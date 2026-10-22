import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { AGENT_AI_LIMITS, AGENT_AI_SCHEMAS, AI_LIMITS, type AgentAiPayload } from '@b20/core';
import { AiProviderError, classifyProviderError, type AiProviderResponse } from './provider.ts';
import { boundedFetch } from './guideProvider.ts';

/** `systemInstruction` llega de SpacetimeDB con las premisas literales; el Worker no la reescribe. */
export interface AgentProviderInput { apiKey: string; model: string; payload: AgentAiPayload; systemInstruction: string }
export interface AgentProvider { generate(input: AgentProviderInput): Promise<AiProviderResponse> }
const OUTPUT_BYTES = 64 * 1024;

export function createAgentProvider(): AgentProvider {
  return { async generate(input) {
    const ai = new GoogleGenAI({ apiKey: input.apiKey, httpOptions: { timeout: AI_LIMITS.timeoutMs, retryOptions: { attempts: 1 }, fetch: boundedFetch } });
    try {
      const response = await ai.models.generateContent({ model: input.model, contents: JSON.stringify(input.payload),
        config: { systemInstruction: input.systemInstruction,
          ...(input.model === 'gemini-3.8-flash' ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          responseMimeType: 'application/json', responseJsonSchema: AGENT_AI_SCHEMAS[input.payload.step],
          maxOutputTokens: AGENT_AI_LIMITS.maxOutputTokens, abortSignal: AbortSignal.timeout(AI_LIMITS.timeoutMs) } });
      if (response.promptFeedback?.blockReason || response.candidates?.some((candidate) => candidate.finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(candidate.finishReason))) throw new AiProviderError('rejected_output', false, 'Gemini no pudo completar este paso.');
      const text = response.text ?? '';
      if (!text || new TextEncoder().encode(text).byteLength > OUTPUT_BYTES) throw new AiProviderError('invalid_output', false, 'La respuesta no contiene un resultado válido.');
      return { text, ...(response.usageMetadata ? { usage: { inputTokens: response.usageMetadata.promptTokenCount ?? 0,
        outputTokens: (response.usageMetadata.candidatesTokenCount ?? 0) + (response.usageMetadata.thoughtsTokenCount ?? 0) } } : {}) };
    } catch (error) { throw classifyProviderError(error); }
  } };
}
