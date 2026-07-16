import { describe, it, expect } from 'vitest';
import * as repos from '../src/core/repos.js';

function stubApi(payload) {
  const calls = [];
  return { calls, get: async (...a) => (calls.push(a), payload) };
}

describe('repos core', () => {
  it('lists repos slimmed', async () => {
    const api = stubApi({ value: [{ id: 'a', name: 'app', defaultBranch: 'refs/heads/main', extra: 1 }] });
    const out = await repos.listRepos({ api });
    expect(out).toEqual([{ id: 'a', name: 'app', defaultBranch: 'refs/heads/main' }]);
  });

  it('branches strip refs/heads/ and filter by heads/<filter>', async () => {
    const api = stubApi({ value: [{ name: 'refs/heads/feat/x', objectId: 'sha' }] });
    const out = await repos.listBranches({ api }, 'app', 'feat');
    expect(out).toEqual([{ name: 'feat/x', objectId: 'sha' }]);
    expect(api.calls[0][1].params.filter).toBe('heads/feat');
  });

  it('commits pass branch as itemVersion and top', async () => {
    const api = stubApi({ value: [{ commitId: 'abcdef1234', comment: 'c', author: { name: 'A', date: 'd' } }] });
    const out = await repos.listCommits({ api }, 'app', { branch: 'main', top: 5 });
    expect(out[0]).toEqual({ id: 'abcdef12', comment: 'c', author: 'A', date: 'd' });
    expect(api.calls[0][1].params['searchCriteria.itemVersion.version']).toBe('main');
    expect(api.calls[0][1].params['searchCriteria.$top']).toBe(5);
  });
});
