import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Response as MiniflareResponse } from 'miniflare';
import { build } from 'esbuild';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { fileURLToPath } from 'node:url';
import { cleanOrphans } from './files/storage.ts';

const actor = 'a'.repeat(64);
const issuer = 'https://auth.example.test';
const uploadId = 'fba43d35-6e35-4de5-b01c-8af685402302';
interface SavedFile { fileId: string; storageKey: string; name: string; size: string; contentType: string; etag: string }
const records = new Map<string, SavedFile>();
let mf: Miniflare;
let token: string;
let active = true;
let allowed = true;
let failFinalize: 'none' | 'before' | 'after' | 'deny' = 'none';
let statusOffline = false;
let finalizeCalls = 0;
let authorizations = 0;
let lastBody = '';
let lastAuthorizationBody = '';

beforeAll(async () => {
  const keys = await generateKeyPair('RS256');
  const jwk = await exportJWK(keys.publicKey);
  token = await new SignJWT({ email: 'alumno@example.test', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'worker-test' }).setIssuer(issuer)
    .setSubject('oidc-sub-differs-from-database-identity').setAudience('web-test')
    .setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./worker.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0]!.text,
    compatibilityDate: '2026-10-21', compatibilityFlags: ['nodejs_compat'],
    r2Buckets: ['FILES'],
    bindings: { CORS_ORIGINS: 'https://app-b20.pages.dev,capacitor://localhost,https://localhost', OIDC_ISSUER: issuer, OIDC_AUDIENCE: 'web-test',
      OIDC_JWKS_URI: `${issuer}/jwks`, SPACETIMEDB_URI: 'https://db.example.test',
      SPACETIMEDB_MODULE: 'test-b20', FILE_SERVICE_TOKEN: 'test-file-service-token' },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.href === `${issuer}/jwks`) return MiniflareResponse.json({ keys: [{ ...jwk, kid: 'worker-test', alg: 'RS256' }] });
      const name = url.pathname.split('/').at(-1);
      const auth = request.headers.get('Authorization');
      if (name === 'assert_active_member') return new MiniflareResponse('', { status: active ? 200 : 530 });
      const service = name === 'get_file_upload_status' || name === 'finalize_file_upload';
      if (auth !== `Bearer ${service ? 'test-file-service-token' : token}`) return new MiniflareResponse('', { status: 401 });
      lastBody = await request.text();
      const args = JSON.parse(lastBody) as (string | number)[];
      if (name === 'authorize_file_upload') {
        authorizations++;
        lastAuthorizationBody = lastBody;
        if (!allowed) return new MiniflareResponse('', { status: 530 });
        return MiniflareResponse.json(JSON.stringify({ actor, targetKind: args[0], targetId: String(args[1]), expectedVersion: args[2] }));
      }
      if (name === 'get_file_upload_status') {
        if (statusOffline) return new MiniflareResponse('', { status: 503 });
        const record = records.get(String(args[1]));
        return MiniflareResponse.json(JSON.stringify(record ? { fileId: record.fileId, storageKey: record.storageKey } : null));
      }
      if (name === 'finalize_file_upload') {
        finalizeCalls++;
        expect(args[0]).toBe(actor);
        if (failFinalize === 'before') return new MiniflareResponse('', { status: 503 });
        if (failFinalize === 'deny') return new MiniflareResponse('', { status: 530 });
        records.set(String(args[4]), { fileId: String(args[4]), storageKey: String(args[8]), name: String(args[5]),
          size: String(args[6]), contentType: String(args[7]), etag: String(args[9]) });
        if (failFinalize === 'after') return new MiniflareResponse('', { status: 503 });
        return new MiniflareResponse('', { status: 200 });
      }
      if (name === 'get_file_download_access') {
        if (!allowed) return new MiniflareResponse('', { status: 530 });
        return MiniflareResponse.json(JSON.stringify(records.get(String(args[0])) ?? null));
      }
      return new MiniflareResponse('', { status: 404 });
    } }));
  await mf.ready;
}, 30_000);
afterAll(async () => { await mf?.dispose(); });
beforeEach(async () => {
  records.clear(); active = true; allowed = true; failFinalize = 'none'; statusOffline = false;
  finalizeCalls = 0; authorizations = 0;
  const bucket = (await mf.getBindings<FileWorkerEnv>()).FILES;
  const page = await bucket.list();
  await Promise.all(page.objects.map((object) => bucket.delete(object.key)));
});

function upload(body = 'hola', extra: Record<string, string> = {}, query = '') {
  return mf.dispatchFetch(`https://files.example.test/files/uploads/${uploadId}?targetKind=work&targetId=12&expectedVersion=1${query}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'X-File-Name': encodeURIComponent('mi código.txt'),
      'X-File-Size': String(new TextEncoder().encode(body).length), 'Content-Type': 'text/plain', ...extra }, body });
}

describe('Worker de archivos en el runtime real de Cloudflare y R2 local', () => {
  it('arranca sin claves Gemini ni GCP y no monta IA', async () => {
    expect(await (await mf.dispatchFetch('https://files.example.test/health')).json()).toEqual({ ok: true, files: 'r2', ai: false });
    expect((await mf.dispatchFetch('https://files.example.test/ai/key')).status).toBe(404);
  });

  it('sube, registra la identidad DB y descarga los bytes solo con sesión', async () => {
    const response = await upload();
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await response.json()).toEqual({ fileId: uploadId });
    expect(finalizeCalls).toBe(1);
    const file = records.get(uploadId)!;
    expect(file.storageKey).toBe(`files/${actor}/${uploadId}`);
    expect(file.size).toBe('4');
    const download = await mf.dispatchFetch(`https://files.example.test/files/${uploadId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('hola');
    expect(download.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(download.headers.get('Content-Disposition')).toContain('mi%20c%C3%B3digo.txt');
    expect(download.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await mf.dispatchFetch(`https://files.example.test/files/${uploadId}`)).status).toBe(401);
  });

  it('un reintento devuelve el mismo archivo sin escribir ni finalizar otra vez', async () => {
    expect((await upload()).status).toBe(201);
    expect((await upload()).status).toBe(200);
    expect(finalizeCalls).toBe(1);
    expect((await ((await mf.getBindings<FileWorkerEnv>()).FILES).list()).objects).toHaveLength(1);
    expect((await upload('cambio')).status).toBe(409);
  });

  it('dos envíos simultáneos del mismo intento conservan un solo objeto', async () => {
    const responses = await Promise.all([upload(), upload()]);
    expect(responses.every((response) => [200, 201].includes(response.status))).toBe(true);
    expect(records.size).toBe(1);
    expect((await ((await mf.getBindings<FileWorkerEnv>()).FILES).list()).objects).toHaveLength(1);
  }, 10_000);

  it('rechaza sesión inválida o baja antes de autorizar y escribir', async () => {
    expect((await upload('hola', { Authorization: 'Bearer fake' })).status).toBe(401);
    active = false;
    expect((await upload()).status).toBe(403);
    expect(authorizations).toBe(0);
    expect((await ((await mf.getBindings<FileWorkerEnv>()).FILES).list()).objects).toHaveLength(0);
  });

  it('rechaza falta de autoría antes de guardar y deniega descarga ajena', async () => {
    allowed = false;
    expect((await upload()).status).toBe(409);
    expect(finalizeCalls).toBe(0);
    expect((await ((await mf.getBindings<FileWorkerEnv>()).FILES).list()).objects).toHaveLength(0);
    expect((await mf.dispatchFetch(`https://files.example.test/files/${uploadId}`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(409);
  });

  it('rechaza archivos vacíos, mayores de 50MiB y tamaños de cuerpo falsos', async () => {
    expect((await upload('', { 'X-File-Size': '0' })).status).toBe(400);
    expect((await upload('hola', { 'X-File-Size': '52428801' })).status).toBe(413);
    expect((await upload('hola', { 'X-File-Size': '3' })).status).toBe(400);
    expect((await upload('hola', { 'X-File-Size': '5' })).status).toBe(400);
    expect(finalizeCalls).toBe(0);
    expect((await ((await mf.getBindings<FileWorkerEnv>()).FILES).list()).objects).toHaveLength(0);
  });

  it('recupera el commit cuando la respuesta de finalize falla después de guardar', async () => {
    failFinalize = 'after';
    expect((await upload()).status).toBe(200);
    expect(records.has(uploadId)).toBe(true);
    expect((await ((await mf.getBindings<FileWorkerEnv>()).FILES).list()).objects).toHaveLength(1);
  });

  it('conserva bytes ante finalize incierto y reintenta sin crear otra subida', async () => {
    failFinalize = 'before';
    expect((await upload()).status).toBe(503);
    const bucket = (await mf.getBindings<FileWorkerEnv>()).FILES;
    const first = (await bucket.list()).objects[0]!;
    expect(first).toBeDefined();
    failFinalize = 'none';
    expect((await upload()).status).toBe(201);
    expect((await bucket.list()).objects[0]!.etag).toBe(first.etag);
  });

  it('elimina solo una subida que finalize rechazó definitivamente y confirmó sin registro', async () => {
    failFinalize = 'deny';
    expect((await upload()).status).toBe(409);
    expect((await ((await mf.getBindings<FileWorkerEnv>()).FILES).list()).objects).toHaveLength(0);
  });

  it('falla cerrado si no puede consultar el estado, sin subir bytes', async () => {
    statusOffline = true;
    expect((await upload()).status).toBe(503);
    expect((await ((await mf.getBindings<FileWorkerEnv>()).FILES).list()).objects).toHaveLength(0);
  });

  it('no entrega bytes si el objeto fue sustituido por fuera del flujo de versiones', async () => {
    expect((await upload()).status).toBe(201);
    await ((await mf.getBindings<FileWorkerEnv>()).FILES).put(records.get(uploadId)!.storageKey, 'otro');
    const response = await mf.dispatchFetch(`https://files.example.test/files/${uploadId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(404);
  });

  it('no redondea un ID u64 y exige nombres seguros', async () => {
    expect((await upload('hola', { 'X-File-Name': encodeURIComponent('../secreto.txt') })).status).toBe(400);
    const response = await mf.dispatchFetch(`https://files.example.test/files/uploads/${uploadId}?targetKind=assignment&targetId=18446744073709551615&expectedVersion=1`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'X-File-Name': 'nota.txt', 'X-File-Size': '4' }, body: 'hola' });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(lastAuthorizationBody).toContain(',18446744073709551615,');
  });

  it('responde a CORS solo para el origen de la app', async () => {
    const response = await mf.dispatchFetch('https://files.example.test/files/uploads/x', {
      method: 'OPTIONS', headers: { Origin: 'https://app-b20.pages.dev', 'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'authorization,x-file-name,x-file-size' } });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app-b20.pages.dev');
    for (const origin of ['capacitor://localhost', 'https://localhost']) {
      const android = await mf.dispatchFetch('https://files.example.test/health', { headers: { Origin: origin } });
      expect(android.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    }
    const foreign = await mf.dispatchFetch('https://files.example.test/health', { headers: { Origin: 'https://foreign.example' } });
    expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('acepta el límite exacto de 50MiB en streaming', async () => {
    const body = new Uint8Array(52_428_800);
    const response = await mf.dispatchFetch(`https://files.example.test/files/uploads/${uploadId}?targetKind=evidence&targetId=12&expectedVersion=1`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'X-File-Name': 'evidencia.bin',
        'X-File-Size': String(body.byteLength) }, body });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(records.get(uploadId)?.size).toBe('52428800');
  }, 20_000);

  it('limpieza conserva archivos registrados y recientes y falla cerrado si DB no responde', async () => {
    const bucket = (await mf.getBindings<FileWorkerEnv>()).FILES;
    const knownId = crypto.randomUUID();
    const orphanId = crypto.randomUUID();
    await bucket.put(`files/${actor}/${knownId}`, 'conservar', { customMetadata: { actor, uploadId: knownId } });
    await bucket.put(`files/${actor}/${orphanId}`, 'huérfano', { customMetadata: { actor, uploadId: orphanId } });
    const recent = await cleanOrphans(bucket, async () => null);
    expect(recent).toBe(0);
    await expect(cleanOrphans(bucket, async () => { throw new Error('DB offline'); }, Date.now() + 25 * 60 * 60_000)).rejects.toThrow('DB offline');
    expect((await bucket.list({ prefix: 'files/' })).objects).toHaveLength(2);
    expect(await cleanOrphans(bucket, async (_actor, id) => id === knownId ? { storageKey: `files/${actor}/${knownId}` } : null,
      Date.now() + 25 * 60 * 60_000)).toBe(1);
    expect(await bucket.head(`files/${actor}/${knownId}`)).not.toBeNull();
    expect(await bucket.head(`files/${actor}/${orphanId}`)).toBeNull();
  });
});
