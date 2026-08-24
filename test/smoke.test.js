import { describe, it, expect } from 'vitest';
import { registerWorkItemTools } from '../src/tools/workitems.tools.js';
import { registerPullRequestTools } from '../src/tools/pullrequests.tools.js';
import { registerRepoTools } from '../src/tools/repos.tools.js';
import { registerProjectTools } from '../src/tools/projects.tools.js';

function fakeServer() {
  const names = [];
  const schemas = {};
  return { names, schemas, registerTool: (name, cfg) => { names.push(name); schemas[name] = cfg.inputSchema; } };
}

const EXPECTED = [
  'branch_list', 'commit_list', 'pr_add_reviewers', 'pr_comment', 'pr_create',
  'pr_get', 'pr_list', 'pr_update', 'project_list', 'repo_list',
  'wit_attach', 'wit_comment', 'wit_comments', 'wit_create', 'wit_get', 'wit_history',
  'wit_link', 'wit_meta', 'wit_query', 'wit_tree', 'wit_unlink', 'wit_update',
];

function registerAll(server) {
  const ctx = { api: {}, config: { repoAllowlist: [], protectedBranches: [], projectAllowlist: [], project: 'Proj' } };
  registerWorkItemTools(server, ctx);
  registerPullRequestTools(server, ctx);
  registerRepoTools(server, ctx);
  registerProjectTools(server, ctx);
}

describe('tool surface', () => {
  it(`registers exactly the expected ${EXPECTED.length} tools, none destructive`, () => {
    const server = fakeServer();
    registerAll(server);
    expect(server.names.sort()).toEqual(EXPECTED);
    for (const forbidden of ['delete', 'abandon', 'complete', 'merge', 'remove', 'destroy']) {
      expect(server.names.some((n) => n.includes(forbidden))).toBe(false);
    }
  });

  it('every tool but project_list accepts a project override', () => {
    const server = fakeServer();
    registerAll(server);
    const missing = server.names.filter((n) => n !== 'project_list' && !server.schemas[n].project);
    expect(missing).toEqual([]);
  });

  it('every write tool requires confirm', () => {
    const server = fakeServer();
    registerAll(server);
    const writes = ['wit_create', 'wit_update', 'wit_link', 'wit_unlink', 'wit_comment', 'wit_attach',
      'pr_create', 'pr_update', 'pr_add_reviewers', 'pr_comment'];
    for (const name of writes) expect(server.schemas[name].confirm).toBeDefined();
  });
});
