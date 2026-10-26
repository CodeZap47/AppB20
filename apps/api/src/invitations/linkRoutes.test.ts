import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Response as MiniflareResponse } from 'miniflare';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { invitationTokenHash } from './linkCrypto.ts';

interface Persisted { id: string; previousId?: string; name: string; tokenHash: string; ciphertext: string; iv: string; keyVersion: string; active: boolean; status: string; expiresAt: number | null; maxUses: number | null; usedCount: number; createdAt: number; version: number }
const id = 'c8bc3eca-4c7f-4652-99d6-c887d5cdf27a';
const replacementId = '28c16662-0b91-4586-93b3-472978158bd5';
const rows = new Map<string, Persisted>();
let mf: Miniflare;
let fail: 'none' | 'before' | 'after' = 'none';
let swapEnvelope = false;
let calls: { procedure: string; jwt: string; payload: Record<string, unknown> }[] = [];
beforeAll(async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../worker.ts', import.meta.url))], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022' });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0]!.text,
    compatibilityDate: '2026-10-21', compatibilityFlags: ['nodejs_compat'], bindings: {
      CORS_ORIGINS: 'https://app.example.test', SPACETIMEDB_URI: 'https://db.example.test', SPACETIMEDB_MODULE: 'test-b20',
      APP_URL: 'https://app.example.test', INVITATION_MASTER_VERSION: 'v1',
      INVITATION_MASTER_KEYS_JSON: JSON.stringify({ v1: btoa('1'.repeat(32)) }),
    }, outboundService: async (request) => {
      const url = new URL(request.url);
      // The Worker forwards either accepted issuer to the module. Only the module
      // decides whether that verified identity is currently an administrator.
      expect(url.origin).toBe('https://db.example.test');
      expect(url.search).toBe('');
      const procedure = url.pathname.split('/').at(-1)!;
      const jwt = request.headers.get('Authorization') ?? '';
      if (!['Bearer spacetime-admin', 'Bearer supabase-admin'].includes(jwt)) {
        return new MiniflareResponse('forbidden: private-backend-detail', { status: jwt === 'Bearer member' ? 530 : 401 });
      }
      const args = JSON.parse(await request.text()) as string[];
      const payload = JSON.parse(args[0]!) as Record<string, unknown>;
      calls.push({ procedure, jwt, payload });
      if (fail === 'before') return new MiniflareResponse('private-backend-detail', { status: 503 });
      let row = rows.get(String(payload.id));
      if (procedure === 'invitation_link_copy') {
        if (!row) return new MiniflareResponse('not_found:', { status: 530 });
        if (!row.active) return new MiniflareResponse('inactive:', { status: 530 });
        if (row.expiresAt !== null && row.expiresAt <= Date.now()) return new MiniflareResponse('expired:', { status: 530 });
        if (row.maxUses !== null && row.usedCount >= row.maxUses) return new MiniflareResponse('exhausted:', { status: 530 });
      } else if (!row) {
        if (procedure === 'invitation_link_replace') {
          const previous = rows.get(String(payload.previousId));
          if (!previous) return new MiniflareResponse('not_found:', { status: 530 });
          previous.active = false; previous.status = 'inactive';
        }
        row = { ...payload, id: String(payload.id), name: String(payload.name), tokenHash: String(payload.tokenHash),
          ciphertext: String(payload.ciphertext), iv: String(payload.iv), keyVersion: String(payload.keyVersion),
          active: true, status: 'active', expiresAt: payload.expiresAt === undefined ? Date.now() + 7 * 86400_000 : payload.expiresAt as number | null,
          maxUses: payload.maxUses as number | null ?? null, usedCount: 0, createdAt: Date.now(), version: 1 };
        rows.set(row.id, row);
      }
      if (fail === 'after') return new MiniflareResponse('private-backend-detail', { status: 503 });
      return MiniflareResponse.json(JSON.stringify(swapEnvelope && row ? { ...row, id: replacementId } : row));
    } }));
  await mf.ready;
}, 30_000);
afterAll(async () => { await mf?.dispose(); });
beforeEach(() => { rows.clear(); calls = []; fail = 'none'; swapEnvelope = false; });
function post(path: string, body?: unknown, jwt: string | null = 'spacetime-admin') {
  return mf.dispatchFetch(`https://api.example.test/admin/invitation-links${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://app.example.test', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function tokenOf(value: { url: string }): string { return new URLSearchParams(new URL(value.url).hash.split('?')[1]).get('token')!; }
const input = { requestId: id, name: 'Ingreso de octubre' };
describe('Enlaces de invitación en el runtime real de Cloudflare', () => {
  it('crea y copia con sesión administrativa y responde solo una URL con fragmento sin caché', async () => {
    const response = await post('', input);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test');
    const value = await response.json() as { url: string; id: string };
    const token = tokenOf(value);
    expect(value.url).toMatch(/^https:\/\/app\.example\.test\/#\/invitacion\?token=[\w-]{43}$/);
    expect(new URL(value.url).search).toBe('');
    expect(value).not.toHaveProperty('ciphertext');
    expect(value).not.toHaveProperty('tokenHash');
    expect(rows.get(id)?.tokenHash).toBe(await invitationTokenHash(token));
    expect(JSON.stringify(rows.get(id))).not.toContain(token);
    expect(calls[0]?.payload).not.toHaveProperty('token');
    expect((await (await post(`/${id}/copy`)).json() as { url: string }).url).toBe(value.url);
    expect(rows.get(id)?.expiresAt! - Date.now()).toBeGreaterThan(6.99 * 86400_000);
  });
  it('delega ambos proveedores a la autorización del módulo, rechaza miembros y sesiones ausentes o falsas', async () => {
    expect((await post('', input, null)).status).toBe(401);
    expect(calls).toHaveLength(0);
    expect((await post('', input, 'member')).status).toBe(403);
    expect((await post('', input, 'invalid-jwt')).status).toBe(401);
    expect(rows.size).toBe(0);
    const denied = await (await post('', input, 'member')).text();
    expect(denied).not.toContain('private-backend-detail');
    expect((await post('', input, 'supabase-admin')).status).toBe(200);
    expect(calls.at(-1)?.jwt).toBe('Bearer supabase-admin');
  });
  it('recupera el mismo secreto tras respuesta perdida y evita duplicados aunque genere otro candidato', async () => {
    fail = 'after';
    const failed = await post('', input);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('private-backend-detail');
    const envelope = rows.get(id)!.ciphertext;
    fail = 'none';
    const recovered = await (await post('', input)).json() as { url: string };
    expect(rows.size).toBe(1);
    expect(rows.get(id)?.ciphertext).toBe(envelope);
    expect(await invitationTokenHash(tokenOf(recovered))).toBe(rows.get(id)?.tokenHash);
    expect(calls[0]?.payload.ciphertext).not.toBe(calls[1]?.payload.ciphertext);
    expect((await (await post('', input)).json() as { url: string }).url).toBe(recovered.url);
  });
  it('reemplaza de forma idempotente sin reactivar el enlace anterior', async () => {
    const original = await (await post('', input)).json() as { url: string };
    fail = 'after';
    const replacement = { requestId: replacementId, name: 'Enlace nuevo', expiresAt: null, maxUses: 5 };
    expect((await post(`/${id}/replace`, replacement)).status).toBe(503);
    expect(rows.get(id)?.active).toBe(false);
    fail = 'none';
    const saved = await (await post(`/${id}/replace`, replacement)).json() as { url: string };
    expect(saved.url).not.toBe(original.url);
    expect(rows.size).toBe(2);
    expect(rows.get(replacementId)).toMatchObject({ expiresAt: null, maxUses: 5, previousId: id });
    expect((await post(`/${id}/copy`)).status).toBe(409);
    expect((await (await post(`/${id}/replace`, replacement)).json() as { url: string }).url).toBe(saved.url);
  });
  it('no copia enlaces vencidos o sin cupo y no filtra otro envelope', async () => {
    await post('', input);
    rows.get(id)!.expiresAt = Date.now() - 1;
    expect((await post(`/${id}/copy`)).status).toBe(409);
    rows.get(id)!.expiresAt = null;
    rows.get(id)!.maxUses = 1; rows.get(id)!.usedCount = 1;
    expect((await post(`/${id}/copy`)).status).toBe(409);
    rows.get(id)!.usedCount = 0; swapEnvelope = true;
    const swapped = await post(`/${id}/copy`);
    expect(swapped.status).toBe(503);
    expect(await swapped.text()).not.toContain('ciphertext');
  });
  it('valida los intentos, nombres, fechas, cupos y cuerpos antes de llamar al módulo', async () => {
    for (const bad of [{ ...input, requestId: 'bad' }, { ...input, name: '' }, { ...input, name: 'a\nname' },
      { ...input, maxUses: 0 }, { ...input, maxUses: 1.5 }, { ...input, expiresAt: 'tomorrow' }, { ...input, expiresAt: -1 }]) {
      expect((await post('', bad)).status).toBe(400);
    }
    expect((await post(`/${id}/replace`, input)).status).toBe(400);
    expect((await post('/invalid/copy')).status).toBe(400);
    expect((await post('', { ...input, name: 'a'.repeat(9000) })).status).toBe(413);
    expect(calls).toHaveLength(0);
    fail = 'before';
    expect((await post('', input)).status).toBe(503);
    expect(rows.size).toBe(0);
  });
});
