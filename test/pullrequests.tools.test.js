import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { registerPullRequestTools } from '../src/tools/pullrequests.tools.js';

const audit = './test-pr-tools-audit.log';
afterEach(() => rm(audit, { force: true }));

function fakeServer() {
  const tools = {};
  return { tools, registerTool: (name, _cfg, handler) => { tools[name] = { handler }; } };
}
const stubApi = { get: async () => ({ value: [] }), post: async () => ({ pullRequestId: 55 }) };
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
});
