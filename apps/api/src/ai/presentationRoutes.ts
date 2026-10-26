import { Hono, type Context } from 'hono';
import { parseBuffer } from 'music-metadata';
import { aiUuid, PRESENTATION_AUDIO_LIMITS, presentationAudioMime, validatePresentationAudioDuration, validatePresentationAudioSize, validatePresentationAiResult,
  type PresentationAiDraft, type PresentationAudio, type AiStatus } from '@b20/core';
import { AiApiError, type AiEncryptedKey } from './database.ts';
import { canEncrypt, decryptAiKey } from './crypto.ts';
import { readAiBody } from './body.ts';
import { classifyProviderError, AiProviderError } from './provider.ts';
import type { AiRouteContext } from './routes.ts';
import { webmOpusDuration } from './webmAudioDuration.ts';
import { createPresentationProvider, type PresentationProvider } from './presentationProvider.ts';
function uuid(value: unknown): string { if (!aiUuid(value)) throw new AiApiError(400, 'invalid', 'Identificador inválido.'); return value.toLowerCase(); }
function model(value: unknown): string { if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,200}$/.test(value)) throw new AiApiError(503, 'configuration', 'Configura el modelo de Gemini.'); return value; }
async function digest(bytes: Uint8Array): Promise<string> { const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>); return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(''); }
/** Only bounded, authenticated chunks are assembled; URL, filename and client MIME never authorize media. */
async function readAudio(c: Context<AiRouteContext>, metadata: PresentationAudio, validation = false): Promise<Uint8Array> {
  validatePresentationAudioSize(metadata.bytes); if (metadata.chunkCount !== Math.ceil(metadata.bytes / PRESENTATION_AUDIO_LIMITS.chunkBytes)) throw new AiApiError(409, 'invalid', 'El número de bloques no coincide.');
  const bytes = new Uint8Array(metadata.bytes); let offset = 0;
  for (let index = 0; index < metadata.chunkCount; index++) {
    const chunk = await c.get('ai').user<{ bytes: number[]; sha256: string }>(c.get('sessionToken'), 'presentation_media', { action: validation ? 'validationChunk' : 'chunk', id: metadata.id, index });
    const expected = Math.min(PRESENTATION_AUDIO_LIMITS.chunkBytes, bytes.byteLength - offset);
    if (!Array.isArray(chunk.bytes) || chunk.bytes.length !== expected || chunk.bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) throw new AiApiError(409, 'invalid', 'Bloque inválido.');
    const value = Uint8Array.from(chunk.bytes); if (await digest(value) !== chunk.sha256) throw new AiApiError(409, 'invalid', 'Bloque corrupto.');
    bytes.set(value, offset); offset += value.length;
  }
  if (offset !== bytes.byteLength || await digest(bytes) !== metadata.sha256) throw new AiApiError(409, 'invalid', 'El audio no supera la comprobación de integridad.'); return bytes;
}
export function presentationRoutes(options: { provider?: PresentationProvider } = {}) {
  const app = new Hono<AiRouteContext>();
  app.get('/attempts/:attemptId/drafts', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'presentation_ai', { action: 'list', attemptId: c.req.param('attemptId') })));
  app.post('/prepare', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'presentation_ai', { ...await readAiBody(c.req.raw, 8192), action: 'prepare', model: model(c.env.GEMINI_MODEL?.trim()) }), 201));
  app.get('/drafts/:id', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'presentation_ai', { action: 'get', id: uuid(c.req.param('id')) })));
  for (const action of ['accept', 'cancel'] as const) app.post(`/drafts/:id/${action}`, async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'presentation_ai', { ...await readAiBody(c.req.raw, 256 * 1024), action, id: uuid(c.req.param('id')) })));
  app.post('/drafts/:id/generate', async (c) => {
    const body = await readAiBody(c.req.raw, 8192); const id = uuid(c.req.param('id')); const generationId = uuid(body.generationId);
    const db = c.get('ai'); const token = c.get('sessionToken'); const status = await db.user<AiStatus>(token, 'ai_status', {});
    const enabled = c.env.AI_ENABLED === 'true' && status.enabled && !!c.env.AI_SERVICE_TOKEN && !!c.env.GEMINI_MODEL && await canEncrypt(c.env);
    const authorized = await db.user<{ actor: string; draft: PresentationAiDraft }>(token, 'presentation_ai', { ...body, id, generationId, action: 'authorize', allowNew: enabled, model: c.env.GEMINI_MODEL?.trim() ?? '' });
    if (!enabled) return c.json(authorized.draft);
    const claim = await db.service<{ claimed: boolean; draft: PresentationAiDraft; key?: AiEncryptedKey }>('presentation_ai', { action: 'claim', actor: authorized.actor, id, generationId });
    if (!claim.claimed) return c.json(claim.draft);
    if (!claim.key) throw new AiApiError(503, 'protocol', 'Consulta el estado antes de continuar.');
    let terminal: { state: 'succeeded' | 'failed' | 'unknown'; result?: unknown; errorMessage?: string; usage?: unknown };
    let key: string | undefined;
    try {
      key = await decryptAiKey(c.env, { actor: authorized.actor, provider: 'gemini', keyId: claim.key.keyId }, claim.key);
      let audio: { mime: string; bytes: Uint8Array } | undefined;
      if (claim.draft.purpose === 'transcription' && claim.draft.context.audio) {
        const metadata = await db.user<PresentationAudio>(token, 'presentation_media', { action: 'get', id: claim.draft.context.audio.id });
        audio = { mime: metadata.mime, bytes: await readAudio(c, metadata) };
      }
      const output = await (options.provider ?? createPresentationProvider()).generate({ apiKey: key, draft: claim.draft, audio }); key = undefined;
      let parsed: unknown; try { parsed = JSON.parse(output.text); } catch { throw new AiProviderError('invalid_output', false, 'La respuesta de Gemini no es válida.'); }
      let result: ReturnType<typeof validatePresentationAiResult>; try { result = validatePresentationAiResult(parsed, claim.draft.purpose, claim.draft.context); } catch { throw new AiProviderError('invalid_output', false, 'La respuesta de Gemini no cumple el formato esperado.'); }
      terminal = { state: 'succeeded', result, usage: output.usage };
    } catch (error) { const failure = classifyProviderError(error); terminal = { state: failure.uncertain ? 'unknown' : 'failed', errorMessage: failure.message }; }
    finally { key = undefined; }
    try { await db.service('presentation_ai', { action: 'finish', actor: authorized.actor, id, generationId, ...terminal }); } catch { /* A missing confirmation never repeats the provider request. */ }
    return c.json(await db.user(token, 'presentation_ai', { action: 'get', id }));
  });
  app.get('/attempts/:attemptId/audio', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'presentation_media', { action: 'list', attemptId: c.req.param('attemptId') })));
  app.post('/audio', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'presentation_media', { ...await readAiBody(c.req.raw, 8192), action: 'begin' }), 201));
  app.get('/audio/:id', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'presentation_media', { action: 'get', id: uuid(c.req.param('id')) })));
  app.get('/audio/:id/chunks/:index', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'presentation_media', { action: 'chunk', id: uuid(c.req.param('id')), index: Number(c.req.param('index')) })));
  app.put('/audio/:id/chunks/:index', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'presentation_media', { ...await readAiBody(c.req.raw, 5 * 1024 * 1024), action: 'putChunk', id: uuid(c.req.param('id')), index: Number(c.req.param('index')) })));
  for (const action of ['share', 'delete', 'cancel'] as const) app.post(`/audio/:id/${action}`, async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'presentation_media', { ...await readAiBody(c.req.raw, 4096), action, id: uuid(c.req.param('id')) })));
  app.post('/audio/:id/confirm', async (c) => {
    const id = uuid(c.req.param('id')); const db = c.get('ai'); const token = c.get('sessionToken');
    const metadata = await db.user<PresentationAudio>(token, 'presentation_media', { action: 'validateInfo', id });
    if (metadata.state === 'ready') return c.json(metadata);
    const bytes = await readAudio(c, metadata, true); let parsed: Awaited<ReturnType<typeof parseBuffer>>;
    try { parsed = await parseBuffer(bytes, undefined, { duration: true, skipCovers: true }); } catch { throw new AiApiError(400, 'invalid', 'El contenedor del audio no es válido.'); }
    if (parsed.format.hasVideo || parsed.format.trackInfo.some((track) => track.type === 1 || track.video !== undefined)) throw new AiApiError(400, 'invalid', 'Sube un archivo que contenga únicamente audio.');
    const container = parsed.format.container?.toLowerCase() ?? ''; const codec = parsed.format.codec?.toLowerCase() ?? '';
    let mime: string;
    if (/webm|matroska/.test(container) && /opus|vorbis/.test(codec)) mime = 'audio/webm';
    else if (/mpeg-4|mp4|m4a|isom/.test(container) && /aac|alac|mpeg/.test(codec)) mime = 'audio/mp4';
    else if (/mpeg/.test(container) && /mpeg/.test(codec)) mime = 'audio/mpeg';
    else if (/ogg/.test(container) && /opus|vorbis|flac/.test(codec)) mime = 'audio/ogg';
    else if (/wave|wav/.test(container) && /pcm|float/.test(codec)) mime = 'audio/wav';
    else throw new AiApiError(400, 'invalid', 'Usa un contenedor y códec de audio compatibles.');
    if ((parsed.format.numberOfChannels ?? 0) < 1 || (parsed.format.numberOfChannels ?? 0) > 8) throw new AiApiError(400, 'invalid', 'El audio no contiene canales válidos.');
    const durationSeconds = mime === 'audio/webm' && /opus/.test(codec) ? webmOpusDuration(bytes) : parsed.format.duration ?? 0;
    validatePresentationAudioDuration(durationSeconds); presentationAudioMime(mime);
    return c.json(await db.service('presentation_media', { action: 'serviceValidate', id, sha256: metadata.sha256, mime, durationSeconds }));
  });
  return app;
}
