import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Response as MfResponse } from 'miniflare';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AI_CONSENT_VERSION, AI_LIMITS, buildGuideAiPreparation, GUIDE_SECTIONS, type GuideAiDraft } from '@b20/core';
import { createWorkerApp } from '../workerApp.ts';
import { AiApiError, type AiDatabase, type AiWorkerEnv } from './database.ts';
import { encryptAiKey } from './crypto.ts';
import type { AuthOptions } from '../lib/auth.ts';
const actor = 'a'.repeat(64); const draftId = '00000000-0000-4000-8000-000000000001'; const generationId = '00000000-0000-4000-8000-000000000002';
const preparation = buildGuideAiPreparation({ purpose: 'study_guide', subjectId: '1', title: 'Guía', topics: ['Tema'], maxOutputTokens: 1500,
  sources: [{ kind: 'note', refId: '2', topics: ['Tema'], includeUnplaced: true }] }, [{ kind: 'note', refId: '2', subjectId: '1', title: 'Nota', version: 1, visibility: 'group', fields: [{ name: 'texto', text: 'Material académico compartido.' }] }],
  { id: draftId, now: Date.now(), model: 'gemini-3.8-flash' });
let runtime: Miniflare;
let token: string; let auth: AuthOptions; let draft: GuideAiDraft; let calls = 0; let finishes = 0; let claimed = false; let access = true; let active = true; let finishFailure = false;
let scenario: 'valid' | 'invalid-json' | 'invalid-cite' | 'timeout' = 'valid';
const env = { AI_ENABLED: 'true', GEMINI_MODEL: preparation.model, AI_SERVICE_TOKEN: 'technical-ai-only', AI_MASTER_VERSION: 'v1', AI_MASTER_KEYS_JSON: JSON.stringify({ v1: btoa('m'.repeat(32)) }), CORS_ORIGINS: 'https://app.example.test' } as AiWorkerEnv;
const keyId = '00000000-0000-4000-8000-000000000003';
const success = () => ({ title: 'Guía', sections: GUIDE_SECTIONS.map((section) => ({ id: section.id, content: 'Texto con sustento.', citations: [scenario === 'invalid-cite' ? 'inventada' : preparation.fragments[0]!.id] })) });
const db: AiDatabase = {
  async user<T>(_token: string, procedure: string, raw: unknown) {
    const payload = raw as Record<string, unknown>;
    if (procedure === 'ai_status') return { actor, enabled: true, configured: true, consentVersion: AI_CONSENT_VERSION, consented: true, limits: AI_LIMITS, model: '' } as T;
    if (procedure !== 'guide_ai') throw new Error('Unexpected procedure');
    if (!access) throw new AiApiError(403, 'unauthorized', 'Material sin acceso.');
    if (payload.action === 'authorizeStep') {
      if (payload.confirmed !== true) throw new Error('Confirmation missing');
      if (!claimed) { draft.steps[0]!.generationId = String(payload.generationId); draft.revision++; }
      return { actor, draft } as T;
    }
    if (payload.action === 'getDraft') return draft as T;
    if (payload.action === 'listDrafts') return [{ id: draft.id, title: draft.title, state: draft.state }] as T;
    if (payload.action === 'prepare') { expect(payload.model).toBe(preparation.model); return draft as T; }
    throw new Error('Unexpected action');
  },
  async service<T>(procedure: string, raw: unknown) {
    expect(procedure).toBe('guide_ai'); const payload = raw as Record<string, unknown>;
    if (payload.action === 'claimStep') {
      if (claimed) return { claimed: false, actor, draft } as T;
      claimed = true; draft.state = 'running'; draft.steps[0]!.state = 'running';
      const encrypted = await encryptAiKey(env, { actor, provider: 'gemini', keyId }, 'fixture-no-real-api-key');
      return { claimed: true, actor, draft, step: draft.steps[0], fragments: preparation.fragments, key: { ...encrypted, keyId, provider: 'gemini' } } as T;
    }
    if (payload.action === 'finishStep') {
      finishes++; if (finishFailure) throw new Error('Lost confirmation');
      draft.state = payload.state === 'succeeded' ? 'ready' : payload.state as 'failed' | 'unknown'; draft.steps[0]!.state = payload.state as 'succeeded' | 'failed' | 'unknown';
      if (payload.result) draft.result = payload.result as GuideAiDraft['result']; return draft as T;
    }
    throw new Error('Unexpected service action');
  },
};
const app = () => createWorkerApp({ auth: { ...auth, isActiveMember: async () => active }, aiDatabase: () => db, guideProvider: { async generate(input) {
  calls++; expect(input.apiKey).toBe('fixture-no-real-api-key'); expect(input.preparation.input.maxOutputTokens).toBe(1500);
  if (scenario === 'timeout') throw new DOMException('private provider text', 'TimeoutError');
  return { text: scenario === 'invalid-json' ? 'NOT JSON' : JSON.stringify(success()) };
} } });
const request = (body: unknown) => new Request(`https://worker.test/ai/study-guides/${draftId}/step`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const payload = () => ({ expectedRevision: draft.revision, generationId, fingerprint: preparation.fingerprint, confirmed: true });
beforeAll(async () => {
  const keys = await generateKeyPair('RS256'); const jwk = await exportJWK(keys.publicKey);
  auth = { issuer: 'https://issuer.test', audiences: ['test'], jwks: createLocalJWKSet({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] }), isActiveMember: async () => true };
  token = await new SignJWT({ email: 'student@example.test', email_verified: true }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('user').setIssuer(auth.issuer).setAudience('test').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../guideWorker.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0]!.text,
    compatibilityDate: '2026-10-21', compatibilityFlags: ['nodejs_compat'],
    bindings: { ...env, OIDC_ISSUER: auth.issuer, OIDC_AUDIENCE: 'test', OIDC_JWKS_URI: `${auth.issuer}/jwks`, SPACETIMEDB_URI: 'https://db.test', SPACETIMEDB_MODULE: 'local-test' },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.href === `${auth.issuer}/jwks`) return MfResponse.json({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] });
      if (url.hostname === 'generativelanguage.googleapis.com') {
        calls++; const body = await request.text(); expect(body).toContain('Material académico compartido.'); expect(body).not.toContain('fixture-no-real-api-key');
        expect(request.headers.get('x-goog-api-key')).toBe('fixture-no-real-api-key');
        return MfResponse.json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(success()) }] }, finishReason: 'STOP' }] });
      }
      if (url.hostname !== 'db.test') throw new Error('Unexpected outbound host');
      if (url.pathname.endsWith('/assert_active_member')) return new MfResponse('', { status: 200 });
      const procedure = url.pathname.split('/').at(-1)!;
      const raw = JSON.parse(JSON.parse(await request.text())[0]) as Record<string, unknown>;
      const service = ['claimStep', 'finishStep'].includes(String(raw.action));
      expect(request.headers.get('Authorization')).toBe(`Bearer ${service ? env.AI_SERVICE_TOKEN : token}`);
      const value = service ? await db.service(procedure, raw) : await db.user(token, procedure, raw);
      return MfResponse.json(JSON.stringify(value));
    },
  }));
});
afterAll(async () => { await runtime?.dispose(); });
beforeEach(() => { calls = 0; finishes = 0; claimed = false; access = true; active = true; finishFailure = false; scenario = 'valid'; draft = { id: draftId, revision: 1, title: 'Guía', subjectId: '1', state: 'prepared', createdAt: Date.now(), updatedAt: Date.now(), completedSteps: 0, totalSteps: 1, preparation, steps: [{ id: 'direct', kind: 'direct', state: 'pending' }] }; });
describe('API autenticada Guías con Gemini simulado', () => {
  it('runtime Cloudflare completo funciona sin R2 y confirma un único envío persistente', async () => {
    const body = payload();
    const options = { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    let response = await runtime.dispatchFetch(`https://worker.test/ai/study-guides/${draftId}/step`, options);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store'); expect(await response.json()).toMatchObject({ state: 'ready' });
    response = await runtime.dispatchFetch(`https://worker.test/ai/study-guides/${draftId}/step`, options); expect(response.status).toBe(200); expect(calls).toBe(1);
    expect(await (await runtime.dispatchFetch('https://worker.test/health')).json()).toMatchObject({ ok: true, files: 'unconfigured' });
  }, 20_000);
  it('un UUID repetido realiza una sola llamada y devuelve el resultado privado', async () => {
    const worker = app(); const body = payload(); const first = await worker.fetch(request(body), env); expect(first.status).toBe(200); expect(first.headers.get('cache-control')).toContain('no-store');
    expect(await first.json()).toMatchObject({ state: 'ready' }); const second = await worker.fetch(request(body), env); expect(second.status).toBe(200); expect(calls).toBe(1); expect(finishes).toBe(1);
  });
  it.each(['invalid-json','invalid-cite','timeout'] as const)('%s se conserva sin repetir automáticamente el proveedor', async (value) => {
    scenario = value; const worker = app(); const body = payload(); const response = await worker.fetch(request(body), env);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ state: value === 'timeout' ? 'unknown' : 'failed' });
    await worker.fetch(request(body), env); expect(calls).toBe(1);
  });
  it('una confirmación perdida conserva la operación en curso, sin segundo envío', async () => { finishFailure = true; const worker = app(); const body = payload(); await worker.fetch(request(body), env); await worker.fetch(request(body), env); expect(calls).toBe(1); expect(draft.state).toBe('running'); });
  it('no envía sin confirmación, sesión, membresía ni acceso vigente', async () => {
    let response = await app().fetch(request({ ...payload(), confirmed: false }), env); expect(response.status).toBe(400); expect(calls).toBe(0);
    active = false; response = await app().fetch(request(payload()), env); expect(response.status).toBe(403); active = true;
    access = false; response = await app().fetch(request(payload()), env); expect(response.status).toBe(403); expect(calls).toBe(0);
    const noToken = request(payload()); noToken.headers.delete('Authorization'); response = await app().fetch(noToken, env); expect(response.status).toBe(401);
  });
  it('preparar no llama al proveedor y mantiene el propósito separado de preguntas', async () => { const req = new Request('https://worker.test/ai/study-guides/prepare', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: draftId, input: preparation.input }) }); const response = await app().fetch(req, env); expect(response.status).toBe(201); expect(calls).toBe(0); });
});
