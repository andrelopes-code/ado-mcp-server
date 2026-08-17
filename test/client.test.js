import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import { toCleanError, createApi } from '../src/core/client.js';

describe('createApi', () => {
  afterEach(() => vi.restoreAllMocks());

  const cfg = (over = {}) => ({ url: 'https://srv/col', project: 'Proj', pat: 'secret', apiVersion: '6.0', ...over });

  it('honours the configured timeout and falls back when it is absent', () => {
    const spy = vi.spyOn(axios, 'create').mockReturnValue({ get: vi.fn(), post: vi.fn(), patch: vi.fn() });
    createApi(cfg({ timeoutMs: 5000 }));
    expect(spy.mock.calls[0][0].timeout).toBe(5000);
    createApi(cfg());
    expect(spy.mock.calls[1][0].timeout).toBe(30000);
  });

  it('encodes the project into the base url and sends the PAT as basic auth', () => {
    const spy = vi.spyOn(axios, 'create').mockReturnValue({ get: vi.fn(), post: vi.fn(), patch: vi.fn() });
    createApi(cfg({ project: 'My Proj' }));
    const opts = spy.mock.calls[0][0];
    expect(opts.baseURL).toBe('https://srv/col/My%20Proj/_apis');
    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from(':secret').toString('base64')}`);
  });
});

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
