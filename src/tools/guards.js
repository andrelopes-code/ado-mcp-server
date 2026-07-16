import { auditWrite } from '../audit.js';

const fmt = (v) => JSON.stringify(v, null, 2);

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

function assertRepoAllowed(config, repo) {
  if (config.repoAllowlist.length && !config.repoAllowlist.includes(repo)) {
    throw new Error(`Repo '${repo}' fora da allowlist: ${config.repoAllowlist.join(', ')}.`);
  }
}

function isProtectedBranch(config, ref) {
  const name = String(ref).replace(/^refs\/heads\//, '');
  return config.protectedBranches.some((p) =>
    p.endsWith('/*') ? name.startsWith(p.slice(0, -1)) : name === p);
}

async function runWrite({ ctx, tool, args, confirm, preview, execute }) {
  if (ctx.config.mode !== 'write') {
    return textResult(`Escrita BLOQUEADA — ADO_MODE=read. Nada foi enviado.\n\nO que seria feito:\n${fmt(preview)}`, true);
  }
  if (confirm !== true) {
    return textResult(`PREVIEW — nada foi enviado. Reenvie a chamada com confirm:true para aplicar.\n\n${fmt(preview)}`);
  }
  const result = await execute();
  await auditWrite(ctx.config, { tool, args, resultId: result?.id ?? result?.pullRequestId ?? null });
  return textResult(`APLICADO ✔\n\n${fmt(result)}`);
}

export { textResult, assertRepoAllowed, isProtectedBranch, runWrite };
