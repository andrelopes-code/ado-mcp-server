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
