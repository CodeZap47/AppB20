import { AiClient } from './aiClient';
import type { AgentAiActions } from './agentTypes';

/** El payload lo arma SpacetimeDB; el cliente solo elige el paso, confirma y consulta. */
export function createAgentAiActions(client: AiClient): AgentAiActions {
  return {
    getAgentAiStatus: async () => (await client.request<{ steps: Awaited<ReturnType<AgentAiActions['getAgentAiStatus']>> }>('/ai/agent/status')).steps,
    previewAgentAi: (input) => client.request('/ai/agent/preview', 'POST', input),
    runAgentAiStep: (input) => client.request('/ai/agent/step', 'POST', input),
    listAgentAiRuns: (sessionId) => client.request(`/ai/agent/runs${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`),
  };
}
