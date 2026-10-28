import type { AiClient } from './aiClient';
import type { GuideMaterialsActions } from './guideMaterialsTypes';
export function createGuideMaterialsActions(client: AiClient): GuideMaterialsActions {
  const base = '/ai/guide-materials';
  return {
    listGuideExamMaterials: (subjectId) => client.request(`${base}/exams?subjectId=${encodeURIComponent(subjectId)}`),
    getGuideExamMaterial: (id, version, includeSolutions = false) => client.request(`${base}/exams/${encodeURIComponent(id)}/${version}?includeSolutions=${includeSolutions ? 'true' : 'false'}`),
    getGuideMaterialSelection: (id) => client.request(`${base}/selections/${encodeURIComponent(id)}`),
    saveGuideMaterialSelection: (input) => client.request(`${base}/selections/${encodeURIComponent(input.id)}`, 'PUT', input),
    listGuideMaterialSelections: () => client.request(`${base}/selections`),
  };
}
