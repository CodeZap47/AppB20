import { AiClient } from './aiClient';
import type { GuideAiActions } from './guideAiTypes';

/** All requests inherit EX-1 authentication, redacted errors and session cancellation. */
export function createGuideAiActions(client: AiClient): GuideAiActions {
  const draft = (id: string) => `/ai/study-guides/${encodeURIComponent(id)}`;
  return {
    createGuideFromMaterials: (input) => client.request('/ai/study-guides/manual', 'POST', input),
    getGuideAiStatus: async () => { const [status, key] = await Promise.all([client.request<Awaited<ReturnType<GuideAiActions['getGuideAiStatus']>>['status']>('/ai/status'), client.request<Awaited<ReturnType<GuideAiActions['getGuideAiStatus']>>['key']>('/ai/key')]); return { status, key }; },
    prepareGuideAiDraft: (input) => client.request('/ai/study-guides/prepare', 'POST', input),
    refreshGuideAiDraft: ({ id, ...input }) => client.request(`${draft(id)}/reprepare`, 'POST', input),
    listGuideAiDrafts: () => client.request('/ai/study-guides'),
    getGuideAiDraft: (id) => client.request(draft(id)),
    getGuideAiFile: (id) => client.request(`/ai/study-guides/files/${encodeURIComponent(id)}`),
    saveGuideAiTranscription: (input) => client.request('/ai/study-guides/transcriptions', 'POST', input),
    runGuideAiStep: (id, input) => client.request(`${draft(id)}/step`, 'POST', input),
    reviewGuideAiTopics: (id, input) => client.request(`${draft(id)}/review-topics`, 'POST', input),
    updateGuideAiDraft: (id, input) => client.request(draft(id), 'PUT', input),
    cancelGuideAiDraft: (id, expectedRevision) => client.request(`${draft(id)}/cancel`, 'POST', { expectedRevision }),
    publishGuideAiDraft: ({ id, ...input }) => client.request(`${draft(id)}/publish`, 'POST', input),
    getGuideAiProvenance: (id, version) => client.request(`/ai/study-guides/provenance/${encodeURIComponent(id)}/${version}`),
  };
}
