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

async function create({ api }, repo, { sourceRef, targetRef, title, description, reviewers = [], workItemIds = [] }) {
  const body = {
    sourceRefName: normalizeRef(sourceRef),
    targetRefName: normalizeRef(targetRef),
    title,
    description,
    reviewers: reviewers.map((id) => ({ id })),
    workItemRefs: workItemIds.map((id) => ({ id: String(id) })),
  };
  return api.post(repoPath(repo), body);
}

async function addReviewers({ api }, repo, prId, reviewerIds) {
  return api.post(repoPath(repo, `/${prId}/reviewers`), reviewerIds.map((id) => ({ id })));
}

async function comment({ api }, repo, prId, text) {
  const body = { comments: [{ parentCommentId: 0, content: text, commentType: 'text' }], status: 'active' };
  return api.post(repoPath(repo, `/${prId}/threads`), body);
}

export { list, get, create, addReviewers, comment, normalizeRef };
