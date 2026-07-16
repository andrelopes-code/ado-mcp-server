import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
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
});
