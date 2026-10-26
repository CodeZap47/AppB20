import { Hono } from 'hono';
import { aiUuid, validateExamEvaluationResult, type AiStatus, type ExamEvaluationDraft } from '@b20/core';
import { AiApiError, type AiEncryptedKey } from './database.ts';
import { canEncrypt, decryptAiKey } from './crypto.ts';
import { readAiBody } from './body.ts';
import { AiProviderError, classifyProviderError } from './provider.ts';
import { createExamEvaluationProvider, type ExamEvaluationProvider } from './examEvaluationProvider.ts';
import type { AiRouteContext } from './routes.ts';
function id(value: unknown) { if (!aiUuid(value)) throw new AiApiError(400, 'invalid', 'El identificador no es válido.'); return value.toLowerCase(); }
function model(value?: string) { if (!value || !/^[\w.-]{1,200}$/.test(value)) throw new AiApiError(503, 'configuration', 'Configura el modelo de Gemini.'); return value; }
export function examEvaluationRoutes(options: { provider?: ExamEvaluationProvider } = {}) {
  const app = new Hono<AiRouteContext>();
  app.get('/', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'exam_evaluation_ai', { action: 'list', attemptId: id(c.req.query('attemptId')) })));
  app.post('/prepare', async (c) => { const body = await readAiBody(c.req.raw, 4096); return c.json(await c.get('ai').user(c.get('sessionToken'), 'exam_evaluation_ai', { action: 'prepare', id: id(body.id), attemptId: id(body.attemptId), questionId: body.questionId, model: model(c.env.GEMINI_MODEL?.trim()) }), 201); });
  app.get('/:id', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'exam_evaluation_ai', { action: 'get', id: id(c.req.param('id')) })));
  app.post('/:id/cancel', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'exam_evaluation_ai', { action: 'cancel', id: id(c.req.param('id')) })));
  app.post('/:id/accept', async (c) => { const body = await readAiBody(c.req.raw, 128 * 1024); return c.json(await c.get('ai').user(c.get('sessionToken'), 'exam_evaluation_ai', { action: 'accept', id: id(c.req.param('id')), requestId: id(body.requestId), expectedRevision: body.expectedRevision, criteria: body.criteria, feedback: body.feedback })); });
  app.post('/:id/generate', async (c) => {
    const body = await readAiBody(c.req.raw, 4096); const draftId = id(c.req.param('id')); const generationId = id(body.generationId); if (body.confirmed !== true) throw new AiApiError(400, 'consent', 'Confirma texto, rúbrica y consumo antes del envío.');
    const db = c.get('ai'); const token = c.get('sessionToken'); const status = await db.user<AiStatus>(token, 'ai_status', {}); const selected = c.env.GEMINI_MODEL?.trim(); const allowNew = c.env.AI_ENABLED === 'true' && status.enabled && !!c.env.AI_SERVICE_TOKEN && !!selected && await canEncrypt(c.env);
    const authorization = await db.user<{ actor: string; draft: ExamEvaluationDraft }>(token, 'exam_evaluation_ai', { action: 'authorize', id: draftId, generationId, confirmed: true, fingerprint: body.fingerprint, model: selected ?? '', allowNew }); if (!allowNew) return c.json(authorization.draft);
    const claim = await db.service<{ claimed: boolean; draft: ExamEvaluationDraft; key?: AiEncryptedKey }>('exam_evaluation_ai', { action: 'claim', actor: authorization.actor, id: draftId, generationId, acknowledgeUnknown: body.acknowledgeUnknown === true }); if (!claim.claimed) return c.json(claim.draft); if (!claim.key) throw new AiApiError(503, 'protocol', 'Consulta el estado guardado.');
    let terminal: { state: 'succeeded' | 'failed' | 'unknown'; result?: unknown; errorMessage?: string; usage?: unknown }; let apiKey: string | undefined;
    try { apiKey = await decryptAiKey(c.env, { actor: authorization.actor, provider: 'gemini', keyId: claim.key.keyId }, claim.key); }
    catch { terminal = { state: 'failed', errorMessage: 'Vuelve a configurar tu clave en Ajustes.' }; }
    if (apiKey !== undefined) try { const output = await (options.provider ?? createExamEvaluationProvider()).generate({ apiKey, model: model(selected), snapshot: claim.draft.snapshot }); apiKey = undefined; if (new TextEncoder().encode(output.text).length > 128 * 1024) throw new AiProviderError('invalid_output', false, 'La sugerencia superó el límite.'); let parsed: unknown; try { parsed = JSON.parse(output.text); } catch { throw new AiProviderError('invalid_output', false, 'La sugerencia no es válida.'); } let result: unknown; try { result = validateExamEvaluationResult(parsed, claim.draft.snapshot.question); } catch { throw new AiProviderError('invalid_output', false, 'La sugerencia no respeta los criterios de la rúbrica.'); } terminal = { state: 'succeeded', result, usage: output.usage }; }
    catch (error) { const failure = classifyProviderError(error); terminal = { state: failure.uncertain ? 'unknown' : 'failed', errorMessage: failure.message }; } finally { apiKey = undefined; }
    try { await db.service('exam_evaluation_ai', { action: 'finish', actor: authorization.actor, id: draftId, generationId, ...terminal! }); } catch { /* A lost confirmation is recovered through get; never resubmit. */ }
    return c.json(await db.user(token, 'exam_evaluation_ai', { action: 'get', id: draftId }));
  });
  return app;
}
