import { Hono } from 'hono';
import { AI_LIMITS, AiError, aiUuid, validateAiPrepareInput, validateAiGenerationConfig, validateAiQuestionDraft, validateAiStudyDraft,
  type AiStatus, type AiKeyStatus, type AiPreparation, type AiGeneration, type AiGenerationConfig } from '@b20/core';
import { AiApiError, type AiDatabase, type AiWorkerEnv, type AiAuthorizedKey, type AiEncryptedKey } from './database.ts';
import { canEncrypt, decryptAiKey, encryptAiKey } from './crypto.ts';
import { readAiBody } from './body.ts';
import { classifyProviderError, createGeminiProvider, AiProviderError, type AiProvider } from './provider.ts';

export type AiRouteContext = { Bindings: AiWorkerEnv; Variables: { sessionToken: string; ai: AiDatabase } };
export interface AiRouteOptions { provider?: AiProvider }
interface ClaimedGeneration { claimed: boolean; generation: AiGeneration; preparation?: AiPreparation; key?: AiEncryptedKey; config?: AiGenerationConfig }
function model(env: AiWorkerEnv): string {
  const selected = env.GEMINI_MODEL?.trim();
  if (!selected || selected.length > 200 || !/^[a-zA-Z0-9._-]+$/.test(selected)) throw new AiApiError(503, 'configuration', 'Configura el modelo de Gemini antes de preparar material.');
  return selected;
}
function configuredModel(env: AiWorkerEnv): string {
  try { return model(env); } catch { return ''; }
}
function uuid(value: unknown): string {
  if (!aiUuid(value)) throw new AiApiError(400, 'invalid', 'El identificador de la operación no es válido.');
  return value.toLowerCase();
}
async function effectiveStatus(db: AiDatabase, token: string, env: AiWorkerEnv): Promise<AiStatus & { serviceConfigured: boolean }> {
  const status = await db.user<AiStatus>(token, 'ai_status', {});
  const modelName = configuredModel(env);
  const configured = !!env.AI_SERVICE_TOKEN && !!modelName && await canEncrypt(env);
  const enabled = env.AI_ENABLED === 'true' && status.enabled && configured;
  return { actor: status.actor, configured: status.configured, consentVersion: status.consentVersion, consented: status.consented,
    enabled, serviceConfigured: configured, model: modelName, limits: { ...AI_LIMITS, ...status.limits },
    ...(!enabled ? { reason: env.AI_ENABLED !== 'true' ? 'La generación con IA permanece desactivada.'
      : !configured ? 'El servicio IA todavía no está configurado.' : 'El grupo todavía no tiene habilitada la generación con IA.' } : {}) };
}
export function aiWorkerRoutes(options: AiRouteOptions = {}) {
  const app = new Hono<AiRouteContext>();
  app.get('/status', async (c) => c.json(await effectiveStatus(c.get('ai'), c.get('sessionToken'), c.env)));
  app.get('/key', async (c) => {
    const status = await c.get('ai').user<AiKeyStatus>(c.get('sessionToken'), 'ai_key_status', {});
    // Deliberately project a public DTO even if a backend version accidentally adds fields.
    return c.json({ configured: status.configured, ...(status.configured ? {
      provider: status.provider, keyId: status.keyId, updatedAt: status.updatedAt,
    } : {}) });
  });
  app.put('/key', async (c) => {
    const body = await readAiBody(c.req.raw, 4096);
    if (typeof body.apiKey !== 'string' || body.apiKey.trim().length < 20 || body.apiKey.trim().length > 256 || /\s/.test(body.apiKey.trim())) {
      throw new AiApiError(400, 'invalid_key', 'La clave debe contener entre 20 y 256 caracteres sin espacios.');
    }
    if (!c.env.AI_SERVICE_TOKEN || !await canEncrypt(c.env)) throw new AiApiError(503, 'configuration', 'El almacenamiento cifrado todavía no está configurado.');
    const db = c.get('ai'); const token = c.get('sessionToken');
    const keyId = crypto.randomUUID(); const intentId = crypto.randomUUID();
    const authorized = await db.user<AiAuthorizedKey>(token, 'ai_authorize_key', { intentId, keyId, provider: 'gemini' });
    const encrypted = await encryptAiKey(c.env, { actor: authorized.actor, provider: 'gemini', keyId }, body.apiKey.trim());
    body.apiKey = undefined;
    try {
      await db.service('ai_commit_key', { actor: authorized.actor, intentId, keyId, provider: 'gemini', ...encrypted });
    } catch (error) {
      // A transport timeout may occur after commit. Never write a second key to recover it.
      const saved = await db.user<AiKeyStatus>(token, 'ai_key_status', {});
      if (saved.keyId !== keyId) throw error;
    }
    return c.json({ configured: true, provider: 'gemini', keyId });
  });
  app.delete('/key', async (c) => {
    await c.get('ai').user(c.get('sessionToken'), 'ai_delete_key', {});
    return c.json({ configured: false });
  });
  app.put('/consent', async (c) => {
    const body = await readAiBody(c.req.raw, 4096);
    if (typeof body.version !== 'string' || typeof body.accepted !== 'boolean') throw new AiApiError(400, 'invalid', 'El consentimiento no es válido.');
    return c.json(await c.get('ai').user(c.get('sessionToken'), 'ai_set_consent', { version: body.version, accepted: body.accepted }));
  });
  app.post('/preparations', async (c) => {
    const input = validateAiPrepareInput(await readAiBody(c.req.raw, AI_LIMITS.maxBodyBytes));
    const preparation = await c.get('ai').user<AiPreparation>(c.get('sessionToken'), 'ai_prepare', { ...input, id: crypto.randomUUID(), model: model(c.env) });
    return c.json(preparation, 201);
  });
  app.post('/generations', async (c) => {
    const body = await readAiBody(c.req.raw, AI_LIMITS.maxBodyBytes);
    const id = uuid(body.id); const preparationId = uuid(body.preparationId);
    const config = validateAiGenerationConfig(body.config);
    if (typeof body.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(body.fingerprint) || body.confirmed !== true) {
      throw new AiApiError(400, 'invalid', 'Revisa y confirma el material que se enviará a Gemini.');
    }
    const db = c.get('ai'); const token = c.get('sessionToken');
    const status = await effectiveStatus(db, token, c.env);
    const generation = await db.user<AiGeneration>(token, 'ai_authorize_generation', { id, preparationId, fingerprint: body.fingerprint, config,
      confirmed: true, acknowledgeUnknown: body.acknowledgeUnknown === true, allowNew: status.enabled,
      model: c.env.GEMINI_MODEL?.trim() ?? '' });
    // A replay remains readable after disabling IA or rotating/removing its configuration.
    // The procedure validates ownership, request identity and current source access first.
    if (!status.enabled || generation.state !== 'prepared') return c.json(generation);
    const claim = await db.service<ClaimedGeneration>('ai_claim_generation', { id, actor: status.actor });
    if (!claim.claimed) return c.json(claim.generation);
    if (!claim.key || !claim.preparation) throw new AiApiError(503, 'protocol', 'No se pudo confirmar la preparación. Consulta el estado de la operación.');
    let terminal: { state: 'succeeded' | 'failed' | 'unknown'; result?: unknown; errorCode?: string; errorMessage?: string; usage?: unknown };
    let apiKey: string | undefined;
    try {
      apiKey = await decryptAiKey(c.env, { actor: status.actor, provider: 'gemini', keyId: claim.key.keyId }, claim.key);
    } catch {
      terminal = { state: 'failed', errorCode: 'key_unavailable', errorMessage: 'No se pudo abrir la clave. Vuelve a configurarla.' };
    }
    if (apiKey !== undefined) {
      try {
        const result = await (options.provider ?? createGeminiProvider()).generate({ apiKey, model: model(c.env), preparation: claim.preparation, config });
        apiKey = undefined;
        if (new TextEncoder().encode(result.text).byteLength > 256 * 1024) throw new AiProviderError('invalid_output', false, 'La respuesta superó el límite permitido.');
        let parsed: unknown;
        try { parsed = JSON.parse(result.text); } catch { throw new AiProviderError('invalid_output', false, 'La IA devolvió una respuesta inválida.'); }
        const draft = config.purpose && config.purpose !== 'questions' ? validateAiStudyDraft(parsed, claim.preparation, config) : validateAiQuestionDraft(parsed, claim.preparation, config);
        if (JSON.stringify(draft).length > 128_000) throw new AiProviderError('invalid_output', false, 'El borrador superó el límite permitido.');
        terminal = { state: 'succeeded', result: draft, ...(result.usage ? { usage: result.usage } : {}) };
      } catch (error) {
        const failure = error instanceof AiError ? new AiProviderError('invalid_output', false, error.message) : classifyProviderError(error);
        terminal = { state: failure.uncertain ? 'unknown' : 'failed', errorCode: failure.code, errorMessage: failure.message };
      } finally { apiKey = undefined; }
    }
    try { await db.service('ai_finish_generation', { actor: status.actor, id, ...terminal! }); }
    catch { /* The claim persists. GET and repeated UUID must never resubmit to the provider. */ }
    // Source access is rechecked here, too, before returning the generated content.
    return c.json(await db.user<AiGeneration>(token, 'ai_get_generation', { id }));
  });
  app.get('/generations', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'ai_list_generations', {})));
  app.post('/generations/:id/publish', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'ai_publish_generation', { id: uuid(c.req.param('id')) })));
  app.get('/generations/:id', async (c) => c.json(await c.get('ai').user<AiGeneration>(c.get('sessionToken'), 'ai_get_generation', { id: uuid(c.req.param('id')) })));
  return app;
}

export function aiPublicError(error: Error): AiApiError | undefined {
  if (error instanceof AiApiError) return error;
  if (error instanceof AiError) return new AiApiError(error.code === 'quota' ? 413 : error.code === 'unauthorized' ? 403 : error.code === 'conflict' ? 409 : 400, error.code, error.message);
  return undefined;
}
