import { describe, it, expect } from 'vitest';
import * as discussion from '../src/core/witdiscussion.js';

const config = { project: 'Proj', url: 'http://srv/col', apiVersion: '6.0' };
const item = { value: [{ id: 3, fields: { 'System.TeamProject': 'Proj' } }] };

function stubApi({ comments, updates, onGet, onPost } = {}) {
  const calls = [];
  return {
    calls,
    get: async (path, opts) => {
      calls.push(['get', path, opts]);
      if (path.endsWith('/comments')) {
        if (onGet === 'fail') throw new Error('ADO 404: not found');
        return comments;
      }
      if (path.endsWith('/updates')) return updates ?? { value: [] };
      return item;
    },
    post: async (path, body, opts) => {
      calls.push(['post', path, body, opts]);
      if (onPost === 'fail') throw new Error('ADO 404: not found');
      return { id: 100, text: body.text, createdBy: { displayName: 'Ana' }, createdDate: '2026-01-01' };
    },
    patch: async (path, body, opts) => { calls.push(['patch', path, body, opts]); return { id: 3, rev: 8 }; },
  };
}

const updatesPayload = {
  value: [
    { rev: 2, revisedBy: { displayName: 'Ana' }, fields: { 'System.History': { newValue: 'primeiro' }, 'System.ChangedDate': { newValue: '2026-01-02' } } },
    { rev: 3, revisedBy: { displayName: 'Bruno' }, fields: { 'System.State': { oldValue: 'To Do', newValue: 'Doing' }, 'System.ChangedDate': { newValue: '2026-01-03' } } },
  ],
};

describe('witdiscussion', () => {
  it('reads comments from the preview API with the preview api-version', async () => {
    const api = stubApi({ comments: { comments: [{ id: 1, text: 'oi', createdBy: { displayName: 'Ana' }, createdDate: 'd' }], totalCount: 1 } });
    const res = await discussion.listComments({ api, config }, { id: 3 });
    expect(res.source).toBe('comments-api');
    expect(res.comments[0]).toMatchObject({ id: 1, text: 'oi', createdBy: 'Ana' });
    const call = api.calls.find((c) => c[1].endsWith('/comments'));
    expect(call[2].params['api-version']).toBe('6.0-preview.3');
  });

  it('falls back to System.History when the comments API is absent', async () => {
    const api = stubApi({ onGet: 'fail', updates: updatesPayload });
    const res = await discussion.listComments({ api, config }, { id: 3 });
    expect(res.source).toBe('system-history');
    expect(res.comments).toEqual([{ id: 2, text: 'primeiro', createdBy: 'Ana', createdDate: '2026-01-02', modifiedDate: null }]);
  });

  it('writes through the comments API when available', async () => {
    const api = stubApi();
    const res = await discussion.comment({ api, config }, { id: 3, text: 'olá' });
    expect(res.source).toBe('comments-api');
    expect(api.calls.find((c) => c[0] === 'post')[1]).toBe('/wit/workItems/3/comments');
  });

  it('falls back to a System.History patch when the comments API rejects', async () => {
    const api = stubApi({ onPost: 'fail' });
    const res = await discussion.comment({ api, config }, { id: 3, text: 'olá' });
    expect(res.source).toBe('system-history');
    expect(api.calls.find((c) => c[0] === 'patch')[2]).toEqual([{ op: 'add', path: '/fields/System.History', value: 'olá' }]);
  });

  it('history returns field level diffs and drops bookkeeping fields', async () => {
    const api = stubApi({ updates: updatesPayload });
    const res = await discussion.updates({ api, config }, { id: 3 });
    expect(res[1]).toMatchObject({ rev: 3, by: 'Bruno' });
    expect(res[1].changes).toEqual([{ field: 'System.State', from: 'To Do', to: 'Doing' }]);
  });
});
