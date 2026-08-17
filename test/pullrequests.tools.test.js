import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { registerPullRequestTools } from '../src/tools/pullrequests.tools.js';

const audit = './test-pr-tools-audit.log';
afterEach(() => rm(audit, { force: true }));

function fakeServer() {
  const tools = {};
  return { tools, registerTool: (name, _cfg, handler) => { tools[name] = { handler }; } };
}
const stubApi = { get: async () => ({ value: [] }), post: async () => ({ pullRequestId: 55 }), patch: async () => ({ pullRequestId: 55 }) };
const cfg = (over = {}) => ({ project: 'Proj', url: 'u', mode: 'write', repoAllowlist: [], protectedBranches: ['main'], auditLog: audit, ...over });

describe('pr tools', () => {
  it('pr_create rejects repo outside allowlist', async () => {
    const server = fakeServer();
    registerPullRequestTools(server, { api: stubApi, config: cfg({ repoAllowlist: ['only'] }) });
    await expect(server.tools.pr_create.handler({ repo: 'other', source: 'f', target: 'main', title: 'T', confirm: true }))
      .rejects.toThrow(/allowlist/);
  });

  it('pr_create preview flags a protected target branch', async () => {
    const server = fakeServer();
    registerPullRequestTools(server, { api: stubApi, config: cfg() });
    const res = await server.tools.pr_create.handler({ repo: 'app', source: 'feat/x', target: 'main', title: 'T' });
    expect(res.content[0].text).toMatch(/PREVIEW/);
    expect(res.content[0].text).toMatch(/protegida/);
  });

  it('pr_create executes with confirm', async () => {
    const server = fakeServer();
    registerPullRequestTools(server, { api: stubApi, config: cfg() });
    const res = await server.tools.pr_create.handler({ repo: 'app', source: 'feat/x', target: 'dev', title: 'T', confirm: true });
    expect(res.content[0].text).toMatch(/APLICADO/);
  });

  it('pr_update recusa chamada sem campo algum', async () => {
    const server = fakeServer();
    registerPullRequestTools(server, { api: stubApi, config: cfg() });
    const res = await server.tools.pr_update.handler({ repo: 'app', prId: 5, confirm: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Nada a alterar/);
  });

  it('pr_update sem confirm só mostra o que mudaria', async () => {
    const server = fakeServer();
    registerPullRequestTools(server, { api: stubApi, config: cfg() });
    const res = await server.tools.pr_update.handler({ repo: 'app', prId: 5, title: 'Novo título' });
    expect(res.content[0].text).toMatch(/PREVIEW/);
    expect(res.content[0].text).toMatch(/Novo título/);
  });

  it('pr_update executes with confirm', async () => {
    const server = fakeServer();
    registerPullRequestTools(server, { api: stubApi, config: cfg() });
    const res = await server.tools.pr_update.handler({ repo: 'app', prId: 5, description: 'D', confirm: true });
    expect(res.content[0].text).toMatch(/APLICADO/);
  });

  it('pr_update em modo leitura não envia nada', async () => {
    const server = fakeServer();
    registerPullRequestTools(server, { api: stubApi, config: cfg({ mode: 'read' }) });
    const res = await server.tools.pr_update.handler({ repo: 'app', prId: 5, description: 'D', confirm: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/BLOQUEADA/);
  });
});
