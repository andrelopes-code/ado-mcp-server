import { auditSafe } from '../audit.js';
import { currentMode } from '../config.js';

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
  if (currentMode(ctx.config.mode, ctx.config.envPath) !== 'write') {
    await auditSafe(ctx.config, { tool, args, outcome: 'blocked', reason: 'ADO_MODE=read' });
    return textResult(`Escrita BLOQUEADA — ADO_MODE=read. Nada foi enviado.\n\nO que seria feito:\n${fmt(preview)}`, true);
  }
  if (confirm !== true) {
    return textResult(`PREVIEW — nada foi enviado. Reenvie a chamada com confirm:true para aplicar.\n\n${fmt(preview)}`);
  }

  let result;
  try {
    result = await execute();
  } catch (err) {
    await auditSafe(ctx.config, { tool, args, outcome: 'failed', reason: err.message });
    throw err;
  }

  // A mutação já foi enviada: uma falha de auditoria vira aviso, nunca um erro que
  // faria o chamador acreditar que nada aconteceu.
  const auditError = await auditSafe(ctx.config, {
    tool, args, outcome: 'applied', resultId: result?.id ?? result?.pullRequestId ?? null,
  });
  const warning = auditError ? `\n\n⚠ A escrita foi aplicada, mas a auditoria falhou: ${auditError}` : '';
  return textResult(`APLICADO ✔${warning}\n\n${fmt(result)}`);
}

export { textResult, assertRepoAllowed, isProtectedBranch, runWrite };
