import { describe, expect, it } from 'vitest';
import { readAiBody } from './body.ts';

describe('Límites de entradas IA', () => {
  it('cancela streaming sin Content-Length al superar bytes permitidos', async () => {
    let cancelled = false;
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(100)); }, cancel() { cancelled = true; } });
    const request = new Request('https://local.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as unknown as RequestInit);
    await expect(readAiBody(request, 99)).rejects.toMatchObject({ status: 413, code: 'body_too_large' });
    expect(cancelled).toBe(true);
  });
  it('rechaza JSON malformado y texto ajeno sin reflejar su contenido', async () => {
    const request = new Request('https://local.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{private-secret' });
    await expect(readAiBody(request)).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
    const wrongType = new Request('https://local.test', { method: 'POST', body: '{}' });
    await expect(readAiBody(wrongType)).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });
});
