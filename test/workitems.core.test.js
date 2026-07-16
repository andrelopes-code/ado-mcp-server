import { describe, it, expect } from 'vitest';
import * as wit from '../src/core/workitems.js';

function stubApi(over = {}) {
  const calls = [];
  return {
    calls,
    get: async (path, opts) => { calls.push(['get', path, opts]); return over.get?.(path, opts) ?? { value: [] }; },
    post: async (path, body, opts) => { calls.push(['post', path, body, opts]); return over.post?.(path, body, opts) ?? { id: 1 }; },
    patch: async (path, body, opts) => { calls.push(['patch', path, body, opts]); return over.patch?.(path, body, opts) ?? { id: 1 }; },
  };
}
const config = { project: 'Proj', url: 'http://srv/col' };

describe('workitems core', () => {
  it('query uses preset WIQL then hydrates returned ids', async () => {
    const api = stubApi({
      post: () => ({ workItems: [{ id: 10 }, { id: 11 }] }),
      get: () => ({ value: [{ id: 10 }, { id: 11 }] }),
    });
    const items = await wit.query({ api, config }, { preset: 'my_active' });
    expect(items).toHaveLength(2);
    const wiqlCall = api.calls.find((c) => c[0] === 'post' && c[1] === '/wit/wiql');
    expect(wiqlCall[2].query).toMatch(/@Me/);
  });

  it('create builds a json-patch with title and parent relation', async () => {
    const api = stubApi();
    await wit.create({ api, config }, { type: 'Task', title: 'Doc', parentId: 5 });
    const call = api.calls.find((c) => c[0] === 'post' && c[1] === '/wit/workitems/$Task');
    const ops = call[2];
    expect(ops[0]).toEqual({ op: 'add', path: '/fields/System.Title', value: 'Doc' });
    expect(call[3].headers['Content-Type']).toBe('application/json-patch+json');
    const rel = ops.find((o) => o.path === '/relations/-');
    expect(rel.value.url).toContain('/wit/workItems/5');
  });

  it('update throws when nothing to change', async () => {
    await expect(wit.update({ api: stubApi(), config }, { id: 1 })).rejects.toThrow(/Nada para atualizar/);
  });

  it('comment posts via System.History', async () => {
    const api = stubApi();
    await wit.comment({ api, config }, { id: 3, text: 'oi' });
    const call = api.calls.find((c) => c[0] === 'patch');
    expect(call[2]).toEqual([{ op: 'add', path: '/fields/System.History', value: 'oi' }]);
  });

  it('getOne rejects a work item from another project', async () => {
    const api = stubApi({ get: () => ({ value: [{ id: 9, fields: { 'System.TeamProject': 'Outro' } }] }) });
    await expect(wit.getOne({ api, config }, 9)).rejects.toThrow(/fora de 'Proj'/);
  });
});
