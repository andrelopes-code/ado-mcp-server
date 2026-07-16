import { appendFile } from 'node:fs/promises';

async function auditWrite(config, entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  await appendFile(config.auditLog, line, 'utf8');
}

export { auditWrite };
