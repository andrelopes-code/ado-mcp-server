import { describe, it, expect, afterEach, vi } from 'vitest';
import { isAbsolute } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { readConfig, currentMode } from '../src/config.js';

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

  it('exposes the resolved .env path for live mode reload', () => {
    const c = readConfig(base);
    expect(isAbsolute(c.envPath)).toBe(true);
    expect(c.envPath.endsWith('/.env')).toBe(true);
  });

  it('defaults the timeout and accepts a valid override, ignoring junk', () => {
    expect(readConfig(base).timeoutMs).toBe(30000);
    expect(readConfig({ ...base, ADO_TIMEOUT_MS: '5000' }).timeoutMs).toBe(5000);
    expect(readConfig({ ...base, ADO_TIMEOUT_MS: 'abc' }).timeoutMs).toBe(30000);
    expect(readConfig({ ...base, ADO_TIMEOUT_MS: '-1' }).timeoutMs).toBe(30000);
  });

  it('warns on stderr when the PAT would travel over plain http, and stays quiet on https', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    readConfig(base);
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/http.*sem TLS/));
    spy.mockClear();
    readConfig({ ...base, DEVOPS_URL: 'https://srv/col' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('currentMode (live reload)', () => {
  const f = './test-live-env';
  afterEach(() => rmSync(f, { force: true }));

  it('reads ADO_MODE live from the given env file', () => {
    writeFileSync(f, 'ADO_MODE=write\n');
    expect(currentMode('read', f)).toBe('write');
    writeFileSync(f, 'ADO_MODE=read\n');
    expect(currentMode('read', f)).toBe('read');
  });

  it('normalizes any non-write value to read', () => {
    writeFileSync(f, 'ADO_MODE=yolo\n');
    expect(currentMode('write', f)).toBe('read');
  });

  it('falls back to the boot mode when the file lacks ADO_MODE, is missing, or no path is given', () => {
    writeFileSync(f, 'FOO=bar\n');
    expect(currentMode('write', f)).toBe('write');
    expect(currentMode('read', './does-not-exist-xyz')).toBe('read');
    expect(currentMode('write')).toBe('write');
  });
});
