function normalizeRef(ref) {
  return String(ref).startsWith('refs/') ? String(ref) : `refs/heads/${ref}`;
}

function repoPath(repo, suffix = '') {
  return `/git/repositories/${encodeURIComponent(repo)}/pullrequests${suffix}`;
}

async function list({ api }, repo, { status = 'active', creatorId, targetRef } = {}) {
  const params = { 'searchCriteria.status': status };
  if (creatorId) params['searchCriteria.creatorId'] = creatorId;
  if (targetRef) params['searchCriteria.targetRefName'] = normalizeRef(targetRef);
  const res = await api.get(repoPath(repo), { params });
  return res.value || [];
}

async function get({ api }, repo, prId) {
  return api.get(repoPath(repo, `/${prId}`));
}

async function create({ api }, repo, { sourceRef, targetRef, title, description, reviewers = [], workItemIds = [], isDraft = false }) {
  const body = {
    sourceRefName: normalizeRef(sourceRef),
    targetRefName: normalizeRef(targetRef),
    title,
    description,
    isDraft,
    reviewers: reviewers.map((id) => ({ id })),
    workItemRefs: workItemIds.map((id) => ({ id: String(id) })),
  };
  return api.post(repoPath(repo), body);
}

async function update({ api }, repo, prId, { title, description, isDraft, targetRef } = {}) {
  const body = {};
  if (title !== undefined) body.title = title;
  if (description !== undefined) body.description = description;
  if (isDraft !== undefined) body.isDraft = isDraft;
  if (targetRef !== undefined) body.targetRefName = normalizeRef(targetRef);
  return api.patch(repoPath(repo, `/${prId}`), body);
}

async function addReviewers({ api }, repo, prId, reviewerIds) {
  return api.post(repoPath(repo, `/${prId}/reviewers`), reviewerIds.map((id) => ({ id })));
}

async function comment({ api }, repo, prId, text) {
  const body = { comments: [{ parentCommentId: 0, content: text, commentType: 'text' }], status: 'active' };
  return api.post(repoPath(repo, `/${prId}/threads`), body);
}

export { list, get, create, update, addReviewers, comment, normalizeRef };
