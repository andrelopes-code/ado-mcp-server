import 'dotenv/config';

const REQUIRED = ['DEVOPS_URL', 'DEVOPS_PROJECT', 'DEVOPS_PAT'];

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
    mode: env.ADO_MODE === 'write' ? 'write' : 'read',
    repoAllowlist: splitList(env.ADO_REPO_ALLOWLIST),
    protectedBranches: splitList(env.ADO_PROTECTED_BRANCHES, ['main', 'master', 'develop', 'release/*']),
    auditLog: env.ADO_AUDIT_LOG || './ado-mcp-audit.log',
  };
}

export { readConfig };
