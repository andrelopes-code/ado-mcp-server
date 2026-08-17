const JSON_PATCH_HEADERS = { headers: { 'Content-Type': 'application/json-patch+json' } };

const PRESETS = {
  my_active: "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed','Done','Removed','Completed') ORDER BY [System.ChangedDate] DESC",
  my_recent: "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC",
};

const PROJECT_FIELD = 'System.TeamProject';
const DEFAULT_FIELDS = ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'System.AssignedTo', PROJECT_FIELD];

// A REST API cai a 400 acima disso, e o ADO ignora ids excedentes em silêncio.
const MAX_IDS = 200;

function assertProjectScope(config, items) {
  const foreign = items.filter((it) => it.fields?.[PROJECT_FIELD] !== config.project);
  if (foreign.length) {
    throw new Error(`Work item(s) fora do projeto '${config.project}': ${foreign.map((it) => it.id).join(', ')}.`);
  }
  return items;
}

async function query(ctx, { wiql, preset }) {
  const q = wiql || PRESETS[preset];
  if (!q) throw new Error('Informe wiql ou um preset válido.');
  const res = await ctx.api.post('/wit/wiql', { query: q });
  const ids = (res.workItems || []).map((w) => w.id).slice(0, 50);
  if (!ids.length) return [];
  return getMany(ctx, ids);
}

// Choke point de leitura: o escopo de projeto é imposto aqui para que WIQL arbitrário,
// getOne e wit_get herdem o mesmo limite de blast radius.
async function getMany({ api, config }, ids, fields = DEFAULT_FIELDS) {
  if (ids.length > MAX_IDS) throw new Error(`Máximo de ${MAX_IDS} ids por consulta; recebidos ${ids.length}.`);
  const wanted = fields.includes(PROJECT_FIELD) ? fields : [...fields, PROJECT_FIELD];
  const res = await api.get('/wit/workitems', { params: { ids: ids.join(','), fields: wanted.join(',') } });
  return assertProjectScope(config, res.value || []);
}

async function getOne(ctx, id) {
  const [item] = await getMany(ctx, [id]);
  if (!item) throw new Error(`Work item ${id} não encontrado.`);
  return item;
}

async function create({ api, config }, { type, title, fields = {}, parentId }) {
  const ops = [{ op: 'add', path: '/fields/System.Title', value: title }];
  for (const [k, v] of Object.entries(fields)) ops.push({ op: 'add', path: `/fields/${k}`, value: v });
  if (parentId != null) {
    ops.push({ op: 'add', path: '/relations/-', value: {
      rel: 'System.LinkTypes.Hierarchy-Reverse',
      url: `${config.url}/${encodeURIComponent(config.project)}/_apis/wit/workItems/${parentId}`,
    } });
  }
  return api.post(`/wit/workitems/$${type}`, ops, JSON_PATCH_HEADERS);
}

async function update({ api }, { id, fields = {}, state }) {
  const ops = [];
  if (state) ops.push({ op: 'add', path: '/fields/System.State', value: state });
  for (const [k, v] of Object.entries(fields)) ops.push({ op: 'add', path: `/fields/${k}`, value: v });
  if (!ops.length) throw new Error('Nada para atualizar: informe fields e/ou state.');
  return api.patch(`/wit/workitems/${id}`, ops, JSON_PATCH_HEADERS);
}

async function comment({ api }, { id, text }) {
  return api.patch(`/wit/workitems/${id}`, [{ op: 'add', path: '/fields/System.History', value: text }], JSON_PATCH_HEADERS);
}

export { query, getMany, getOne, create, update, comment, MAX_IDS };
