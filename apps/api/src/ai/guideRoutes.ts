import { Hono } from 'hono';
import { AiError, aiUuid, validateGuideAiAssessment, validateGuideAiPrepareInput, validateGuideAiResult, validateGuideAiSummary,
  type AiStatus, type GuideAiClaim, type GuideAiDraft } from '@b20/core';
import { AiApiError } from './database.ts';
import { canEncrypt, decryptAiKey } from './crypto.ts';
import { readAiBody } from './body.ts';
import { AiProviderError, classifyProviderError } from './provider.ts';
import { createGuideProvider, type GuideProvider } from './guideProvider.ts';
import type { AiRouteContext } from './routes.ts';
const BODY_BYTES = 2 * 1024 * 1024;
function uuid(id: unknown) { if (!aiUuid(id)) throw new AiApiError(400, 'invalid', 'El identificador no es válido.'); return id.toLowerCase(); }
function model(value: string | undefined) { if (!value || !/^[\w.-]{1,200}$/.test(value)) throw new AiApiError(503, 'configuration', 'Configura el modelo de Gemini antes de preparar una guía.'); return value; }
export function guideAiRoutes(options: { provider?: GuideProvider } = {}) {
  const app = new Hono<AiRouteContext>();
  app.get('/', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_ai', { action: 'listDrafts' })));
  app.post('/manual', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_ai', { ...await readAiBody(c.req.raw, BODY_BYTES), action: 'createManualFromMaterials' }), 201));
  app.post('/prepare', async (c) => {
    const body = await readAiBody(c.req.raw, BODY_BYTES);
    return c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_ai', { action: 'prepare', id: uuid(body.id), input: validateGuideAiPrepareInput(body.input), model: model(c.env.GEMINI_MODEL?.trim()) }), 201);
  });
  app.post('/transcriptions', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_ai', { ...await readAiBody(c.req.raw, BODY_BYTES), action: 'saveTranscription' }), 201));
  app.get('/files/:fileId', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_ai', { action: 'fileInfo', fileId: c.req.param('fileId') })));
  app.get('/provenance/:guideId/:version', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_ai', { action: 'getProvenance', guideId: c.req.param('guideId'), version: Number(c.req.param('version')) })));
  app.get('/:id', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_ai', { action: 'getDraft', id: uuid(c.req.param('id')) })));
  app.put('/:id', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_ai', { ...await readAiBody(c.req.raw, BODY_BYTES), action: 'saveDraft', id: uuid(c.req.param('id')) })));
  app.post('/:id/reprepare', async (c) => {
    const body = await readAiBody(c.req.raw, BODY_BYTES);
    return c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_ai', { ...body, action: 'reprepareDraft', input: validateGuideAiPrepareInput(body.input), id: uuid(c.req.param('id')), model: model(c.env.GEMINI_MODEL?.trim()) }));
  });
  app.post('/:id/cancel', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_ai', { ...await readAiBody(c.req.raw, 4096), action: 'cancelDraft', id: uuid(c.req.param('id')) })));
  app.post('/:id/review-topics', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_ai', { ...await readAiBody(c.req.raw, 256 * 1024), action: 'reviewTopics', id: uuid(c.req.param('id')) })));
  app.post('/:id/publish', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_ai', { ...await readAiBody(c.req.raw, 4096), action: 'publish', id: uuid(c.req.param('id')) })));
  app.post('/:id/step', async (c) => {
    const body = await readAiBody(c.req.raw, 4096); const id = uuid(c.req.param('id')); const generationId = uuid(body.generationId);
    if (body.confirmed !== true) throw new AiApiError(400, 'consent', 'Revisa la vista previa y confirma el envío.');
    const db = c.get('ai'); const token = c.get('sessionToken'); const status = await db.user<AiStatus>(token, 'ai_status', {});
    const selected = c.env.GEMINI_MODEL?.trim();
    const allowNew = c.env.AI_ENABLED === 'true' && status.enabled && !!c.env.AI_SERVICE_TOKEN && !!selected && await canEncrypt(c.env);
    const authorized = await db.user<{ actor: string; draft: GuideAiDraft }>(token, 'guide_ai', { ...body, action: 'authorizeStep', id, generationId, model: selected ?? '', allowNew });
    // The UUID identifies one provider submission. Replays and disabled service cannot create another.
    if (!allowNew) return c.json(authorized.draft);
    const claim = await db.service<GuideAiClaim>('guide_ai', { action: 'claimStep', actor: authorized.actor, id, generationId });
    if (!claim.claimed) return c.json(claim.draft);
    if (!claim.key || !claim.step || !claim.fragments) throw new AiApiError(503, 'protocol', 'Consulta el estado del borrador antes de continuar.');
    let terminal: { state: 'succeeded' | 'failed' | 'unknown'; result?: unknown; errorCode?: string; errorMessage?: string; usage?: unknown };
    let apiKey: string | undefined;
    try { apiKey = await decryptAiKey(c.env, { actor: authorized.actor, provider: 'gemini', keyId: claim.key.keyId }, claim.key); }
    catch { terminal = { state: 'failed', errorCode: 'key_unavailable', errorMessage: 'Vuelve a configurar tu clave personal en Ajustes.' }; }
    if (apiKey !== undefined) {
      try {
        const output = await (options.provider ?? createGuideProvider()).generate({ apiKey, model: model(selected), preparation: claim.draft.preparation, step: claim.step, fragments: claim.fragments, summaries: claim.summaries ?? [] });
        apiKey = undefined;
        if (new TextEncoder().encode(output.text).byteLength > 256 * 1024) throw new AiProviderError('invalid_output', false, 'La respuesta superó el límite.');
        let result: unknown;
        try { result = JSON.parse(output.text); } catch { throw new AiProviderError('invalid_output', false, 'Gemini devolvió un resultado inválido.'); }
        result = claim.step.kind === 'assessment' ? validateGuideAiAssessment(result, { ...claim.draft.preparation, fragments: claim.fragments }) : claim.step.kind === 'summary' ? validateGuideAiSummary(result, claim.fragments, Math.min(8000, Math.floor(32000 / Math.max(1, claim.draft.preparation.batches.length)))) : validateGuideAiResult(result,
          { ...claim.draft.preparation, fragments: claim.fragments });
        terminal = { state: 'succeeded', result, usage: output.usage };
      } catch (error) {
        const failure = error instanceof AiError ? new AiProviderError('invalid_output', false, error.message) : classifyProviderError(error);
        terminal = { state: failure.uncertain ? 'unknown' : 'failed', errorCode: failure.code, errorMessage: failure.message };
      } finally { apiKey = undefined; }
    }
    try { await db.service('guide_ai', { action: 'finishStep', actor: authorized.actor, id, generationId, ...terminal! }); }
    catch { /* A lost confirmation never triggers another provider call. */ }
    return c.json(await db.user(token, 'guide_ai', { action: 'getDraft', id }));
  });
  return app;
}
