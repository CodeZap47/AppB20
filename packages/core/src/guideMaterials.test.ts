import { describe, expect, it } from 'vitest';
import { validateGuideMaterialSelectionInput, guideMaterialSelectionSummary } from './guideMaterials';
const id = '10000000-0000-4000-8000-000000000001';
const input = { id, expectedRevision: 0, subjectId: '1', guideType: 'partial', title: '', topicsText: '', sources: [], chosenFileIds: [] };
describe('borradores de selección de materiales', () => {
  it('permite composición incompleta y referencias de exámenes UUID fijadas a versión', () => {
    expect(validateGuideMaterialSelectionInput(input)).toEqual(input);
    const exam = { kind: 'exam', refId: id, examVersion: 2, includeSolutions: true, includeOutsideTerm: true, topics: ['Tema'], includeUnplaced: true };
    expect(validateGuideMaterialSelectionInput({ ...input, sources: [exam], chosenFileIds: ['archivo', 'archivo'] })).toMatchObject({ sources: [exam], chosenFileIds: ['archivo'] });
  });
  it('rechaza referencias repetidas, exámenes sin versión y tipos o ámbitos inválidos', () => {
    const ref = { kind: 'note', refId: '1', topics: [], includeUnplaced: true };
    for (const change of [{ sources: [ref, ref] }, { sources: [{ ...ref, kind: 'exam', refId: id }] }, { guideType: 'quarter', termId: '2' }, { sources: [{ ...ref, kind: 'file' }] }, { id: '1' }, { expectedRevision: -1 }]) expect(() => validateGuideMaterialSelectionInput({ ...input, ...change })).toThrow();
  });
  it('el listado no incluye respuestas, archivos, fuentes ni texto manual', () => {
    const summary = guideMaterialSelectionSummary({ ...validateGuideMaterialSelectionInput(input), revision: 3, updatedAt: 100, transcriptions: [], unavailableSourceKeys: [], manualSections: Array(8).fill('Privado') });
    expect(summary).toEqual({ id, revision: 3, subjectId: '1', termId: undefined, guideType: 'partial', title: '', materialCount: 0, updatedAt: 100 }); expect(JSON.stringify(summary)).not.toContain('Privado');
  });
});
