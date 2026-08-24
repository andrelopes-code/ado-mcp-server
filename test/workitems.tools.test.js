import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { registerWorkItemTools } from '../src/tools/workitems.tools.js';

const audit = './test-wit-tools-audit.log';
afterEach(() => rm(audit, { force: true }));

function fakeServer() {
  const tools = {};
  return { tools, registerTool: (name, cfg, handler) => { tools[name] = { cfg, handler }; } };
}
function stubApi(over = {}) {
  return {
    get: async () => over.get?.() ?? { value: [{ id: 3, fields: { 'System.TeamProject': 'Proj', 'System.State': 'To Do' } }] },
    post: async () => over.post?.() ?? { id: 100 },
    patch: async () => over.patch?.() ?? { id: 3 },
  };
}
const baseCfg = { project: 'Proj', url: 'http://srv/col', mode: 'read', repoAllowlist: [], protectedBranches: [], auditLog: audit };

describe('wit tools', () => {
  it('wit_update in read mode returns blocked and shows before/after', async () => {
    const server = fakeServer();
    registerWorkItemTools(server, { api: stubApi(), config: baseCfg });
    const res = await server.tools.wit_update.handler({ id: 3, state: 'Doing', confirm: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/BLOQUEADA/);
    expect(res.content[0].text).toMatch(/To Do/); // current value surfaced in preview
  });

  it('wit_create with write + confirm executes', async () => {
    const server = fakeServer();
    registerWorkItemTools(server, { api: stubApi(), config: { ...baseCfg, mode: 'write' } });
    const res = await server.tools.wit_create.handler({ type: 'Task', title: 'X', confirm: true });
    expect(res.content[0].text).toMatch(/APLICADO/);
  });

  it('wit_get rejects ids from another project', async () => {
    const server = fakeServer();
    const api = stubApi({ get: () => ({ value: [
      { id: 3, fields: { 'System.TeamProject': 'Proj' } },
      { id: 9, fields: { 'System.TeamProject': 'Outro' } },
    ] }) });
    registerWorkItemTools(server, { api, config: baseCfg });
    await expect(server.tools.wit_get.handler({ ids: [3, 9] })).rejects.toThrow(/fora do projeto 'Proj'/);
  });
});

describe('wit tools — extensão', () => {
  const item = (id, fields = {}) => ({ id, fields: { 'System.TeamProject': 'Proj', 'System.State': 'To Do', ...fields } });

  function routedApi({ onPost, onPatch, get } = {}) {
    const calls = [];
    return {
      calls,
      get: async (path, opts) => { calls.push(['get', path, opts]); return get?.(path, opts) ?? { value: [item(3)] }; },
      post: async (path, body, opts) => { calls.push(['post', path, body, opts]); return onPost?.(path, body, opts) ?? { id: 100 }; },
      patch: async (path, body, opts) => { calls.push(['patch', path, body, opts]); return onPatch?.(path, body, opts) ?? { id: 3 }; },
    };
  }
  const writeCfg = { ...baseCfg, mode: 'write' };

  function register(api, config = writeCfg) {
    const server = fakeServer();
    registerWorkItemTools(server, { api, config, forProject: () => { throw new Error('sem troca de projeto'); } });
    return server;
  }

  it('preview of wit_create asks the server to validate without persisting', async () => {
    const api = routedApi({ onPost: (path, body, opts) => {
      if (opts?.params?.validateOnly) return { id: 0 };
      throw new Error('não deveria persistir no preview');
    } });
    const server = register(api);
    const res = await server.tools.wit_create.handler({ type: 'Task', title: 'X' });
    expect(res.content[0].text).toMatch(/PREVIEW/);
    expect(res.content[0].text).toMatch(/validateOnly\): aceita/);
  });

  it('preview of wit_create surfaces a process rule rejection', async () => {
    const api = routedApi({ onPost: (path, body, opts) => {
      if (opts?.params?.validateOnly) throw new Error('ADO 400: campo obrigatório ausente');
      return { id: 100 };
    } });
    const server = register(api);
    const res = await server.tools.wit_create.handler({ type: 'Task', title: 'X' });
    expect(res.content[0].text).toMatch(/RECUSOU: ADO 400: campo obrigatório ausente/);
  });

  it('wit_create resolves relations before the preview, so a bad target fails early', async () => {
    const api = routedApi({ get: () => ({ value: [{ id: 9, fields: { 'System.TeamProject': 'Outro' } }] }) });
    const server = register(api);
    await expect(server.tools.wit_create.handler({ type: 'Task', title: 'X', relations: [{ rel: 'related', targetId: 9 }] }))
      .rejects.toThrow(/fora do projeto 'Proj'/);
    expect(api.calls.some((c) => c[0] === 'post')).toBe(false);
  });

  it('wit_update previews the current value of every id in the batch', async () => {
    const api = routedApi({ get: () => ({ value: [item(3), item(4, { 'System.State': 'Doing' })] }) });
    const server = register(api);
    const res = await server.tools.wit_update.handler({ ids: [3, 4], state: 'Done' });
    const text = res.content[0].text;
    expect(text).toMatch(/"id": 3/);
    expect(text).toMatch(/"id": 4/);
    expect(text).toMatch(/"System.State": "Doing"/);
  });

  it('wit_unlink shows the current relations before removing anything', async () => {
    const api = routedApi({ get: () => ({ value: [{ ...item(3), relations: [{ rel: 'System.LinkTypes.Related', url: 'http://srv/col/Proj/_apis/wit/workItems/7' }] }] }) });
    const server = register(api);
    const res = await server.tools.wit_unlink.handler({ id: 3, rel: 'related', targetId: 7 });
    expect(res.content[0].text).toMatch(/currentRelations/);
    expect(api.calls.some((c) => c[0] === 'patch')).toBe(false);
  });

  it('records the project in the audit trail of an applied write', async () => {
    const api = routedApi();
    const server = register(api);
    await server.tools.wit_comment.handler({ id: 3, text: 'oi', confirm: true });
    const line = JSON.parse((await readFile(audit, 'utf8')).trim().split('\n').pop());
    expect(line).toMatchObject({ tool: 'wit_comment', outcome: 'applied', args: { project: 'Proj', id: 3 } });
  });

  it('blocks a write in read mode before touching the API', async () => {
    const api = routedApi();
    const server = register(api, baseCfg);
    const res = await server.tools.wit_link.handler({ id: 3, rel: 'related', targetId: 7, confirm: true });
    expect(res.isError).toBe(true);
    expect(api.calls.some((c) => c[0] === 'patch')).toBe(false);
  });
});
