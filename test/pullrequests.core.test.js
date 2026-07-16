import { describe, it, expect } from 'vitest';
import * as pr from '../src/core/pullrequests.js';

function stubApi() {
  const calls = [];
  return { calls, get: async (...a) => (calls.push(['get', ...a]), { value: [] }), post: async (...a) => (calls.push(['post', ...a]), { pullRequestId: 1 }) };
}

describe('pullrequests core', () => {
  it('create normalizes refs and never sends completion options', async () => {
    const api = stubApi();
    await pr.create({ api }, 'app', { sourceRef: 'feat/x', targetRef: 'main', title: 'T', workItemIds: [7] });
    const [, path, body] = api.calls.find((c) => c[0] === 'post');
    expect(path).toBe('/git/repositories/app/pullrequests');
    expect(body.sourceRefName).toBe('refs/heads/feat/x');
    expect(body.targetRefName).toBe('refs/heads/main');
    expect(body.workItemRefs).toEqual([{ id: '7' }]);
    expect(body).not.toHaveProperty('completionOptions');
    expect(body).not.toHaveProperty('autoCompleteSetBy');
    expect(JSON.stringify(body)).not.toMatch(/deleteSourceBranch/);
  });

  it('list passes status search criteria', async () => {
    const api = stubApi();
    await pr.list({ api }, 'app', { status: 'active' });
    const [, path, opts] = api.calls.find((c) => c[0] === 'get');
    expect(path).toBe('/git/repositories/app/pullrequests');
    expect(opts.params['searchCriteria.status']).toBe('active');
  });

  it('comment opens an active thread', async () => {
    const api = stubApi();
    await pr.comment({ api }, 'app', 12, 'revisar isto');
    const [, path, body] = api.calls.find((c) => c[0] === 'post');
    expect(path).toBe('/git/repositories/app/pullrequests/12/threads');
    expect(body.comments[0].content).toBe('revisar isto');
    expect(body.status).toBe('active');
  });
});
