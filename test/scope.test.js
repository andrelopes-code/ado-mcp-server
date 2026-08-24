import { describe, it, expect } from 'vitest';
import { createContext } from '../src/core/client.js';
import { scoped, assertProjectAllowed } from '../src/tools/guards.js';
import { registerWorkItemTools } from '../src/tools/workitems.tools.js';

const baseConfig = {
  url: 'http://srv/col', project: 'Alfa', pat: 'x', apiVersion: '6.0', mode: 'read',
  projectAllowlist: ['Beta'], repoAllowlist: [], protectedBranches: [], timeoutMs: 1000,
};

function fakeServer() {
  const tools = {};
  return { tools, registerTool: (name, cfg, handler) => { tools[name] = { cfg, handler }; } };
}

describe('project scope', () => {
  it('always allows the project from the .env', () => {
    expect(() => assertProjectAllowed({ ...baseConfig, projectAllowlist: [] }, 'Alfa')).not.toThrow();
  });

  it('refuses a project outside the allowlist', () => {
    expect(() => assertProjectAllowed(baseConfig, 'Gama')).toThrow(/fora da allowlist: Alfa, Beta/);
  });

  it('accepts any project when the allowlist is *', () => {
    expect(() => assertProjectAllowed({ ...baseConfig, projectAllowlist: ['*'] }, 'Qualquer')).not.toThrow();
  });

  it('createContext gives each project its own client and reuses it', () => {
    const ctx = createContext(baseConfig);
    expect(ctx.config.project).toBe('Alfa');
    const beta = ctx.forProject('Beta');
    expect(beta.config.project).toBe('Beta');
    expect(beta.api).not.toBe(ctx.api);
    expect(ctx.forProject('Beta').api).toBe(beta.api);
  });

  it('the scoped client points its baseURL at the requested project', () => {
    const ctx = createContext(baseConfig);
    expect(ctx.forProject('Beta').api.baseURL).toBe('http://srv/col/Beta/_apis');
  });

  it('scoped returns the same ctx when no project is given', () => {
    const ctx = createContext(baseConfig);
    expect(scoped(ctx, undefined)).toBe(ctx);
    expect(scoped(ctx, 'Alfa')).toBe(ctx);
  });

  it('a tool call with a foreign project fails before any request', async () => {
    const server = fakeServer();
    const ctx = createContext(baseConfig);
    registerWorkItemTools(server, ctx);
    await expect(server.tools.wit_get.handler({ ids: [1], project: 'Gama' })).rejects.toThrow(/fora da allowlist/);
  });
});
