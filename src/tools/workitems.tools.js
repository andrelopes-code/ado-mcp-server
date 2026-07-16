import { z } from 'zod';
import * as wit from '../core/workitems.js';
import { textResult, runWrite } from './guards.js';

const fieldMap = z.record(z.string(), z.union([z.string(), z.number()]));

function registerWorkItemTools(server, ctx) {
  server.registerTool('wit_query', {
    description: 'Busca work items via WIQL ou preset (my_active | my_recent). Leitura.',
    inputSchema: {
      wiql: z.string().optional().describe('Consulta WIQL; se ausente, informe preset.'),
      preset: z.enum(['my_active', 'my_recent']).optional(),
    },
  }, async ({ wiql, preset }) => {
    if (!wiql && !preset) return textResult('Informe wiql ou preset.', true);
    return textResult(JSON.stringify(await wit.query(ctx, { wiql, preset }), null, 2));
  });

  server.registerTool('wit_get', {
    description: 'Detalha work items por id. Leitura.',
    inputSchema: { ids: z.array(z.number()).min(1) },
  }, async ({ ids }) => {
    const items = await wit.getMany(ctx, ids);
    const foreign = items.filter((it) => it.fields?.['System.TeamProject'] !== ctx.config.project);
    if (foreign.length) {
      throw new Error(`Work item(s) fora do projeto '${ctx.config.project}': ${foreign.map((it) => it.id).join(', ')}.`);
    }
    return textResult(JSON.stringify(items, null, 2));
  });

  server.registerTool('wit_create', {
    description: 'Cria work item. Escrita: exige ADO_MODE=write e confirm:true.',
    inputSchema: {
      type: z.string().describe('Task, Bug, Product Backlog Item...'),
      title: z.string(),
      fields: fieldMap.optional(),
      parentId: z.number().optional(),
      confirm: z.boolean().optional(),
    },
  }, async ({ type, title, fields, parentId, confirm }) => {
    const preview = { action: 'create', type, title, fields: fields ?? {}, parentId: parentId ?? null };
    return runWrite({ ctx, tool: 'wit_create', args: { type, title }, confirm, preview,
      execute: () => wit.create(ctx, { type, title, fields, parentId }) });
  });

  server.registerTool('wit_update', {
    description: 'Atualiza campos/estado de UM work item. Escrita: write + confirm.',
    inputSchema: {
      id: z.number(),
      fields: fieldMap.optional(),
      state: z.string().optional(),
      confirm: z.boolean().optional(),
    },
  }, async ({ id, fields, state, confirm }) => {
    const current = await wit.getOne(ctx, id);
    const after = { ...(state ? { 'System.State': state } : {}), ...(fields ?? {}) };
    const before = Object.fromEntries(Object.keys(after).map((k) => [k, current.fields?.[k] ?? null]));
    const preview = { action: 'update', id, before, after };
    return runWrite({ ctx, tool: 'wit_update', args: { id }, confirm, preview,
      execute: () => wit.update(ctx, { id, fields, state }) });
  });

  server.registerTool('wit_comment', {
    description: 'Adiciona comentário (System.History) a um work item. Escrita: write + confirm.',
    inputSchema: { id: z.number(), text: z.string(), confirm: z.boolean().optional() },
  }, async ({ id, text, confirm }) => {
    await wit.getOne(ctx, id);
    const preview = { action: 'comment', id, text };
    return runWrite({ ctx, tool: 'wit_comment', args: { id }, confirm, preview,
      execute: () => wit.comment(ctx, { id, text }) });
  });
}

export { registerWorkItemTools };
