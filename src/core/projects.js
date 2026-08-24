import { orgUrl } from './client.js';

// Endpoint organizacional: lista o que existe na coleção, independente do projeto da baseURL.
async function listProjects({ api, config }) {
  const res = await api.get(orgUrl(config, '/projects'), { params: { $top: 500 } });
  return (res.value || []).map((p) => ({ id: p.id, name: p.name, state: p.state, description: p.description }));
}

function isAllowed(config, name) {
  if (name === config.project) return true;
  const list = config.projectAllowlist ?? [];
  return list.includes('*') || list.includes(name);
}

export { listProjects, isAllowed };
