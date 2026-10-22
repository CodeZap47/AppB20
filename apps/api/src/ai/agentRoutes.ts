import { Hono } from 'hono';
import { AGENT_AI_STEPS, agentAiStep, aiUuid, enabledAgentAiSteps, type AgentAiPayload, type AgentAiStep, type AiStatus } from '@b20/core';
import { AiApiError } from './database.ts';
import { canEncrypt, decryptAiKey } from './crypto.ts';
import { readAiBody } from './body.ts';
import { AiProviderError, classifyProviderError } from './provider.ts';
import { createAgentProvider, type AgentProvider } from './agentProvider.ts';
import type { AiRouteContext } from './routes.ts';

/** Agente personal con Gemini (7.13, AG-4). Cada paso se habilita aparte con `AGENT_AI_STEPS`. */
const BODY_BYTES = 4096;
interface AgentRun { id: string; step: AgentAiStep; state: string }
interface AgentClaim { claimed: boolean; run: AgentRun; model?: string; payload?: AgentAiPayload; systemInstruction?: string;
  key?: { keyId: string; provider: 'gemini'; ciphertext: string; iv: string; masterVersion: string } }
function step(value: unknown): AgentAiStep { try { return agentAiStep(value); } catch { throw new AiApiError(400, 'invalid', 'El paso del agente no es válido.'); } }
function session(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[0-9]{1,20}$/.test(value)) throw new AiApiError(400, 'invalid', 'La sesión no es válida.');
  return value;
}
function uuid(value: unknown) { if (!aiUuid(value)) throw new AiApiError(400, 'invalid', 'El identificador no es válido.'); return value.toLowerCase(); }

export function agentAiRoutes(options: { provider?: AgentProvider } = {}) {
  const app = new Hono<AiRouteContext>();
  app.get('/status', (c) => {
    const enabled = enabledAgentAiSteps(c.env.AGENT_AI_STEPS);
    return c.json({ steps: AGENT_AI_STEPS.map((name) => ({ step: name, enabled: c.env.AI_ENABLED === 'true' && enabled.has(name) })) });
  });
  app.get('/runs', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'agent_ai', { action: 'list', sessionId: session(c.req.query('sessionId')) })));
  app.get('/runs/:id', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'agent_ai', { action: 'get', generationId: uuid(c.req.param('id')) })));
  // Preparar y revisar nunca llama a Gemini: muestra exactamente lo que se enviaría.
  app.post('/preview', async (c) => {
    const body = await readAiBody(c.req.raw, BODY_BYTES);
    return c.json(await c.get('ai').user(c.get('sessionToken'), 'agent_ai', { action: 'preview', step: step(body.step), sessionId: session(body.sessionId) }));
  });
  app.post('/step', async (c) => {
    const body = await readAiBody(c.req.raw, BODY_BYTES); const selected = step(body.step); const generationId = uuid(body.generationId);
    if (body.confirmed !== true) throw new AiApiError(400, 'consent', 'Revisa la vista previa y confirma el envío.');
    const db = c.get('ai'); const token = c.get('sessionToken'); const status = await db.user<AiStatus>(token, 'ai_status', {});
    const model = c.env.GEMINI_MODEL?.trim();
    const allowNew = c.env.AI_ENABLED === 'true' && enabledAgentAiSteps(c.env.AGENT_AI_STEPS).has(selected) && status.enabled
      && !!c.env.AI_SERVICE_TOKEN && !!model && /^[\w.-]{1,200}$/.test(model) && await canEncrypt(c.env);
    const authorized = await db.user<{ actor: string; run: AgentRun }>(token, 'agent_ai', { action: 'authorize', step: selected, sessionId: session(body.sessionId),
      generationId, confirmed: true, allowNew, model: model ?? '', acknowledgeUnknown: body.acknowledgeUnknown === true,
      ...(Number.isInteger(body.expectedTokens) ? { expectedTokens: body.expectedTokens } : {}) });
    // El UUID identifica un único envío. Repetirlo o tener el paso apagado nunca crea otro.
    if (!allowNew || authorized.run.state !== 'pending') return c.json(authorized.run);
    const claim = await db.service<AgentClaim>('agent_ai', { action: 'claim', actor: authorized.actor, generationId });
    if (!claim.claimed) return c.json(claim.run);
    if (!claim.key || !claim.payload || !claim.systemInstruction || !claim.model) throw new AiApiError(503, 'protocol', 'Consulta el estado del envío antes de continuar.');
    let terminal: { state: 'succeeded' | 'failed' | 'unknown'; result?: unknown; errorCode?: string; errorMessage?: string; usage?: unknown };
    let apiKey: string | undefined;
    try { apiKey = await decryptAiKey(c.env, { actor: authorized.actor, provider: 'gemini', keyId: claim.key.keyId }, claim.key); }
    catch { terminal = { state: 'failed', errorCode: 'key_unavailable', errorMessage: 'Vuelve a configurar tu clave personal en Ajustes.' }; }
    if (apiKey !== undefined) {
      try {
        const output = await (options.provider ?? createAgentProvider()).generate({ apiKey, model: claim.model, payload: claim.payload, systemInstruction: claim.systemInstruction });
        apiKey = undefined;
        let result: unknown;
        try { result = JSON.parse(output.text); } catch { throw new AiProviderError('invalid_output', false, 'Gemini devolvió un resultado inválido.'); }
        // SpacetimeDB valida el resultado contra las premisas antes de aplicarlo.
        terminal = { state: 'succeeded', result, usage: output.usage };
      } catch (error) {
        const failure = classifyProviderError(error);
        terminal = { state: failure.uncertain ? 'unknown' : 'failed', errorCode: failure.code, errorMessage: failure.message };
      } finally { apiKey = undefined; }
    }
    try { return c.json(await db.service('agent_ai', { action: 'finish', actor: authorized.actor, generationId, ...terminal! })); }
    catch { /* Una confirmación perdida nunca provoca otro envío al proveedor. */ }
    return c.json(await db.user(token, 'agent_ai', { action: 'get', generationId }));
  });
  return app;
}
