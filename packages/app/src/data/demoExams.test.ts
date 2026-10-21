import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiPrepareInput, ExamDetail } from '@b20/core';
import { createDemoState, DemoDataSource } from './demo';

const sources: DemoDataSource[] = [];
afterEach(() => { sources.splice(0).forEach((source) => source.dispose()); vi.useRealTimers(); });
function setup(personal = false) {
  const state = createDemoState(); const source = new DemoDataSource(state, 'demo-1'); sources.push(source);
  const subjectId = source.getSnapshot().subjects[0]!.id;
  const noteId = source.saveNote({ subjectId, title: 'Material para examen', topic: 'Tema', body: 'Texto compartido', tags: [], visibility: personal ? 'personal' : 'group', source: 'student' });
  const input: AiPrepareInput = { subjectId, topics: ['Tema'], sources: [{ kind: 'note', refId: noteId, topics: ['Tema'], includeUnplaced: true }], config: { questionCount: 2, types: ['single'], difficulty: 'basic', topicWeights: [{ topic: 'Tema', weight: 1 }] } };
  return { source, state, input, noteId };
}
async function generate(source: DemoDataSource, input: AiPrepareInput) {
  const preparation = await source.prepareExamMaterial(input); const request = { id: crypto.randomUUID(), preparationId: preparation.id, fingerprint: preparation.fingerprint, config: preparation.config, confirmed: true };
  const generation = await source.generateExamQuestions(request); return { preparation, request, generation };
}
async function create(source: DemoDataSource, input: AiPrepareInput, timed = false) {
  const { generation } = await generate(source, input);
  return source.examAction({ action: 'importGeneration', generationId: generation.id, title: 'Mi examen', requestId: crypto.randomUUID(), ...(timed ? { timeLimitSeconds: 60 } : {}) });
}
async function approve(source: DemoDataSource, exam: ExamDetail) {
  return source.examAction({ action: 'approveVersion', examId: exam.id, expectedRevision: exam.revision, version: exam.draft!.version, reviewedQuestionIds: exam.draft!.questions.map((question) => question.id) });
}

describe('Exámenes de estudio en simulación', () => {
  it('aísla tres identidades y permite resolver lo compartido sin clave ni llamadas de IA', async () => {
    const { source, input } = setup(); const network = vi.spyOn(globalThis, 'fetch'); const generated = await generate(source, input); const id = generated.generation.id;
    const exam = await source.examAction({ action: 'importGeneration', generationId: id, title: 'Mi examen privado', requestId: crypto.randomUUID() });
    source.setViewer('demo-2'); expect(await source.examAction({ action: 'listGenerations' })).toEqual([]); expect(await source.examAction({ action: 'listExams' })).toEqual([]); await expect(source.getExamGeneration(id)).rejects.toThrow('disponible');
    source.setViewer('demo-3'); await expect(source.examAction({ action: 'getExam', examId: exam.id })).rejects.toThrow('acceso');
    source.setViewer('demo-1'); const ready = await approve(source, exam); await source.examAction({ action: 'setVisibility', examId: ready.id, expectedRevision: ready.revision, visibility: 'group' });
    source.setViewer('demo-2'); const shared = await source.examAction({ action: 'getExam', examId: exam.id }); expect(shared.draft).toBeUndefined(); expect(shared.canEdit).toBe(false); expect(JSON.stringify(shared)).not.toContain('correctOptionId');
    const attempt = await source.examAction({ action: 'startAttempt', examId: exam.id, version: 1, mode: 'practice', requestId: crypto.randomUUID() }); expect(attempt.questions.every((question) => !question.solution)).toBe(true);
    source.setViewer('demo-1'); expect(await source.examAction({ action: 'listAttempts' })).toEqual([]); await expect(source.examAction({ action: 'getAttempt', attemptId: attempt.id })).rejects.toThrow('acceso'); expect(network).not.toHaveBeenCalled(); network.mockRestore();
  });

  it('mantiene soluciones protegidas, confirmaciones inmutables, simulacros y puntajes deterministas', async () => {
    const { source, input } = setup(); const ready = await approve(source, await create(source, input)); const question = ready.draft!.questions[0]!;
    const practice = await source.examAction({ action: 'startAttempt', examId: ready.id, version: 1, mode: 'practice', requestId: crypto.randomUUID() });
    const saved = await source.examAction({ action: 'saveAnswer', attemptId: practice.id, expectedRevision: practice.revision, questionId: question.id, optionId: question.correctOptionId, requestId: crypto.randomUUID() }); expect(saved.questions.find((row) => row.id === question.id)?.solution).toBeUndefined(); expect(saved.answers[0]?.correct).toBeUndefined();
    const confirmed = await source.examAction({ action: 'confirmAnswer', attemptId: practice.id, expectedRevision: saved.revision, questionId: question.id, optionId: question.correctOptionId, requestId: crypto.randomUUID() }); expect(confirmed.questions.find((row) => row.id === question.id)?.solution).toBeTruthy();
    await expect(source.examAction({ action: 'saveAnswer', attemptId: practice.id, expectedRevision: confirmed.revision, questionId: question.id, optionId: question.options[1]!.id, requestId: crypto.randomUUID() })).rejects.toThrow('confirmó');
    const closed = await source.examAction({ action: 'finishAttempt', attemptId: practice.id, expectedRevision: confirmed.revision, requestId: crypto.randomUUID() }); expect(closed.result).toMatchObject({ correct: 1, total: 2, percentage: 50 });
    const simulation = await source.examAction({ action: 'startAttempt', examId: ready.id, version: 1, mode: 'simulation', requestId: crypto.randomUUID() });
    await expect(source.examAction({ action: 'confirmAnswer', attemptId: simulation.id, expectedRevision: simulation.revision, questionId: question.id, optionId: question.correctOptionId, requestId: crypto.randomUUID() })).rejects.toThrow('terminar');
    expect((await source.examAction({ action: 'getAttempt', attemptId: simulation.id })).questions.every((row) => !row.solution)).toBe(true);
    expect((await source.examAction({ action: 'finishAttempt', attemptId: simulation.id, expectedRevision: simulation.revision, requestId: crypto.randomUUID() })).questions.every((row) => row.solution)).toBe(true);
  });

  it('conserva plazo tras recargar y el resultado numérico después de retirar fuentes', async () => {
    vi.useFakeTimers(); const { source, input, noteId } = setup(); const ready = await approve(source, await create(source, input, true));
    const attempt = await source.examAction({ action: 'startAttempt', examId: ready.id, version: 1, mode: 'simulation', requestId: crypto.randomUUID() }); vi.advanceTimersByTime(30_000);
    expect((await source.examAction({ action: 'getAttempt', attemptId: attempt.id })).deadlineAt).toBe(attempt.deadlineAt); vi.advanceTimersByTime(30_001);
    const closed = await source.examAction({ action: 'getAttempt', attemptId: attempt.id }); expect(closed).toMatchObject({ state: 'closed', closeReason: 'timeout', result: { correct: 0, total: 2 } });
    const note = source.getSnapshot().notes.find((row) => row.id === noteId)!; source.withdrawContent('note', noteId, true, note.version);
    const redacted = await source.examAction({ action: 'getAttempt', attemptId: attempt.id }); expect(redacted.result).toEqual(closed.result); expect(redacted.contentUnavailable).toBe(true); expect(redacted.questions.every((row) => row.unavailable && !row.text && !row.solution)).toBe(true);
  });

  it('protege versiones listas, CAS e identificadores de reintento', async () => {
    const { source, input } = setup(); const { generation, request } = await generate(source, input); expect((await source.generateExamQuestions(request)).id).toBe(generation.id);
    await expect(source.generateExamQuestions({ ...request, config: { ...request.config, questionCount: 3 } })).rejects.toThrow('identificador');
    const imported = await source.examAction({ action: 'importGeneration', generationId: generation.id, title: 'Original', requestId: crypto.randomUUID() }); const ready = await approve(source, imported);
    await expect(source.examAction({ action: 'setArchived', examId: ready.id, expectedRevision: imported.revision, archived: true })).rejects.toThrow('cambió');
    await expect(source.examAction({ action: 'saveDraft', examId: ready.id, expectedRevision: ready.revision, version: 1, title: 'Cambio', config: ready.draft!.config, questions: ready.draft!.questions })).rejects.toThrow('inmutable');
    const requestId = crypto.randomUUID(); const attempt = await source.examAction({ action: 'startAttempt', examId: ready.id, version: 1, mode: 'practice', requestId }); expect((await source.examAction({ action: 'startAttempt', examId: ready.id, version: 1, mode: 'practice', requestId })).id).toBe(attempt.id);
    await expect(source.examAction({ action: 'startAttempt', examId: ready.id, version: 1, mode: 'simulation', requestId })).rejects.toThrow('identificador');
  });

  it('no publica títulos o contenido de un borrador nuevo y bloquea fuentes personales', async () => {
    const { source, input } = setup(); let exam = await approve(source, await create(source, input)); exam = await source.examAction({ action: 'setVisibility', examId: exam.id, expectedRevision: exam.revision, visibility: 'group' });
    exam = await source.examAction({ action: 'forkVersion', examId: exam.id, expectedRevision: exam.revision, version: 1, requestId: crypto.randomUUID() });
    exam = await source.examAction({ action: 'saveDraft', examId: exam.id, expectedRevision: exam.revision, version: 2, title: 'Título privado nuevo', config: exam.draft!.config, questions: exam.draft!.questions.map((question) => ({ ...question, text: 'Borrador aún privado' })) });
    source.setViewer('demo-2'); const shared = await source.examAction({ action: 'getExam', examId: exam.id }); expect(shared.title).toBe('Mi examen'); expect(shared.draftVersion).toBeUndefined(); expect(shared.versions).toHaveLength(1); expect(JSON.stringify(shared)).not.toContain('Borrador aún privado');
    source.setViewer('demo-1'); await approve(source, exam); source.setViewer('demo-2'); expect((await source.examAction({ action: 'getExam', examId: exam.id })).title).toBe('Título privado nuevo');
    const personal = setup(true); const privateExam = await approve(personal.source, await create(personal.source, personal.input)); await expect(personal.source.examAction({ action: 'setVisibility', examId: privateExam.id, expectedRevision: privateExam.revision, visibility: 'group' })).rejects.toThrow('personal');
  });
});
