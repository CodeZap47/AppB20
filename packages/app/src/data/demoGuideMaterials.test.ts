import { afterEach, describe, expect, it } from 'vitest';
import type { AiPrepareInput } from '@b20/core';
import { createDemoState, DemoDataSource } from './demo';
const instances: DemoDataSource[] = [];
afterEach(() => instances.splice(0).forEach((source) => source.dispose()));
function setup() { const state = createDemoState(), source = new DemoDataSource(state, 'demo-1'); instances.push(source); return { source, state, subjectId: source.getSnapshot().subjects[0]!.id }; }
describe('catálogo y lista persistente de materiales en simulación', () => {
  it('guarda vacíos, recupera agregado entre instancias y aísla las cuentas', async () => {
    const { source, state, subjectId } = setup(), id = crypto.randomUUID();
    const note = source.saveNote({ subjectId, title: 'Personal propia', topic: 'Tema', body: 'Mi contenido personal', visibility: 'personal', source: 'student', tags: [] });
    const saved = await source.saveGuideMaterialSelection({ id, expectedRevision: 0, subjectId, guideType: 'quarter', title: 'Mi guía', topicsText: 'Tema', sources: [{ kind: 'note', refId: note, topics: ['Tema'], includeUnplaced: true }], chosenFileIds: [] });
    expect(saved.revision).toBe(1); expect(saved.sources).toHaveLength(1);
    const reopened = new DemoDataSource(state, 'demo-1'); instances.push(reopened); expect((await reopened.getGuideMaterialSelection(id))?.sources).toEqual(saved.sources);
    source.setViewer('demo-2'); expect(await source.listGuideMaterialSelections()).toEqual([]); await expect(source.getGuideMaterialSelection(id)).rejects.toThrow('disponible');
    await expect(source.saveGuideMaterialSelection({ id: crypto.randomUUID(), expectedRevision: 0, subjectId, guideType: 'quarter', title: '', topicsText: '', sources: saved.sources, chosenFileIds: [] })).rejects.toThrow();
    source.setViewer('demo-1'); await expect(source.saveGuideMaterialSelection({ ...saved, expectedRevision: 0 })).rejects.toThrow('cambió');
    expect(await source.getGuideMaterialSelection(crypto.randomUUID())).toBeNull();
  });
  it('conserva referencias retiradas para poder quitarlas, sin devolver texto ni transcripciones', async () => {
    const { source, subjectId } = setup(), id = crypto.randomUUID();
    const noteId = source.saveNote({ subjectId, title: 'Fuente', topic: 'Tema', body: 'Contenido retirado', visibility: 'group', source: 'student', tags: [] });
    await source.saveGuideMaterialSelection({ id, expectedRevision: 0, subjectId, guideType: 'quarter', title: 'Guía', topicsText: '', sources: [{ kind: 'note', refId: noteId, topics: [], includeUnplaced: true }], chosenFileIds: [] });
    const note = source.getSnapshot().notes.find((row) => row.id === noteId)!; source.withdrawContent('note', noteId, true, note.version);
    const stale = await source.getGuideMaterialSelection(id); expect(stale?.unavailableSourceKeys).toEqual([`note:${noteId}`]); expect(stale?.sources).toHaveLength(1); expect(JSON.stringify(stale)).not.toContain('Contenido retirado');
    expect((await source.saveGuideMaterialSelection({ ...stale!, expectedRevision: stale!.revision, sources: [] })).sources).toEqual([]);
  });
  it('proyecta exámenes propios personales y compartidos sin revelar soluciones ajenas ocultas', async () => {
    const { source, subjectId } = setup();
    const noteId = source.saveNote({ subjectId, title: 'Texto base', topic: 'Tema', body: 'Una explicación pública.', visibility: 'group', source: 'student', tags: [] });
    const input: AiPrepareInput = { subjectId, topics: ['Tema'], sources: [{ kind: 'note', refId: noteId, topics: ['Tema'], includeUnplaced: true }], config: { questionCount: 2, types: ['single'], difficulty: 'basic' } };
    const preparation = await source.prepareExamMaterial(input), generation = await source.generateExamQuestions({ id: crypto.randomUUID(), preparationId: preparation.id, fingerprint: preparation.fingerprint, config: preparation.config, confirmed: true });
    let exam = await source.examAction({ action: 'importGeneration', requestId: crypto.randomUUID(), generationId: generation.id, title: 'Examen personal' });
    expect((await source.listGuideExamMaterials(subjectId)).find((row) => row.id === exam.id)).toMatchObject({ visibility: 'personal', canIncludeSolutions: true });
    expect((await source.getGuideExamMaterial(exam.id, 1, true)).fields.some((field) => field.name.startsWith('solucion:'))).toBe(true);
    source.setViewer('demo-2'); expect((await source.listGuideExamMaterials(subjectId)).some((row) => row.id === exam.id)).toBe(false);
    source.setViewer('demo-1'); exam = await source.examAction({ action: 'approveVersion', examId: exam.id, expectedRevision: exam.revision, version: 1, reviewedQuestionIds: exam.draft!.questions.map((row) => row.id) });
    await source.examAction({ action: 'setVisibility', examId: exam.id, expectedRevision: exam.revision, visibility: 'group' });
    source.setViewer('demo-2'); const shared = await source.getGuideExamMaterial(exam.id, 1, true); expect(shared.canIncludeSolutions).toBe(false); expect(shared.fields.every((field) => !field.name.startsWith('solucion:'))).toBe(true); expect(shared.omissions).toHaveLength(1);
    const attempt = await source.examAction({ action: 'startAttempt', examId: exam.id, version: 1, mode: 'practice', requestId: crypto.randomUUID() }); const question = attempt.questions[0]!;
    await source.examAction({ action: 'confirmAnswer', attemptId: attempt.id, expectedRevision: attempt.revision, requestId: crypto.randomUUID(), questionId: question.id, optionId: question.options[0]!.id });
    const revealed = await source.getGuideExamMaterial(exam.id, 1, true); expect(revealed.canIncludeSolutions).toBe(true); expect(revealed.fields.filter((field) => field.name.startsWith('solucion:'))).toHaveLength(1); expect((await source.examAction({ action: 'listAttempts' })).length).toBe(1);
  });
});
