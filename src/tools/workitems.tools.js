import { z } from 'zod';
import * as wit from '../core/workitems.js';
import * as links from '../core/witlinks.js';
import * as discussion from '../core/witdiscussion.js';
import { meta, KINDS } from '../core/witmeta.js';
import { textResult, runWrite, scoped } from './guards.js';

const fieldMap = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const expandEnum = z.enum(['none', 'relations', 'fields', 'links', 'all']);
const project = z.string().optional().describe('Projeto alvo; default = DEVOPS_PROJECT. Outros exigem ADO_PROJECT_ALLOWLIST.');
const relSpec = {
  rel: z.string().describe('parent | child | related | predecessor | successor | duplicate | duplicate_of | tested_by | tests | hyperlink | pull_request | commit | branch, ou o refName cru.'),
  targetId: z.number().optional().describe('Work item alvo, para links entre cards.'),
  url: z.string().optional().describe('URL externa (hyperlink) ou url exata do link a remover.'),
  repo: z.string().optional().describe('Repositório, para pull_request | commit | branch.'),
  artifactValue: z.string().optional().describe('Id do PR, sha do commit ou nome do branch.'),
  comment: z.string().optional(),
};

const json = (value) => textResult(JSON.stringify(value, null, 2));

function registerWorkItemTools(server, rootCtx) {
  server.registerTool('wit_query', {
    description: 'Busca work items via WIQL, preset (my_active | my_recent) ou query salva. Leitura.',
    inputSchema: {
      wiql: z.string().optional().describe('Consulta WIQL plana (FROM WorkItems).'),
      preset: z.enum(['my_active', 'my_recent']).optional(),
      queryId: z.string().optional().describe('GUID de query salva no projeto.'),
      top: z.number().min(1).max(wit.MAX_IDS).optional(),
      fields: z.array(z.string()).optional().describe('RefNames a retornar; default = campos resumidos.'),
      expand: expandEnum.optional().describe('Ignora fields e traz o item completo.'),
      project,
    },
  }, async ({ wiql, preset, queryId, top, fields, expand, project: proj }) => {
    if (!wiql && !preset && !queryId) return textResult('Informe wiql, preset ou queryId.', true);
    const ctx = scoped(rootCtx, proj);
    return json(await wit.query(ctx, { wiql, preset, queryId, top, fields, expand }));
  });

  server.registerTool('wit_get', {
    description: 'Detalha work items por id, com campos e relações opcionais. Leitura.',
    inputSchema: {
      ids: z.array(z.number()).min(1).max(wit.MAX_IDS),
      fields: z.array(z.string()).optional().describe('Ex.: System.Description, Microsoft.VSTS.Common.AcceptanceCriteria.'),
      expand: expandEnum.optional().describe('relations traz pai, filhos, PRs e anexos.'),
      asOf: z.string().optional().describe('Data ISO para leitura histórica.'),
      project,
    },
  }, async ({ ids, fields, expand, asOf, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    return json(await wit.getMany(ctx, ids, fields, { expand, asOf }));
  });

  server.registerTool('wit_tree', {
    description: 'Executa WIQL de hierarquia (FROM WorkItemLinks) e devolve a árvore epic → feature → item. Leitura.',
    inputSchema: {
      wiql: z.string().describe('WIQL FROM WorkItemLinks, normalmente com mode(Recursive).'),
      top: z.number().min(1).max(wit.MAX_IDS).optional(),
      fields: z.array(z.string()).optional(),
      project,
    },
  }, async ({ wiql, top, fields, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    return json(await wit.tree(ctx, { wiql, top, fields }));
  });

  server.registerTool('wit_comments', {
    description: 'Lê a discussão de um work item (autor, data, texto). Leitura.',
    inputSchema: { id: z.number(), top: z.number().min(1).max(200).optional(), project },
  }, async ({ id, top, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    return json(await discussion.listComments(ctx, { id, top }));
  });

  server.registerTool('wit_history', {
    description: 'Lê o histórico de revisões de um work item, campo a campo. Leitura.',
    inputSchema: { id: z.number(), top: z.number().min(1).max(200).optional(), project },
  }, async ({ id, top, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    return json(await discussion.updates(ctx, { id, top }));
  });

  server.registerTool('wit_meta', {
    description: `Metadados do processo: ${KINDS.join(' | ')}. Use antes de criar/atualizar para descobrir tipos, estados e campos válidos. Leitura.`,
    inputSchema: {
      kind: z.enum(KINDS),
      type: z.string().optional().describe("Tipo do work item, exigido em 'states' e 'fields'."),
      depth: z.number().min(1).max(10).optional().describe("Profundidade em 'areas' e 'iterations'."),
      project,
    },
  }, async ({ kind, type, depth, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    return json(await meta(ctx, { kind, type, depth }));
  });

  server.registerTool('wit_create', {
    description: 'Cria work item (epic, feature, PBI, task, bug...) com campos, tags, área, iteração, pai e links. Escrita: exige ADO_MODE=write e confirm:true.',
    inputSchema: {
      type: z.string().describe('Epic, Feature, Product Backlog Item, Task, Bug...'),
      title: z.string(),
      fields: fieldMap.optional().describe('RefNames, ex.: System.Description (HTML), Microsoft.VSTS.Common.AcceptanceCriteria.'),
      parentId: z.number().optional(),
      tags: z.array(z.string()).optional(),
      areaPath: z.string().optional(),
      iterationPath: z.string().optional(),
      relations: z.array(z.object(relSpec)).optional().describe('Links adicionais criados junto do item.'),
      confirm: z.boolean().optional(),
      project,
    },
  }, async ({ type, title, fields, parentId, tags, areaPath, iterationPath, relations = [], confirm, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    // Resolve os links antes do preview: alvo inexistente ou fora do projeto falha aqui,
    // não depois do confirm com o item já criado.
    const built = [];
    for (const spec of relations) built.push(await links.buildRelation(ctx, spec));
    const payload = { type, title, fields, parentId, relations: built, tags, areaPath, iterationPath };
    const preview = {
      action: 'create', project: ctx.config.project, type, title,
      fields: fields ?? {}, parentId: parentId ?? null, tags: tags ?? [],
      areaPath: areaPath ?? null, iterationPath: iterationPath ?? null, relations: built,
    };
    return runWrite({
      ctx, tool: 'wit_create', args: { type, title }, confirm, preview,
      validate: () => wit.create(ctx, { ...payload, validateOnly: true }),
      execute: () => wit.create(ctx, payload),
    });
  });

  server.registerTool('wit_update', {
    description: 'Atualiza campos, estado e tags de um ou mais work items. Escrita: write + confirm.',
    inputSchema: {
      id: z.number().optional(),
      ids: z.array(z.number()).min(1).max(wit.MAX_BATCH).optional().describe('Lote; usa /wit/$batch acima de um id.'),
      fields: fieldMap.optional(),
      state: z.string().optional(),
      tags: z.object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() }).optional(),
      expectedRev: z.number().optional().describe('Revisão lida; a escrita falha se o item mudou desde então.'),
      confirm: z.boolean().optional(),
      project,
    },
  }, async ({ id, ids, fields, state, tags, expectedRev, confirm, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    const targets = ids?.length ? ids : [id];
    if (targets[0] == null) return textResult('Informe id ou ids.', true);
    const after = { ...(state ? { 'System.State': state } : {}), ...(fields ?? {}) };
    const wanted = [...new Set([...wit.DEFAULT_FIELDS, 'System.Tags', ...Object.keys(after)])];
    const current = await wit.getMany(ctx, targets, wanted);
    const before = current.map((it) => ({
      id: it.id,
      ...Object.fromEntries(Object.keys(after).map((k) => [k, it.fields?.[k] ?? null])),
      ...(tags ? { 'System.Tags': it.fields?.['System.Tags'] ?? null } : {}),
    }));
    const payload = { ids: targets, fields, state, tags, expectedRev, current };
    const preview = { action: 'update', project: ctx.config.project, ids: targets, before, after, tags: tags ?? null };
    return runWrite({
      ctx, tool: 'wit_update', args: { ids: targets }, confirm, preview,
      validate: () => wit.update(ctx, { ...payload, validateOnly: true }),
      execute: () => wit.update(ctx, payload),
    });
  });

  server.registerTool('wit_link', {
    description: 'Cria link em um work item: hierarquia, relacionado, dependência, duplicado, hyperlink ou artefato de código (PR, commit, branch). Escrita: write + confirm.',
    inputSchema: {
      id: z.number(),
      ...relSpec,
      expectedRev: z.number().optional(),
      confirm: z.boolean().optional(),
      project,
    },
  }, async ({ id, rel, targetId, url, repo, artifactValue, comment, expectedRev, confirm, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    await wit.getOne(ctx, id);
    const spec = { id, rel, targetId, url, repo, artifactValue, comment, expectedRev };
    const value = await links.buildRelation(ctx, spec);
    const preview = { action: 'link', project: ctx.config.project, id, relation: value };
    return runWrite({
      ctx, tool: 'wit_link', args: { id, rel, targetId: targetId ?? null }, confirm, preview,
      validate: () => links.link(ctx, { ...spec, validateOnly: true }),
      execute: () => links.link(ctx, spec),
    });
  });

  server.registerTool('wit_unlink', {
    description: 'Remove um link de um work item, resolvendo o índice da relação no momento da escrita. Escrita: write + confirm.',
    inputSchema: {
      id: z.number(),
      rel: relSpec.rel,
      targetId: z.number().optional(),
      url: z.string().optional(),
      expectedRev: z.number().optional(),
      confirm: z.boolean().optional(),
      project,
    },
  }, async ({ id, rel, targetId, url, expectedRev, confirm, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    const relations = await links.listRelations(ctx, id);
    const preview = { action: 'unlink', project: ctx.config.project, id, rel, targetId: targetId ?? null, url: url ?? null, currentRelations: relations };
    return runWrite({
      ctx, tool: 'wit_unlink', args: { id, rel, targetId: targetId ?? null }, confirm, preview,
      execute: () => links.unlink(ctx, { id, rel, targetId, url, expectedRev }),
    });
  });

  server.registerTool('wit_comment', {
    description: 'Publica comentário na discussão do work item (API de comments, com fallback para System.History). Escrita: write + confirm.',
    inputSchema: { id: z.number(), text: z.string(), confirm: z.boolean().optional(), project },
  }, async ({ id, text, confirm, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    await wit.getOne(ctx, id);
    const preview = { action: 'comment', project: ctx.config.project, id, text };
    return runWrite({
      ctx, tool: 'wit_comment', args: { id }, confirm, preview,
      execute: () => discussion.comment(ctx, { id, text }),
    });
  });

  server.registerTool('wit_attach', {
    description: 'Anexa um arquivo local ao work item (upload + relação AttachedFile). Escrita: write + confirm.',
    inputSchema: {
      id: z.number(),
      filePath: z.string().describe('Caminho local do arquivo.'),
      comment: z.string().optional(),
      confirm: z.boolean().optional(),
      project,
    },
  }, async ({ id, filePath, comment, confirm, project: proj }) => {
    const ctx = scoped(rootCtx, proj);
    // Checa tamanho e extensão no preview; o upload em si só ocorre no confirm.
    const file = await links.inspectFile(ctx.config, filePath);
    const preview = { action: 'attach', project: ctx.config.project, id, file: file.name, bytes: file.size, comment: comment ?? null };
    return runWrite({
      ctx, tool: 'wit_attach', args: { id, file: file.name }, confirm, preview,
      execute: () => links.attach(ctx, { id, filePath, comment }),
    });
  });
}

export { registerWorkItemTools };
