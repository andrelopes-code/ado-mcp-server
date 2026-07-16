function repoBase(repo) {
  return `/git/repositories/${encodeURIComponent(repo)}`;
}

async function listRepos({ api }) {
  const res = await api.get('/git/repositories');
  return (res.value || []).map((r) => ({ id: r.id, name: r.name, defaultBranch: r.defaultBranch }));
}

async function listBranches({ api }, repo, filter) {
  const res = await api.get(`${repoBase(repo)}/refs`, { params: { filter: `heads/${filter || ''}` } });
  return (res.value || []).map((r) => ({ name: r.name.replace(/^refs\/heads\//, ''), objectId: r.objectId }));
}

async function listCommits({ api }, repo, { branch, top = 30 } = {}) {
  const params = { 'searchCriteria.$top': top };
  if (branch) {
    params['searchCriteria.itemVersion.version'] = branch;
    params['searchCriteria.itemVersion.versionType'] = 'branch';
  }
  const res = await api.get(`${repoBase(repo)}/commits`, { params });
  return (res.value || []).map((c) => ({ id: c.commitId?.slice(0, 8), comment: c.comment, author: c.author?.name, date: c.author?.date }));
}

export { listRepos, listBranches, listCommits };
