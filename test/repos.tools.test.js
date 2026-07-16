import { describe, it, expect } from 'vitest';
import { registerRepoTools } from '../src/tools/repos.tools.js';

function fakeServer() {
  const tools = {};
  return { tools, registerTool: (name, cfg, handler) => { tools[name] = { handler }; } };
}
const stubApi = { get: async () => ({ value: [{ id: 'a', name: 'app', defaultBranch: 'refs/heads/main' }, { id: 'b', name: 'infra' }] }) };

describe('repo tools', () => {
  it('repo_list filters by allowlist', async () => {
    const server = fakeServer();
    registerRepoTools(server, { api: stubApi, config: { repoAllowlist: ['app'], protectedBranches: [] } });
    const res = await server.tools.repo_list.handler({});
    const out = JSON.parse(res.content[0].text);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('app');
  });

  it('branch_list enforces allowlist', async () => {
    const server = fakeServer();
    registerRepoTools(server, { api: stubApi, config: { repoAllowlist: ['app'], protectedBranches: [] } });
    await expect(server.tools.branch_list.handler({ repo: 'infra' })).rejects.toThrow(/allowlist/);
  });
});
