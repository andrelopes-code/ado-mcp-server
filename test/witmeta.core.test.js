import { describe, it, expect } from 'vitest';
import { meta, KINDS } from '../src/core/witmeta.js';

const config = { project: 'Proj', url: 'http://srv/col', apiVersion: '6.0' };

function stubApi(handler) {
  const calls = [];
  return { calls, get: async (path, opts) => { calls.push([path, opts]); return handler(path, opts); } };
}

describe('witmeta', () => {
  it('exposes the documented kinds', () => {
    expect(KINDS).toContain('relationtypes');
    expect(KINDS).toContain('iterations');
  });

  it('reads relation types from the organization scope, outside the project baseURL', async () => {
    const api = stubApi(() => ({ value: [{ referenceName: 'System.LinkTypes.Related', name: 'Related', attributes: { usage: 'workItemLink' } }] }));
    const res = await meta({ api, config }, { kind: 'relationtypes' });
    expect(api.calls[0][0]).toBe('http://srv/col/_apis/wit/workitemrelationtypes');
    expect(res[0].referenceName).toBe('System.LinkTypes.Related');
  });

  it('falls back to the System.State allowed values when the states endpoint is missing', async () => {
    const api = stubApi((path) => {
      if (path.endsWith('/states')) throw new Error('ADO 404: not found');
      return { allowedValues: ['New', 'Active', 'Closed'] };
    });
    const res = await meta({ api, config }, { kind: 'states', type: 'Bug' });
    expect(res).toEqual([{ name: 'New', category: null }, { name: 'Active', category: null }, { name: 'Closed', category: null }]);
  });

  it('flattens the area tree into full paths', async () => {
    const api = stubApi(() => ({ name: 'Proj', children: [{ name: 'Time A', children: [{ name: 'Squad 1' }] }] }));
    const res = await meta({ api, config }, { kind: 'areas', depth: 3 });
    expect(res.map((n) => n.path)).toEqual(['Proj', 'Proj\\Time A', 'Proj\\Time A\\Squad 1']);
  });

  it('asks tags with the preview api-version', async () => {
    const api = stubApi(() => ({ value: [{ name: 'debito-tecnico' }] }));
    const res = await meta({ api, config }, { kind: 'tags' });
    expect(api.calls[0][1].params['api-version']).toBe('6.0-preview.1');
    expect(res).toEqual(['debito-tecnico']);
  });

  it('rejects an unknown kind', async () => {
    await expect(meta({ api: stubApi(() => ({})), config }, { kind: 'boards' })).rejects.toThrow(/kind inválido/);
  });

  it('requires a type for states and fields', async () => {
    await expect(meta({ api: stubApi(() => ({})), config }, { kind: 'fields' })).rejects.toThrow(/exige type/);
  });
});
