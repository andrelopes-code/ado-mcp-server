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
  const inProject = (id) => ({ id, fields: { 'System.TeamProject': 'Proj' } });

  it('query uses preset WIQL then hydrates returned ids', async () => {
    const api = stubApi({
      post: () => ({ workItems: [{ id: 10 }, { id: 11 }] }),
      get: () => ({ value: [inProject(10), inProject(11)] }),
    });
    const items = await wit.query({ api, config }, { preset: 'my_active' });
    expect(items).toHaveLength(2);
    const wiqlCall = api.calls.find((c) => c[0] === 'post' && c[1] === '/wit/wiql');
    expect(wiqlCall[2].query).toMatch(/@Me/);
  });

  it('query rejects results that a WIQL pulled in from another project', async () => {
    const api = stubApi({
      post: () => ({ workItems: [{ id: 10 }, { id: 99 }] }),
      get: () => ({ value: [inProject(10), { id: 99, fields: { 'System.TeamProject': 'Outro' } }] }),
    });
    await expect(wit.query({ api, config }, { wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'Outro'" }))
      .rejects.toThrow(/fora do projeto 'Proj': 99/);
  });

  it('getMany always asks for the project field, even with custom fields', async () => {
    const api = stubApi({ get: () => ({ value: [inProject(1)] }) });
    await wit.getMany({ api, config }, [1], ['System.Title']);
    const call = api.calls.find((c) => c[0] === 'get');
    expect(call[2].params.fields).toContain('System.TeamProject');
  });

  it('getMany refuses more ids than the ADO limit before calling the API', async () => {
    const api = stubApi();
    const ids = Array.from({ length: wit.MAX_IDS + 1 }, (_, i) => i + 1);
    await expect(wit.getMany({ api, config }, ids)).rejects.toThrow(/Máximo de 200 ids/);
    expect(api.calls).toHaveLength(0);
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

  it('update builds a json-patch with state and fields plus the json-patch content-type', async () => {
    const api = stubApi();
    await wit.update({ api, config }, { id: 7, state: 'Doing', fields: { 'System.AssignedTo': 'me' } });
    const call = api.calls.find((c) => c[0] === 'patch' && c[1] === '/wit/workitems/7');
    expect(call[2]).toContainEqual({ op: 'add', path: '/fields/System.State', value: 'Doing' });
    expect(call[2]).toContainEqual({ op: 'add', path: '/fields/System.AssignedTo', value: 'me' });
    expect(call[3].headers['Content-Type']).toBe('application/json-patch+json');
  });

  it('comment posts via System.History', async () => {
    const api = stubApi();
    await wit.comment({ api, config }, { id: 3, text: 'oi' });
    const call = api.calls.find((c) => c[0] === 'patch');
    expect(call[2]).toEqual([{ op: 'add', path: '/fields/System.History', value: 'oi' }]);
  });

  it('getOne rejects a work item from another project', async () => {
    const api = stubApi({ get: () => ({ value: [{ id: 9, fields: { 'System.TeamProject': 'Outro' } }] }) });
    await expect(wit.getOne({ api, config }, 9)).rejects.toThrow(/fora do projeto 'Proj': 9/);
  });
});
