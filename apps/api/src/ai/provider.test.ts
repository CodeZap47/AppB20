import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_LIMITS, buildAiPreparation } from '@b20/core';
import { classifyProviderError, createGeminiProvider } from './provider.ts';

const preparation = buildAiPreparation({ subjectId: '1', topics: ['Variables'], sources: [{ kind: 'note', refId: '1', topics: ['Variables'], includeUnplaced: true }] },
  [{ kind: 'note', refId: '1', subjectId: '1', title: 'Variables', version: 1, visibility: 'group', fields: [{ name: 'content', text: 'Almacena valores.' }] }],
  { id: crypto.randomUUID(), model: 'gemini-test', now: Date.now() });
const input = { apiKey: 'local-fixture-key-no-real-account', model: 'gemini-test', preparation,
  config: { questionCount: 1, types: ['boolean' as const], difficulty: 'basic' as const } };
afterEach(() => { vi.unstubAllGlobals(); });
describe('Política de envío Gemini sin llamadas reales', () => {
  it('aplica salida estructurada, límite de salida e incluye tokens de razonamiento en uso', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: '{"questions":[]}' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 12, thoughtsTokenCount: 30, totalTokenCount: 52 } });
    }));
    const result = await createGeminiProvider().generate(input);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 42 });
    expect(body.generationConfig).toMatchObject({ maxOutputTokens: AI_LIMITS.maxOutputTokens, responseMimeType: 'application/json' });
    expect(JSON.stringify(body)).toContain('responseJsonSchema');
    expect(JSON.stringify(body)).not.toContain(input.apiKey);
  });
  it('timeout y error de red no se reintentan ni exponen detalles del proveedor', async () => {
    const transport = vi.fn(async () => { throw new DOMException('private details', 'TimeoutError'); });
    vi.stubGlobal('fetch', transport);
    await expect(createGeminiProvider().generate(input)).rejects.toMatchObject({ uncertain: true, code: 'unknown' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(classifyProviderError(new DOMException('secret', 'TimeoutError')).message).not.toContain('secret');
  });
  it('429 usa un solo intento y rechazo definitivo sin propagar el cuerpo del error', async () => {
    const transport = vi.fn(async () => Response.json({ error: { code: 429, message: 'private details', status: 'RESOURCE_EXHAUSTED' } }, { status: 429 }));
    vi.stubGlobal('fetch', transport);
    await expect(createGeminiProvider().generate(input)).rejects.toMatchObject({ uncertain: false, code: 'provider_quota' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
