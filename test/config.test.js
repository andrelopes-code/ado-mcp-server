import { describe, it, expect } from 'vitest';
import { readConfig } from '../src/config.js';

const base = { DEVOPS_URL: 'http://srv/col/', DEVOPS_PROJECT: 'Proj', DEVOPS_PAT: 'secret' };

describe('readConfig', () => {
  it('throws when required vars are missing', () => {
    expect(() => readConfig({})).toThrow(/DEVOPS_URL/);
    expect(() => readConfig({ DEVOPS_URL: 'x' })).toThrow(/DEVOPS_PROJECT/);
  });

  it('strips trailing slashes from url and applies defaults', () => {
    const c = readConfig(base);
    expect(c.url).toBe('http://srv/col');
    expect(c.apiVersion).toBe('6.0');
    expect(c.mode).toBe('read');
    expect(c.protectedBranches).toEqual(['main', 'master', 'develop', 'release/*']);
    expect(c.repoAllowlist).toEqual([]);
  });

  it('parses write mode and allowlist', () => {
    const c = readConfig({ ...base, ADO_MODE: 'write', ADO_REPO_ALLOWLIST: 'a, b ,c' });
    expect(c.mode).toBe('write');
    expect(c.repoAllowlist).toEqual(['a', 'b', 'c']);
  });

  it('defaults unknown mode to read', () => {
    expect(readConfig({ ...base, ADO_MODE: 'yolo' }).mode).toBe('read');
  });
});
