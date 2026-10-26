import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createInvitationDatabase, InvitationApiError, type InvitationLinkRecord, type InvitationProcedure, type InvitationWorkerEnv } from './linkDatabase.ts';
import { decryptInvitationToken, encryptInvitationToken, generateInvitationToken, invitationTokenHash, InvitationCryptoError } from './linkCrypto.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type InvitationContext = { Bindings: InvitationWorkerEnv; Variables: { invitationSession: string } };
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new InvitationApiError(400, 'invalid_request', 'El identificador del intento no es válido.');
  return value.toLowerCase();
}
function configuration(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvitationApiError(400, 'invalid_request', 'Revisa los datos del enlace.');
  const input = value as Record<string, unknown>;
  const id = identifier(input.requestId);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(input.name)) {
    throw new InvitationApiError(400, 'invalid_request', 'Usa un nombre de enlace de hasta 120 caracteres.');
  }
  const expiresAt = input.expiresAt;
  if (expiresAt !== undefined && expiresAt !== null && (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= 0)) {
    throw new InvitationApiError(400, 'invalid_request', 'El vencimiento del enlace no es válido.');
  }
  const maxUses = input.maxUses;
  if (maxUses !== undefined && maxUses !== null && (typeof maxUses !== 'number' || !Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 1_000_000)) {
    throw new InvitationApiError(400, 'invalid_request', 'El cupo debe ser un número entero entre 1 y 1 000 000.');
  }
  return { id, name: input.name.trim(), ...(expiresAt === undefined ? {} : { expiresAt }), ...(maxUses === undefined ? {} : { maxUses }) };
}
function appAddress(env: InvitationWorkerEnv): URL {
  try {
    const url = new URL(env.APP_URL);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error();
    return url;
  } catch { throw new InvitationApiError(503, 'configuration', 'La dirección de la aplicación todavía no está configurada.'); }
}
async function publicResult(env: InvitationWorkerEnv, expectedId: string, saved: InvitationLinkRecord) {
  if (saved.id !== expectedId) throw new InvitationApiError(503, 'protocol', 'No pudimos confirmar el enlace de este intento.');
  if (saved.active === false || (saved.status !== undefined && saved.status !== 'active')
    || (saved.expiresAt != null && saved.expiresAt <= Date.now())
    || (saved.maxUses != null && saved.usedCount != null && saved.usedCount >= saved.maxUses)) {
    throw new InvitationApiError(409, 'inactive', 'Este enlace ya no está activo.');
  }
  const token = await decryptInvitationToken(env, { module: env.SPACETIMEDB_MODULE, id: saved.id }, saved);
  const url = appAddress(env);
  url.hash = `/invitacion?token=${token}`;
  // Keep the persisted envelope and its fingerprint out of browser responses.
  return { id: saved.id, name: saved.name, status: saved.status, createdAt: saved.createdAt,
    expiresAt: saved.expiresAt, maxUses: saved.maxUses, usedCount: saved.usedCount, version: saved.version, url: url.href };
}
export function invitationLinkRoutes(options: { fetchFn?: typeof fetch } = {}) {
  const app = new Hono<InvitationContext>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('Referrer-Policy', 'no-referrer');
    const session = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '')?.[1];
    if (!session || session.length > 16_384) return c.json({ error: 'Inicia sesión para gestionar enlaces.', code: 'unauthenticated' }, 401);
    c.set('invitationSession', session);
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 8192, onError: (c) => c.json({ error: 'La solicitud es demasiado grande.', code: 'request_too_large' }, 413) }));
  async function save(c: Context<InvitationContext>, procedure: InvitationProcedure, previousId?: string) {
    let input: unknown;
    try { input = await c.req.json(); } catch { throw new InvitationApiError(400, 'invalid_request', 'Envía los datos del enlace en formato JSON.'); }
    const config = configuration(input);
    appAddress(c.env);
    if (config.id === previousId) throw new InvitationApiError(400, 'invalid_request', 'El enlace nuevo necesita un identificador de intento distinto.');
    const token = generateInvitationToken();
    const envelope = await encryptInvitationToken(c.env, { module: c.env.SPACETIMEDB_MODULE, id: config.id }, token);
    const tokenHash = await invitationTokenHash(token);
    const saved = await createInvitationDatabase(c.env, options.fetchFn).call(c.get('invitationSession'), procedure,
      { ...config, ...envelope, tokenHash, ...(previousId ? { previousId } : {}) });
    // The returned persisted envelope may be from an earlier successful request whose
    // response was lost. Always open that envelope, never return the newly generated token.
    return c.json(await publicResult(c.env, config.id, saved));
  }
  app.post('/', (c) => save(c, 'invitation_link_create'));
  app.post('/:id/copy', async (c) => {
    const id = identifier(c.req.param('id'));
    appAddress(c.env);
    const saved = await createInvitationDatabase(c.env, options.fetchFn).call(c.get('invitationSession'), 'invitation_link_copy', { id });
    return c.json(await publicResult(c.env, id, saved));
  });
  app.post('/:id/replace', (c) => save(c, 'invitation_link_replace', identifier(c.req.param('id'))));
  app.onError((error, c) => {
    if (error instanceof InvitationApiError) return c.json({ error: error.message, code: error.code }, error.status);
    if (error instanceof InvitationCryptoError) return c.json({ error: error.message, code: 'encryption_unavailable' }, 503);
    // No request body, URL fragment, token, encrypted envelope or backend error is logged.
    console.error(JSON.stringify({ event: 'invitation_link_error', error: error.name }));
    return c.json({ error: 'No pudimos confirmar el enlace. Reintenta sin cambiar el intento.', code: 'unavailable' }, 503);
  });
  return app;
}
