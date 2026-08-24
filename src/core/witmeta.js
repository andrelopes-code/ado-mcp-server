import { orgUrl, previewVersion } from './client.js';

const TAGS_PREVIEW = 1;

const KINDS = ['types', 'states', 'fields', 'categories', 'relationtypes', 'areas', 'iterations', 'tags'];

async function types({ api }) {
  const res = await api.get('/wit/workitemtypes');
  return (res.value || []).map((t) => ({ name: t.name, referenceName: t.referenceName, description: t.description }));
}

// Estados vivem em dois lugares: o endpoint dedicado (ADO Server 2020+) e os allowedValues
// de System.State. O fallback mantém a tool utilizável em on-prem mais antigo.
async function states({ api }, type) {
  if (!type) throw new Error("kind 'states' exige type.");
  const path = `/wit/workitemtypes/${encodeURIComponent(type)}/states`;
  try {
    const res = await api.get(path);
    return (res.value || []).map((s) => ({ name: s.name, category: s.category }));
  } catch {
    const res = await api.get(`/wit/workitemtypes/${encodeURIComponent(type)}/fields/System.State`);
    return (res.allowedValues || []).map((name) => ({ name, category: null }));
  }
}

async function fields({ api }, type) {
  if (!type) throw new Error("kind 'fields' exige type.");
  const res = await api.get(`/wit/workitemtypes/${encodeURIComponent(type)}/fields`, { params: { $expand: 'all' } });
  return (res.value || []).map((f) => ({
    referenceName: f.referenceName,
    name: f.name,
    type: f.type ?? null,
    required: Boolean(f.alwaysRequired),
    allowedValues: f.allowedValues?.length ? f.allowedValues : undefined,
  }));
}

async function categories({ api }) {
  const res = await api.get('/wit/workitemtypecategories');
  return (res.value || []).map((c) => ({
    name: c.name,
    referenceName: c.referenceName,
    defaultType: c.defaultWorkItemType?.name ?? null,
    types: (c.workItemTypes || []).map((t) => t.name),
  }));
}

// Catálogo organizacional: fora de /{project}/_apis.
async function relationtypes({ api, config }) {
  const res = await api.get(orgUrl(config, '/wit/workitemrelationtypes'));
  return (res.value || []).map((r) => ({ referenceName: r.referenceName, name: r.name, usage: r.attributes?.usage }));
}

function flattenNodes(node, prefix = '') {
  const path = prefix ? `${prefix}\\${node.name}` : node.name;
  const out = [{ path, hasChildren: Boolean(node.children?.length), attributes: node.attributes ?? undefined }];
  for (const child of node.children || []) out.push(...flattenNodes(child, path));
  return out;
}

async function classification({ api }, group, depth) {
  const res = await api.get(`/wit/classificationnodes/${group}`, { params: { $depth: depth } });
  return flattenNodes(res);
}

async function tags({ api, config }) {
  const res = await api.get('/wit/tags', previewVersion(config, TAGS_PREVIEW));
  return (res.value || []).map((t) => t.name);
}

async function meta(ctx, { kind, type, depth = 4 }) {
  switch (kind) {
    case 'types': return types(ctx);
    case 'states': return states(ctx, type);
    case 'fields': return fields(ctx, type);
    case 'categories': return categories(ctx);
    case 'relationtypes': return relationtypes(ctx);
    case 'areas': return classification(ctx, 'Areas', depth);
    case 'iterations': return classification(ctx, 'Iterations', depth);
    case 'tags': return tags(ctx);
    default: throw new Error(`kind inválido: ${kind}. Use ${KINDS.join(' | ')}.`);
  }
}

export { meta, KINDS };
