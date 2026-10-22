import { describe, expect, it, vi } from 'vitest';
import { createNotificationCall } from './database';
const config = { uri: 'wss://example.spacetimedb.com', module: 'b20', serviceToken: 'private-token' };
describe('bridge privado de notificaciones', () => {
  it('envía un único payload string y admite DTO JSON y bool nativo', async () => {
    const fetchFn = vi.fn(async (url, init) => { expect(String(url)).toBe('https://example.spacetimedb.com/v1/database/b20/call/notifications_claim'); expect(init?.redirect).toBe('manual'); expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-token'); expect(JSON.parse(init!.body as string)).toEqual(['{"limit":8}']); return new Response(JSON.stringify(JSON.stringify({ jobs: [] }))); }) as unknown as typeof fetch;
    expect(await createNotificationCall(config, fetchFn)('notifications_claim', { limit: 8 })).toEqual({ jobs: [] });
    expect(await createNotificationCall(config, async () => new Response('true'))('notifications_authorize', {})).toBe(true);
  });
  it('limita respuestas y no revela el cuerpo de errores del servicio', async () => {
    await expect(createNotificationCall(config, async () => new Response('a'.repeat(128 * 1024 + 1)))('notifications_claim', {})).rejects.toThrow('large');
    await expect(createNotificationCall(config, async () => new Response('private-token endpoint secret', { status: 500 }))('notifications_claim', {})).rejects.toThrow('could not be confirmed');
  });
});
