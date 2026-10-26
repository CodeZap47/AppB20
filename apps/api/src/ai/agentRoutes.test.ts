import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AI_CONSENT_VERSION, AI_LIMITS } from '@b20/core';
import { createWorkerApp } from '../workerApp.ts';
import { AiApiError, type AiDatabase, type AiWorkerEnv } from './database.ts';
import { encryptAiKey } from './crypto.ts';
import type { AuthOptions } from '../lib/auth.ts';

const actor = 'b'.repeat(64); const generationId = '20000000-0000-4000-8000-000000000001'; const keyId = '20000000-0000-4000-8000-000000000009';
const env = { AI_ENABLED: 'true', AGENT_AI_STEPS: 'review', GEMINI_MODEL: 'gemini-test', AI_SERVICE_TOKEN: 'technical-ai-only', AI_MASTER_VERSION: 'v1',
  AI_MASTER_KEYS_JSON: JSON.stringify({ v1: btoa('m'.repeat(32)) }), CORS_ORIGINS: 'https://app.example.test' } as AiWorkerEnv;
const payload = { purpose: 'agent', step: 'review', owner: 'Luis', bot: 'Luis_BOT', draft: 'El ciclo ciclo termina.' };
let token: string; let auth: AuthOptions; let calls = 0; let state = 'none'; let lastAuthorize: Record<string, unknown> = {}; let finishFailure = false;
let output = JSON.stringify({ suggestions: [{ reason: 'Se repite', original: 'ciclo ciclo', replacement: 'ciclo' }] });
const run = () => ({ id: generationId, step: 'review', state });
const db: AiDatabase = {
  async user<T>(_token: string, procedure: string, raw: unknown) {
    const input = raw as Record<string, unknown>;
    if (procedure === 'ai_status') return { actor, enabled: true, configured: true, consentVersion: AI_CONSENT_VERSION, consented: true, limits: AI_LIMITS, model: '' } as T;
    expect(procedure).toBe('agent_ai');
    if (input.action === 'preview') return { step: input.step, payload, systemInstruction: 'Soy Luis_BOT', estimatedTokens: 3000 } as T;
    if (input.action === 'authorize') {
      lastAuthorize = input;
      if (input.confirmed !== true) throw new AiApiError(409, 'consent', 'Confirma.');
      if (state === 'none') state = input.allowNew ? 'pending' : 'none';
      if (state === 'none') throw new AiApiError(503, 'disabled', 'Este paso del agente todavía no está habilitado.');
      return { actor, run: run() } as T;
    }
    if (input.action === 'get' || input.action === 'list') return (input.action === 'get' ? run() : [run()]) as T;
    throw new Error('Unexpected action');
  },
  async service<T>(procedure: string, raw: unknown) {
    expect(procedure).toBe('agent_ai'); const input = raw as Record<string, unknown>;
    if (input.action === 'claim') {
      if (state !== 'pending') return { claimed: false, run: run() } as T;
      state = 'running'; const encrypted = await encryptAiKey(env, { actor, provider: 'gemini', keyId }, 'fixture-no-real-api-key');
      return { claimed: true, run: run(), model: 'gemini-test', payload, systemInstruction: 'Soy Luis_BOT', key: { ...encrypted, keyId, provider: 'gemini' } } as T;
    }
    if (input.action === 'finish') { if (finishFailure) throw new Error('Lost confirmation'); state = String(input.state); return { ...run(), result: input.result, error: input.errorCode } as T; }
    throw new Error('Unexpected service action');
  },
};
const app = (worker = env) => createWorkerApp({ auth, aiDatabase: () => db, agentProvider: { async generate(input) {
  calls++; expect(input.apiKey).toBe('fixture-no-real-api-key'); expect(input.systemInstruction).toBe('Soy Luis_BOT'); expect(input.payload).toEqual(payload);
  if (output === 'timeout') throw new DOMException('private provider text', 'TimeoutError');
  return { text: output };
} } }).fetch(new Request('https://worker.test/ai/agent/step', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ step: 'review', sessionId: '7', generationId, confirmed: true, expectedTokens: 3000 }) }), worker);
const get = (path: string) => createWorkerApp({ auth, aiDatabase: () => db }).fetch(new Request(`https://worker.test/ai/agent${path}`, { headers: { Authorization: `Bearer ${token}` } }), env);

beforeAll(async () => {
  const keys = await generateKeyPair('RS256'); const jwk = await exportJWK(keys.publicKey);
  auth = { issuer: 'https://issuer.test', audiences: ['test'], jwks: createLocalJWKSet({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] }), isActiveMember: async () => true };
  token = await new SignJWT({ email: 'student@example.test', email_verified: true }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('user').setIssuer(auth.issuer).setAudience('test').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
});
beforeEach(() => { calls = 0; state = 'none'; finishFailure = false; lastAuthorize = {}; output = JSON.stringify({ suggestions: [{ reason: 'Se repite', original: 'ciclo ciclo', replacement: 'ciclo' }] }); });

describe('API del agente con Gemini simulado', () => {
  it('informa qué pasos están habilitados y la vista previa no llama al proveedor', async () => {
    expect(await (await get('/status')).json()).toEqual({ steps: [{ step: 'style', enabled: false }, { step: 'plan', enabled: false }, { step: 'review', enabled: true }, { step: 'originality', enabled: false }] });
    const preview = await createWorkerApp({ auth, aiDatabase: () => db }).fetch(new Request('https://worker.test/ai/agent/preview', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'review', sessionId: '7' }) }), env);
    expect(await preview.json()).toMatchObject({ estimatedTokens: 3000, payload: { bot: 'Luis_BOT' } }); expect(calls).toBe(0);
  });
  it('un UUID repetido hace una sola llamada y entrega el resultado a SpacetimeDB', async () => {
    const first = await app(); expect(first.status).toBe(200); expect(first.headers.get('cache-control')).toContain('no-store');
    expect(await first.json()).toMatchObject({ state: 'succeeded', result: { suggestions: [{ original: 'ciclo ciclo' }] } });
    expect(lastAuthorize).toMatchObject({ allowNew: true, model: 'gemini-test', expectedTokens: 3000, sessionId: '7' });
    await app(); expect(calls).toBe(1);
  });
  it('un paso apagado no autoriza envíos nuevos', async () => {
    const response = await app({ ...env, AGENT_AI_STEPS: 'style,plan' }); expect(response.status).toBe(503); expect(lastAuthorize.allowNew).toBe(false); expect(calls).toBe(0);
    expect((await app({ ...env, AGENT_AI_STEPS: '' })).status).toBe(503);
  });
  it('JSON inválido falla y el tiempo agotado queda incierto, sin repetir el proveedor', async () => {
    output = 'NOT JSON'; expect(await (await app()).json()).toMatchObject({ state: 'failed' }); await app(); expect(calls).toBe(1);
    state = 'none'; output = 'timeout'; expect(await (await app()).json()).toMatchObject({ state: 'unknown' }); expect(calls).toBe(2);
  });
  it('una confirmación perdida conserva el envío en curso y no vuelve a llamar', async () => {
    finishFailure = true; expect(await (await app()).json()).toMatchObject({ state: 'running' }); await app(); expect(calls).toBe(1);
  });
  it('rechaza pasos desconocidos y envíos sin confirmar', async () => {
    const send = (body: unknown) => createWorkerApp({ auth, aiDatabase: () => db }).fetch(new Request('https://worker.test/ai/agent/step', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
    expect((await send({ step: 'publicar', generationId, confirmed: true })).status).toBe(400);
    expect((await send({ step: 'review', generationId, confirmed: false })).status).toBe(400);
    expect((await send({ step: 'review', generationId: 'x', confirmed: true })).status).toBe(400);
    expect(calls).toBe(0);
  });
});
