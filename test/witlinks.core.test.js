import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import * as links from '../src/core/witlinks.js';

const config = { project: 'Proj', url: 'http://srv/col', apiVersion: '6.0', attachMaxBytes: 1024 * 1024, attachExtAllowlist: [] };
const tmpDir = './test-tmp-attach';

function stubApi(routes = {}) {
  const calls = [];
  const pick = (path) => Object.entries(routes).find(([frag]) => path.includes(frag))?.[1];
  return {
    calls,
    get: async (path, opts) => { calls.push(['get', path, opts]); return pick(path)?.(path) ?? { value: [{ id: 1, fields: { 'System.TeamProject': 'Proj' } }] }; },
    post: async (path, body, opts) => { calls.push(['post', path, body, opts]); return pick(path)?.(path, body) ?? { id: 1 }; },
    patch: async (path, body, opts) => { calls.push(['patch', path, body, opts]); return pick(path)?.(path, body) ?? { id: 1 }; },
  };
}

const itemWithRelations = (relations) => ({ value: [{ id: 5, fields: { 'System.TeamProject': 'Proj' }, relations }] });

afterEach(() => rm(tmpDir, { recursive: true, force: true }));

describe('witlinks', () => {
  it('resolves the parent alias to the hierarchy-reverse refName', async () => {
    const api = stubApi({ '/wit/workitems': () => ({ value: [{ id: 9, fields: { 'System.TeamProject': 'Proj' } }] }) });
    const value = await links.buildRelation({ api, config }, { rel: 'parent', targetId: 9 });
    expect(value.rel).toBe('System.LinkTypes.Hierarchy-Reverse');
    expect(value.url).toContain('/wit/workItems/9');
  });

  it('refuses a link whose target lives in another project', async () => {
    const api = stubApi({ '/wit/workitems': () => ({ value: [{ id: 9, fields: { 'System.TeamProject': 'Outro' } }] }) });
    await expect(links.buildRelation({ api, config }, { rel: 'related', targetId: 9 }))
      .rejects.toThrow(/fora do projeto 'Proj'/);
  });

  it('builds a pull request artifact link from the repo and project GUIDs', async () => {
    const api = stubApi({ '/git/repositories': () => ({ id: 'repo-guid', project: { id: 'proj-guid' } }) });
    const value = await links.buildRelation({ api, config }, { rel: 'pull_request', repo: 'app', artifactValue: '42' });
    expect(value).toEqual({
      rel: 'ArtifactLink',
      url: 'vstfs:///Git/PullRequestId/proj-guid%2Frepo-guid%2F42',
      attributes: { name: 'Pull Request' },
    });
  });

  it('requires repo and value for artifact links', async () => {
    await expect(links.buildRelation({ api: stubApi(), config }, { rel: 'commit' }))
      .rejects.toThrow(/exige repo e artifactValue/);
  });

  it('unlink resolves the relation index at write time', async () => {
    const api = stubApi({
      '/wit/workitems': () => itemWithRelations([
        { rel: 'System.LinkTypes.Related', url: 'http://srv/col/Proj/_apis/wit/workItems/7' },
        { rel: 'System.LinkTypes.Related', url: 'http://srv/col/Proj/_apis/wit/workItems/8' },
      ]),
    });
    await links.unlink({ api, config }, { id: 5, rel: 'related', targetId: 8 });
    const ops = api.calls.find((c) => c[0] === 'patch')[2];
    expect(ops).toEqual([{ op: 'remove', path: '/relations/1' }]);
  });

  it('unlink refuses to guess when more than one relation matches', async () => {
    const api = stubApi({
      '/wit/workitems': () => itemWithRelations([
        { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/a%2Fb%2Fc' },
        { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/a%2Fb%2Fd' },
      ]),
    });
    await expect(links.unlink({ api, config }, { id: 5, rel: 'commit', targetId: null, url: undefined }))
      .rejects.toThrow(/Nenhum link/);
  });

  it('attach refuses a file above the configured limit before uploading', async () => {
    await mkdir(tmpDir, { recursive: true });
    const file = `${tmpDir}/big.bin`;
    await writeFile(file, Buffer.alloc(2048));
    await expect(links.inspectFile({ ...config, attachMaxBytes: 1024 }, file)).rejects.toThrow(/limite/);
  });

  it('attach refuses an extension outside the allowlist', async () => {
    await mkdir(tmpDir, { recursive: true });
    const file = `${tmpDir}/script.exe`;
    await writeFile(file, 'x');
    await expect(links.inspectFile({ ...config, attachExtAllowlist: ['png', 'pdf'] }, file))
      .rejects.toThrow(/Extensão 'exe' fora da allowlist/);
  });

  it('attach uploads then links the returned url as AttachedFile', async () => {
    await mkdir(tmpDir, { recursive: true });
    const file = `${tmpDir}/nota.txt`;
    await writeFile(file, 'conteudo');
    const api = stubApi({
      '/wit/attachments': () => ({ id: 'att-guid', url: 'http://srv/col/_apis/wit/attachments/att-guid' }),
      '/wit/workitems': () => ({ value: [{ id: 5, fields: { 'System.TeamProject': 'Proj' } }] }),
    });
    await links.attach({ api, config }, { id: 5, filePath: file, comment: 'anexo' });
    const upload = api.calls.find((c) => c[0] === 'post');
    expect(upload[3].params).toEqual({ fileName: 'nota.txt', uploadType: 'simple' });
    expect(upload[3].headers['Content-Type']).toBe('application/octet-stream');
    const patch = api.calls.find((c) => c[0] === 'patch')[2];
    expect(patch[0].value).toEqual({
      rel: 'AttachedFile',
      url: 'http://srv/col/_apis/wit/attachments/att-guid',
      attributes: { name: 'nota.txt', comment: 'anexo' },
    });
  });
});
