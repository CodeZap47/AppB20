import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Hono } from 'hono';
import { type PresentationAiDraft, type PresentationAudio, PRESENTATION_AUDIO_LIMITS } from '@b20/core';
import type { PresentationProviderInput } from './presentationProvider.ts';
import { mediaRecorderWebm } from './webmAudioFixture.ts';
import { presentationRoutes } from './presentationRoutes.ts';
import { AiApiError, type AiDatabase, type AiEncryptedKey, type AiWorkerEnv } from './database.ts';
import type { AiRouteContext } from './routes.ts';
import { encryptAiKey } from './crypto.ts';
const id = '20000000-0000-4000-8000-000000000001'; const generationId = '20000000-0000-4000-8000-000000000002'; const actor = 'a'.repeat(64);
const env = { AI_ENABLED: 'true', GEMINI_MODEL: 'gemini-test', AI_SERVICE_TOKEN: 'test-service', AI_MASTER_VERSION: 'v1', AI_MASTER_KEYS_JSON: JSON.stringify({ v1: btoa('m'.repeat(32)) }) } as AiWorkerEnv;
function wav(seconds = 1, sampleRate = 8000): Uint8Array {
  const data = new Uint8Array(44 + seconds * sampleRate * 2); const view = new DataView(data.buffer); const text = (at: number, value: string) => { for (let index = 0; index < value.length; index++) data[at + index] = value.charCodeAt(index); };
  text(0, 'RIFF'); view.setUint32(4, data.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, data.length - 44, true); return data;
}
async function hash(value: Uint8Array) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value as Uint8Array<ArrayBuffer>)), (byte) => byte.toString(16).padStart(2, '0')).join(''); }
let bytes: Uint8Array; let metadata: PresentationAudio; let draft: PresentationAiDraft; let encrypted: AiEncryptedKey; let claimed: boolean; let loseFinish: boolean; let validated: unknown[]; let provider: Mock<(input: PresentationProviderInput) => Promise<{ text: string }>>;
const db: AiDatabase = {
  async user<T>(_token: string, procedure: string, payload: unknown) {
    const raw = payload as Record<string, unknown>;
    if (procedure === 'ai_status') return { enabled: true } as T;
    if (procedure === 'presentation_media') {
      if (raw.action === 'get' || raw.action === 'validateInfo') return metadata as T;
      if (raw.action === 'chunk' || raw.action === 'validationChunk') { const index = Number(raw.index); const chunk = bytes.subarray(index * PRESENTATION_AUDIO_LIMITS.chunkBytes, (index + 1) * PRESENTATION_AUDIO_LIMITS.chunkBytes); return { bytes: Array.from(chunk), sha256: await hash(chunk) } as T; }
    }
    if (procedure === 'presentation_ai') {
      if (raw.action === 'authorize') return { actor, draft } as T;
      if (raw.action === 'get') return draft as T;
    }
    throw new Error(`Unexpected ${procedure}:${raw.action}`);
  },
  async service<T>(procedure: string, payload: unknown) {
    const raw = payload as Record<string, unknown>;
    if (procedure === 'presentation_media' && raw.action === 'serviceValidate') { validated.push(raw); metadata.state = 'ready'; return metadata as T; }
    if (procedure === 'presentation_ai' && raw.action === 'claim') {
      if (claimed) return { claimed: false, draft } as T; claimed = true; draft.state = 'running'; return { claimed: true, draft, key: encrypted } as T;
    }
    if (procedure === 'presentation_ai' && raw.action === 'finish') { if (loseFinish) throw new Error('Lost confirmation'); draft = { ...draft, state: raw.state as PresentationAiDraft['state'], result: raw.result as PresentationAiDraft['result'] }; return draft as T; }
    throw new Error('Unexpected service call');
  },
};
function app() {
  const app = new Hono<AiRouteContext>(); app.use('*', async (c, next) => { c.set('ai', db); c.set('sessionToken', 'user'); await next(); });
  app.route('/', presentationRoutes({ provider: { generate: async (input) => provider(input) } }));
  app.onError((error, c) => c.json({ code: error instanceof AiApiError ? error.code : 'invalid' }, error instanceof AiApiError ? error.status : 400)); return app;
}
const confirm = () => app().request(`/audio/${id}/confirm`, { method: 'POST' }, env);
beforeEach(async () => {
  bytes = wav(); metadata = { id, attemptId: '1', name: 'fake.pdf', mime: 'audio/webm', bytes: bytes.length, sha256: await hash(bytes), state: 'pending', received: [0], chunkCount: 1, shared: false };
  validated = []; claimed = false; loseFinish = false; encrypted = { ...await encryptAiKey(env, { actor, provider: 'gemini', keyId: id }, 'fixture-key-not-real'), provider: 'gemini', keyId: id };
  draft = { id, actor, purpose: 'outline', state: 'prepared', revision: 1, context: { practiceId: '1', attemptId: '1', attemptVersion: 1, title: 'Tema', topic: 'Tema', audience: 'Clase', targetMinutes: 3, keyPoints: ['Idea'], body: '' }, fingerprint: 'a'.repeat(64), model: 'gemini-test', estimatedTokens: 100, createdAt: Date.now(), expiresAt: Date.now() + 60000 };
  provider = vi.fn(async () => ({ text: JSON.stringify({ outline: 'Introducción, ejemplo y conclusión.' }) }));
});
describe('Worker de Exposiciones: valida contenido y no reenvía resultados inciertos', () => {
  it('detecta WAV real sin confiar en nombre, tipo o duración declarados', async () => {
    expect((await confirm()).status).toBe(200); expect(validated).toHaveLength(1); expect(validated[0]).toMatchObject({ mime: 'audio/wav', durationSeconds: 1 });
  });
  it('confirma una grabación WebM/Opus sin Duration y aplica el límite a sus bloques reales', async () => {
    bytes = mediaRecorderWebm(); metadata.bytes = bytes.length; metadata.sha256 = await hash(bytes);
    expect((await confirm()).status).toBe(200); expect(validated[0]).toMatchObject({ mime: 'audio/webm', durationSeconds: 1 });
    validated = []; metadata.state = 'pending'; bytes = mediaRecorderWebm(1_200_980, { declaredDuration: 1000 }); metadata.bytes = bytes.length; metadata.sha256 = await hash(bytes);
    expect((await confirm()).status).toBe(400); expect(validated).toHaveLength(0);
  });
  it('rechaza video aunque el contenedor también tenga una pista de audio válida', async () => {
    bytes = mediaRecorderWebm(980, { videoTrack: true }); metadata.bytes = bytes.length; metadata.sha256 = await hash(bytes);
    expect((await confirm()).status).toBe(400); expect(validated).toHaveLength(0);
  });
  it('rechaza bytes arbitrarios renombrados como audio y huellas falsas', async () => {
    bytes = new TextEncoder().encode('Esto es un PDF falso'); metadata.bytes = bytes.length; metadata.sha256 = await hash(bytes);
    expect((await confirm()).status).toBe(400); expect(validated).toHaveLength(0);
    bytes = wav(); metadata.bytes = bytes.length; metadata.sha256 = 'b'.repeat(64); expect((await confirm()).status).toBe(409); expect(validated).toHaveLength(0);
  });
  it('rechaza duración real mayor a 20 minutos antes de confirmar', async () => {
    bytes = wav(1201, 1000); metadata.bytes = bytes.length; metadata.sha256 = await hash(bytes); metadata.chunkCount = Math.ceil(bytes.length / PRESENTATION_AUDIO_LIMITS.chunkBytes);
    expect((await confirm()).status).toBe(400); expect(validated).toHaveLength(0);
  });
  it('ante confirmación perdida el mismo UUID consulta sin una segunda llamada a Gemini', async () => {
    loseFinish = true; const input = { generationId, expectedRevision: 1, fingerprint: draft.fingerprint, confirmed: true };
    const request = () => app().request(`/drafts/${id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }, env);
    expect((await request()).status).toBe(200); expect((await request()).status).toBe(200); expect(provider).toHaveBeenCalledTimes(1);
  });
  it('trata JSON incompleto como fallo y nunca acepta ni recorta resultados', async () => {
    provider.mockResolvedValueOnce({ text: '{"outline":' });
    const response = await app().request(`/drafts/${id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ generationId, expectedRevision: 1, fingerprint: draft.fingerprint, confirmed: true }) }, env);
    expect(response.status).toBe(200); expect(draft.state).toBe('failed'); expect(draft.result).toBeUndefined();
  });
});
