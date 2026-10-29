import { describe, expect, it, vi } from 'vitest';
import {
  appAddress,
  boundedText,
  ShareApiError,
  shareRecords,
  shareServiceToken,
} from './protocol.ts';
import { createShareDatabase } from './database.ts';
import { feedSharePreviewRoutes, feedShareRoutes } from './routes.ts';

const env = {
  APP_URL: 'https://b20.mx',
  SPACETIMEDB_URI: 'https://db.example.test',
  SPACETIMEDB_MODULE: 'test-b20',
};
describe('límites y configuración de enlaces compartidos', () => {
  it('rechaza credenciales técnicas ausentes o mal formadas sin llamar al backend ni registrar sus valores', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const SHARE_SERVICE_TOKEN of [
        undefined,
        '',
        'bad token',
        'bad\nheader',
        'bad\u0000header',
        'bad-token'.repeat(3000),
      ]) {
        const configuration = { ...env, SHARE_SERVICE_TOKEN };
        expect(() => shareServiceToken(configuration)).toThrow(ShareApiError);
        await expect(
          createShareDatabase(configuration, fetchFn).preview('a'.repeat(64)),
        ).rejects.toMatchObject({ status: 503, code: 'configuration' });
        const publicResponse = await feedSharePreviewRoutes({ fetchFn }).request(
          `/${'A'.repeat(43)}`,
          { headers: { Authorization: 'Bearer visitor-must-not-be-used' } },
          configuration,
        );
        expect(publicResponse.status).toBe(503);
        expect(await publicResponse.text()).not.toContain('bad-token');
        const createResponse = await feedShareRoutes({ fetchFn }).request(
          '/',
          {
            method: 'POST',
            headers: { Authorization: 'Bearer actor', 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: { kind: 'note', id: '34' } }),
          },
          configuration,
        );
        expect(createResponse.status).toBe(503);
      }
      expect(fetchFn).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
  it('usa exclusivamente la identidad de proyección en previews y mantiene la identidad del actor en acciones', async () => {
    const serviceToken = 'share-projection-only';
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => Response.json('null'));
    const database = createShareDatabase({ ...env, SHARE_SERVICE_TOKEN: serviceToken }, fetchFn);
    expect(await database.preview('a'.repeat(64))).toBeNull();
    expect(new Headers(fetchFn.mock.calls[0]![1]?.headers).get('Authorization')).toBe(
      `Bearer ${serviceToken}`,
    );
    await database.action('actor-only', { action: 'list', target: { kind: 'note', id: '34' } });
    expect(new Headers(fetchFn.mock.calls[1]![1]?.headers).get('Authorization')).toBe(
      'Bearer actor-only',
    );
  });
  it('una identidad de proyección rechazada es indisponibilidad de servicio y no expone su token', async () => {
    const secret = 'share-projection-private-token';
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(`forbidden: ${secret}`, { status: 403 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await feedSharePreviewRoutes({ fetchFn }).request(
        `/${'A'.repeat(43)}`,
        undefined,
        { ...env, SHARE_SERVICE_TOKEN: secret },
      );
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(secret);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
  it('admite orígenes HTTPS y localhost sin aceptar protocolos, credenciales o componentes inseguros', () => {
    expect(appAddress(env).href).toBe('https://b20.mx/');
    expect(appAddress({ ...env, APP_URL: 'http://localhost:5173' }).href).toBe(
      'http://localhost:5173/',
    );
    for (const APP_URL of [
      'javascript:alert(1)',
      'http://evil.example',
      'https://user:password@b20.mx',
      'https://b20.mx?next=evil',
      'https://b20.mx/#/notas',
      'https://b20.mx/redirect',
      '//evil.example',
      'not-a-url',
    ]) {
      expect(() => appAddress({ ...env, APP_URL }), APP_URL).toThrow(ShareApiError);
    }
  });
  it('limita bytes reales aunque Content-Length declare un cuerpo menor', async () => {
    const request = new Request('https://api.example/shares', {
      method: 'POST',
      headers: { 'Content-Length': '1' },
      body: 'á'.repeat(3000),
    });
    await expect(boundedText(request, 4096, true)).rejects.toMatchObject({
      status: 413,
      code: 'request_too_large',
    });
    const invalidLength = new Request('https://api.example/shares', {
      method: 'POST',
      headers: { 'Content-Length': '-1' },
      body: '{}',
    });
    await expect(boundedText(invalidLength, 4096, true)).rejects.toMatchObject({ status: 413 });
  });
  it('cancela la lectura de una respuesta remota cuando supera el límite', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4097));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(boundedText(new Response(body), 4096)).rejects.toMatchObject({
      status: 503,
      code: 'protocol',
    });
    expect(cancelled).toBe(true);
  });
  it('convierte errores de red en un mensaje seguro y no reintenta una creación incierta', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('Bearer private-session backend-trace'));
    await expect(
      createShareDatabase(env, fetchFn).action('private-session', {
        action: 'create',
        target: { kind: 'note', id: '34' },
        tokenHash: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ status: 503, code: 'unavailable' });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn.mock.calls[0]![1]?.redirect).toBe('manual');
    expect(fetchFn.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it('no envía la sesión a un origen de base de datos mal configurado', () => {
    const fetchFn = vi.fn<typeof fetch>();
    for (const SPACETIMEDB_URI of [
      'file:///tmp/db',
      'https://user:password@evil.example',
      'bad://evil',
    ])
      expect(() => createShareDatabase({ ...env, SPACETIMEDB_URI }, fetchFn)).toThrow(
        ShareApiError,
      );
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('rechaza un listado remoto excesivo sin devolver campos privados', () => {
    expect(() => shareRecords(new Array(501).fill({}), { kind: 'note', id: '34' })).toThrow(
      ShareApiError,
    );
  });
});
