import { config as loadEnv, parse as parseEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = resolve(SERVER_DIR, '.env');
loadEnv({ path: ENV_PATH });

const REQUIRED = ['DEVOPS_URL', 'DEVOPS_PROJECT', 'DEVOPS_PAT'];

function toMode(value) {
  return value === 'write' ? 'write' : 'read';
}

function splitList(value, fallback = []) {
  const parts = String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : fallback;
}

function readConfig(env = process.env) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Config inválida: faltam variáveis obrigatórias no .env: ${missing.join(', ')}`);
  }
  return {
    url: env.DEVOPS_URL.replace(/\/+$/, ''),
    project: env.DEVOPS_PROJECT,
    pat: env.DEVOPS_PAT,
    apiVersion: env.API_VERSION || '6.0',
    mode: toMode(env.ADO_MODE),
    repoAllowlist: splitList(env.ADO_REPO_ALLOWLIST),
    protectedBranches: splitList(env.ADO_PROTECTED_BRANCHES, ['main', 'master', 'develop', 'release/*']),
    auditLog: resolve(SERVER_DIR, env.ADO_AUDIT_LOG || 'ado-mcp-audit.log'),
    envPath: ENV_PATH,
  };
}

function currentMode(fallback = 'read', envPath) {
  if (!envPath) return fallback;
  try {
    const parsed = parseEnv(readFileSync(envPath, 'utf8'));
    if ('ADO_MODE' in parsed) return toMode(parsed.ADO_MODE);
  } catch {
    // .env ausente/ilegível em runtime: mantém a postura definida no boot em vez de derrubar a escrita
  }
  return fallback;
}

export { readConfig, currentMode };
