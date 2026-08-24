import { z } from 'zod';
import * as repos from '../core/repos.js';
import { textResult, assertRepoAllowed, scoped } from './guards.js';

const project = z.string().optional().describe('Projeto alvo; default = DEVOPS_PROJECT. Outros exigem ADO_PROJECT_ALLOWLIST.');

function registerRepoTools(server, rootCtx) {
  server.registerTool('repo_list', {
    description: 'Lista repositórios do projeto. Leitura.',
    inputSchema: { project },
  }, async ({ project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    const all = await repos.listRepos(ctx);
    const out = ctx.config.repoAllowlist.length ? all.filter((r) => ctx.config.repoAllowlist.includes(r.name)) : all;
    return textResult(JSON.stringify(out, null, 2));
  });

  server.registerTool('branch_list', {
    description: 'Lista branches de um repo. Leitura.',
    inputSchema: { repo: z.string(), filter: z.string().optional(), project },
  }, async ({ repo, filter, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    assertRepoAllowed(ctx.config, repo);
    return textResult(JSON.stringify(await repos.listBranches(ctx, repo, filter), null, 2));
  });

  server.registerTool('commit_list', {
    description: 'Lista commits recentes de um repo/branch. Leitura.',
    inputSchema: { repo: z.string(), branch: z.string().optional(), top: z.number().max(200).optional(), project },
  }, async ({ repo, branch, top, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    assertRepoAllowed(ctx.config, repo);
    return textResult(JSON.stringify(await repos.listCommits(ctx, repo, { branch, top }), null, 2));
  });
}

export { registerRepoTools };
