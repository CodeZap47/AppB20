import { describe, expect, it, vi } from 'vitest';
import { AiClient, AiClientError } from './aiClient';

describe('transporte privado de IA', () => {
  it('consulta el token vigente por petición y prohíbe cache, cookies y redirecciones', async () => {
    let token = 'first';
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ hasKey: false }));
    const client = new AiClient({ apiUrl: 'https://api.example/', getToken: () => token, fetch: fetcher });
    await client.request('/ai/key'); token = 'second'; await client.request('/ai/key');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer first' }, cache: 'no-store', credentials: 'omit', redirect: 'error' });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer second' } });
    client.dispose();
  });
  it('descarta respuestas que llegaron después de cambiar la sesión', async () => {
    let token = 'first'; let finish!: (response: Response) => void;
    const client = new AiClient({ apiUrl: 'https://api.example', getToken: () => token, fetch: vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })) });
    const request = client.request('/ai/key'); token = 'second'; finish(Response.json({ hasKey: true }));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('cancela peticiones al abandonar el panel y no expone el texto de un error remoto', async () => {
    let signal!: AbortSignal; let finish!: (response: Response) => void;
    const client = new AiClient({ apiUrl: 'https://api.example', getToken: () => 'current', fetch: vi.fn((_url, options) => { signal = options!.signal!; return new Promise<Response>((resolve) => { finish = resolve; }); }) });
    const request = client.request('/ai/key'); client.dispose(); expect(signal.aborted).toBe(true); finish(Response.json({ hasKey: true }));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    const failing = new AiClient({ apiUrl: 'https://api.example', getToken: () => 'current', fetch: vi.fn(async () => Response.json({ error: { code: 'unknown', message: 'AIza-secret-must-not-leak' } }, { status: 500 })) });
    await expect(failing.request('/ai/key')).rejects.toBeInstanceOf(AiClientError);
    await expect(failing.request('/ai/key')).rejects.not.toThrow('AIza-secret');
  });
});
