import { Hono, type Context } from 'hono';
import { createShareDatabase } from './database.ts';
import { shareHtml } from './preview.ts';
import {
  appAddress,
  boundedText,
  createdShare,
  generateShareToken,
  identifier,
  object,
  protocolError,
  resourceRef,
  SHARE_PUBLIC_ORIGIN,
  SHARE_TOKEN,
  ShareApiError,
  sharePreview,
  shareRecords,
  shareTokenHash,
  shareServiceToken,
  type ShareWorkerEnv,
} from './protocol.ts';

type ShareContext = { Bindings: ShareWorkerEnv; Variables: { shareSession: string } };
type Options = { fetchFn?: typeof fetch };
function headers(c: Context<ShareContext>) {
  c.header('Cache-Control', 'private, no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
}
function errorResponse(error: Error, c: Context<ShareContext>) {
  if (error instanceof ShareApiError)
    return c.json({ error: error.message, code: error.code }, error.status);
  // Tokens, request URLs/bodies and backend detail are deliberately excluded from logs.
  console.error(JSON.stringify({ event: 'feed_share_error', error: error.name }));
  return c.json(
    {
      error: 'No pudimos confirmar la operación. Revisa tus enlaces antes de reintentar.',
      code: 'unavailable',
    },
    503,
  );
}
export function feedShareRoutes(options: Options = {}) {
  const app = new Hono<ShareContext>();
  app.use('*', async (c, next) => {
    headers(c);
    const session = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '')?.[1];
    if (!session || session.length > 16_384)
      return c.json(
        { error: 'Inicia sesión para gestionar enlaces.', code: 'unauthenticated' },
        401,
      );
    c.set('shareSession', session);
    await next();
  });
  app.post('/', async (c) => {
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? ''))
      throw new ShareApiError(400, 'invalid_request', 'Envía una solicitud JSON.');
    let body: unknown;
    try {
      body = JSON.parse(await boundedText(c.req.raw, 4096, true));
    } catch (error) {
      if (error instanceof ShareApiError) throw error;
      throw new ShareApiError(400, 'invalid_request', 'Los datos del enlace no son válidos.');
    }
    const row = object(body);
    const target = resourceRef(row?.target);
    if (!target || !row || Object.keys(row).length !== 1)
      throw new ShareApiError(
        400,
        'invalid_request',
        'Elige una publicación válida para compartir.',
      );
    appAddress(c.env);
    shareServiceToken(c.env);
    const token = generateShareToken();
    const saved = createdShare(
      await createShareDatabase(c.env, options.fetchFn).action(c.get('shareSession'), {
        action: 'create',
        target,
        tokenHash: await shareTokenHash(token),
      }),
    );
    return c.json({ ...saved, url: `${SHARE_PUBLIC_ORIGIN}/s/${token}` }, 201);
  });
  app.get('/', async (c) => {
    const target = resourceRef({ kind: c.req.query('kind'), id: c.req.query('id') });
    if (!target)
      throw new ShareApiError(
        400,
        'invalid_request',
        'Elige una publicación válida para consultar sus enlaces.',
      );
    return c.json(
      shareRecords(
        await createShareDatabase(c.env, options.fetchFn).action(c.get('shareSession'), {
          action: 'list',
          target,
        }),
        target,
      ),
    );
  });
  app.delete('/:id', async (c) => {
    const id = identifier(c.req.param('id'));
    if (!id) throw new ShareApiError(400, 'invalid_request', 'El enlace no es válido.');
    const result = await createShareDatabase(c.env, options.fetchFn).action(c.get('shareSession'), {
      action: 'revoke',
      id,
    });
    if (object(result)?.ok !== true) throw protocolError();
    return c.json({ ok: true });
  });
  app.onError(errorResponse);
  return app;
}
export function feedSharePreviewRoutes(options: Options = {}) {
  const app = new Hono<ShareContext>();
  app.use('*', async (c, next) => {
    headers(c);
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    await next();
  });
  app.get('/:token', async (c) => {
    const token = c.req.param('token');
    if (!SHARE_TOKEN.test(token)) return c.html(shareHtml({ unavailable: true }), 404);
    const address = appAddress(c.env);
    const raw = await createShareDatabase(c.env, options.fetchFn).preview(
      await shareTokenHash(token),
    );
    if (raw === null) return c.html(shareHtml({ unavailable: true, app: address }), 404);
    return c.html(
      shareHtml({
        preview: sharePreview(raw),
        app: address,
        canonical: `${SHARE_PUBLIC_ORIGIN}/s/${token}`,
      }),
    );
  });
  app.all('*', (c) => c.html(shareHtml({ unavailable: true }), 404));
  app.onError((error, c) => {
    const denied =
      error instanceof ShareApiError && [400, 401, 403, 404, 409].includes(error.status);
    return c.html(shareHtml({ unavailable: denied }), denied ? 404 : 503);
  });
  return app;
}
