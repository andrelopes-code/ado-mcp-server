import { z } from 'zod';
import * as pr from '../core/pullrequests.js';
import { textResult, runWrite, assertRepoAllowed, isProtectedBranch, scoped } from './guards.js';

const project = z.string().optional().describe('Projeto alvo; default = DEVOPS_PROJECT. Outros exigem ADO_PROJECT_ALLOWLIST.');

function slimPr(p) {
  return { id: p.pullRequestId, title: p.title, status: p.status, source: p.sourceRefName, target: p.targetRefName, createdBy: p.createdBy?.displayName };
}

function registerPullRequestTools(server, rootCtx) {
  server.registerTool('pr_list', {
    description: 'Lista pull requests de um repo. Leitura.',
    inputSchema: {
      repo: z.string(),
      status: z.enum(['active', 'completed', 'abandoned', 'all']).optional(),
      creatorId: z.string().optional(),
      target: z.string().optional(),
      project,
    },
  }, async ({ repo, status, creatorId, target, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    assertRepoAllowed(ctx.config, repo);
    const items = await pr.list(ctx, repo, { status, creatorId, targetRef: target });
    return textResult(JSON.stringify(items.map(slimPr), null, 2));
  });

  server.registerTool('pr_get', {
    description: 'Detalha um pull request. Leitura.',
    inputSchema: { repo: z.string(), prId: z.number(), project },
  }, async ({ repo, prId, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    assertRepoAllowed(ctx.config, repo);
    return textResult(JSON.stringify(await pr.get(ctx, repo, prId), null, 2));
  });

  server.registerTool('pr_create', {
    description: 'Cria um pull request (NÃO faz merge). Escrita: write + confirm.',
    inputSchema: {
      repo: z.string(), source: z.string(), target: z.string(), title: z.string(),
      description: z.string().optional(),
      reviewers: z.array(z.string()).optional().describe('ids (GUID) de reviewers'),
      workItemIds: z.array(z.number()).optional(),
      isDraft: z.boolean().optional().describe('cria o PR como rascunho (draft)'),
      confirm: z.boolean().optional(),
      project,
    },
  }, async ({ repo, source, target, title, description, reviewers, workItemIds, isDraft, confirm, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    assertRepoAllowed(ctx.config, repo);
    const preview = {
      action: 'create_pr', project: ctx.config.project, repo, source, target, title, isDraft: isDraft ?? false,
      reviewers: reviewers ?? [], workItemIds: workItemIds ?? [],
      note: isProtectedBranch(ctx.config, target)
        ? `⚠ target '${target}' é branch protegida — PR permitido; o merge continua manual no web UI.`
        : undefined,
    };
    return runWrite({ ctx, tool: 'pr_create', args: { repo, source, target }, confirm, preview,
      execute: () => pr.create(ctx, repo, { sourceRef: source, targetRef: target, title, description, reviewers, workItemIds, isDraft }) });
  });

  server.registerTool('pr_update', {
    description: 'Edita título, descrição, rascunho ou branch de destino de um PR. NÃO altera status: abandonar e mergear não passam por aqui. Escrita: write + confirm.',
    inputSchema: {
      repo: z.string(), prId: z.number(),
      title: z.string().optional(),
      description: z.string().optional(),
      isDraft: z.boolean().optional().describe('false tira o PR de rascunho'),
      target: z.string().optional().describe('nova branch de destino'),
      confirm: z.boolean().optional(),
      project,
    },
  }, async ({ repo, prId, title, description, isDraft, target, confirm, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    assertRepoAllowed(ctx.config, repo);
    if ([title, description, isDraft, target].every((field) => field === undefined)) {
      return textResult('Nada a alterar: informe title, description, isDraft ou target.', true);
    }
    const preview = {
      action: 'pr_update', project: ctx.config.project, repo, prId, title, description, isDraft, target,
      note: target !== undefined && isProtectedBranch(ctx.config, target)
        ? `⚠ target '${target}' é branch protegida — a troca é permitida; o merge continua manual no web UI.`
        : undefined,
    };
    return runWrite({ ctx, tool: 'pr_update', args: { repo, prId }, confirm, preview,
      execute: () => pr.update(ctx, repo, prId, { title, description, isDraft, targetRef: target }) });
  });

  server.registerTool('pr_add_reviewers', {
    description: 'Adiciona reviewers a um PR. Escrita: write + confirm.',
    inputSchema: { repo: z.string(), prId: z.number(), reviewers: z.array(z.string()).min(1), confirm: z.boolean().optional(), project },
  }, async ({ repo, prId, reviewers, confirm, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    assertRepoAllowed(ctx.config, repo);
    const preview = { action: 'add_reviewers', project: ctx.config.project, repo, prId, reviewers };
    return runWrite({ ctx, tool: 'pr_add_reviewers', args: { repo, prId }, confirm, preview,
      execute: () => pr.addReviewers(ctx, repo, prId, reviewers) });
  });

  server.registerTool('pr_comment', {
    description: 'Comenta num PR (abre thread). Escrita: write + confirm.',
    inputSchema: { repo: z.string(), prId: z.number(), text: z.string(), confirm: z.boolean().optional(), project },
  }, async ({ repo, prId, text, confirm, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    assertRepoAllowed(ctx.config, repo);
    const preview = { action: 'pr_comment', project: ctx.config.project, repo, prId, text };
    return runWrite({ ctx, tool: 'pr_comment', args: { repo, prId }, confirm, preview,
      execute: () => pr.comment(ctx, repo, prId, text) });
  });
}

export { registerPullRequestTools };
