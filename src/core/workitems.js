const JSON_PATCH_HEADERS = { headers: { 'Content-Type': 'application/json-patch+json' } };

const PRESETS = {
  my_active: "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed','Done','Removed','Completed') ORDER BY [System.ChangedDate] DESC",
  my_recent: "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC",
};

const PROJECT_FIELD = 'System.TeamProject';
const TAGS_FIELD = 'System.Tags';
const DEFAULT_FIELDS = ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'System.AssignedTo', PROJECT_FIELD];

// A REST API cai a 400 acima disso, e o ADO ignora ids excedentes em silêncio.
const MAX_IDS = 200;
// Mesmo teto do endpoint /wit/$batch.
const MAX_BATCH = 200;

const EXPAND = { none: 'None', relations: 'Relations', fields: 'Fields', links: 'Links', all: 'All' };

function assertProjectScope(config, items) {
  const foreign = items.filter((it) => it.fields?.[PROJECT_FIELD] !== config.project);
  if (foreign.length) {
    throw new Error(`Work item(s) fora do projeto '${config.project}': ${foreign.map((it) => it.id).join(', ')}.`);
  }
  return items;
}

// Campos ricos são HTML e chegam do modelo: script e handlers inline viram XSS armazenado
// para todo mundo que abrir o card no navegador.
function assertSafeHtml(fields = {}) {
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || !value.includes('<')) continue;
    if (/<\s*script/i.test(value) || /<\s*iframe/i.test(value) || /\son\w+\s*=/i.test(value) || /javascript:/i.test(value)) {
      throw new Error(`Campo '${key}' contém HTML executável (script/iframe/handler inline). Remova antes de gravar.`);
    }
  }
}

function assertTypeAllowed(config, type) {
  const list = config.witTypeAllowlist ?? [];
  if (list.length && !list.includes(type)) {
    throw new Error(`Tipo '${type}' fora da allowlist: ${list.join(', ')}.`);
  }
}

function assertAreaAllowed(config, areaPath) {
  const list = config.witAreaAllowlist ?? [];
  if (!areaPath || !list.length) return;
  const ok = list.some((p) => areaPath === p || areaPath.startsWith(`${p}\\`));
  if (!ok) throw new Error(`Area path '${areaPath}' fora da allowlist: ${list.join(', ')}.`);
}

function fieldOps(fields = {}) {
  return Object.entries(fields).map(([k, v]) => ({ op: 'add', path: `/fields/${k}`, value: v }));
}

async function query(ctx, { wiql, preset, queryId, top = 50, fields, expand }) {
  let res;
  if (queryId) {
    res = await ctx.api.get(`/wit/wiql/${encodeURIComponent(queryId)}`, { params: { $top: top } });
  } else {
    const q = wiql || PRESETS[preset];
    if (!q) throw new Error('Informe wiql, preset ou queryId.');
    res = await ctx.api.post('/wit/wiql', { query: q }, { params: { $top: top } });
  }
  const ids = (res.workItems || []).map((w) => w.id).slice(0, Math.min(top, MAX_IDS));
  if (!ids.length) return [];
  return getMany(ctx, ids, fields, { expand });
}

// Query de link (WorkItemLinks) devolve arestas, não itens: hidrata os ids e devolve
// a hierarquia aninhada, que é o formato em que epic → feature → PBI é legível.
async function tree(ctx, { wiql, top = 100, fields }) {
  if (!wiql) throw new Error('Informe uma WIQL do tipo FROM WorkItemLinks.');
  const res = await ctx.api.post('/wit/wiql', { query: wiql }, { params: { $top: top } });
  const rels = res.workItemRelations || [];
  if (!rels.length) return [];
  const ids = [...new Set(rels.flatMap((r) => [r.source?.id, r.target?.id]).filter(Boolean))];
  if (ids.length > MAX_IDS) throw new Error(`A árvore retornou ${ids.length} itens; reduza o escopo da WIQL (máximo ${MAX_IDS}).`);
  const items = await getMany(ctx, ids, fields);
  const nodes = new Map(items.map((it) => [it.id, {
    id: it.id,
    type: it.fields?.['System.WorkItemType'],
    title: it.fields?.['System.Title'],
    state: it.fields?.['System.State'],
    children: [],
  }]));
  const roots = [];
  for (const rel of rels) {
    const child = nodes.get(rel.target?.id);
    if (!child) continue;
    const parent = rel.source ? nodes.get(rel.source.id) : null;
    if (parent) parent.children.push(child);
    else if (!roots.includes(child)) roots.push(child);
  }
  return roots;
}

// Choke point de leitura: o escopo de projeto é imposto aqui para que WIQL arbitrário,
// getOne e wit_get herdem o mesmo limite de blast radius.
async function getMany({ api, config }, ids, fields = DEFAULT_FIELDS, { expand, asOf } = {}) {
  if (ids.length > MAX_IDS) throw new Error(`Máximo de ${MAX_IDS} ids por consulta; recebidos ${ids.length}.`);
  const params = { ids: ids.join(',') };
  // A API recusa fields e $expand na mesma chamada; com expand todos os campos voltam.
  if (expand && expand !== 'none') params.$expand = EXPAND[expand] ?? expand;
  else params.fields = (fields.includes(PROJECT_FIELD) ? fields : [...fields, PROJECT_FIELD]).join(',');
  if (asOf) params.asOf = asOf;
  const res = await api.get('/wit/workitems', { params });
  return assertProjectScope(config, res.value || []);
}

async function getOne(ctx, id, fields, opts) {
  const [item] = await getMany(ctx, [id], fields, opts);
  if (!item) throw new Error(`Work item ${id} não encontrado.`);
  return item;
}

function parentRelation(config, parentId) {
  return {
    op: 'add',
    path: '/relations/-',
    value: {
      rel: 'System.LinkTypes.Hierarchy-Reverse',
      url: `${config.url}/${encodeURIComponent(config.project)}/_apis/wit/workItems/${parentId}`,
    },
  };
}

async function create(ctx, { type, title, fields = {}, parentId, relations = [], tags = [], areaPath, iterationPath, validateOnly = false }) {
  const { api, config } = ctx;
  assertTypeAllowed(config, type);
  assertAreaAllowed(config, areaPath);
  assertSafeHtml(fields);
  const all = { ...fields };
  if (areaPath) all['System.AreaPath'] = areaPath;
  if (iterationPath) all['System.IterationPath'] = iterationPath;
  if (tags.length) all[TAGS_FIELD] = tags.join('; ');
  const ops = [{ op: 'add', path: '/fields/System.Title', value: title }, ...fieldOps(all)];
  if (parentId != null) ops.push(parentRelation(config, parentId));
  for (const rel of relations) ops.push({ op: 'add', path: '/relations/-', value: rel });
  const opts = validateOnly
    ? { ...JSON_PATCH_HEADERS, params: { validateOnly: true } }
    : JSON_PATCH_HEADERS;
  return api.post(`/wit/workitems/$${type}`, ops, opts);
}

function mergeTags(current, { add = [], remove = [] }) {
  const set = new Map(String(current || '').split(';').map((t) => t.trim()).filter(Boolean).map((t) => [t.toLowerCase(), t]));
  for (const t of remove) set.delete(String(t).trim().toLowerCase());
  for (const t of add) set.set(String(t).trim().toLowerCase(), String(t).trim());
  return [...set.values()].join('; ');
}

function updateOps({ fields = {}, state, tags, expectedRev, current }) {
  const ops = [];
  // test /rev falha a escrita inteira se alguém alterou o item entre a leitura e o patch.
  if (expectedRev != null) ops.push({ op: 'test', path: '/rev', value: expectedRev });
  if (state) ops.push({ op: 'add', path: `/fields/System.State`, value: state });
  ops.push(...fieldOps(fields));
  if (tags && (tags.add?.length || tags.remove?.length)) {
    ops.push({ op: 'add', path: `/fields/${TAGS_FIELD}`, value: mergeTags(current?.fields?.[TAGS_FIELD], tags) });
  }
  return ops;
}

async function update(ctx, { id, ids, fields = {}, state, tags, expectedRev, validateOnly = false, current }) {
  const { api, config } = ctx;
  const targets = ids?.length ? ids : [id];
  if (!targets.length || targets[0] == null) throw new Error('Informe id ou ids.');
  if (targets.length > MAX_BATCH) throw new Error(`Máximo de ${MAX_BATCH} ids por lote; recebidos ${targets.length}.`);
  assertSafeHtml(fields);
  assertAreaAllowed(config, fields['System.AreaPath']);
  const needsCurrent = Boolean(tags?.add?.length || tags?.remove?.length);
  const items = current ?? (needsCurrent ? await getMany(ctx, targets, [TAGS_FIELD]) : []);
  const byId = new Map(items.map((it) => [it.id, it]));

  const opsFor = (target) => {
    const ops = updateOps({ fields, state, tags, expectedRev, current: byId.get(target) });
    if (!ops.length || ops.every((o) => o.op === 'test')) throw new Error('Nada para atualizar: informe fields, state e/ou tags.');
    return ops;
  };

  if (targets.length === 1) {
    const opts = validateOnly ? { ...JSON_PATCH_HEADERS, params: { validateOnly: true } } : JSON_PATCH_HEADERS;
    return api.patch(`/wit/workitems/${targets[0]}`, opsFor(targets[0]), opts);
  }
  const suffix = validateOnly ? '&validateOnly=true' : '';
  const batch = targets.map((target) => ({
    method: 'PATCH',
    uri: `/_apis/wit/workitems/${target}?api-version=${config.apiVersion}${suffix}`,
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: opsFor(target),
  }));
  return api.post('/wit/$batch', batch);
}

export {
  query, tree, getMany, getOne, create, update, mergeTags,
  assertProjectScope, assertSafeHtml, assertTypeAllowed, assertAreaAllowed,
  JSON_PATCH_HEADERS, PROJECT_FIELD, DEFAULT_FIELDS, MAX_IDS, MAX_BATCH,
};
