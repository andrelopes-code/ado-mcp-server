import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { auditWrite } from '../src/audit.js';

const file = './test-audit.log';
afterEach(() => rm(file, { force: true }));

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
});
