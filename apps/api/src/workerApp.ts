import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { createRemoteJWKSet } from 'jose';
import { createRequireAuth, type AuthOptions, type AuthVariables } from './lib/auth.ts';
import { checkActiveMembership } from './lib/membership.ts';
import { createFileDatabase, FileApiError, type FileDatabase, type TargetKind } from './files/database.ts';
import { matchesMetadata, MAX_FILE_BYTES, metadata, objectKey, storeFile } from './files/storage.ts';
import { createAiDatabase, type AiDatabase, type AiWorkerEnv } from './ai/database.ts';
import { aiWorkerRoutes, aiPublicError } from './ai/routes.ts';
import { guideAiRoutes } from './ai/guideRoutes.ts';
import type { GuideProvider } from './ai/guideProvider.ts';
import type { AiProvider } from './ai/provider.ts';

type WorkerContext = { Bindings: AiWorkerEnv; Variables: AuthVariables & { sessionToken: string; files: FileDatabase; ai: AiDatabase } };
interface WorkerOptions {
  auth?: AuthOptions;
  database?: (env: FileWorkerEnv) => FileDatabase;
  aiDatabase?: (env: AiWorkerEnv) => AiDatabase;
  aiProvider?: AiProvider;
  guideProvider?: GuideProvider;
}
const kinds = new Set(['assignment', 'activity', 'work', 'evidence']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const U64 = /^(?:0|[1-9]\d{0,19})$/;
function decimalId(value: string | undefined): string {
  if (!value || !U64.test(value) || BigInt(value) > 0xffffffffffffffffn) {
    throw new FileApiError(400, 'La página del archivo no es válida.');
  }
  return value;
}
function targetKind(value: string | undefined): TargetKind {
  if (!value || !kinds.has(value)) throw new FileApiError(400, 'El tipo de página no es válido.');
  return value as TargetKind;
}
function fileName(value: string | undefined): string {
  let name: string;
  try { name = decodeURIComponent(value ?? ''); } catch { throw new FileApiError(400, 'El nombre del archivo no es válido.'); }
  name = name.trim();
  if (!name || name.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(name)) {
    throw new FileApiError(400, 'Usa un nombre de archivo de hasta 200 caracteres.');
  }
  return name;
}
function fileType(value: string | undefined): string {
  const type = (value ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) || type.length > 150) {
    throw new FileApiError(400, 'El tipo de archivo no es válido.');
  }
  return type;
}
function configAuth(env: FileWorkerEnv): AuthOptions {
  return { issuer: env.OIDC_ISSUER, audiences: env.OIDC_AUDIENCE.split(',').map((v) => v.trim()).filter(Boolean),
    jwks: createRemoteJWKSet(new URL(env.OIDC_JWKS_URI)),
    isActiveMember: (token) => checkActiveMembership(token, { uri: env.SPACETIMEDB_URI, module: env.SPACETIMEDB_MODULE }) };
}

export function createWorkerApp(options: WorkerOptions = {}) {
  const app = new Hono<WorkerContext>();
  app.use('*', secureHeaders());
  app.use('*', (c, next) => cors({ origin: c.env.CORS_ORIGINS.split(',').map((v) => v.trim()).filter(Boolean),
    allowMethods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-File-Name', 'X-File-Size'],
    exposeHeaders: ['Content-Disposition', 'Content-Length'] })(c, next));
  app.get('/health', (c) => c.json({ ok: true, files: c.env.FILES ? 'r2' : 'unconfigured', ai: c.env.AI_ENABLED === 'true' }));
  app.use('/ai/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    let auth: AuthOptions;
    try { auth = options.auth ?? configAuth(c.env); }
    catch { return c.json({ error: 'El acceso todavía no está configurado.' }, 503); }
    return createRequireAuth<WorkerContext>(auth)(c, async () => {
      c.set('sessionToken', c.req.header('Authorization')!.replace(/^Bearer\s+/i, ''));
      c.set('ai', options.aiDatabase?.(c.env) ?? createAiDatabase(c.env));
      await next();
    });
  });
  app.route('/ai/study-guides', guideAiRoutes({ provider: options.guideProvider }));
  app.route('/ai', aiWorkerRoutes({ provider: options.aiProvider }));
  app.use('/files/*', async (c, next) => {
    if (!c.env.FILES) return c.json({ error: 'La compatibilidad con archivos anteriores no está configurada en este servicio.' }, 503);
    let auth: AuthOptions;
    try { auth = options.auth ?? configAuth(c.env); }
    catch { return c.json({ error: 'El acceso todavía no está configurado.' }, 503); }
    return createRequireAuth<WorkerContext>(auth)(c, async () => {
      c.set('sessionToken', c.req.header('Authorization')!.replace(/^Bearer\s+/i, ''));
      c.set('files', options.database?.(c.env) ?? createFileDatabase(c.env));
      c.header('Cache-Control', 'private, no-store');
      await next();
    });
  });

  app.put('/files/uploads/:uploadId', async (c) => {
    const uploadId = c.req.param('uploadId').toLowerCase();
    if (!UUID.test(uploadId)) throw new FileApiError(400, 'El intento de subida no es válido.');
    const version = Number(c.req.query('expectedVersion'));
    if (!Number.isInteger(version) || version < 1 || version > 0xffffffff) throw new FileApiError(400, 'Actualiza la versión de esta página.');
    const sizeText = c.req.header('X-File-Size') ?? '';
    const size = Number(sizeText);
    if (!/^\d+$/.test(sizeText) || !Number.isSafeInteger(size) || size <= 0) throw new FileApiError(400, 'El archivo está vacío.');
    if (size > MAX_FILE_BYTES) throw new FileApiError(413, 'El límite es de 50 MB por archivo.');
    const httpSize = c.req.header('Content-Length');
    if (httpSize !== undefined && Number(httpSize) !== size) throw new FileApiError(400, 'El tamaño del archivo cambió. Vuelve a intentarlo.');
    const body = c.req.raw.body;
    if (!body) throw new FileApiError(400, 'Falta el archivo.');
    const name = fileName(c.req.header('X-File-Name'));
    const contentType = fileType(c.req.header('Content-Type'));
    const db = c.get('files');
    const upload = await db.authorize(c.get('sessionToken'), { targetKind: targetKind(c.req.query('targetKind')),
      targetId: decimalId(c.req.query('targetId')), expectedVersion: version, uploadId });
    const existing = await db.status(upload.actor, uploadId);
    if (existing) {
      await body.cancel();
      if (existing.storageKey !== objectKey(upload.actor, uploadId)) throw new FileApiError(409, 'El intento corresponde a otro archivo.');
      const saved = await c.env.FILES.head(existing.storageKey);
      if (!saved || !matchesMetadata(saved.customMetadata, metadata(upload, name, contentType, size))) {
        throw new FileApiError(409, 'Ese intento ya se usó para otro archivo. Elígelo de nuevo.');
      }
      return c.json({ fileId: existing.fileId }, 200);
    }
    const stored = await storeFile(c.env.FILES, body, upload, name, contentType, size);
    try {
      await db.finalize(stored);
    } catch (error) {
      // A timeout can occur after commit. Resolve by uploadId before considering cleanup.
      try {
        const result = await db.status(upload.actor, uploadId);
        if (result?.storageKey === stored.storageKey) return c.json({ fileId: result.fileId }, 200);
        if (error instanceof FileApiError && error.status === 409 && result === null) {
          await c.env.FILES.delete(stored.storageKey);
        }
      } catch { /* Preserve unknown outcomes; scheduled cleanup only removes proven orphans. */ }
      throw error;
    }
    const result = await db.status(upload.actor, uploadId);
    if (!result || result.storageKey !== stored.storageKey) throw new FileApiError(503, 'No pudimos confirmar el archivo. Reintenta sin cambiarlo.');
    return c.json({ fileId: result.fileId }, 201);
  });

  app.get('/files/uploads/:uploadId', async (c) => {
    const uploadId = c.req.param('uploadId').toLowerCase();
    if (!UUID.test(uploadId)) throw new FileApiError(400, 'El intento de subida no es válido.');
    const version = Number(c.req.query('expectedVersion'));
    if (!Number.isInteger(version) || version < 1 || version > 0xffffffff) throw new FileApiError(400, 'Actualiza la versión de esta página.');
    const db = c.get('files');
    const upload = await db.authorize(c.get('sessionToken'), { targetKind: targetKind(c.req.query('targetKind')),
      targetId: decimalId(c.req.query('targetId')), expectedVersion: version, uploadId });
    const result = await db.status(upload.actor, uploadId);
    return c.json({ fileId: result?.fileId ?? null });
  });

  app.get('/files/:fileId', async (c) => {
    const fileId = c.req.param('fileId');
    if (!UUID.test(fileId) && !/^legacy:(?:0|[1-9]\d{0,19})$/.test(fileId)) throw new FileApiError(404, 'Este archivo no está disponible.');
    const file = await c.get('files').download(c.get('sessionToken'), fileId);
    if (!file.storageKey || !/^\d+$/.test(file.size) || BigInt(file.size) > BigInt(MAX_FILE_BYTES)) throw new FileApiError(404, 'Este archivo no está disponible.');
    const object = await c.env.FILES.get(file.storageKey, file.etag ? { onlyIf: { etagMatches: file.etag } } : undefined);
    if (!object || !('body' in object) || object.size !== Number(file.size)) throw new FileApiError(404, 'El archivo no está disponible en esta versión.');
    const name = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, '_');
    const encodedName = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(object.body, { headers: { 'Content-Type': 'application/octet-stream',
      'Content-Length': String(object.size), 'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  });
  app.onError((error, c) => {
    const aiError = aiPublicError(error);
    if (aiError) return c.json({ error: aiError.message, code: aiError.code }, aiError.status);
    if (error instanceof FileApiError) return c.json({ error: error.message }, error.status);
    console.error(JSON.stringify({ event: 'file_api_error', error: error.name }));
    return c.json({ error: 'No se pudo completar la operación. Vuelve a intentarlo.' }, 503);
  });
  return app;
}
