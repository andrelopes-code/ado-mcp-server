import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { getOne, JSON_PATCH_HEADERS } from './workitems.js';

// Apelidos estáveis para os refNames do ADO: o modelo erra 'System.LinkTypes.Dependency-Reverse'
// com frequência, e a direção (predecessor x sucessor) é invertida com facilidade.
const REL_ALIASES = {
  parent: 'System.LinkTypes.Hierarchy-Reverse',
  child: 'System.LinkTypes.Hierarchy-Forward',
  related: 'System.LinkTypes.Related',
  predecessor: 'System.LinkTypes.Dependency-Reverse',
  successor: 'System.LinkTypes.Dependency-Forward',
  duplicate: 'System.LinkTypes.Duplicate-Forward',
  duplicate_of: 'System.LinkTypes.Duplicate-Reverse',
  tested_by: 'Microsoft.VSTS.Common.TestedBy-Forward',
  tests: 'Microsoft.VSTS.Common.TestedBy-Reverse',
  hyperlink: 'Hyperlink',
  attachment: 'AttachedFile',
  pull_request: 'ArtifactLink',
  commit: 'ArtifactLink',
  branch: 'ArtifactLink',
};

const ARTIFACT_KINDS = {
  pull_request: { name: 'Pull Request', uri: (p, r, v) => `vstfs:///Git/PullRequestId/${p}%2F${r}%2F${v}` },
  commit: { name: 'Fixed in Commit', uri: (p, r, v) => `vstfs:///Git/Commit/${p}%2F${r}%2F${v}` },
  branch: { name: 'Branch', uri: (p, r, v) => `vstfs:///Git/Ref/${p}%2F${r}%2FGB${encodeURIComponent(v)}` },
};

function resolveRel(rel) {
  return REL_ALIASES[rel] ?? rel;
}

function workItemUrl(config, id) {
  return `${config.url}/${encodeURIComponent(config.project)}/_apis/wit/workItems/${id}`;
}

// vstfs:// exige os GUIDs do projeto e do repositório, não os nomes.
async function repoIds({ api }, repo) {
  const res = await api.get(`/git/repositories/${encodeURIComponent(repo)}`);
  if (!res?.id || !res?.project?.id) throw new Error(`Repositório '${repo}' não encontrado ou sem GUID de projeto.`);
  return { repoId: res.id, projectId: res.project.id };
}

async function buildRelation(ctx, { rel, targetId, url, repo, artifactValue, comment }) {
  const artifact = ARTIFACT_KINDS[rel];
  if (artifact) {
    if (!repo || !artifactValue) throw new Error(`Link '${rel}' exige repo e artifactValue (id do PR, sha do commit ou nome do branch).`);
    const { repoId, projectId } = await repoIds(ctx, repo);
    return {
      rel: 'ArtifactLink',
      url: artifact.uri(projectId, repoId, artifactValue),
      attributes: { name: artifact.name, ...(comment ? { comment } : {}) },
    };
  }
  const resolved = resolveRel(rel);
  if (resolved === 'Hyperlink') {
    if (!url) throw new Error("Link 'hyperlink' exige url.");
    return { rel: 'Hyperlink', url, attributes: comment ? { comment } : {} };
  }
  if (targetId == null) throw new Error(`Link '${rel}' exige targetId.`);
  // Valida o alvo antes de gravar: getOne aplica o escopo de projeto do servidor.
  await getOne(ctx, targetId);
  return { rel: resolved, url: workItemUrl(ctx.config, targetId), attributes: comment ? { comment } : {} };
}

async function listRelations(ctx, id) {
  const item = await getOne(ctx, id, undefined, { expand: 'relations' });
  return (item.relations || []).map((r, index) => ({ index, rel: r.rel, url: r.url, attributes: r.attributes }));
}

async function link(ctx, { id, rel, targetId, url, repo, artifactValue, comment, expectedRev, validateOnly = false }) {
  const value = await buildRelation(ctx, { rel, targetId, url, repo, artifactValue, comment });
  const ops = [];
  if (expectedRev != null) ops.push({ op: 'test', path: '/rev', value: expectedRev });
  ops.push({ op: 'add', path: '/relations/-', value });
  const opts = validateOnly ? { ...JSON_PATCH_HEADERS, params: { validateOnly: true } } : JSON_PATCH_HEADERS;
  return ctx.api.patch(`/wit/workitems/${id}`, ops, opts);
}

function matches(relation, { rel, targetId, url }) {
  const wanted = resolveRel(rel);
  const isArtifact = ARTIFACT_KINDS[rel];
  if (!isArtifact && relation.rel !== wanted) return false;
  if (isArtifact && relation.rel !== 'ArtifactLink') return false;
  if (url) return relation.url === url;
  if (targetId != null) return new RegExp(`/workItems/${targetId}$`, 'i').test(relation.url || '');
  return false;
}

// O índice de /relations/{i} muda a cada mutação: resolver aqui, imediatamente antes do
// patch, evita remover o link errado a partir de um índice envelhecido.
async function unlink(ctx, { id, rel, targetId, url, expectedRev }) {
  const relations = await listRelations(ctx, id);
  const found = relations.filter((r) => matches(r, { rel, targetId, url }));
  if (!found.length) throw new Error(`Nenhum link '${rel}' para ${targetId ?? url} no work item ${id}.`);
  if (found.length > 1) throw new Error(`Link '${rel}' ambíguo em ${id}: ${found.length} correspondências. Informe url exata.`);
  const ops = [];
  if (expectedRev != null) ops.push({ op: 'test', path: '/rev', value: expectedRev });
  ops.push({ op: 'remove', path: `/relations/${found[0].index}` });
  return ctx.api.patch(`/wit/workitems/${id}`, ops, JSON_PATCH_HEADERS);
}

async function inspectFile(config, filePath) {
  const { size } = await stat(filePath);
  const name = basename(filePath);
  const ext = extname(name).toLowerCase().replace(/^\./, '');
  const max = config.attachMaxBytes ?? Infinity;
  if (size > max) throw new Error(`Anexo '${name}' tem ${(size / 1048576).toFixed(1)} MB; limite ${(max / 1048576).toFixed(0)} MB (ADO_ATTACH_MAX_MB).`);
  const allow = config.attachExtAllowlist ?? [];
  if (allow.length && !allow.includes(ext)) throw new Error(`Extensão '${ext}' fora da allowlist: ${allow.join(', ')}.`);
  return { name, size };
}

// Upload e link são duas chamadas: o upload sozinho já cria um blob órfão no servidor,
// então ele só acontece depois do confirm, junto do patch.
async function attach(ctx, { id, filePath, comment }) {
  const { name } = await inspectFile(ctx.config, filePath);
  await getOne(ctx, id);
  const body = await readFile(filePath);
  const uploaded = await ctx.api.post('/wit/attachments', body, {
    params: { fileName: name, uploadType: 'simple' },
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  if (!uploaded?.url) throw new Error('Upload do anexo não devolveu url.');
  const value = { rel: 'AttachedFile', url: uploaded.url, attributes: { name, ...(comment ? { comment } : {}) } };
  return ctx.api.patch(`/wit/workitems/${id}`, [{ op: 'add', path: '/relations/-', value }], JSON_PATCH_HEADERS);
}

export { link, unlink, attach, listRelations, buildRelation, inspectFile, resolveRel, REL_ALIASES, ARTIFACT_KINDS };
