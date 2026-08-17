import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm, writeFile, stat } from 'node:fs/promises';
import { auditWrite, auditSafe, MAX_BYTES } from '../src/audit.js';

const file = './test-audit.log';
afterEach(() => Promise.all([rm(file, { force: true }), rm(`${file}.1`, { force: true })]));

describe('auditWrite', () => {
  it('appends a JSON line with a timestamp', async () => {
    await auditWrite({ auditLog: file }, { tool: 'wit_create', resultId: 42 });
    await auditWrite({ auditLog: file }, { tool: 'wit_update', resultId: 7 });
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.tool).toBe('wit_create');
    expect(first.resultId).toBe(42);
    expect(typeof first.ts).toBe('string');
  });

  it('rotates to .1 once the log passes the size cap', async () => {
    await writeFile(file, 'x'.repeat(MAX_BYTES), 'utf8');
    await auditWrite({ auditLog: file }, { tool: 'wit_create', resultId: 1 });
    expect((await stat(`${file}.1`)).size).toBe(MAX_BYTES);
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
  });
});

describe('auditSafe', () => {
  it('returns null on success and the error message on failure', async () => {
    expect(await auditSafe({ auditLog: file }, { tool: 't' })).toBeNull();
    expect(await auditSafe({ auditLog: './no-such-dir/audit.log' }, { tool: 't' })).toMatch(/ENOENT/);
  });
});
