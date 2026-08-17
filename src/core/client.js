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
  const http = axios.create({
    baseURL: `${config.url}/${encodeURIComponent(config.project)}/_apis`,
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
    get: call((path, opts) => http.get(path, opts)),
    post: call((path, body, opts) => http.post(path, body, opts)),
    patch: call((path, body, opts) => http.patch(path, body, opts)),
  };
}

export { createApi, toCleanError };
