const PATCH = { headers: { 'Content-Type': 'application/json-patch+json' } };

const PRESETS = {
  my_active: "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed','Done','Removed','Completed') ORDER BY [System.ChangedDate] DESC",
  my_recent: "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC",
};

const DEFAULT_FIELDS = ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'System.AssignedTo'];

async function query({ api, config }, { wiql, preset }) {
  const q = wiql || PRESETS[preset];
  if (!q) throw new Error('Informe wiql ou um preset válido.');
  const res = await api.post('/wit/wiql', { query: q });
  const ids = (res.workItems || []).map((w) => w.id).slice(0, 50);
  if (!ids.length) return [];
  return getMany({ api, config }, ids, DEFAULT_FIELDS);
}

async function getMany({ api }, ids, fields = DEFAULT_FIELDS) {
  const res = await api.get('/wit/workitems', { params: { ids: ids.join(','), fields: fields.join(',') } });
  return res.value || [];
}

async function getOne(ctx, id) {
  const [item] = await getMany(ctx, [id], [...DEFAULT_FIELDS, 'System.TeamProject']);
  if (!item) throw new Error(`Work item ${id} não encontrado.`);
  const proj = item.fields?.['System.TeamProject'];
  if (proj && proj !== ctx.config.project) {
    throw new Error(`Work item ${id} pertence ao projeto '${proj}', fora de '${ctx.config.project}'.`);
  }
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
  return api.post(`/wit/workitems/$${type}`, ops, PATCH);
}

async function update({ api }, { id, fields = {}, state }) {
  const ops = [];
  if (state) ops.push({ op: 'add', path: '/fields/System.State', value: state });
  for (const [k, v] of Object.entries(fields)) ops.push({ op: 'add', path: `/fields/${k}`, value: v });
  if (!ops.length) throw new Error('Nada para atualizar: informe fields e/ou state.');
  return api.patch(`/wit/workitems/${id}`, ops, PATCH);
}

async function comment({ api }, { id, text }) {
  return api.patch(`/wit/workitems/${id}`, [{ op: 'add', path: '/fields/System.History', value: text }], PATCH);
}

export { query, getMany, getOne, create, update, comment };
