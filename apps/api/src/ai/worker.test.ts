import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Response as MfResponse } from 'miniflare';
import { build } from 'esbuild';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { fileURLToPath } from 'node:url';
import { AI_CONSENT_VERSION, AI_LIMITS, aiHash, buildAiPreparation, type AiGeneration, type AiGenerationConfig, type AiPreparation } from '@b20/core';
import { createWorkerApp } from '../workerApp.ts';
import type { AuthOptions } from '../lib/auth.ts';
import { AiApiError, type AiDatabase, type AiWorkerEnv } from './database.ts';
import { encryptAiKey } from './crypto.ts';

const actor = 'a'.repeat(64);
const issuer = 'https://ai-auth.example.test';
const personalKey = 'not-a-real-gemini-key-for-local-test';
const serviceToken = 'ai-only-token';
const config: AiGenerationConfig = { questionCount: 1, types: ['boolean'], difficulty: 'basic' };
const prepInput = { subjectId: '18446744073709551615', topics: ['Variables'], sources: [{ kind: 'note', refId: '1', topics: ['Variables'], includeUnplaced: true }], config };
let mf: Miniflare; let token = ''; let otherToken = '';
let localAuth: AuthOptions;
let key: Record<string, unknown> | undefined;
const intentions = new Map<string, Record<string, unknown>>();
const preparations = new Map<string, AiPreparation>();
const generations = new Map<string, AiGeneration & { fingerprint: string; requestHash: string; config: AiGenerationConfig }>();
let consent = true; let policy = true; let active = true; let access = true; let quota = false;
let providerCalls = 0; let commits = 0; let failCommitAfter = false;
let finishFailure: 'none' | 'before' | 'after' = 'none';
let scenario: 'ok' | 'invalid-key' | 'quota' | 'uncertain' | 'invalid-json' | 'invalid-cite' | 'oversized' = 'ok';
let lastPrepare: Record<string, unknown> | undefined;
let lastProviderBody = '';

function dto(value: unknown) { return MfResponse.json(JSON.stringify(value)); }
function denied(code: string) { return new MfResponse(`${code}: backend-detail-must-stay-private ${personalKey}`, { status: 530 }); }
function question(prep: AiPreparation) { return { questions: [{ id: 'q1', type: 'boolean', text: 'Una variable almacena un valor.',
  options: [{ id: 'yes', text: 'Verdadero' }, { id: 'no', text: 'Falso' }], correctOptionId: 'yes', explanation: 'El material explica cómo almacenar valores.',
  topic: 'Variables', citations: [scenario === 'invalid-cite' ? 'unseen-fragment' : prep.fragments[0]!.id] }] }; }

beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); const jwk = await exportJWK(pair.publicKey);
  localAuth = { issuer, audiences: ['ai-test'], jwks: createLocalJWKSet({ keys: [{ ...jwk, kid: 'ai-test', alg: 'RS256' }] }), isActiveMember: async () => true };
  const jwt = (sub: string) => new SignJWT({ email: 'student@example.test', email_verified: true }).setProtectedHeader({ alg: 'RS256', kid: 'ai-test' })
    .setIssuer(issuer).setSubject(sub).setAudience('ai-test').setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
  token = await jwt('oidc-sub-is-not-database-actor'); otherToken = await jwt('another-oidc-user');
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../worker.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0]!.text,
    compatibilityDate: '2026-10-21', compatibilityFlags: ['nodejs_compat'], r2Buckets: ['FILES'],
    bindings: { CORS_ORIGINS: 'https://app.example.test', OIDC_ISSUER: issuer, OIDC_AUDIENCE: 'ai-test', OIDC_JWKS_URI: `${issuer}/jwks`,
      SPACETIMEDB_URI: 'https://ai-db.example.test', SPACETIMEDB_MODULE: 'ai-local', FILE_SERVICE_TOKEN: 'files-only-token',
      AI_ENABLED: 'true', GEMINI_MODEL: 'gemini-test', AI_MASTER_VERSION: 'v1',
      AI_MASTER_KEYS_JSON: JSON.stringify({ v1: btoa('m'.repeat(32)) }), AI_SERVICE_TOKEN: serviceToken },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.href === `${issuer}/jwks`) return MfResponse.json({ keys: [{ ...jwk, kid: 'ai-test', alg: 'RS256' }] });
      if (url.hostname === 'generativelanguage.googleapis.com') {
        providerCalls++; lastProviderBody = await request.text();
        expect(request.headers.get('x-goog-api-key')).toBe(personalKey);
        expect(url.pathname).toBe('/v1beta/models/gemini-test:generateContent');
        if (scenario === 'invalid-key' || scenario === 'quota' || scenario === 'uncertain') {
          const code = scenario === 'invalid-key' ? 401 : scenario === 'quota' ? 429 : 503;
          return MfResponse.json({ error: { code, message: `private provider error ${personalKey}`, status: 'TEST' } }, { status: code });
        }
        const prep = [...preparations.values()][0]!;
        const text = scenario === 'invalid-json' ? 'not JSON' : scenario === 'oversized' ? 'x'.repeat(300_000) : JSON.stringify(question(prep));
        return MfResponse.json({ candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 30 } });
      }
      if (url.hostname !== 'ai-db.example.test') throw new Error(`Unexpected outbound host: ${url.hostname}`);
      const procedure = url.pathname.split('/').at(-1)!;
      const bearer = request.headers.get('Authorization');
      if (procedure === 'assert_active_member') return new MfResponse('', { status: active ? 200 : 530 });
      const isService = ['ai_commit_key', 'ai_claim_generation', 'ai_finish_generation'].includes(procedure);
      if (bearer !== `Bearer ${isService ? serviceToken : token}`) return denied('forbidden');
      const args = JSON.parse(await request.text()) as string[];
      const input = JSON.parse(args[0]!) as Record<string, unknown>;
      if (procedure === 'ai_status') return dto({ actor, enabled: policy, configured: !!key, model: '', limits: AI_LIMITS, consentVersion: AI_CONSENT_VERSION, consented: consent });
      if (procedure === 'ai_key_status') return dto({ configured: !!key, ...(key ? { keyId: key.keyId, provider: 'gemini' } : {}) });
      if (procedure === 'ai_set_consent') { consent = input.accepted === true; return dto({ version: input.version, accepted: consent }); }
      if (procedure === 'ai_authorize_key') { intentions.set(String(input.intentId), input); return dto({ ...input, actor, expiresAt: Date.now() + 300_000 }); }
      if (procedure === 'ai_commit_key') {
        expect(input.actor).toBe(actor); expect(intentions.has(String(input.intentId))).toBe(true);
        key = input; commits++;
        if (failCommitAfter) return new MfResponse('', { status: 503 });
        return dto({ configured: true, keyId: input.keyId });
      }
      if (procedure === 'ai_delete_key') { key = undefined; return dto({ configured: false }); }
      if (procedure === 'ai_prepare') {
        if (!access) return denied('unauthorized');
        lastPrepare = input;
        const prep = buildAiPreparation(input, [{ kind: 'note', refId: '1', version: 1, subjectId: prepInput.subjectId,
          visibility: 'personal', title: 'Variables', fields: [{ name: 'content', text: 'Una variable almacena valores.' }] }], { id: String(input.id), model: String(input.model), now: Date.now() });
        preparations.set(prep.id, prep); return dto(prep);
      }
      if (procedure === 'ai_authorize_generation') {
        const id = String(input.id); const existing = generations.get(id);
        const requestHash = aiHash({ preparationId: input.preparationId, fingerprint: input.fingerprint, config: input.config });
        if (existing) return existing.requestHash === requestHash ? dto(existing) : denied('conflict');
        if (input.allowNew === false) return denied('disabled');
        if (quota) return denied('quota');
        if (!consent) return denied('consent');
        if (!key) return denied('key_required');
        if (!access) return denied('unauthorized');
        if (input.acknowledgeUnknown !== true && [...generations.values()].some((generation) => generation.state === 'unknown')) return denied('unknown_confirmation_required');
        const generation = { id, state: 'prepared' as const, preparationId: String(input.preparationId), createdAt: Date.now(),
          fingerprint: String(input.fingerprint), requestHash, config: input.config as AiGenerationConfig };
        generations.set(id, generation); return dto(generation);
      }
      if (procedure === 'ai_claim_generation') {
        const generation = generations.get(String(input.id))!;
        if (!access) return denied('unauthorized');
        if (generation.state !== 'prepared') return dto({ claimed: false, generation });
        generation.state = 'running';
        return dto({ claimed: true, generation, preparation: preparations.get(generation.preparationId), config: generation.config, key });
      }
      if (procedure === 'ai_finish_generation') {
        if (finishFailure === 'before') return new MfResponse('', { status: 503 });
        const generation = generations.get(String(input.id))!;
        generation.state = input.state as AiGeneration['state'];
        if (input.result) generation.result = input.result;
        if (input.errorMessage) generation.error = String(input.errorMessage);
        if (finishFailure === 'after') return new MfResponse('', { status: 503 });
        return dto(generation);
      }
      if (procedure === 'ai_get_generation') {
        if (!access) return denied('unauthorized');
        return dto(generations.get(String(input.id)) ?? null);
      }
      throw new Error(`Unexpected procedure: ${procedure}`);
    },
  }));
  await mf.ready;
}, 30_000);
afterAll(async () => { await mf?.dispose(); });
beforeEach(() => { key = undefined; intentions.clear(); preparations.clear(); generations.clear(); consent = true; policy = true; active = true; access = true; quota = false;
  providerCalls = 0; commits = 0; failCommitAfter = false; finishFailure = 'none'; scenario = 'ok'; lastPrepare = undefined; lastProviderBody = ''; });

function api(path: string, method = 'GET', body?: unknown, bearer = token) {
  return mf.dispatchFetch(`https://api.example.test/ai/${path}`, { method, headers: { Authorization: `Bearer ${bearer}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
async function saveKey() { const response = await api('key', 'PUT', { apiKey: personalKey }); expect(response.status, await response.clone().text()).toBe(200); }
async function prepare() { const response = await api('preparations', 'POST', prepInput); expect(response.status, await response.clone().text()).toBe(201); return await response.json() as AiPreparation; }
async function ready() { await saveKey(); return await prepare(); }
const generationRequest = (prep: AiPreparation, id = crypto.randomUUID()) => ({ id, preparationId: prep.id, fingerprint: prep.fingerprint, config, confirmed: true });

describe('BYOK en runtime Cloudflare con Gemini interceptado localmente', () => {
  it('el flag ausente o falso bloquea generación aunque el grupo y secretos estén listos', async () => {
    const db: AiDatabase = { async user<T>(_token: string, procedure: string) {
      if (procedure === 'ai_authorize_generation') throw new AiApiError(503, 'disabled', 'La generación con IA permanece desactivada.');
      return { actor, enabled: true, configured: true, model: '', limits: AI_LIMITS, consentVersion: AI_CONSENT_VERSION, consented: true } as T; },
      async service<T>() { throw new Error('No debe reclamar la generación'); return undefined as T; } };
    const app = createWorkerApp({ auth: localAuth, aiDatabase: () => db,
      aiProvider: { async generate() { throw new Error('No debe llamar a Gemini'); } } });
    for (const flag of [undefined, 'false']) {
      const env = { CORS_ORIGINS: '', AI_ENABLED: flag, GEMINI_MODEL: 'gemini-test', AI_MASTER_VERSION: 'v1',
        AI_MASTER_KEYS_JSON: JSON.stringify({ v1: btoa('m'.repeat(32)) }), AI_SERVICE_TOKEN: serviceToken } as unknown as AiWorkerEnv;
      const response = await app.request('https://api.example.test/ai/generations', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: crypto.randomUUID(), preparationId: crypto.randomUUID(), fingerprint: 'a'.repeat(64), config, confirmed: true }) }, env);
      expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  });
  it('POST conserva resultados tras desactivar IA y quitar secretos/modelo, sin permitir nuevos envíos', async () => {
    const env = { CORS_ORIGINS: '', AI_ENABLED: 'true', GEMINI_MODEL: 'gemini-test', AI_MASTER_VERSION: 'v1',
      AI_MASTER_KEYS_JSON: JSON.stringify({ v1: btoa('m'.repeat(32)) }), AI_SERVICE_TOKEN: serviceToken } as AiWorkerEnv;
    const prep = buildAiPreparation(prepInput, [{ kind: 'note', refId: '1', version: 1, subjectId: prepInput.subjectId,
      visibility: 'personal', title: 'Variables', fields: [{ name: 'content', text: 'Una variable almacena valores.' }] }],
    { id: crypto.randomUUID(), model: 'gemini-test', now: Date.now() });
    const keyId = crypto.randomUUID();
    const encrypted = { keyId, provider: 'gemini', ...await encryptAiKey(env, { actor, provider: 'gemini', keyId }, personalKey) };
    const request = generationRequest(prep); let saved: AiGeneration | undefined; let savedHash = ''; let allowed = true; let calls = 0;
    const db: AiDatabase = {
      async user<T>(_token: string, procedure: string, raw: unknown) {
        const input = raw as Record<string, unknown>;
        if (procedure === 'ai_status') return { actor, enabled: true, configured: true, model: '', limits: AI_LIMITS, consentVersion: AI_CONSENT_VERSION, consented: true } as T;
        if (procedure === 'ai_authorize_generation') {
          if (!allowed) throw new AiApiError(403, 'unauthorized', 'Ya no tienes acceso a este material.');
          const requestHash = aiHash({ preparationId: input.preparationId, fingerprint: input.fingerprint, config: input.config });
          if (saved?.id === input.id) {
            if (savedHash !== requestHash) throw new AiApiError(409, 'conflict', 'El UUID ya pertenece a otra solicitud.');
            return saved as T;
          }
          if (input.allowNew === false) throw new AiApiError(503, 'disabled', 'La generación con IA permanece desactivada.');
          saved = { id: String(input.id), preparationId: String(input.preparationId), state: 'prepared', createdAt: Date.now() };
          savedHash = requestHash; return saved as T;
        }
        if (procedure === 'ai_get_generation') return saved as T;
        throw new Error('Unexpected user procedure');
      },
      async service<T>(procedure: string, raw: unknown) {
        if (procedure === 'ai_claim_generation') { saved!.state = 'running'; return { claimed: true, generation: saved, preparation: prep, key: encrypted, config } as T; }
        if (procedure === 'ai_finish_generation') { const input = raw as Record<string, unknown>; saved!.state = input.state as AiGeneration['state']; saved!.result = input.result; return saved as T; }
        throw new Error('Unexpected service procedure');
      },
    };
    const app = createWorkerApp({ auth: localAuth, aiDatabase: () => db, aiProvider: { async generate() { calls++; return { text: JSON.stringify(question(prep)) }; } } });
    const post = (body: unknown) => app.request('https://api.example.test/ai/generations', { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    const first = await post(request); expect(first.status).toBe(200); expect((await first.json() as AiGeneration).state).toBe('succeeded'); expect(calls).toBe(1);
    env.AI_ENABLED = 'false'; env.GEMINI_MODEL = ''; delete env.AI_SERVICE_TOKEN; delete env.AI_MASTER_KEYS_JSON;
    const replay = await post(request); expect(replay.status).toBe(200); expect((await replay.json() as AiGeneration).result).toEqual(question(prep)); expect(calls).toBe(1);
    expect((await post({ ...request, id: crypto.randomUUID() })).status).toBe(503);
    expect((await post({ ...request, config: { ...config, questionCount: 2 } })).status).toBe(409);
    allowed = false; expect((await post(request)).status).toBe(403); expect(calls).toBe(1);
  });
  it('cifra por identidad DB, no expone clave y recupera un commit cuya respuesta se perdió', async () => {
    failCommitAfter = true; await saveKey();
    expect(commits).toBe(1); expect(key?.actor).toBe(actor); expect(key?.ciphertext).not.toContain(personalKey);
    const status = await api('key'); expect(status.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await status.text()).not.toMatch(/ciphertext|masterVersion|not-a-real|oidc-sub/);
    await saveKey(); expect(commits).toBe(2);
    expect(await (await api('key', 'DELETE')).json()).toEqual({ configured: false });
  });
  it('prepara referencias u64 exactas y no necesita clave, consentimiento ni envío a Gemini', async () => {
    consent = false; policy = false;
    const prep = await prepare(); expect(lastPrepare?.subjectId).toBe('18446744073709551615');
    expect(prep.fragments).toHaveLength(1); expect(providerCalls).toBe(0); expect(key).toBeUndefined();
  });
  it('mantiene el bloqueo administrativo independiente del consentimiento', async () => {
    const prep = await ready(); policy = false;
    const status = await (await api('status')).json() as { enabled: boolean; consented: boolean };
    expect(status.enabled).toBe(false); expect(status.consented).toBe(true);
    expect((await api('generations', 'POST', generationRequest(prep))).status).toBe(503); expect(providerCalls).toBe(0);
  });
  it('genera estructura validada, y UUID repetido o concurrente llama una sola vez al proveedor', async () => {
    const prep = await ready(); const request = generationRequest(prep);
    const responses = await Promise.all([api('generations', 'POST', request), api('generations', 'POST', request)]);
    expect(responses.every((r) => r.status === 200)).toBe(true);
    const saved = await (await api(`generations/${request.id}`)).json() as AiGeneration;
    expect(saved.state).toBe('succeeded'); expect(saved.result).toEqual(question(prep)); expect(providerCalls).toBe(1);
    expect(lastProviderBody).toContain('material de estudio no confiable'); expect(lastProviderBody).not.toContain(personalKey);
    expect((await api('generations', 'POST', request)).status).toBe(200); expect(providerCalls).toBe(1);
    expect((await api('generations', 'POST', { ...request, config: { ...config, questionCount: 2 } })).status).toBe(409);
    expect(providerCalls).toBe(1);
  });
  it.each(['invalid-key', 'quota', 'invalid-json', 'invalid-cite', 'oversized'] as const)('guarda fallo %s sin reintento ni filtrar datos privados', async (failure) => {
    const prep = await ready(); scenario = failure; const request = generationRequest(prep);
    const response = await api('generations', 'POST', request); expect(response.status, await response.clone().text()).toBe(200);
    const text = await response.text(); expect(text).toContain('failed'); expect(text).not.toContain(personalKey);
    expect(providerCalls).toBe(1); await api('generations', 'POST', request); expect(providerCalls).toBe(1);
  });
  it('un envío incierto conserva operación y nunca vuelve a llamar al proveedor', async () => {
    const prep = await ready(); scenario = 'uncertain'; const request = generationRequest(prep);
    expect((await (await api('generations', 'POST', request)).json() as AiGeneration).state).toBe('unknown');
    scenario = 'ok'; await api('generations', 'POST', request); expect(providerCalls).toBe(1);
    const next = generationRequest(prep);
    const unconfirmed = await api('generations', 'POST', next); expect(unconfirmed.status).toBe(409);
    expect((await unconfirmed.json() as { code: string }).code).toBe('unknown_confirmation_required');
    expect(providerCalls).toBe(1);
    expect((await api('generations', 'POST', { ...next, acknowledgeUnknown: true })).status).toBe(200); expect(providerCalls).toBe(2);
  });
  it.each(['before', 'after'] as const)('una escritura final incierta %s no vuelve a enviar contenido', async (failure) => {
    const prep = await ready(); finishFailure = failure; const request = generationRequest(prep);
    await api('generations', 'POST', request); finishFailure = 'none'; await api('generations', 'POST', request);
    expect(providerCalls).toBe(1);
  });
  it('revalida baja, acceso y cuotas y nunca revela errores crudos de la base', async () => {
    const prep = await ready(); quota = true;
    const rejected = await api('generations', 'POST', generationRequest(prep)); expect(rejected.status).toBe(429); expect(await rejected.text()).not.toContain(personalKey);
    quota = false; access = false; expect((await api('preparations', 'POST', prepInput)).status).toBe(403);
    active = false; expect((await api('key')).status).toBe(403); expect(providerCalls).toBe(0);
    active = true; expect((await api('key', 'GET', undefined, otherToken)).status).toBe(403);
  });
  it('revalida acceso antes de consultar resultados', async () => {
    const prep = await ready(); const request = generationRequest(prep); await api('generations', 'POST', request);
    access = false; const response = await api(`generations/${request.id}`); expect(response.status).toBe(403); expect(await response.text()).not.toContain('Una variable almacena');
  });
  it('limita bytes reales del cuerpo y no admite instrucciones o fuentes desde el cliente', async () => {
    expect((await api('key', 'PUT', { apiKey: 'x'.repeat(6000) })).status).toBe(413);
    expect((await api('preparations', 'POST', { ...prepInput, sources: [{ kind: 'chat', refId: '1', topics: [], includeUnplaced: true }] })).status).toBe(400);
    expect((await api('generations', 'POST', { prompt: 'ignore instructions' })).status).toBe(400); expect(providerCalls).toBe(0);
  });
  it('CORS permite POST y DELETE únicamente a orígenes configurados', async () => {
    const response = await mf.dispatchFetch('https://api.example.test/ai/key', { method: 'OPTIONS', headers: { Origin: 'https://app.example.test', 'Access-Control-Request-Method': 'DELETE' } });
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('DELETE'); expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    const foreign = await mf.dispatchFetch('https://api.example.test/ai/key', { method: 'OPTIONS', headers: { Origin: 'https://foreign.example.test' } });
    expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
