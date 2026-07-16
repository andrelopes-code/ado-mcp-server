import { describe, it, expect } from 'vitest';
import { registerWorkItemTools } from '../src/tools/workitems.tools.js';
import { registerPullRequestTools } from '../src/tools/pullrequests.tools.js';
import { registerRepoTools } from '../src/tools/repos.tools.js';

function fakeServer() {
  const names = [];
  return { names, registerTool: (name) => names.push(name) };
}

describe('tool surface', () => {
  it('registers exactly the expected 13 tools, none destructive', () => {
    const server = fakeServer();
    const ctx = { api: {}, config: { repoAllowlist: [], protectedBranches: [] } };
    registerWorkItemTools(server, ctx);
    registerPullRequestTools(server, ctx);
    registerRepoTools(server, ctx);
    expect(server.names.sort()).toEqual([
      'branch_list', 'commit_list', 'pr_add_reviewers', 'pr_comment', 'pr_create',
      'pr_get', 'pr_list', 'repo_list', 'wit_comment', 'wit_create', 'wit_get', 'wit_query', 'wit_update',
    ]);
    for (const forbidden of ['delete', 'abandon', 'complete', 'merge', 'remove']) {
      expect(server.names.some((n) => n.includes(forbidden))).toBe(false);
    }
  });
});
