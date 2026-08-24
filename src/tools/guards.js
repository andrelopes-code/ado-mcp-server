import { auditSafe } from '../audit.js';
import { currentMode } from '../config.js';

const fmt = (v) => JSON.stringify(v, null, 2);

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

function assertProjectAllowed(config, project) {
  if (project === config.project) return;
  const list = config.projectAllowlist ?? [];
  if (list.includes('*') || list.includes(project)) return;
  const shown = list.length ? [config.project, ...list].join(', ') : config.project;
  throw new Error(`Projeto '${project}' fora da allowlist: ${shown}. Ajuste ADO_PROJECT_ALLOWLIST no .env.`);
}

// Toda tool aceita `project` opcional. O ctx derivado carrega api e config do projeto
// alvo, então allowlists, escopo de leitura e auditoria seguem valendo sem duplicar server.
function scoped(ctx, project) {
  if (!project || project === ctx.config.project) return ctx;
  assertProjectAllowed(ctx.config, project);
  if (typeof ctx.forProject !== 'function') throw new Error('Contexto sem suporte a troca de projeto.');
  return ctx.forProject(project);
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

async function runWrite({ ctx, tool, args, confirm, preview, execute, validate }) {
  const auditArgs = { project: ctx.config.project, ...args };
  if (currentMode(ctx.config.mode, ctx.config.envPath) !== 'write') {
    await auditSafe(ctx.config, { tool, args: auditArgs, outcome: 'blocked', reason: 'ADO_MODE=read' });
    return textResult(`Escrita BLOQUEADA — ADO_MODE=read. Nada foi enviado.\n\nO que seria feito:\n${fmt(preview)}`, true);
  }
  if (confirm !== true) {
    // validateOnly=true: o próprio ADO valida regras de processo sem persistir, então o
    // preview reprova payload inválido antes do confirm em vez de só ecoar o que foi montado.
    let note = '';
    if (validate) {
      try {
        await validate();
        note = '\n\nValidação do servidor (validateOnly): aceita.';
      } catch (err) {
        note = `\n\nValidação do servidor (validateOnly) RECUSOU: ${err.message}`;
      }
    }
    return textResult(`PREVIEW — nada foi enviado. Reenvie a chamada com confirm:true para aplicar.\n\n${fmt(preview)}${note}`);
  }

  let result;
  try {
    result = await execute();
  } catch (err) {
    await auditSafe(ctx.config, { tool, args: auditArgs, outcome: 'failed', reason: err.message });
    throw err;
  }

  // A mutação já foi enviada: uma falha de auditoria vira aviso, nunca um erro que
  // faria o chamador acreditar que nada aconteceu.
  const auditError = await auditSafe(ctx.config, {
    tool, args: auditArgs, outcome: 'applied', resultId: result?.id ?? result?.pullRequestId ?? null,
  });
  const warning = auditError ? `\n\n⚠ A escrita foi aplicada, mas a auditoria falhou: ${auditError}` : '';
  return textResult(`APLICADO ✔${warning}\n\n${fmt(result)}`);
}

export { textResult, assertRepoAllowed, assertProjectAllowed, scoped, isProtectedBranch, runWrite };
