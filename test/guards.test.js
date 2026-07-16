import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { assertRepoAllowed, isProtectedBranch, runWrite, textResult } from '../src/tools/guards.js';

const audit = './test-guards-audit.log';
afterEach(() => rm(audit, { force: true }));

const cfg = (over = {}) => ({ mode: 'read', repoAllowlist: [], protectedBranches: ['main', 'release/*'], auditLog: audit, ...over });

describe('assertRepoAllowed', () => {
  it('allows everything when allowlist empty', () => {
    expect(() => assertRepoAllowed(cfg(), 'anything')).not.toThrow();
  });
  it('throws for repo outside a non-empty allowlist', () => {
    expect(() => assertRepoAllowed(cfg({ repoAllowlist: ['app'] }), 'other')).toThrow(/allowlist/);
  });
});

describe('isProtectedBranch', () => {
  it('matches exact and glob, stripping refs/heads/', () => {
    const c = cfg();
    expect(isProtectedBranch(c, 'main')).toBe(true);
    expect(isProtectedBranch(c, 'refs/heads/main')).toBe(true);
    expect(isProtectedBranch(c, 'release/1.2')).toBe(true);
    expect(isProtectedBranch(c, 'feature/x')).toBe(false);
  });
});

describe('runWrite', () => {
  const preview = { action: 'demo' };
  it('blocks in read mode and does not execute', async () => {
    let ran = false;
    const res = await runWrite({ ctx: { config: cfg() }, tool: 't', args: {}, confirm: true, preview, execute: async () => { ran = true; } });
    expect(ran).toBe(false);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/BLOQUEADA/);
  });
  it('previews when confirm is not true', async () => {
    let ran = false;
    const res = await runWrite({ ctx: { config: cfg({ mode: 'write' }) }, tool: 't', args: {}, confirm: false, preview, execute: async () => { ran = true; } });
    expect(ran).toBe(false);
    expect(res.content[0].text).toMatch(/PREVIEW/);
  });
  it('executes and audits when write + confirm', async () => {
    const res = await runWrite({ ctx: { config: cfg({ mode: 'write' }) }, tool: 'wit_create', args: { title: 'x' }, confirm: true, preview, execute: async () => ({ id: 99 }) });
    expect(res.content[0].text).toMatch(/APLICADO/);
    const logged = JSON.parse((await readFile(audit, 'utf8')).trim());
    expect(logged.tool).toBe('wit_create');
    expect(logged.resultId).toBe(99);
  });
});
