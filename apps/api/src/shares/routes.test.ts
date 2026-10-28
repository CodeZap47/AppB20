import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Response as MiniflareResponse } from 'miniflare';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { FEED_RESOURCE_KINDS, type FeedSharePreview } from '@b20/core';
import { generateShareToken, safeSharePath, shareTokenHash } from './protocol.ts';

const environment = {
  CORS_ORIGINS: 'https://b20.mx',
  SPACETIMEDB_URI: 'https://db.example.test',
  SPACETIMEDB_MODULE: 'test-b20',
  APP_URL: 'https://b20.mx',
  SHARE_SERVICE_TOKEN: 'share-preview-service-test',
};
const preview: FeedSharePreview = {
  title: 'Tabla de verdad',
  description: 'Una explicación breve para el parcial.',
  subject: 'Lógica',
  kindLabel: 'Nota de clase',
  path: '/m/notas/34',
};
const token = 'A'.repeat(43);
const rankingId = `parcial:1:1:2026-10-01|${'a'.repeat(64)}|1793016000000`;
let mf: Miniflare;
let withoutService: Miniflare;
let withoutServiceCalls: string[] = [];
let calls: {
  procedure: string;
  authorization: string | null;
  argument: string;
  redirect: string;
}[] = [];
let mode:
  | 'normal'
  | 'null'
  | 'forbidden'
  | 'unauthenticated'
  | 'not-found'
  | 'invalid'
  | 'outage'
  | 'redirect'
  | 'malformed'
  | 'huge'
  | 'huge-error' = 'normal';
let suppliedPreview: unknown = preview;
let suppliedRecord: unknown;
let createdHash = '';
beforeAll(async () => {
  // Build the entry actually deployed by wrangler.ai.jsonc, not only the legacy file Worker.
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../guideWorker.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0]!.text,
      compatibilityDate: '2026-10-21',
      compatibilityFlags: ['nodejs_compat'],
      bindings: environment,
      outboundService: async (request) => {
        const url = new URL(request.url);
        expect(url.origin).toBe('https://db.example.test');
        expect(url.search).toBe('');
        const procedure = url.pathname.split('/').at(-1)!;
        const args = JSON.parse(await request.text()) as string[];
        expect(args).toHaveLength(1);
        calls.push({
          procedure,
          authorization: request.headers.get('Authorization'),
          argument: args[0]!,
          redirect: request.redirect,
        });
        if (mode === 'outage')
          return new MiniflareResponse('private-backend-trace', { status: 503 });
        if (mode === 'redirect')
          return new MiniflareResponse(null, {
            status: 302,
            headers: { Location: 'https://evil.example/steal' },
          });
        if (mode === 'huge-error') return new MiniflareResponse('x'.repeat(5000), { status: 530 });
        if (mode === 'huge') return new MiniflareResponse('x'.repeat(300_000));
        if (mode === 'malformed') return new MiniflareResponse('invalid-json');
        if (mode === 'forbidden')
          return new MiniflareResponse('forbidden: private-backend-trace', { status: 530 });
        if (mode === 'unauthenticated')
          return new MiniflareResponse('private-backend-trace', { status: 401 });
        if (mode === 'not-found')
          return new MiniflareResponse('not_found: private-backend-trace', { status: 530 });
        if (mode === 'invalid')
          return new MiniflareResponse('invalid_request: private-backend-trace', { status: 530 });
        if (procedure === 'feed_share_preview')
          return MiniflareResponse.json(JSON.stringify(mode === 'null' ? null : suppliedPreview));
        expect(procedure).toBe('feed_share_action');
        const command = JSON.parse(args[0]!) as {
          action: string;
          target?: { kind: string; id: string };
          tokenHash?: string;
        };
        if (command.action === 'list')
          return MiniflareResponse.json(
            JSON.stringify(
              suppliedRecord ?? [
                {
                  id: 'share-1',
                  target: command.target,
                  createdBy: 'author',
                  createdAt: '2026-10-26T12:00:00.000Z',
                  active: true,
                  canRevoke: true,
                  tokenHash: 'private-hash',
                },
              ],
            ),
          );
        if (command.action === 'revoke')
          return MiniflareResponse.json(JSON.stringify({ ok: true, private: 'hidden' }));
        expect(command.action).toBe('create');
        expect(command.tokenHash).toMatch(/^[0-9a-f]{64}$/);
        createdHash = command.tokenHash!;
        return MiniflareResponse.json(
          JSON.stringify({
            id: 'share-1',
            preview: suppliedPreview,
            tokenHash: 'private-hash',
            fullContent: 'private-body',
          }),
        );
      },
    }),
  );
  await mf.ready;
  const { SHARE_SERVICE_TOKEN: _omitted, ...unconfigured } = environment;
  withoutService = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0]!.text,
      compatibilityDate: '2026-10-21',
      compatibilityFlags: ['nodejs_compat'],
      bindings: {
        ...unconfigured,
        AI_SERVICE_TOKEN: 'ai-never-fallback',
        FILE_SERVICE_TOKEN: 'files-never-fallback',
        NOTIFICATION_SERVICE_TOKEN: 'notifications-never-fallback',
      },
      outboundService: async (request) => {
        expect(request.headers.get('Authorization')).toBe('Bearer ordinary-member');
        const [raw] = JSON.parse(await request.text()) as string[];
        const command = JSON.parse(raw!) as { action: string };
        withoutServiceCalls.push(command.action);
        expect(new URL(request.url).pathname).toMatch(/\/feed_share_action$/);
        return MiniflareResponse.json(
          JSON.stringify(command.action === 'list' ? [] : { ok: true }),
        );
      },
    }),
  );
  await withoutService.ready;
}, 30_000);
afterAll(async () => {
  await mf?.dispose();
  await withoutService?.dispose();
});
beforeEach(() => {
  calls = [];
  mode = 'normal';
  suppliedPreview = preview;
  suppliedRecord = undefined;
  createdHash = '';
  withoutServiceCalls = [];
});
function request(
  path: string,
  method = 'GET',
  body?: unknown,
  authorization: string | null = 'Bearer spacetime-member',
) {
  return mf.dispatchFetch(`https://untrusted-host.example${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://b20.mx',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const create = () => request('/shares', 'POST', { target: { kind: 'note', id: '34' } });
const assertHeaders = (response: { headers: { get(name: string): string | null } }) => {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('x-robots-tag')).toContain('noindex');
};
describe('Enlaces públicos del feed en el Worker de producción', () => {
  it('sin credencial exclusiva bloquea crear/vista pública, conserva listar/revocar y nunca reutiliza otro token', async () => {
    const send = (path: string, method = 'GET', body?: unknown) =>
      withoutService.dispatchFetch(`https://api.example${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ordinary-member' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    for (const response of [
      await send(`/s/${token}`),
      await send('/shares', 'POST', { target: { kind: 'note', id: '34' } }),
    ]) {
      expect(response.status).toBe(503);
      assertHeaders(response);
      expect(await response.text()).not.toMatch(
        /ai-never|files-never|notifications-never|ordinary-member|SHARE_SERVICE_TOKEN/,
      );
    }
    expect(withoutServiceCalls).toEqual([]);
    expect((await send('/shares?kind=note&id=34')).status).toBe(200);
    expect((await send('/shares/1', 'DELETE')).status).toBe(200);
    expect(withoutServiceCalls).toEqual(['list', 'revoke']);
  });
  it('genera 32 bytes nuevos, persiste únicamente su hash y devuelve URL canónica sin confiar en Host', async () => {
    const response = await create();
    expect(response.status).toBe(201);
    assertHeaders(response);
    const body = (await response.json()) as { id: string; preview: FeedSharePreview; url: string };
    expect(body).toEqual({
      id: 'share-1',
      preview,
      url: expect.stringMatching(/^https:\/\/api\.b20\.mx\/s\/[a-zA-Z0-9_-]{43}$/),
    });
    const generated = new URL(body.url).pathname.slice(3);
    expect(atob(generated.replace(/-/g, '+').replace(/_/g, '/') + '=')).toHaveLength(32);
    expect(createdHash).toBe(await shareTokenHash(generated));
    expect(calls[0]!.authorization).toBe('Bearer spacetime-member');
    expect(calls[0]!.argument).not.toContain(generated);
    expect(JSON.parse(calls[0]!.argument)).toEqual({
      action: 'create',
      target: { kind: 'note', id: '34' },
      tokenHash: createdHash,
    });
    const another = (await (await create()).json()) as { url: string };
    expect(another.url).not.toBe(body.url);
  });
  it('preserva los dos proveedores de sesión y deja permisos al módulo', async () => {
    expect(
      (await request('/shares?kind=note&id=34', 'GET', undefined, 'Bearer supabase-member')).status,
    ).toBe(200);
    expect(calls[0]!.authorization).toBe('Bearer supabase-member');
    mode = 'forbidden';
    const denied = await create();
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain('private-backend');
  });
  it('acepta los 20 tipos de publicación y limita la salida de listado a campos permitidos', async () => {
    for (const kind of FEED_RESOURCE_KINDS) {
      const id = kind === 'ranking' ? rankingId : '34';
      const response = await request(`/shares?kind=${kind}&id=${encodeURIComponent(id)}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([
        {
          id: 'share-1',
          target: { kind, id },
          createdBy: 'author',
          createdAt: '2026-10-26T12:00:00.000Z',
          active: true,
          canRevoke: true,
        },
      ]);
    }
    const response = await request('/shares/share-1', 'DELETE');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(JSON.parse(calls.at(-1)!.argument)).toEqual({ action: 'revoke', id: 'share-1' });
  });
  it('comparte un aviso de ranking concreto y conserva su destino al hilo', async () => {
    const path = `/m/leaderboard?aviso=${encodeURIComponent(rankingId)}`;
    suppliedPreview = { ...preview, kindLabel: 'Ranking', path };
    const created = await request('/shares', 'POST', {
      target: { kind: 'ranking', id: rankingId },
    });
    expect(created.status).toBe(201);
    expect(JSON.parse(calls[0]!.argument).target).toEqual({ kind: 'ranking', id: rankingId });
    const response = await request(`/s/${token}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`href="https://b20.mx/#${path}"`);
    expect((await request('/shares?kind=ranking&id=invalid')).status).toBe(400);
  });
  it('no llama al backend sin sesión, con bearer incorrecto o con targets no válidos', async () => {
    for (const bearer of [
      null,
      'Basic member',
      'Bearer two tokens',
      `Bearer ${'a'.repeat(16_385)}`,
    ])
      expect(
        (await request('/shares', 'POST', { target: { kind: 'note', id: '34' } }, bearer)).status,
      ).toBe(401);
    for (const body of [
      null,
      [],
      {},
      { target: { kind: 'message', id: '1' } },
      { target: { kind: 'note', id: '../1' } },
      { target: { kind: 'note', id: 'a'.repeat(201) } },
      { target: { kind: 'note', id: '34' }, tokenHash: 'caller-controlled' },
    ])
      expect((await request('/shares', 'POST', body)).status).toBe(400);
    expect((await request('/shares?kind=message&id=1')).status).toBe(400);
    expect((await request('/shares/bad%3Fid', 'DELETE')).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('limita bytes reales de la solicitud y exige JSON válido incluso sin Content-Length', async () => {
    const large = await request('/shares', 'POST', {
      target: { kind: 'note', id: '1' },
      extra: 'á'.repeat(3000),
    });
    expect(large.status).toBe(413);
    const malformed = await mf.dispatchFetch('https://api.example/shares', {
      method: 'POST',
      headers: { Authorization: 'Bearer member', 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    const wrongType = await mf.dispatchFetch('https://api.example/shares', {
      method: 'POST',
      headers: { Authorization: 'Bearer member', 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect(wrongType.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('responde metadatos OG en el HTML inicial, con imagen estática y CTA segura sin JavaScript', async () => {
    const response = await request(`/s/${token}`, 'GET', undefined, 'Bearer must-not-be-forwarded');
    expect(response.status).toBe(200);
    assertHeaders(response);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain('<meta property="og:title" content="Tabla de verdad">');
    expect(html).toContain(
      '<meta property="og:description" content="Lógica · Una explicación breve para el parcial.">',
    );
    expect(html).toContain('<meta property="og:image" content="https://b20.mx/og/compartir.png">');
    expect(html).toContain(`content="https://api.b20.mx/s/${token}"`);
    expect(html).toContain('href="https://b20.mx/#/m/notas/34"');
    expect(html).toContain('acceso vigente al grupo');
    expect(html).not.toMatch(/<script|http-equiv="refresh"/i);
    expect(calls[0]!.procedure).toBe('feed_share_preview');
    expect(calls[0]!.authorization).toBe('Bearer share-preview-service-test');
    expect(html).not.toContain(environment.SHARE_SERVICE_TOKEN);
    expect(calls[0]!.argument).toBe(await shareTokenHash(token));
  });
  it('escapa caracteres peligrosos de texto y atributos sin filtrarlos como HTML', async () => {
    suppliedPreview = {
      ...preview,
      title: `Título "<img src=x onerror=alert(1)>" & 'fin'`,
      description: '</p><script>alert(1)</script> & "texto"',
      subject: '<Lógica>',
      kindLabel: 'Nota & clase',
      fullContent: 'private-body',
    };
    const response = await request(`/s/${token}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;fin&#39;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('private-body');
  });
  it('rechaza rutas suministradas por backend que puedan navegar fuera o abrir pantallas arbitrarias', async () => {
    for (const path of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/m/notas/../34',
      '/m/notas/34#https://evil.example',
      '/m/notas/34?redirect=https://evil.example',
      '/ajustes',
      '/m/notas/nueva',
      '/m/notas/%2f%2fevil.example',
    ]) {
      suppliedPreview = { ...preview, path };
      const response = await request(`/s/${token}`);
      expect(response.status, path).toBe(503);
      expect(await response.text()).not.toContain('Tabla de verdad');
    }
  });
  it('consulta revocación y disponibilidad cada vez sin devolver metadatos anteriores', async () => {
    expect((await request(`/s/${token}`)).status).toBe(200);
    mode = 'null';
    const revoked = await request(`/s/${token}`);
    expect(revoked.status).toBe(404);
    assertHeaders(revoked);
    const html = await revoked.text();
    expect(html).not.toContain('Tabla de verdad');
    expect(html).not.toContain('og:title');
    expect(calls).toHaveLength(2);
    for (const path of [
      '/s',
      '/s/short',
      `/s/${'A'.repeat(44)}`,
      `/s/${'A'.repeat(42)}!`,
      `/s/${token}/extra`,
    ]) {
      const response = await request(path);
      expect(response.status, path).toBe(404);
      assertHeaders(response);
    }
    expect(calls).toHaveLength(2);
  });
  it('no expone fallos de autorización; distingue servicio mal configurado de enlace no disponible', async () => {
    for (const [failure, status] of [
      ['unauthenticated', 401],
      ['forbidden', 403],
      ['not-found', 404],
      ['invalid', 400],
    ] as const) {
      mode = failure;
      const response = await create();
      expect(response.status).toBe(status);
      assertHeaders(response);
      expect(await response.text()).not.toContain('private-backend-trace');
      const publicResponse = await request(`/s/${token}`);
      expect(publicResponse.status).toBe(status === 401 || status === 403 ? 503 : 404);
      expect(await publicResponse.text()).not.toContain('Tabla de verdad');
    }
  });
  it('rechaza redirects, caídas, respuestas malformadas o demasiado grandes sin exponer detalles', async () => {
    for (const failure of ['outage', 'redirect', 'malformed', 'huge', 'huge-error'] as const) {
      mode = failure;
      const response = await create();
      expect(response.status, failure).toBe(503);
      expect(await response.text()).not.toContain('private-backend-trace');
      const publicResponse = await request(`/s/${token}`);
      expect(publicResponse.status).toBe(503);
      assertHeaders(publicResponse);
      expect(await publicResponse.text()).not.toContain('Tabla de verdad');
    }
  });
  it('valida las proyecciones del backend antes de responder al navegador', async () => {
    for (const invalid of [
      { ...preview, description: 'a'.repeat(801) },
      { ...preview, title: '' },
      { ...preview, subject: 42 },
      { ...preview, description: '\u0000' },
      { ...preview, kindLabel: null },
    ]) {
      suppliedPreview = invalid;
      expect((await create()).status).toBe(503);
    }
    suppliedRecord = [
      {
        id: 'share-1',
        target: { kind: 'note', id: 'other' },
        createdBy: 'author',
        createdAt: '2026-10-26T12:00:00.000Z',
        active: true,
        canRevoke: true,
      },
    ];
    expect((await request('/shares?kind=note&id=34')).status).toBe(503);
    suppliedRecord = [
      {
        id: 'share-1',
        target: { kind: 'note', id: '34' },
        createdBy: 'author',
        createdAt: 'not-a-date',
        active: 'yes',
        canRevoke: true,
      },
    ];
    expect((await request('/shares?kind=note&id=34')).status).toBe(503);
  });
});

describe('validación local del contrato', () => {
  it('permite destinos de los veinte recursos, con parámetros de foco acotados', () => {
    for (const path of [
      '/m/tareas/1',
      '/m/tareas/1?trabajo=2',
      '/m/actividades/1?evidencia=2',
      '/m/notas/1',
      '/m/preguntas/1?respuesta=2',
      '/m/guias/1',
      '/m/votaciones/1',
      '/m/ayuda/1',
      '/m/repaso/colecciones/1',
      '/m/inicio?vista=feed&publicacion=1',
      '/m/retos/1',
      '/m/retos/1?solucion=2',
      '/m/revision-codigo/1?observacion=2',
      '/m/oportunidades?oportunidad=1',
      '/m/salas/1',
      '/m/examenes/1',
      '/m/leaderboard',
      `/m/leaderboard?aviso=${encodeURIComponent(rankingId)}`,
    ])
      expect(safeSharePath(path), path).toBe(true);
    expect(safeSharePath('/m/retos/1?solucion=2&solucion=3')).toBe(false);
    expect(safeSharePath('/m/inicio?vista=feed&publicacion=1&redirect=1')).toBe(false);
    expect(safeSharePath('/m/leaderboard?aviso=invalid')).toBe(false);
    expect(safeSharePath(`/m/leaderboard?aviso=${encodeURIComponent(rankingId)}&redirect=1`)).toBe(
      false,
    );
  });
  it('usa tokens aleatorios con el formato estable esperado por el enlace público', () => {
    const values = new Set(Array.from({ length: 50 }, generateShareToken));
    expect(values.size).toBe(50);
    for (const value of values) expect(value).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  });
});
