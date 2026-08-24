import { previewVersion } from './client.js';
import { getOne, JSON_PATCH_HEADERS } from './workitems.js';

// A API de comments (autor, data, edição) ainda é preview no on-prem. System.History é GA
// e grava no mesmo fluxo de discussão, então serve de fallback quando o preview não existe.
const COMMENTS_PREVIEW = 3;

function commentsPath(id) {
  return `/wit/workItems/${id}/comments`;
}

function slim(c) {
  return {
    id: c.id,
    text: c.text,
    createdBy: c.createdBy?.displayName ?? null,
    createdDate: c.createdDate ?? null,
    modifiedDate: c.modifiedDate !== c.createdDate ? c.modifiedDate ?? null : null,
  };
}

// Fallback de leitura: /updates é GA e cada revisão com System.History é um comentário.
async function historyAsComments({ api }, id, top) {
  const res = await api.get(`/wit/workitems/${id}/updates`, { params: { $top: top } });
  return (res.value || [])
    .filter((u) => u.fields?.['System.History']?.newValue)
    .map((u) => ({
      id: u.rev,
      text: u.fields['System.History'].newValue,
      createdBy: u.revisedBy?.displayName ?? null,
      createdDate: u.fields['System.ChangedDate']?.newValue ?? u.revisedDate ?? null,
      modifiedDate: null,
    }));
}

async function listComments(ctx, { id, top = 50 }) {
  await getOne(ctx, id);
  const preview = previewVersion(ctx.config, COMMENTS_PREVIEW);
  try {
    const res = await ctx.api.get(commentsPath(id), { ...preview, params: { ...preview.params, $top: top } });
    return { source: 'comments-api', comments: (res.comments || []).map(slim), total: res.totalCount ?? null };
  } catch {
    const comments = await historyAsComments(ctx, id, top);
    return { source: 'system-history', comments, total: comments.length };
  }
}

async function updates(ctx, { id, top = 20 }) {
  await getOne(ctx, id);
  const res = await ctx.api.get(`/wit/workitems/${id}/updates`, { params: { $top: top } });
  return (res.value || []).map((u) => ({
    rev: u.rev,
    by: u.revisedBy?.displayName ?? null,
    date: u.fields?.['System.ChangedDate']?.newValue ?? u.revisedDate ?? null,
    changes: Object.entries(u.fields || {})
      .filter(([field]) => !['System.ChangedDate', 'System.ChangedBy', 'System.Rev', 'System.AuthorizedDate', 'System.AuthorizedAs', 'System.RevisedDate', 'System.Watermark'].includes(field))
      .map(([field, v]) => ({ field, from: v.oldValue ?? null, to: v.newValue ?? null })),
    relations: u.relations ? { added: u.relations.added?.length ?? 0, removed: u.relations.removed?.length ?? 0 } : undefined,
  }));
}

async function historyComment({ api }, { id, text }) {
  return api.patch(`/wit/workitems/${id}`, [{ op: 'add', path: '/fields/System.History', value: text }], JSON_PATCH_HEADERS);
}

async function comment(ctx, { id, text }) {
  const preview = previewVersion(ctx.config, COMMENTS_PREVIEW);
  try {
    const res = await ctx.api.post(commentsPath(id), { text }, preview);
    return { source: 'comments-api', ...slim(res) };
  } catch {
    const res = await historyComment(ctx, { id, text });
    return { source: 'system-history', id: res?.id ?? id, rev: res?.rev ?? null };
  }
}

export { listComments, updates, comment, historyComment, COMMENTS_PREVIEW };
