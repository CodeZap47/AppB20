import { describe, expect, it, vi } from 'vitest';
import { AiClient } from './aiClient';
import { createGuideMaterialsActions } from './guideMaterialsClient';
const id = '10000000-0000-4000-8000-000000000001';
describe('cliente autenticado del catálogo y selección de Guías', () => {
  it('usa rutas independientes y conserva el control de revisión del borrador', async () => {
    const request = vi.fn().mockResolvedValue(null); const client = { request } as unknown as AiClient; const actions = createGuideMaterialsActions(client);
    await actions.listGuideExamMaterials('12'); await actions.getGuideExamMaterial(id, 3, true); await actions.getGuideMaterialSelection(id); await actions.listGuideMaterialSelections();
    const input = { id, expectedRevision: 4, subjectId: '12', guideType: 'quarter' as const, title: '', topicsText: '', sources: [], chosenFileIds: [] };
    await actions.saveGuideMaterialSelection(input);
    expect(request.mock.calls).toEqual([
      ['/ai/guide-materials/exams?subjectId=12'], [`/ai/guide-materials/exams/${id}/3?includeSolutions=true`], [`/ai/guide-materials/selections/${id}`], ['/ai/guide-materials/selections'], [`/ai/guide-materials/selections/${id}`, 'PUT', input],
    ]);
  });
});
