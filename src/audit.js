import { appendFile, rename, stat } from 'node:fs/promises';

const MAX_BYTES = 5 * 1024 * 1024;

async function rotateIfLarge(file) {
  try {
    const { size } = await stat(file);
    if (size >= MAX_BYTES) await rename(file, `${file}.1`);
  } catch {
    // log ainda não existe, ou rotação falhou: seguir e apenas anexar
  }
}

async function auditWrite(config, entry) {
  await rotateIfLarge(config.auditLog);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  await appendFile(config.auditLog, line, 'utf8');
}

// Nunca deixa a trilha de auditoria derrubar (nem mascarar) uma mutação já enviada ao ADO.
async function auditSafe(config, entry) {
  try {
    await auditWrite(config, entry);
    return null;
  } catch (err) {
    return err.message;
  }
}

export { auditWrite, auditSafe, MAX_BYTES };
