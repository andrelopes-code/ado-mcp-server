# ado-mcp-server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, security-first MCP server that gives Claude Code controlled access to an on-prem Azure DevOps Server (work items, pull requests, repos) — incapable of destructive/irreversible actions by construction.

**Architecture:** Node ESM MCP server over stdio. A pure `core/` REST layer (no MCP knowledge) is wrapped by a thin `tools/` adapter layer that applies safety guards (read-only default, preview→confirm, project/repo scoping, audit log). Auth reuses the proven on-prem pattern: PAT via HTTP Basic.

**Tech Stack:** Node 20, `@modelcontextprotocol/sdk` v1.x (`McpServer` + `registerTool` + `StdioServerTransport`), `axios`, `zod` v3, `dotenv`, `vitest`.

## Global Constraints

- Node ≥ 20; ESM (`"type": "module"` in package.json); all imports use `.js` extension.
- MCP SDK **stable v1.x only** (`@modelcontextprotocol/sdk`) — never the v2 alpha. `registerTool(name, { description, inputSchema }, handler)` where `inputSchema` is a **raw zod shape** (plain object of zod validators, not `z.object(...)`).
- zod pinned to **v3** (`^3.23.0`) — v1.x SDK expects zod 3.
- **No destructive operations exist in the code:** no delete/abandon/complete/merge tools. Ever.
- Every **write** tool: (a) refuses unless `config.mode === 'write'`; (b) requires `confirm: true`, otherwise returns a preview and does nothing; (c) appends to the audit log when it executes.
- Secrets (`DEVOPS_PAT`) only ever come from `.env`; never logged, never in a committed file. PAT never appears in any audit entry or preview.
- Logs go to **stderr** (`console.error`) — stdout is reserved for the MCP protocol.
- Commit messages: Conventional Commits in PT-BR (`feat:`, `chore:`, `test:`, `docs:`). No co-author/trailer of any kind.
- Language: identifiers in English; user-facing tool text/messages in PT-BR.

---

### Task 1: Project scaffold + config module

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`
- Create: `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Produces: `readConfig(env = process.env) → { url, project, pat, apiVersion, mode, repoAllowlist, protectedBranches, auditLog }`. `mode` is `'read'|'write'`. `url` has trailing slashes stripped. Throws if `DEVOPS_URL`/`DEVOPS_PROJECT`/`DEVOPS_PAT` missing.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ado-mcp-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": { "start": "node src/index.js", "test": "vitest run" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "axios": "^1.7.0",
    "dotenv": "^16.4.0",
    "zod": "^3.23.0"
  },
  "devDependencies": { "vitest": "^2.0.0" }
}
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
node_modules/
.env
*.log
```

- [ ] **Step 3: Create `.env.example`**

```dotenv
# Base da coleção on-prem, ex: http://servidor/colecao
DEVOPS_URL=
# Projeto único (blast radius)
DEVOPS_PROJECT=
# PAT dedicado, escopos mínimos (Work Items RW, Code RW, PR Threads RW), expiração curta
DEVOPS_PAT=
# Versão da REST API (comprovada no on-prem)
API_VERSION=6.0
# read = só leitura (default seguro) | write = habilita mutações
ADO_MODE=read
# Repos permitidos, separados por vírgula (vazio = todos)
ADO_REPO_ALLOWLIST=
# Branches sob sinalização reforçada
ADO_PROTECTED_BRANCHES=main,master,develop,release/*
# Trilha de auditoria de escritas
ADO_AUDIT_LOG=./ado-mcp-audit.log
```

- [ ] **Step 4: Write the failing test** — `test/config.test.js`

```js
import { describe, it, expect } from 'vitest';
import { readConfig } from '../src/config.js';

const base = { DEVOPS_URL: 'http://srv/col/', DEVOPS_PROJECT: 'Proj', DEVOPS_PAT: 'secret' };

describe('readConfig', () => {
  it('throws when required vars are missing', () => {
    expect(() => readConfig({})).toThrow(/DEVOPS_URL/);
    expect(() => readConfig({ DEVOPS_URL: 'x' })).toThrow(/DEVOPS_PROJECT/);
  });

  it('strips trailing slashes from url and applies defaults', () => {
    const c = readConfig(base);
    expect(c.url).toBe('http://srv/col');
    expect(c.apiVersion).toBe('6.0');
    expect(c.mode).toBe('read');
    expect(c.protectedBranches).toEqual(['main', 'master', 'develop', 'release/*']);
    expect(c.repoAllowlist).toEqual([]);
  });

  it('parses write mode and allowlist', () => {
    const c = readConfig({ ...base, ADO_MODE: 'write', ADO_REPO_ALLOWLIST: 'a, b ,c' });
    expect(c.mode).toBe('write');
    expect(c.repoAllowlist).toEqual(['a', 'b', 'c']);
  });

  it('defaults unknown mode to read', () => {
    expect(readConfig({ ...base, ADO_MODE: 'yolo' }).mode).toBe('read');
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm install && npx vitest run test/config.test.js`
Expected: FAIL — cannot find `../src/config.js`.

- [ ] **Step 6: Implement `src/config.js`**

```js
import 'dotenv/config';

const REQUIRED = ['DEVOPS_URL', 'DEVOPS_PROJECT', 'DEVOPS_PAT'];

function splitList(value, fallback = []) {
  const parts = String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : fallback;
}

function readConfig(env = process.env) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Config inválida: faltam variáveis obrigatórias no .env: ${missing.join(', ')}`);
  }
  return {
    url: env.DEVOPS_URL.replace(/\/+$/, ''),
    project: env.DEVOPS_PROJECT,
    pat: env.DEVOPS_PAT,
    apiVersion: env.API_VERSION || '6.0',
    mode: env.ADO_MODE === 'write' ? 'write' : 'read',
    repoAllowlist: splitList(env.ADO_REPO_ALLOWLIST),
    protectedBranches: splitList(env.ADO_PROTECTED_BRANCHES, ['main', 'master', 'develop', 'release/*']),
    auditLog: env.ADO_AUDIT_LOG || './ado-mcp-audit.log',
  };
}

export { readConfig };
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run test/config.test.js`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git init && git add -A
git commit -m "chore: scaffold do projeto e módulo de config"
```

---

### Task 2: REST client (`createApi`)

**Files:**
- Create: `src/core/client.js`
- Test: `test/client.test.js`

**Interfaces:**
- Consumes: config object from Task 1.
- Produces:
  - `createApi(config) → { get(path, opts?), post(path, body, opts?), patch(path, body, opts?) }` — each returns `response.data`, maps errors via `toCleanError`. Base URL is `${config.url}/${project}/_apis`; `Authorization: Basic base64(':'+pat)`; default param `api-version`.
  - `toCleanError(err) → Error` with a short message: `ADO <status>: <message>` for HTTP errors, `ADO sem resposta: ...` for no-response, else the raw message.

- [ ] **Step 1: Write the failing test** — `test/client.test.js`

```js
import { describe, it, expect } from 'vitest';
import { toCleanError } from '../src/core/client.js';

describe('toCleanError', () => {
  it('maps an HTTP error response to a short message', () => {
    const err = { response: { status: 404, statusText: 'Not Found', data: { message: 'work item não existe' } } };
    expect(toCleanError(err).message).toBe('ADO 404: work item não existe');
  });

  it('falls back to statusText when no data.message', () => {
    const err = { response: { status: 500, statusText: 'Server Error', data: {} } };
    expect(toCleanError(err).message).toBe('ADO 500: Server Error');
  });

  it('handles no-response errors', () => {
    const err = { request: {}, message: 'ECONNREFUSED' };
    expect(toCleanError(err).message).toBe('ADO sem resposta: ECONNREFUSED');
  });

  it('handles generic errors', () => {
    expect(toCleanError(new Error('boom')).message).toBe('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/client.test.js`
Expected: FAIL — cannot find `../src/core/client.js`.

- [ ] **Step 3: Implement `src/core/client.js`**

```js
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
    timeout: 30000,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/client.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: client REST com auth PAT e mapeamento de erro"
```

---

### Task 3: Audit log

**Files:**
- Create: `src/audit.js`
- Test: `test/audit.test.js`

**Interfaces:**
- Produces: `auditWrite(config, entry) → Promise<void>` — appends one JSON line `{ ts, ...entry }` to `config.auditLog`. `entry` is caller-sanitized (never contains the PAT).

- [ ] **Step 1: Write the failing test** — `test/audit.test.js`

```js
import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { auditWrite } from '../src/audit.js';

const file = './test-audit.log';
afterEach(() => rm(file, { force: true }));

describe('auditWrite', () => {
  it('appends a JSON line with a timestamp', async () => {
    await auditWrite({ auditLog: file }, { tool: 'wit_create', resultId: 42 });
    await auditWrite({ auditLog: file }, { tool: 'wit_update', resultId: 7 });
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.tool).toBe('wit_create');
    expect(first.resultId).toBe(42);
    expect(typeof first.ts).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/audit.test.js`
Expected: FAIL — cannot find `../src/audit.js`.

- [ ] **Step 3: Implement `src/audit.js`**

```js
import { appendFile } from 'node:fs/promises';

async function auditWrite(config, entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  await appendFile(config.auditLog, line, 'utf8');
}

export { auditWrite };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/audit.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: trilha de auditoria de escritas"
```

---

### Task 4: Guards + write orchestration (the safety heart)

**Files:**
- Create: `src/tools/guards.js`
- Test: `test/guards.test.js`

**Interfaces:**
- Consumes: `auditWrite` (Task 3).
- Produces:
  - `textResult(text, isError = false) → { content: [{ type:'text', text }], isError }`
  - `assertRepoAllowed(config, repo)` — throws if `repoAllowlist` non-empty and `repo` not in it.
  - `isProtectedBranch(config, ref) → boolean` — matches `protectedBranches`, supporting a trailing `/*` prefix glob; strips a leading `refs/heads/`.
  - `runWrite({ ctx, tool, args, confirm, preview, execute }) → Promise<toolResult>` — read-mode → blocked result; `confirm !== true` → preview result; else `await execute()`, audit, return applied result. `ctx = { config, api }`.

- [ ] **Step 1: Write the failing test** — `test/guards.test.js`

```js
import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { assertRepoAllowed, isProtectedBranch, runWrite, textResult } from '../src/tools/guards.js';

const audit = './test-guards-audit.log';
afterEach(() => rm(audit, { force: true }));

const cfg = (over = {}) => ({ mode: 'read', repoAllowlist: [], protectedBranches: ['main', 'release/*'], auditLog: audit, ...over });

describe('assertRepoAllowed', () => {
  it('allows everything when allowlist empty', () => {
    expect(() => assertRepoAllowed(cfg(), 'anything')).not.toThrow();
  });
  it('throws for repo outside a non-empty allowlist', () => {
    expect(() => assertRepoAllowed(cfg({ repoAllowlist: ['app'] }), 'other')).toThrow(/allowlist/);
  });
});

describe('isProtectedBranch', () => {
  it('matches exact and glob, stripping refs/heads/', () => {
    const c = cfg();
    expect(isProtectedBranch(c, 'main')).toBe(true);
    expect(isProtectedBranch(c, 'refs/heads/main')).toBe(true);
    expect(isProtectedBranch(c, 'release/1.2')).toBe(true);
    expect(isProtectedBranch(c, 'feature/x')).toBe(false);
  });
});

describe('runWrite', () => {
  const preview = { action: 'demo' };
  it('blocks in read mode and does not execute', async () => {
    let ran = false;
    const res = await runWrite({ ctx: { config: cfg() }, tool: 't', args: {}, confirm: true, preview, execute: async () => { ran = true; } });
    expect(ran).toBe(false);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/BLOQUEADA/);
  });
  it('previews when confirm is not true', async () => {
    let ran = false;
    const res = await runWrite({ ctx: { config: cfg({ mode: 'write' }) }, tool: 't', args: {}, confirm: false, preview, execute: async () => { ran = true; } });
    expect(ran).toBe(false);
    expect(res.content[0].text).toMatch(/PREVIEW/);
  });
  it('executes and audits when write + confirm', async () => {
    const res = await runWrite({ ctx: { config: cfg({ mode: 'write' }) }, tool: 'wit_create', args: { title: 'x' }, confirm: true, preview, execute: async () => ({ id: 99 }) });
    expect(res.content[0].text).toMatch(/APLICADO/);
    const logged = JSON.parse((await readFile(audit, 'utf8')).trim());
    expect(logged.tool).toBe('wit_create');
    expect(logged.resultId).toBe(99);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/guards.test.js`
Expected: FAIL — cannot find `../src/tools/guards.js`.

- [ ] **Step 3: Implement `src/tools/guards.js`**

```js
import { auditWrite } from '../audit.js';

const fmt = (v) => JSON.stringify(v, null, 2);

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

function assertRepoAllowed(config, repo) {
  if (config.repoAllowlist.length && !config.repoAllowlist.includes(repo)) {
    throw new Error(`Repo '${repo}' fora da allowlist: ${config.repoAllowlist.join(', ')}.`);
  }
}

function isProtectedBranch(config, ref) {
  const name = String(ref).replace(/^refs\/heads\//, '');
  return config.protectedBranches.some((p) =>
    p.endsWith('/*') ? name.startsWith(p.slice(0, -1)) : name === p);
}

async function runWrite({ ctx, tool, args, confirm, preview, execute }) {
  if (ctx.config.mode !== 'write') {
    return textResult(`Escrita BLOQUEADA — ADO_MODE=read. Nada foi enviado.\n\nO que seria feito:\n${fmt(preview)}`, true);
  }
  if (confirm !== true) {
    return textResult(`PREVIEW — nada foi enviado. Reenvie a chamada com confirm:true para aplicar.\n\n${fmt(preview)}`);
  }
  const result = await execute();
  await auditWrite(ctx.config, { tool, args, resultId: result?.id ?? result?.pullRequestId ?? null });
  return textResult(`APLICADO ✔\n\n${fmt(result)}`);
}

export { textResult, assertRepoAllowed, isProtectedBranch, runWrite };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/guards.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: guardas de segurança e orquestração preview/confirm de escrita"
```

---

### Task 5: Work items core

**Files:**
- Create: `src/core/workitems.js`
- Test: `test/workitems.core.test.js`

**Interfaces:**
- Consumes: `ctx = { api, config }`.
- Produces (all take `ctx` first):
  - `query(ctx, { wiql, preset }) → Promise<item[]>` — runs WIQL (or the preset's WIQL), then hydrates up to 50 ids via `getMany`.
  - `getMany(ctx, ids, fields?) → Promise<item[]>`
  - `getOne(ctx, id) → Promise<item>` — throws if not found or if `System.TeamProject` ≠ `config.project`.
  - `create(ctx, { type, title, fields?, parentId? }) → Promise<item>`
  - `update(ctx, { id, fields?, state? }) → Promise<item>` — throws if nothing to change.
  - `comment(ctx, { id, text }) → Promise<item>` — posts via `System.History`.

- [ ] **Step 1: Write the failing test** — `test/workitems.core.test.js`

```js
import { describe, it, expect } from 'vitest';
import * as wit from '../src/core/workitems.js';

function stubApi(over = {}) {
  const calls = [];
  return {
    calls,
    get: async (path, opts) => { calls.push(['get', path, opts]); return over.get?.(path, opts) ?? { value: [] }; },
    post: async (path, body, opts) => { calls.push(['post', path, body, opts]); return over.post?.(path, body, opts) ?? { id: 1 }; },
    patch: async (path, body, opts) => { calls.push(['patch', path, body, opts]); return over.patch?.(path, body, opts) ?? { id: 1 }; },
  };
}
const config = { project: 'Proj', url: 'http://srv/col' };

describe('workitems core', () => {
  it('query uses preset WIQL then hydrates returned ids', async () => {
    const api = stubApi({
      post: () => ({ workItems: [{ id: 10 }, { id: 11 }] }),
      get: () => ({ value: [{ id: 10 }, { id: 11 }] }),
    });
    const items = await wit.query({ api, config }, { preset: 'my_active' });
    expect(items).toHaveLength(2);
    const wiqlCall = api.calls.find((c) => c[0] === 'post' && c[1] === '/wit/wiql');
    expect(wiqlCall[2].query).toMatch(/@Me/);
  });

  it('create builds a json-patch with title and parent relation', async () => {
    const api = stubApi();
    await wit.create({ api, config }, { type: 'Task', title: 'Doc', parentId: 5 });
    const call = api.calls.find((c) => c[0] === 'post' && c[1] === '/wit/workitems/$Task');
    const ops = call[2];
    expect(ops[0]).toEqual({ op: 'add', path: '/fields/System.Title', value: 'Doc' });
    expect(call[3].headers['Content-Type']).toBe('application/json-patch+json');
    const rel = ops.find((o) => o.path === '/relations/-');
    expect(rel.value.url).toContain('/wit/workItems/5');
  });

  it('update throws when nothing to change', async () => {
    await expect(wit.update({ api: stubApi(), config }, { id: 1 })).rejects.toThrow(/Nada para atualizar/);
  });

  it('comment posts via System.History', async () => {
    const api = stubApi();
    await wit.comment({ api, config }, { id: 3, text: 'oi' });
    const call = api.calls.find((c) => c[0] === 'patch');
    expect(call[2]).toEqual([{ op: 'add', path: '/fields/System.History', value: 'oi' }]);
  });

  it('getOne rejects a work item from another project', async () => {
    const api = stubApi({ get: () => ({ value: [{ id: 9, fields: { 'System.TeamProject': 'Outro' } }] }) });
    await expect(wit.getOne({ api, config }, 9)).rejects.toThrow(/fora de 'Proj'/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/workitems.core.test.js`
Expected: FAIL — cannot find `../src/core/workitems.js`.

- [ ] **Step 3: Implement `src/core/workitems.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/workitems.core.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: core de work items (query/get/create/update/comment)"
```

---

### Task 6: Pull requests core

**Files:**
- Create: `src/core/pullrequests.js`
- Test: `test/pullrequests.core.test.js`

**Interfaces:**
- Produces (all take `ctx = { api }` first):
  - `list(ctx, repo, { status?, creatorId?, targetRef? }) → Promise<pr[]>`
  - `get(ctx, repo, prId) → Promise<pr>`
  - `create(ctx, repo, { sourceRef, targetRef, title, description?, reviewers?, workItemIds? }) → Promise<pr>` — body contains **no** completion/autocomplete/deleteSourceBranch fields.
  - `addReviewers(ctx, repo, prId, reviewerIds) → Promise<any>`
  - `comment(ctx, repo, prId, text) → Promise<any>`
  - Helper `normalizeRef(ref)` prefixes `refs/heads/` when missing.

- [ ] **Step 1: Write the failing test** — `test/pullrequests.core.test.js`

```js
import { describe, it, expect } from 'vitest';
import * as pr from '../src/core/pullrequests.js';

function stubApi() {
  const calls = [];
  return { calls, get: async (...a) => (calls.push(['get', ...a]), { value: [] }), post: async (...a) => (calls.push(['post', ...a]), { pullRequestId: 1 }) };
}

describe('pullrequests core', () => {
  it('create normalizes refs and never sends completion options', async () => {
    const api = stubApi();
    await pr.create({ api }, 'app', { sourceRef: 'feat/x', targetRef: 'main', title: 'T', workItemIds: [7] });
    const [, path, body] = api.calls.find((c) => c[0] === 'post');
    expect(path).toBe('/git/repositories/app/pullrequests');
    expect(body.sourceRefName).toBe('refs/heads/feat/x');
    expect(body.targetRefName).toBe('refs/heads/main');
    expect(body.workItemRefs).toEqual([{ id: '7' }]);
    expect(body).not.toHaveProperty('completionOptions');
    expect(body).not.toHaveProperty('autoCompleteSetBy');
    expect(JSON.stringify(body)).not.toMatch(/deleteSourceBranch/);
  });

  it('list passes status search criteria', async () => {
    const api = stubApi();
    await pr.list({ api }, 'app', { status: 'active' });
    const [, path, opts] = api.calls.find((c) => c[0] === 'get');
    expect(path).toBe('/git/repositories/app/pullrequests');
    expect(opts.params['searchCriteria.status']).toBe('active');
  });

  it('comment opens an active thread', async () => {
    const api = stubApi();
    await pr.comment({ api }, 'app', 12, 'revisar isto');
    const [, path, body] = api.calls.find((c) => c[0] === 'post');
    expect(path).toBe('/git/repositories/app/pullrequests/12/threads');
    expect(body.comments[0].content).toBe('revisar isto');
    expect(body.status).toBe('active');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/pullrequests.core.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `src/core/pullrequests.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/pullrequests.core.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: core de pull requests (sem merge por construção)"
```

---

### Task 7: Repos core

**Files:**
- Create: `src/core/repos.js`
- Test: `test/repos.core.test.js`

**Interfaces:**
- Produces (all take `ctx = { api }` first):
  - `listRepos(ctx) → Promise<{ id, name, defaultBranch }[]>`
  - `listBranches(ctx, repo, filter?) → Promise<{ name, objectId }[]>` — `name` stripped of `refs/heads/`.
  - `listCommits(ctx, repo, { branch?, top? }) → Promise<{ id, comment, author, date }[]>`

- [ ] **Step 1: Write the failing test** — `test/repos.core.test.js`

```js
import { describe, it, expect } from 'vitest';
import * as repos from '../src/core/repos.js';

function stubApi(payload) {
  const calls = [];
  return { calls, get: async (...a) => (calls.push(a), payload) };
}

describe('repos core', () => {
  it('lists repos slimmed', async () => {
    const api = stubApi({ value: [{ id: 'a', name: 'app', defaultBranch: 'refs/heads/main', extra: 1 }] });
    const out = await repos.listRepos({ api });
    expect(out).toEqual([{ id: 'a', name: 'app', defaultBranch: 'refs/heads/main' }]);
  });

  it('branches strip refs/heads/ and filter by heads/<filter>', async () => {
    const api = stubApi({ value: [{ name: 'refs/heads/feat/x', objectId: 'sha' }] });
    const out = await repos.listBranches({ api }, 'app', 'feat');
    expect(out).toEqual([{ name: 'feat/x', objectId: 'sha' }]);
    expect(api.calls[0][1].params.filter).toBe('heads/feat');
  });

  it('commits pass branch as itemVersion and top', async () => {
    const api = stubApi({ value: [{ commitId: 'abcdef1234', comment: 'c', author: { name: 'A', date: 'd' } }] });
    const out = await repos.listCommits({ api }, 'app', { branch: 'main', top: 5 });
    expect(out[0]).toEqual({ id: 'abcdef12', comment: 'c', author: 'A', date: 'd' });
    expect(api.calls[0][1].params['searchCriteria.itemVersion.version']).toBe('main');
    expect(api.calls[0][1].params['searchCriteria.$top']).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/repos.core.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `src/core/repos.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/repos.core.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: core de repos (list/branches/commits)"
```

---

### Task 8: Work item tools (MCP adapter)

**Files:**
- Create: `src/tools/workitems.tools.js`
- Test: `test/workitems.tools.test.js`

**Interfaces:**
- Consumes: `wit.*` (Task 5), `runWrite`/`textResult` (Task 4).
- Produces: `registerWorkItemTools(server, ctx)` — registers `wit_query`, `wit_get`, `wit_create`, `wit_update`, `wit_comment`. `server` exposes `registerTool(name, cfg, handler)`.

- [ ] **Step 1: Write the failing test** — `test/workitems.tools.test.js`

```js
import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { registerWorkItemTools } from '../src/tools/workitems.tools.js';

const audit = './test-wit-tools-audit.log';
afterEach(() => rm(audit, { force: true }));

function fakeServer() {
  const tools = {};
  return { tools, registerTool: (name, cfg, handler) => { tools[name] = { cfg, handler }; } };
}
function stubApi(over = {}) {
  return {
    get: async () => over.get?.() ?? { value: [{ id: 3, fields: { 'System.TeamProject': 'Proj', 'System.State': 'To Do' } }] },
    post: async () => over.post?.() ?? { id: 100 },
    patch: async () => over.patch?.() ?? { id: 3 },
  };
}
const baseCfg = { project: 'Proj', url: 'http://srv/col', mode: 'read', repoAllowlist: [], protectedBranches: [], auditLog: audit };

describe('wit tools', () => {
  it('wit_update in read mode returns blocked and shows before/after', async () => {
    const server = fakeServer();
    registerWorkItemTools(server, { api: stubApi(), config: baseCfg });
    const res = await server.tools.wit_update.handler({ id: 3, state: 'Doing', confirm: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/BLOQUEADA/);
    expect(res.content[0].text).toMatch(/To Do/); // current value surfaced in preview
  });

  it('wit_create with write + confirm executes', async () => {
    const server = fakeServer();
    registerWorkItemTools(server, { api: stubApi(), config: { ...baseCfg, mode: 'write' } });
    const res = await server.tools.wit_create.handler({ type: 'Task', title: 'X', confirm: true });
    expect(res.content[0].text).toMatch(/APLICADO/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/workitems.tools.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `src/tools/workitems.tools.js`**

```js
import { z } from 'zod';
import * as wit from '../core/workitems.js';
import { textResult, runWrite } from './guards.js';

const fieldMap = z.record(z.string(), z.union([z.string(), z.number()]));

function registerWorkItemTools(server, ctx) {
  server.registerTool('wit_query', {
    description: 'Busca work items via WIQL ou preset (my_active | my_recent). Leitura.',
    inputSchema: {
      wiql: z.string().optional().describe('Consulta WIQL; se ausente, informe preset.'),
      preset: z.enum(['my_active', 'my_recent']).optional(),
    },
  }, async ({ wiql, preset }) => {
    if (!wiql && !preset) return textResult('Informe wiql ou preset.', true);
    return textResult(JSON.stringify(await wit.query(ctx, { wiql, preset }), null, 2));
  });

  server.registerTool('wit_get', {
    description: 'Detalha work items por id. Leitura.',
    inputSchema: { ids: z.array(z.number()).min(1) },
  }, async ({ ids }) => textResult(JSON.stringify(await wit.getMany(ctx, ids), null, 2)));

  server.registerTool('wit_create', {
    description: 'Cria work item. Escrita: exige ADO_MODE=write e confirm:true.',
    inputSchema: {
      type: z.string().describe('Task, Bug, Product Backlog Item...'),
      title: z.string(),
      fields: fieldMap.optional(),
      parentId: z.number().optional(),
      confirm: z.boolean().optional(),
    },
  }, async ({ type, title, fields, parentId, confirm }) => {
    const preview = { action: 'create', type, title, fields: fields ?? {}, parentId: parentId ?? null };
    return runWrite({ ctx, tool: 'wit_create', args: { type, title }, confirm, preview,
      execute: () => wit.create(ctx, { type, title, fields, parentId }) });
  });

  server.registerTool('wit_update', {
    description: 'Atualiza campos/estado de UM work item. Escrita: write + confirm.',
    inputSchema: {
      id: z.number(),
      fields: fieldMap.optional(),
      state: z.string().optional(),
      confirm: z.boolean().optional(),
    },
  }, async ({ id, fields, state, confirm }) => {
    const current = await wit.getOne(ctx, id);
    const after = { ...(state ? { 'System.State': state } : {}), ...(fields ?? {}) };
    const before = Object.fromEntries(Object.keys(after).map((k) => [k, current.fields?.[k] ?? null]));
    const preview = { action: 'update', id, before, after };
    return runWrite({ ctx, tool: 'wit_update', args: { id }, confirm, preview,
      execute: () => wit.update(ctx, { id, fields, state }) });
  });

  server.registerTool('wit_comment', {
    description: 'Adiciona comentário (System.History) a um work item. Escrita: write + confirm.',
    inputSchema: { id: z.number(), text: z.string(), confirm: z.boolean().optional() },
  }, async ({ id, text, confirm }) => {
    await wit.getOne(ctx, id);
    const preview = { action: 'comment', id, text };
    return runWrite({ ctx, tool: 'wit_comment', args: { id }, confirm, preview,
      execute: () => wit.comment(ctx, { id, text }) });
  });
}

export { registerWorkItemTools };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/workitems.tools.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tools MCP de work items"
```

---

### Task 9: Pull request tools (MCP adapter)

**Files:**
- Create: `src/tools/pullrequests.tools.js`
- Test: `test/pullrequests.tools.test.js`

**Interfaces:**
- Consumes: `pr.*` (Task 6), `runWrite`/`textResult`/`assertRepoAllowed`/`isProtectedBranch` (Task 4).
- Produces: `registerPullRequestTools(server, ctx)` — `pr_list`, `pr_get`, `pr_create`, `pr_add_reviewers`, `pr_comment`.

- [ ] **Step 1: Write the failing test** — `test/pullrequests.tools.test.js`

```js
import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { registerPullRequestTools } from '../src/tools/pullrequests.tools.js';

const audit = './test-pr-tools-audit.log';
afterEach(() => rm(audit, { force: true }));

function fakeServer() {
  const tools = {};
  return { tools, registerTool: (name, cfg, handler) => { tools[name] = { handler }; } };
}
const stubApi = { get: async () => ({ value: [] }), post: async () => ({ pullRequestId: 55 }) };
const cfg = (over = {}) => ({ project: 'Proj', url: 'u', mode: 'write', repoAllowlist: [], protectedBranches: ['main'], auditLog: audit, ...over });

describe('pr tools', () => {
  it('pr_create rejects repo outside allowlist', async () => {
    const server = fakeServer();
    registerPullRequestTools(server, { api: stubApi, config: cfg({ repoAllowlist: ['only'] }) });
    await expect(server.tools.pr_create.handler({ repo: 'other', source: 'f', target: 'main', title: 'T', confirm: true }))
      .rejects.toThrow(/allowlist/);
  });

  it('pr_create preview flags a protected target branch', async () => {
    const server = fakeServer();
    registerPullRequestTools(server, { api: stubApi, config: cfg() });
    const res = await server.tools.pr_create.handler({ repo: 'app', source: 'feat/x', target: 'main', title: 'T' });
    expect(res.content[0].text).toMatch(/PREVIEW/);
    expect(res.content[0].text).toMatch(/protegida/);
  });

  it('pr_create executes with confirm', async () => {
    const server = fakeServer();
    registerPullRequestTools(server, { api: stubApi, config: cfg() });
    const res = await server.tools.pr_create.handler({ repo: 'app', source: 'feat/x', target: 'dev', title: 'T', confirm: true });
    expect(res.content[0].text).toMatch(/APLICADO/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/pullrequests.tools.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `src/tools/pullrequests.tools.js`**

```js
import { z } from 'zod';
import * as pr from '../core/pullrequests.js';
import { textResult, runWrite, assertRepoAllowed, isProtectedBranch } from './guards.js';

function slimPr(p) {
  return { id: p.pullRequestId, title: p.title, status: p.status, source: p.sourceRefName, target: p.targetRefName, createdBy: p.createdBy?.displayName };
}

function registerPullRequestTools(server, ctx) {
  server.registerTool('pr_list', {
    description: 'Lista pull requests de um repo. Leitura.',
    inputSchema: {
      repo: z.string(),
      status: z.enum(['active', 'completed', 'abandoned', 'all']).optional(),
      creatorId: z.string().optional(),
      target: z.string().optional(),
    },
  }, async ({ repo, status, creatorId, target }) => {
    assertRepoAllowed(ctx.config, repo);
    const items = await pr.list(ctx, repo, { status, creatorId, targetRef: target });
    return textResult(JSON.stringify(items.map(slimPr), null, 2));
  });

  server.registerTool('pr_get', {
    description: 'Detalha um pull request. Leitura.',
    inputSchema: { repo: z.string(), prId: z.number() },
  }, async ({ repo, prId }) => {
    assertRepoAllowed(ctx.config, repo);
    return textResult(JSON.stringify(await pr.get(ctx, repo, prId), null, 2));
  });

  server.registerTool('pr_create', {
    description: 'Cria um pull request (NÃO faz merge). Escrita: write + confirm.',
    inputSchema: {
      repo: z.string(), source: z.string(), target: z.string(), title: z.string(),
      description: z.string().optional(),
      reviewers: z.array(z.string()).optional().describe('ids (GUID) de reviewers'),
      workItemIds: z.array(z.number()).optional(),
      confirm: z.boolean().optional(),
    },
  }, async ({ repo, source, target, title, description, reviewers, workItemIds, confirm }) => {
    assertRepoAllowed(ctx.config, repo);
    const preview = {
      action: 'create_pr', repo, source, target, title,
      reviewers: reviewers ?? [], workItemIds: workItemIds ?? [],
      note: isProtectedBranch(ctx.config, target)
        ? `⚠ target '${target}' é branch protegida — PR permitido; o merge continua manual no web UI.`
        : undefined,
    };
    return runWrite({ ctx, tool: 'pr_create', args: { repo, source, target }, confirm, preview,
      execute: () => pr.create(ctx, repo, { sourceRef: source, targetRef: target, title, description, reviewers, workItemIds }) });
  });

  server.registerTool('pr_add_reviewers', {
    description: 'Adiciona reviewers a um PR. Escrita: write + confirm.',
    inputSchema: { repo: z.string(), prId: z.number(), reviewers: z.array(z.string()).min(1), confirm: z.boolean().optional() },
  }, async ({ repo, prId, reviewers, confirm }) => {
    assertRepoAllowed(ctx.config, repo);
    const preview = { action: 'add_reviewers', repo, prId, reviewers };
    return runWrite({ ctx, tool: 'pr_add_reviewers', args: { repo, prId }, confirm, preview,
      execute: () => pr.addReviewers(ctx, repo, prId, reviewers) });
  });

  server.registerTool('pr_comment', {
    description: 'Comenta num PR (abre thread). Escrita: write + confirm.',
    inputSchema: { repo: z.string(), prId: z.number(), text: z.string(), confirm: z.boolean().optional() },
  }, async ({ repo, prId, text, confirm }) => {
    assertRepoAllowed(ctx.config, repo);
    const preview = { action: 'pr_comment', repo, prId, text };
    return runWrite({ ctx, tool: 'pr_comment', args: { repo, prId }, confirm, preview,
      execute: () => pr.comment(ctx, repo, prId, text) });
  });
}

export { registerPullRequestTools };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/pullrequests.tools.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tools MCP de pull requests"
```

---

### Task 10: Repo tools (MCP adapter)

**Files:**
- Create: `src/tools/repos.tools.js`
- Test: `test/repos.tools.test.js`

**Interfaces:**
- Consumes: `repos.*` (Task 7), `textResult`/`assertRepoAllowed` (Task 4).
- Produces: `registerRepoTools(server, ctx)` — `repo_list`, `branch_list`, `commit_list`.

- [ ] **Step 1: Write the failing test** — `test/repos.tools.test.js`

```js
import { describe, it, expect } from 'vitest';
import { registerRepoTools } from '../src/tools/repos.tools.js';

function fakeServer() {
  const tools = {};
  return { tools, registerTool: (name, cfg, handler) => { tools[name] = { handler }; } };
}
const stubApi = { get: async () => ({ value: [{ id: 'a', name: 'app', defaultBranch: 'refs/heads/main' }, { id: 'b', name: 'infra' }] }) };

describe('repo tools', () => {
  it('repo_list filters by allowlist', async () => {
    const server = fakeServer();
    registerRepoTools(server, { api: stubApi, config: { repoAllowlist: ['app'], protectedBranches: [] } });
    const res = await server.tools.repo_list.handler({});
    const out = JSON.parse(res.content[0].text);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('app');
  });

  it('branch_list enforces allowlist', async () => {
    const server = fakeServer();
    registerRepoTools(server, { api: stubApi, config: { repoAllowlist: ['app'], protectedBranches: [] } });
    await expect(server.tools.branch_list.handler({ repo: 'infra' })).rejects.toThrow(/allowlist/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/repos.tools.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `src/tools/repos.tools.js`**

```js
import { z } from 'zod';
import * as repos from '../core/repos.js';
import { textResult, assertRepoAllowed } from './guards.js';

function registerRepoTools(server, ctx) {
  server.registerTool('repo_list', {
    description: 'Lista repositórios do projeto. Leitura.',
    inputSchema: {},
  }, async () => {
    const all = await repos.listRepos(ctx);
    const out = ctx.config.repoAllowlist.length ? all.filter((r) => ctx.config.repoAllowlist.includes(r.name)) : all;
    return textResult(JSON.stringify(out, null, 2));
  });

  server.registerTool('branch_list', {
    description: 'Lista branches de um repo. Leitura.',
    inputSchema: { repo: z.string(), filter: z.string().optional() },
  }, async ({ repo, filter }) => {
    assertRepoAllowed(ctx.config, repo);
    return textResult(JSON.stringify(await repos.listBranches(ctx, repo, filter), null, 2));
  });

  server.registerTool('commit_list', {
    description: 'Lista commits recentes de um repo/branch. Leitura.',
    inputSchema: { repo: z.string(), branch: z.string().optional(), top: z.number().max(200).optional() },
  }, async ({ repo, branch, top }) => {
    assertRepoAllowed(ctx.config, repo);
    return textResult(JSON.stringify(await repos.listCommits(ctx, repo, { branch, top }), null, 2));
  });
}

export { registerRepoTools };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/repos.tools.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tools MCP de repos"
```

---

### Task 11: MCP bootstrap (`index.js`)

**Files:**
- Create: `src/index.js`
- Test: `test/smoke.test.js`

**Interfaces:**
- Consumes: `readConfig`, `createApi`, the three `register*Tools`.
- Produces: an executable entrypoint. Also exports `buildServer(ctx)` so a smoke test can assert all 13 tools register without opening stdio.

- [ ] **Step 1: Write the failing test** — `test/smoke.test.js`

```js
import { describe, it, expect } from 'vitest';
import { registerWorkItemTools } from '../src/tools/workitems.tools.js';
import { registerPullRequestTools } from '../src/tools/pullrequests.tools.js';
import { registerRepoTools } from '../src/tools/repos.tools.js';

function fakeServer() {
  const names = [];
  return { names, registerTool: (name) => names.push(name) };
}

describe('tool surface', () => {
  it('registers exactly the expected 13 tools, none destructive', () => {
    const server = fakeServer();
    const ctx = { api: {}, config: { repoAllowlist: [], protectedBranches: [] } };
    registerWorkItemTools(server, ctx);
    registerPullRequestTools(server, ctx);
    registerRepoTools(server, ctx);
    expect(server.names.sort()).toEqual([
      'branch_list', 'commit_list', 'pr_add_reviewers', 'pr_comment', 'pr_create',
      'pr_get', 'pr_list', 'repo_list', 'wit_comment', 'wit_create', 'wit_get', 'wit_query', 'wit_update',
    ]);
    for (const forbidden of ['delete', 'abandon', 'complete', 'merge', 'remove']) {
      expect(server.names.some((n) => n.includes(forbidden))).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/smoke.test.js`
Expected: FAIL — the tools modules exist, but run this to confirm the count/name expectations match; fix any name drift before implementing index.

- [ ] **Step 3: Implement `src/index.js`**

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConfig } from './config.js';
import { createApi } from './core/client.js';
import { registerWorkItemTools } from './tools/workitems.tools.js';
import { registerPullRequestTools } from './tools/pullrequests.tools.js';
import { registerRepoTools } from './tools/repos.tools.js';

function buildServer(ctx) {
  const server = new McpServer({ name: 'ado', version: '1.0.0' });
  registerWorkItemTools(server, ctx);
  registerPullRequestTools(server, ctx);
  registerRepoTools(server, ctx);
  return server;
}

async function main() {
  const config = readConfig();
  const ctx = { config, api: createApi(config) };
  const server = buildServer(ctx);
  await server.connect(new StdioServerTransport());
  console.error(`ado-mcp-server pronto — projeto '${config.project}', modo ${config.mode.toUpperCase()}`);
}

main().catch((err) => {
  console.error(`ado-mcp-server falhou: ${err.message}`);
  process.exit(1);
});

export { buildServer };
```

- [ ] **Step 4: Run the full suite + a real stdio boot smoke check**

Run: `npx vitest run`
Expected: PASS (all suites).

Run: `DEVOPS_URL=http://x DEVOPS_PROJECT=P DEVOPS_PAT=fake node src/index.js`
Expected: prints to stderr `ado-mcp-server pronto — projeto 'P', modo READ` and waits on stdin (Ctrl-C to exit). This proves the SDK wiring boots.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: bootstrap do MCP server (stdio) e superfície de 13 tools"
```

---

### Task 12: README (setup, PAT mínimo, registro no Claude)

**Files:**
- Create: `README.md`

**Interfaces:** none (docs).

- [ ] **Step 1: Write `README.md`**

````markdown
# ado-mcp-server

MCP server local que dá ao Claude Code acesso **controlado e seguro-por-padrão** ao Azure DevOps Server on-premise (work items, pull requests, repos). Ver `DESIGN.md` para o modelo de segurança.

## Instalação

```bash
cd ~/dev/ado-mcp-server
npm install
cp .env.example .env
# edite o .env (ver abaixo)
```

## PAT de privilégio mínimo (obrigatório)

No Azure DevOps: **User settings → Personal access tokens → New Token**. Escopos:

- **Work Items** — Read & Write
- **Code** — Read & Write
- **Pull Request Threads** — Read & Write

**Nunca** marque *Full access* nem escopos *Manage*. Use **expiração curta**. Cole em `DEVOPS_PAT` no `.env`.

## `.env`

| Var | Papel |
|---|---|
| `DEVOPS_URL` | base da coleção, ex. `http://servidor/colecao` |
| `DEVOPS_PROJECT` | projeto único |
| `DEVOPS_PAT` | o PAT mínimo acima |
| `ADO_MODE` | `read` (default, só lê) \| `write` (habilita mutações) |
| `ADO_REPO_ALLOWLIST` | repos permitidos, separados por vírgula (vazio = todos) |

## Registrar no Claude Code (user scope)

```bash
claude mcp add --scope user ado -- node ~/dev/ado-mcp-server/src/index.js
```

Verifique: `claude mcp list` deve mostrar `ado`.

## Segurança — como não destruir o DevOps

- **Read-only por padrão.** Mutações só com `ADO_MODE=write` no `.env` (fora do alcance do Claude).
- **Preview → confirm.** Toda escrita retorna um preview e só executa com `confirm: true`.
- **Nada destrutivo existe.** Sem delete/abandon/**merge**. O merge de PR é sempre manual no web UI.
- **Blast radius.** Projeto único; allowlist opcional de repos.
- **Auditoria.** Toda escrita executada vai para `ado-mcp-audit.log`.

## Uso pelo Claude

Leitura (sempre): `wit_query`, `wit_get`, `pr_list`, `pr_get`, `repo_list`, `branch_list`, `commit_list`.
Escrita (write + confirm): `wit_create`, `wit_update`, `wit_comment`, `pr_create`, `pr_add_reviewers`, `pr_comment`.

Fluxo típico de escrita: o Claude chama a tool sem `confirm` → você lê o preview → ele repete com `confirm: true`.

> Reviewers em `pr_create`/`pr_add_reviewers` usam **ids (GUID)** de identidade, não nomes.
````

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "docs: README com setup, PAT mínimo e registro no Claude"
```

---

## Self-Review

**Spec coverage (DESIGN.md → task):**
- §4 estrutura core/tools → Tasks 2,5,6,7 (core) + 4,8,9,10 (tools) + 11 (index). ✔
- §5.1 PAT mínimo → README (Task 12). ✔
- §5.2 nada destrutivo → enforced by omission; asserted in Task 11 smoke test. ✔
- §5.3 read-only default → Task 1 (`mode` default) + Task 4 (`runWrite` block) + tests. ✔
- §5.4 preview→confirm → Task 4 `runWrite` + Tasks 8/9 previews. ✔
- §5.5 blast radius (projeto único, allowlist, sem bulk) → Task 5 `getOne` project assert, Task 4 `assertRepoAllowed`, single-entity tools. ✔
- §5.6 pr_create sem opções destrutivas → Task 6 core + test asserting no completion fields. ✔
- §5.7 audit log → Task 3 + Task 4 wiring. ✔
- §6 catálogo (13 tools) → Tasks 8,9,10; count asserted Task 11. ✔
- §7 config env → Task 1. ✔
- §8 registro user scope → README. ✔
- §11 testes de guardas → Tasks 4,8,9,10. ✔

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `ctx = { config, api }` uniform across cores/tools; `runWrite` signature identical in Task 4 def and Tasks 8/9 calls; tool names in Tasks 8/9/10 match the Task 11 assertion list (13 total).
