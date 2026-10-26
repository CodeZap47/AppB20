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
  it('el feed excluye privados y archivados incluso con includeArchived para el autor', async () => {
    const { source, input } = setup(); const draft = await create(source, input); const personal = await approve(source, await create(source, input));
    let shared = await approve(source, await create(source, input)); shared = await source.examAction({ action: 'setVisibility', examId: shared.id, expectedRevision: shared.revision, visibility: 'group' });
    expect((await source.examAction({ action: 'listExams' })).map((row) => row.id)).toEqual(expect.arrayContaining([draft.id, personal.id, shared.id]));
    expect((await source.examAction({ action: 'listExams', sharedOnly: true, includeArchived: true })).map((row) => row.id)).toEqual([shared.id]);
    await source.examAction({ action: 'setArchived', examId: shared.id, expectedRevision: shared.revision, archived: true });
    expect(await source.examAction({ action: 'listExams', sharedOnly: true, includeArchived: true })).toEqual([]);
    expect((await source.examAction({ action: 'listExams', includeArchived: true })).map((row) => row.id)).toContain(shared.id);
    source.setViewer('demo-2'); expect(await source.examAction({ action: 'listExams', sharedOnly: true })).toEqual([]);
  });
  it('mantiene metadata aprobada en el feed del autor con un borrador de fuentes personales', async () => {
    vi.useFakeTimers(); const { source, input } = setup(); let exam = await approve(source, await create(source, input));
    exam = await source.examAction({ action: 'setVisibility', examId: exam.id, expectedRevision: exam.revision, visibility: 'group' });
    const before = (await source.examAction({ action: 'listExams', sharedOnly: true }))[0]!;
    vi.advanceTimersByTime(5000); exam = await source.examAction({ action: 'forkVersion', examId: exam.id, version: 1, expectedRevision: exam.revision, requestId: crypto.randomUUID() });
    const privateNote = source.saveNote({ subjectId: input.subjectId, title: 'Fuente privada nueva', topic: 'Tema privado', body: 'Mi apunte privado', tags: [], visibility: 'personal', source: 'student' });
    const { generation } = await generate(source, { ...input, topics: ['Tema privado'], sources: [{ kind: 'note', refId: privateNote, topics: ['Tema privado'], includeUnplaced: true }], config: { ...input.config!, topicWeights: [{ topic: 'Tema privado', weight: 1 }] } });
    exam = await source.examAction({ action: 'replaceQuestions', examId: exam.id, version: 2, expectedRevision: exam.revision, requestId: crypto.randomUUID(), generationId: generation.id, questionIds: exam.draft!.questions.map((question) => question.id) });
    exam = await source.examAction({ action: 'saveDraft', examId: exam.id, version: 2, expectedRevision: exam.revision, title: 'Título privado en edición', config: { ...exam.draft!.config, questionCount: 1 }, questions: exam.draft!.questions.slice(0, 1) });
    const note = source.getSnapshot().notes.find((row) => row.id === privateNote)!; source.withdrawContent('note', privateNote, true, note.version);
    const summary = (await source.examAction({ action: 'listExams', sharedOnly: true }))[0]!;
    expect(summary).toEqual(before); expect(summary).not.toHaveProperty('draftVersion'); expect(summary).toMatchObject({ questionCount: 2, topics: ['Tema'], sourceIssues: [] });
    expect((await source.examAction({ action: 'listExams' }))[0]).toMatchObject({ draftVersion: 2, questionCount: 1, topics: ['Tema privado'] });
    source.setViewer('demo-2'); expect((await source.examAction({ action: 'listExams', sharedOnly: true }))[0]).toEqual({ ...before, canEdit: false });
  });
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

  it('purga las copias de material a los 30 días y conserva únicamente el resultado del intento', async () => {
    vi.useFakeTimers(); const { source, input, noteId } = setup(); const ready = await approve(source, await create(source, input));
    const attempt = await source.examAction({ action: 'startAttempt', examId: ready.id, version: 1, mode: 'simulation', requestId: crypto.randomUUID() });
    const closed = await source.examAction({ action: 'finishAttempt', attemptId: attempt.id, expectedRevision: attempt.revision, requestId: crypto.randomUUID() });
    const note = source.getSnapshot().notes.find((row) => row.id === noteId)!; source.withdrawContent('note', noteId, true, note.version);
    vi.advanceTimersByTime(30 * 86_400_000 + 1); await source.getTrashClock();
    expect(source.getSnapshot().notes.some((row) => row.id === noteId)).toBe(false);
    expect(await source.examAction({ action: 'listGenerations' })).toEqual([]);
    const redacted = await source.examAction({ action: 'getAttempt', attemptId: attempt.id }); expect(redacted.result).toEqual(closed.result); expect(redacted.questions.every((row) => row.unavailable && !row.text && !row.solution && !row.options.length)).toBe(true);
    expect((await source.examAction({ action: 'getExam', examId: ready.id })).draft).toBeUndefined();
    await expect(source.examAction({ action: 'getVersion', examId: ready.id, version: 1 })).rejects.toThrow('no está disponible');
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

describe('EX-3 en demostración', () => {
  it('publica el banco sin soluciones y crea copias privadas reproducibles por otro miembro', async () => {
    const { source, input } = setup(); const exam = await approve(source, await create(source, input)); const request = { action: 'saveToBank' as const, examId: exam.id, version: 1, questionId: exam.draft!.questions[0]!.id, requestId: crypto.randomUUID() };
    const bank = await source.examAction(request); expect(bank.visibility).toBe('personal'); expect((await source.examAction(request)).id).toBe(bank.id); source.setViewer('demo-2'); expect(await source.examAction({ action: 'listBank' })).toEqual([]);
    source.setViewer('demo-1'); await source.examAction({ action: 'setBankVisibility', bankId: bank.id, expectedVersion: 1, visibility: 'group' }); source.setViewer('demo-2'); const catalog = await source.examAction({ action: 'listBank' }); expect(JSON.stringify(catalog)).not.toContain('correctOptionId');
    const plan = { subjectId: input.subjectId, topics: ['Tema'], questionCount: 1, types: ['single' as const], difficulty: 'basic' as const, seed: 'reproducible', bankIds: [bank.id] }; const preview = await source.examAction({ action: 'previewVariant', plan }); expect(preview.deficits).toEqual([]); expect((await source.examAction({ action: 'previewVariant', plan })).selected).toEqual(preview.selected);
    const copied = await source.examAction({ action: 'createVariant', plan, title: 'Mi copia', requestId: crypto.randomUUID() }); expect(copied.ownerId).toBe('demo-2'); expect(copied.visibility).toBe('personal'); expect(copied.draft!.questions[0]!.correctOptionId).toBeTruthy(); await expect(source.examAction({ action: 'setBankVisibility', bankId: bank.id, expectedVersion: 1, visibility: 'personal' })).rejects.toThrow('editar');
  });
  it('evalúa abiertas manualmente y acepta una sugerencia revisada sin duplicar envíos', async () => {
    const { source, input } = setup(); const openInput = { ...input, config: { ...input.config!, questionCount: 1, types: ['open' as const] } }; const exam = await approve(source, await create(source, openInput)); let attempt = await source.examAction({ action: 'startAttempt', examId: exam.id, version: 1, mode: 'simulation', requestId: crypto.randomUUID() }); expect(JSON.stringify(attempt)).not.toContain('rubric');
    attempt = await source.examAction({ action: 'saveAnswer', attemptId: attempt.id, expectedRevision: attempt.revision, requestId: crypto.randomUUID(), questionId: 'question-1', text: 'Mi argumento' }); attempt = await source.examAction({ action: 'finishAttempt', attemptId: attempt.id, expectedRevision: attempt.revision, requestId: crypto.randomUUID() }); expect(attempt.result!.total).toBe(0); expect(attempt.openResult!.pending).toBe(1);
    const prepared = await source.examEvaluationAction({ action: 'prepare', id: crypto.randomUUID(), attemptId: attempt.id, questionId: 'question-1' }); expect(prepared.state).toBe('prepared'); const request = { action: 'generate' as const, id: prepared.id, generationId: crypto.randomUUID(), fingerprint: prepared.fingerprint, confirmed: true }; const suggestion = await source.examEvaluationAction(request); expect(await source.examEvaluationAction(request)).toEqual(suggestion);
    const accept = { action: 'accept' as const, id: prepared.id, requestId: crypto.randomUUID(), expectedRevision: attempt.revision, criteria: [{ criterionId: 'clarity', points: 3, feedback: 'Revisado por mí' }], feedback: 'Acepto con ajustes' }; attempt = await source.examEvaluationAction(accept); expect(attempt.answers[0]!.evaluation!.origin).toBe('assisted'); expect(attempt.openResult).toMatchObject({ evaluated: 1, pending: 0, points: 3, maxPoints: 4 }); expect((await source.examEvaluationAction(accept)).revision).toBe(attempt.revision);
    attempt = await source.examAction({ action: 'evaluateOpenAnswer', attemptId: attempt.id, expectedRevision: attempt.revision, requestId: crypto.randomUUID(), questionId: 'question-1', criteria: [{ criterionId: 'clarity', points: 2, feedback: 'Ajuste manual' }], feedback: 'Corregido' }); expect(attempt.openResult!.percentage).toBe(50);
  });
});

describe('Banco simulado con selecciones distintas de una fuente', () => {
  it('combina respuestas independientes y oculta solamente la retirada, sin cambiar el resultado', async () => {
    const { source, input } = setup();
    const questionId = source.askQuestion({ subjectId: input.subjectId, topic: 'Tema', title: 'Dos explicaciones', body: '¿Cómo justificas la solución?' });
    const firstAnswer = source.answerQuestion(questionId, 'ANSWER_A_RETIRADA_DEMO'); const secondAnswer = source.answerQuestion(questionId, 'ANSWER_B_DISPONIBLE_DEMO');
    const fromAnswer = async (answerId: string, label: string) => {
      const selected: AiPrepareInput = { ...input, sources: [{ kind: 'question', refId: questionId, answerIds: [answerId], topics: ['Tema'], includeUnplaced: true }], config: { ...input.config!, questionCount: 1 } };
      let exam = await create(source, selected);
      exam = await source.examAction({ action: 'saveDraft', examId: exam.id, version: 1, expectedRevision: exam.revision, title: label, config: exam.draft!.config, questions: exam.draft!.questions.map((question) => ({ ...question, text: `Pregunta diferente ${label}` })) });
      exam = await approve(source, exam);
      const bank = await source.examAction({ action: 'saveToBank', examId: exam.id, version: 1, questionId: exam.draft!.questions[0]!.id, requestId: crypto.randomUUID() });
      return source.examAction({ action: 'setBankVisibility', bankId: bank.id, expectedVersion: bank.version, visibility: 'group' });
    };
    const first = await fromAnswer(firstAnswer, 'A'); const second = await fromAnswer(secondAnswer, 'B'); source.setViewer('demo-2');
    let variant = await source.examAction({ action: 'createVariant', title: 'Variante de selecciones', requestId: crypto.randomUUID(), plan: { subjectId: input.subjectId, topics: ['Tema'], questionCount: 2, types: ['single'], difficulty: 'basic', seed: 'selecciones', bankIds: [first.id, second.id] } });
    expect(variant.draft!.preparation.sources).toHaveLength(2);
    expect(variant.draft!.preparation.sources.map((ref) => ref.answerIds)).toEqual(expect.arrayContaining([[firstAnswer], [secondAnswer]]));
    variant = await approve(source, variant); let attempt = await source.examAction({ action: 'startAttempt', examId: variant.id, version: 1, mode: 'simulation', requestId: crypto.randomUUID() });
    attempt = await source.examAction({ action: 'finishAttempt', attemptId: attempt.id, expectedRevision: attempt.revision, requestId: crypto.randomUUID() }); const score = attempt.result;
    expect(JSON.stringify(attempt)).toContain('ANSWER_A_RETIRADA_DEMO'); expect(JSON.stringify(attempt)).toContain('ANSWER_B_DISPONIBLE_DEMO');
    source.setViewer('demo-1'); const answer = source.getSnapshot().answers.find((row) => row.id === firstAnswer)!; source.withdrawContent('answer', firstAnswer, true, answer.version ?? 1); source.setViewer('demo-2');
    const reread = await source.examAction({ action: 'getAttempt', attemptId: attempt.id });
    expect(reread.questions.find((question) => question.id === first.id)!.unavailable).toBe(true); expect(reread.questions.find((question) => question.id === second.id)!.unavailable).not.toBe(true);
    expect(JSON.stringify(reread)).not.toContain('ANSWER_A_RETIRADA_DEMO'); expect(JSON.stringify(reread)).toContain('ANSWER_B_DISPONIBLE_DEMO'); expect(reread.result).toEqual(score);
  });
});
