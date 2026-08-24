import { listProjects, isAllowed } from '../core/projects.js';
import { textResult } from './guards.js';

function registerProjectTools(server, ctx) {
  server.registerTool('project_list', {
    description: 'Lista os projetos da coleção e marca quais podem ser usados no parâmetro project das demais tools. Leitura.',
    inputSchema: {},
  }, async () => {
    const all = await listProjects(ctx);
    const out = all.map((p) => ({
      ...p,
      default: p.name === ctx.config.project,
      allowed: isAllowed(ctx.config, p.name),
    }));
    return textResult(JSON.stringify({ default: ctx.config.project, allowlist: ctx.config.projectAllowlist, projects: out }, null, 2));
  });
}

export { registerProjectTools };
