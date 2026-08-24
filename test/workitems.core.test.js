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

  it('create refuses a type outside the allowlist before calling the API', async () => {
    const api = stubApi();
    const cfg = { ...config, witTypeAllowlist: ['Task', 'Bug'] };
    await expect(wit.create({ api, config: cfg }, { type: 'Epic', title: 'X' })).rejects.toThrow(/Tipo 'Epic' fora da allowlist/);
    expect(api.calls).toHaveLength(0);
  });

  it('create refuses html with an inline handler', async () => {
    const api = stubApi();
    await expect(wit.create({ api, config }, { type: 'Task', title: 'X', fields: { 'System.Description': '<img src=x onerror=alert(1)>' } }))
      .rejects.toThrow(/HTML executável/);
    expect(api.calls).toHaveLength(0);
  });

  it('create carries tags, area, iteration and extra relations in one patch', async () => {
    const api = stubApi();
    await wit.create({ api, config }, {
      type: 'Feature', title: 'F', tags: ['a', 'b'], areaPath: 'Proj\\Time',
      iterationPath: 'Proj\\Sprint 1', relations: [{ rel: 'System.LinkTypes.Related', url: 'http://srv/col/_apis/wit/workItems/9' }],
    });
    const ops = api.calls.find((c) => c[0] === 'post')[2];
    expect(ops).toContainEqual({ op: 'add', path: '/fields/System.Tags', value: 'a; b' });
    expect(ops).toContainEqual({ op: 'add', path: '/fields/System.AreaPath', value: 'Proj\\Time' });
    expect(ops.filter((o) => o.path === '/relations/-')).toHaveLength(1);
  });

  it('create with validateOnly sends the flag instead of persisting silently', async () => {
    const api = stubApi();
    await wit.create({ api, config }, { type: 'Task', title: 'X', validateOnly: true });
    expect(api.calls.find((c) => c[0] === 'post')[3].params).toEqual({ validateOnly: true });
  });

  it('update sends a rev test op so a concurrent edit fails the write', async () => {
    const api = stubApi();
    await wit.update({ api, config }, { id: 7, state: 'Doing', expectedRev: 12 });
    const ops = api.calls.find((c) => c[0] === 'patch')[2];
    expect(ops[0]).toEqual({ op: 'test', path: '/rev', value: 12 });
  });

  it('update merges tags against the current value instead of overwriting', async () => {
    const api = stubApi({ get: () => ({ value: [{ id: 7, fields: { 'System.TeamProject': 'Proj', 'System.Tags': 'alpha; beta' } }] }) });
    await wit.update({ api, config }, { id: 7, tags: { add: ['gama'], remove: ['alpha'] } });
    const ops = api.calls.find((c) => c[0] === 'patch')[2];
    expect(ops).toContainEqual({ op: 'add', path: '/fields/System.Tags', value: 'beta; gama' });
  });

  it('update of many ids goes through $batch with one entry per id', async () => {
    const api = stubApi();
    await wit.update({ api, config }, { ids: [1, 2, 3], state: 'Done' });
    const batch = api.calls.find((c) => c[0] === 'post' && c[1] === '/wit/$batch')[2];
    expect(batch).toHaveLength(3);
    expect(batch[0].method).toBe('PATCH');
    expect(batch[0].headers['Content-Type']).toBe('application/json-patch+json');
  });

  it('getMany with expand drops the fields param, since the API refuses both', async () => {
    const api = stubApi({ get: () => ({ value: [{ id: 1, fields: { 'System.TeamProject': 'Proj' } }] }) });
    await wit.getMany({ api, config }, [1], undefined, { expand: 'relations' });
    const params = api.calls.find((c) => c[0] === 'get')[2].params;
    expect(params.$expand).toBe('Relations');
    expect(params.fields).toBeUndefined();
  });

  it('tree nests children under their source work item', async () => {
    const api = stubApi({
      post: () => ({ workItemRelations: [
        { rel: null, source: null, target: { id: 1 } },
        { rel: 'System.LinkTypes.Hierarchy-Forward', source: { id: 1 }, target: { id: 2 } },
      ] }),
      get: () => ({ value: [
        { id: 1, fields: { 'System.TeamProject': 'Proj', 'System.Title': 'Epic' } },
        { id: 2, fields: { 'System.TeamProject': 'Proj', 'System.Title': 'Feature' } },
      ] }),
    });
    const roots = await wit.tree({ api, config }, { wiql: 'SELECT [System.Id] FROM WorkItemLinks' });
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe(1);
    expect(roots[0].children.map((c) => c.id)).toEqual([2]);
  });

  it('getOne rejects a work item from another project', async () => {
    const api = stubApi({ get: () => ({ value: [{ id: 9, fields: { 'System.TeamProject': 'Outro' } }] }) });
    await expect(wit.getOne({ api, config }, 9)).rejects.toThrow(/fora do projeto 'Proj': 9/);
  });
});
