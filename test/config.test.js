import { describe, it, expect } from 'vitest';
import { isAbsolute } from 'node:path';
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

  it('anchors the default audit log to the server dir as an absolute path', () => {
    const c = readConfig(base);
    expect(isAbsolute(c.auditLog)).toBe(true);
    expect(c.auditLog.endsWith('/ado-mcp-audit.log')).toBe(true);
  });

  it('resolves a relative ADO_AUDIT_LOG against the server dir; leaves absolute as-is', () => {
    const rel = readConfig({ ...base, ADO_AUDIT_LOG: 'logs/x.log' }).auditLog;
    expect(isAbsolute(rel)).toBe(true);
    expect(rel.endsWith('/logs/x.log')).toBe(true);
    expect(readConfig({ ...base, ADO_AUDIT_LOG: '/var/tmp/a.log' }).auditLog).toBe('/var/tmp/a.log');
  });
});
