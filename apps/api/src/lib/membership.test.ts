import { describe, expect, it, vi } from 'vitest';
import { checkActiveMembership } from './membership.ts';

describe('checkActiveMembership', () => {
  it('consulta solo el reducer de permisos con el token del usuario, sin leer tablas', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('', { status: 200 }));
    expect(await checkActiveMembership('id-token', { uri: 'wss://maincloud.spacetimedb.com', module: 'app-b20', fetchFn })).toBe(true);
    const [url, request] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe('https://maincloud.spacetimedb.com/v1/database/app-b20/call/assert_active_member');
    expect(request?.method).toBe('POST');
    expect(request?.body).toBe('[]');
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer id-token');
    expect(request?.redirect).toBe('error');
  });

  it.each([400, 401, 403, 530])('deniega cuando el módulo rechaza el acceso (%s)', async (status) => {
    expect(await checkActiveMembership('token', {
      uri: 'http://localhost:3000', module: 'b20', fetchFn: async () => new Response('', { status }),
    })).toBe(false);
  });

  it.each([404, 500, 503])('no concede permisos si hay error de despliegue o servicio (%s)', async (status) => {
    await expect(checkActiveMembership('token', {
      uri: 'https://maincloud.spacetimedb.com', module: 'b20', fetchFn: async () => new Response('', { status }),
    })).rejects.toThrow();
  });

  it('propaga errores de red para que middleware responda 503', async () => {
    await expect(checkActiveMembership('token', {
      uri: 'https://maincloud.spacetimedb.com', module: 'b20', fetchFn: async () => { throw new TypeError('offline'); },
    })).rejects.toThrow('offline');
  });
});
