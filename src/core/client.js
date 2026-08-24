import axios from 'axios';

function toCleanError(err) {
  if (err.response) {
    const msg = err.response.data?.message || err.response.statusText || 'erro';
    return new Error(`ADO ${err.response.status}: ${msg}`);
  }
  if (err.request) return new Error(`ADO sem resposta: ${err.message}`);
  return err instanceof Error ? err : new Error(String(err.message ?? err));
}

function createApi(config) {
  const token = Buffer.from(`:${config.pat}`).toString('base64');
  const baseURL = `${config.url}/${encodeURIComponent(config.project)}/_apis`;
  const http = axios.create({
    baseURL,
    timeout: config.timeoutMs ?? 30000,
    headers: { Authorization: `Basic ${token}` },
    params: { 'api-version': config.apiVersion },
  });

  const call = (fn) => async (...args) => {
    try {
      return (await fn(...args)).data;
    } catch (err) {
      throw toCleanError(err);
    }
  };

  return {
    baseURL,
    get: call((path, opts) => http.get(path, opts)),
    post: call((path, body, opts) => http.post(path, body, opts)),
    patch: call((path, body, opts) => http.patch(path, body, opts)),
  };
}

// Rotas organizacionais (projects, workitemrelationtypes) vivem fora de /{project}/_apis.
// A URL absoluta ignora a baseURL da instância e preserva os params (api-version, auth).
function orgUrl(config, path) {
  return `${config.url}/_apis${path.replace(/^\/+/, '/')}`;
}

// Endpoints ainda em preview exigem sufixo na api-version. axios faz merge profundo de
// `params`, então sobrescrever só esta chave por chamada preserva as demais.
function previewVersion(config, revision) {
  return { params: { 'api-version': `${String(config.apiVersion).split('-')[0]}-preview.${revision}` } };
}

// Um cliente HTTP por projeto, memoizado: a baseURL fixa o projeto, então trocar de
// projeto em runtime significa trocar de instância — não reescrever caminho por chamada.
function createContext(config) {
  const cache = new Map();
  const forProject = (project) => {
    if (!cache.has(project)) cache.set(project, createApi({ ...config, project }));
    return {
      config: project === config.project ? config : { ...config, project },
      api: cache.get(project),
      forProject,
    };
  };
  return forProject(config.project);
}

export { createApi, createContext, toCleanError, orgUrl, previewVersion };
