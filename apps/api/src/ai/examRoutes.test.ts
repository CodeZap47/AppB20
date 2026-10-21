import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, Response as MfResponse, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createWorkerApp } from '../workerApp.ts';
import { AiApiError, type AiDatabase, type AiWorkerEnv } from './database.ts';
import type { AuthOptions } from '../lib/auth.ts';

let token: string;
let auth: AuthOptions;
let runtime: Miniflare;
let active = true;
let calls: { token: string; procedure: string; body: unknown }[] = [];
const env = { AI_ENABLED: 'false', CORS_ORIGINS: 'https://app.example.test' } as AiWorkerEnv;
const safeAttempt = { id: 'attempt', state: 'active', mode: 'simulation', questions: [
  { id: 'q1', text: 'Una pregunta', options: [{ id: 'a', text: 'Una opción' }] },
] };
const db: AiDatabase = {
  async user<T>(sessionToken: string, procedure: string, body: unknown) {
    calls.push({ token: sessionToken, procedure, body });
    return safeAttempt as T;
  },
  async service<T>(): Promise<T> { throw new Error('Saved exams must not use the service credential'); },
};
const request = (body: unknown, credential: string | undefined = token) => new Request('https://worker.test/ai/exams', {
  method: 'POST', headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
beforeAll(async () => {
  const keys = await generateKeyPair('RS256'); const jwk = await exportJWK(keys.publicKey);
  auth = { issuer: 'https://issuer.test', audiences: ['exams'], jwks: createLocalJWKSet({ keys: [{ ...jwk, kid: 'exams', alg: 'RS256' }] }), isActiveMember: async () => active };
  token = await new SignJWT({ email: 'student@example.test', email_verified: true }).setProtectedHeader({ alg: 'RS256', kid: 'exams' })
    .setSubject('exam-student').setIssuer(auth.issuer).setAudience('exams').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../guideWorker.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0]!.text,
    compatibilityDate: '2026-10-21', compatibilityFlags: ['nodejs_compat'],
    bindings: { ...env, OIDC_ISSUER: auth.issuer, OIDC_AUDIENCE: 'exams', OIDC_JWKS_URI: `${auth.issuer}/jwks`, SPACETIMEDB_URI: 'https://db.test', SPACETIMEDB_MODULE: 'exams-test' },
    outboundService: async (incoming) => {
      const url = new URL(incoming.url);
      if (url.href === `${auth.issuer}/jwks`) return MfResponse.json({ keys: [{ ...jwk, kid: 'exams', alg: 'RS256' }] });
      if (url.hostname !== 'db.test') throw new Error('Saved exams cannot contact Gemini or another service');
      expect(incoming.headers.get('Authorization')).toBe(`Bearer ${token}`);
      if (url.pathname.endsWith('/assert_active_member')) return new MfResponse('', { status: 200 });
      expect(url.pathname).toBe('/v1/database/exams-test/call/exam_action');
      const payload = JSON.parse(JSON.parse(await incoming.text())[0]);
      return MfResponse.json(JSON.stringify(await db.user(token, 'exam_action', payload)));
    },
  }));
});
afterAll(async () => { await runtime?.dispose(); });
beforeEach(() => { active = true; calls = []; });

describe('Exámenes guardados en el Worker compartido', () => {
  it('funcionan en runtime Cloudflare sin clave, secretos de IA, R2 ni Gemini habilitado', async () => {
    const response = await runtime.dispatchFetch('https://worker.test/ai/exams', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'https://app.example.test' },
      body: JSON.stringify({ action: 'getAttempt', attemptId: 'attempt' }),
    });
    expect(response.status).toBe(200); expect(await response.json()).toEqual(safeAttempt);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.test');
    expect(calls).toEqual([{ token, procedure: 'exam_action', body: { action: 'getAttempt', attemptId: 'attempt' } }]);
  }, 20_000);

  it('rechaza sesión ausente y baja antes de consultar preguntas o soluciones', async () => {
    const app = createWorkerApp({ auth, aiDatabase: () => db });
    expect((await app.fetch(request({ action: 'listExams' }, ''), env)).status).toBe(401);
    active = false;
    expect((await app.fetch(request({ action: 'getAttempt', attemptId: 'attempt' }), env)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it.each([{ action: 'claimGeneration' }, { action: 'finishGeneration' }, { action: 'getExam', actor: 'another-person' }, { action: 'listAttempts', ownerId: 'another-person' }])(
    'rechaza operaciones técnicas e identidades declaradas por el navegador: %j', async (body) => {
      expect((await createWorkerApp({ auth, aiDatabase: () => db }).fetch(request(body), env)).status).toBe(400);
      expect(calls).toHaveLength(0);
    });

  it('limita el cuerpo de edición antes de enviarlo al servidor', async () => {
    const response = await createWorkerApp({ auth, aiDatabase: () => db }).fetch(request({ action: 'saveDraft', questions: '界'.repeat(710_000) }), env);
    expect(response.status).toBe(413); expect(calls).toHaveLength(0);
  });

  it('conserva un conflicto sin convertirlo en un reintento ni mostrar datos privados', async () => {
    const unavailable: AiDatabase = { ...db, async user() { throw new AiApiError(409, 'conflict', 'La versión cambió.'); } };
    const response = await createWorkerApp({ auth, aiDatabase: () => unavailable }).fetch(request({ action: 'saveAnswer', attemptId: 'attempt', expectedRevision: 1 }), env);
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'conflict' });
  });
});
