import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import type { AiPreparation } from '../../core/src/ai';
import type { AiQuestion } from '../../core/src/exam';
import type { ExamAttempt, ExamDetail, ExamDraft, ExamGenerationSummary } from '../../core/src/exams';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import { ai_prepare, exam_action, type Ctx } from './index';
import { purgeExamSource } from './examHandlers';
const person = (digit: string) => Identity.fromString(digit.repeat(64)); const alice = person('a'); const bob = person('b'); const creator = person('c'); const removed = person('d');
const uid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = Record<string, unknown>;
const keyOf = (value: unknown) => typeof value === 'object' && value !== null && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function store(key: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[key]), row]));
  return new Proxy({ rows, iter: () => rows.values(), insert: (value: Row) => { if (rows.has(keyOf(value[key]))) throw new Error('duplicate key'); rows.set(keyOf(value[key]), { ...value }); return value; } }, { get(target, name) {
    if (name in target) return target[name as keyof typeof target];
    return { find: (value: unknown) => rows.get(keyOf(value)), update: (row: Row) => { rows.set(keyOf(row[key]), { ...row }); return row; }, delete: (value: unknown) => rows.delete(keyOf(value)),
      filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[String(name)]) === keyOf(value)) };
  } });
}
function setup() {
  const timestamp = new Timestamp(1_790_000_000_000_000n);
  const initial: Record<string, Row[]> = {
    authConfig: [{ id: 0, issuer: 'https://issuer.test', audiences: ['test'] }],
    member: [alice, bob, creator, removed].map((identity) => ({ identity, status: identity.isEqual(removed) ? 'removed' : 'active', isCreator: identity.isEqual(creator) })),
    subject: [{ id: 1n }], term: [{ id: 11n, subjectId: 1n }],
    note: [{ id: 1n, subjectId: 1n, title: 'Ciclos', topic: 'Ciclos', body: 'Un ciclo repite instrucciones mientras su condición sea verdadera.', version: 1, author: alice, visibility: 'group', source: 'student' },
      { id: 2n, subjectId: 1n, title: 'Personal', topic: 'Ciclos', body: 'Ejemplo personal del ciclo', version: 1, author: alice, visibility: 'personal', source: 'student' },
      { id: 3n, subjectId: 1n, title: 'Copia compartida', topic: 'Ciclos', body: 'Un ciclo repite instrucciones mientras su condición sea verdadera.', version: 1, author: bob, visibility: 'group', source: 'student' }],
    noteDetail: [1n, 2n, 3n].map((noteId) => ({ noteId, termId: 11n })),
  };
  const keys: Record<string, string> = { member: 'identity', noteDetail: 'noteId', contentStatus: 'key', resourceVersion: 'key', examVersion: 'key', examOperation: 'key', examGenerationImport: 'generationId' };
  const tables = new Map<string, ReturnType<typeof store>>();
  const db = new Proxy({}, { get: (_target, name: string) => { if (!tables.has(name)) tables.set(name, store(keys[name] ?? 'id', initial[name])); return tables.get(name); } });
  const state = { db, sender: alice, timestamp, env: {}, senderAuth: { jwt: { issuer: 'https://issuer.test', audience: ['test'], fullPayload: { email: 'member@example.com', email_verified: true } } } };
  const ctx = state as unknown as Ctx;
  const proc = { withTx: (fn: (tx: Ctx) => unknown) => fn(ctx) } as unknown as Parameters<typeof exam_action>[0];
  const call = <T = ExamDetail>(action: string, raw: Record<string, unknown> = {}) => {
    const result = JSON.parse(exam_action(proc, { payload: JSON.stringify({ action, ...raw }) }));
    if (result?.ok === false) throw new Error(`${result.code}:${result.message ?? ''}`);
    return result as T;
  };
  const rows = (name: string) => [...(db as Record<string, ReturnType<typeof store>>)[name].rows.values()];
  const as = (identity: Identity) => { state.sender = identity; };
  const tick = (seconds: number) => { state.timestamp = new Timestamp(state.timestamp.microsSinceUnixEpoch + BigInt(seconds) * 1_000_000n); };
  const seed = (n = 1, refs = ['1'], count = 2) => {
    const preparation = JSON.parse(ai_prepare(proc as unknown as Parameters<typeof ai_prepare>[0], { payload: JSON.stringify({ id: uid(n), model: 'gemini-test', subjectId: '1', termId: '11', topics: ['Ciclos'],
      sources: refs.map((refId) => ({ kind: 'note', refId, topics: ['Ciclos'], includeUnplaced: false })), config: { questionCount: count, types: ['single', 'boolean'], difficulty: 'basic', topicWeights: [{ topic: 'Ciclos', weight: 1 }] } }) })) as AiPreparation;
    const questions: AiQuestion[] = Array.from({ length: count }, (_, index) => ({ id: `q${index + 1}`, type: index % 2 ? 'boolean' : 'single', text: `Pregunta ${index + 1} sobre ciclos`, topic: 'Ciclos',
      options: index % 2 ? [{ id: 'v', text: 'Verdadero' }, { id: 'f', text: 'Falso' }] : ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `Opción ${id}` })),
      correctOptionId: index % 2 ? 'v' : 'b', explanation: `Explicación protegida ${index + 1}`, citations: [preparation.fragments[0]!.id] }));
    const generationId = uid(100 + n);
    ctx.db.aiGeneration.insert({ id: generationId, actor: state.sender, preparationId: preparation.id, requestHash: 'hash', configJson: JSON.stringify(preparation.config), keyId: uid(900), model: preparation.model,
      status: 'succeeded', createdAt: state.timestamp, claimedAt: state.timestamp, resultJson: JSON.stringify({ questions }), errorCode: '', errorMessage: '', inputTokens: undefined, outputTokens: undefined });
    return { generationId, preparation, questions };
  };
  const imported = (n = 1, refs = ['1'], seconds?: number) => { const g = seed(n, refs); return call('importGeneration', { generationId: g.generationId, requestId: uid(1000 + n), title: 'Autoevaluación de ciclos', ...(seconds ? { timeLimitSeconds: seconds } : {}) }); };
  const approve = (exam: ExamDetail) => call('approveVersion', { examId: exam.id, version: exam.draftVersion, expectedRevision: exam.revision, reviewedQuestionIds: exam.draft!.questions.map((question) => question.id) });
  const shared = (seconds?: number) => { let exam = approve(imported(1, ['1'], seconds)); exam = call('setVisibility', { examId: exam.id, expectedRevision: exam.revision, visibility: 'group' }); return exam; };
  const start = (exam: ExamDetail, mode = 'simulation', n = 2000) => call<ExamAttempt>('startAttempt', { examId: exam.id, version: exam.readyVersion, mode, requestId: uid(n) });
  return { ctx, call, rows, as, tick, seed, imported, approve, shared, start };
}
describe('EX-2: permisos, borradores y versiones listas', () => {
  it('separa las guías y explicaciones de las generaciones de preguntas y conserva errores recuperables', () => {
    const s = setup(); const legacy = s.seed(1); const questions = s.seed(2); const guide = s.seed(3); const explanation = s.seed(4);
    for (const [id, purpose] of [[questions.generationId, 'questions'], [guide.generationId, 'guide'], [explanation.generationId, 'explanation']] as const) {
      const row = s.rows('aiGeneration').find((row) => row.id === id)!; row.configJson = JSON.stringify({ ...JSON.parse(String(row.configJson)), purpose });
    }
    expect(s.call<ExamGenerationSummary[]>('listGenerations').map((row) => row.id).sort()).toEqual([legacy.generationId, questions.generationId].sort());
    for (const id of [guide.generationId, explanation.generationId]) expect(() => s.call('importGeneration', { generationId: id, requestId: uid(4000 + Number(id.slice(-1))), title: 'No es un examen' })).toThrow('preguntas');
    const exam = s.call('importGeneration', { generationId: questions.generationId, requestId: uid(1001), title: 'Preguntas explícitas' });
    expect(exam.draft!.config.purpose).toBe('questions');
    expect(() => s.call('saveDraft', { examId: exam.id, version: 1, expectedRevision: exam.revision, title: exam.title,
      config: { ...exam.draft!.config, purpose: 'guide' }, questions: exam.draft!.questions })).toThrow('preguntas');
    expect(JSON.parse(exam_action({ withTx: (fn: (ctx: Ctx) => unknown) => fn(s.ctx) } as Parameters<typeof exam_action>[0], { payload: '{' }))).toMatchObject({ ok: false, code: 'invalid' });
  });
  it('importa una generación una sola vez y no entrega soluciones en catálogo ni a otro autor', () => {
    const s = setup(); const generation = s.seed(); const request = { generationId: generation.generationId, requestId: uid(1001), title: 'Autoevaluación' };
    const exam = s.call('importGeneration', request); expect(s.call('importGeneration', request).id).toBe(exam.id);
    expect(s.call('importGeneration', { ...request, requestId: uid(1002) }).id).toBe(exam.id); expect(s.rows('studyExam')).toHaveLength(1);
    expect(JSON.stringify(s.call('listExams'))).not.toContain('correctOptionId');
    expect(s.call<ExamGenerationSummary[]>('listGenerations')[0]).toMatchObject({ importedExamId: exam.id });
    s.as(bob); expect(s.call('listExams')).toEqual([]); expect(() => s.call('getVersion', { examId: exam.id, version: 1 })).toThrow('disponible');
    expect(() => s.call('importGeneration', { ...request, requestId: uid(1003) })).toThrow('disponible');
    s.as(removed); expect(() => s.call('listExams')).toThrow('activo'); expect(s.rows('changeLog')).toHaveLength(0);
  });
  it('valida observaciones, cobertura, distribución y CAS antes de aprobar una versión inmutable', () => {
    const s = setup(); let exam = s.imported(); const draft = exam.draft!;
    expect(() => s.call('approveVersion', { examId: exam.id, version: 1, expectedRevision: exam.revision, reviewedQuestionIds: ['q1'] })).toThrow('todas');
    const save = { examId: exam.id, version: 1, expectedRevision: exam.revision, title: draft.title, config: draft.config, questions: draft.questions.map((question) => ({ ...question, issue: 'Ambigua' })) };
    exam = s.call('saveDraft', save); expect(() => s.approve(exam)).toThrow('observaciones');
    expect(() => s.call('saveDraft', save)).toThrow('cambió');
    expect(JSON.parse(exam_action({ withTx: (fn: (ctx: Ctx) => unknown) => fn(s.ctx) } as Parameters<typeof exam_action>[0], { payload: JSON.stringify({ action: 'saveDraft', ...save }) }))).toMatchObject({ ok: false, code: 'conflict' });
    exam = s.call('saveDraft', { ...save, expectedRevision: exam.revision, questions: draft.questions }); exam = s.approve(exam);
    expect(exam.readyVersion).toBe(1); expect(exam.draftVersion).toBeUndefined();
    expect(() => s.call('saveDraft', { ...save, expectedRevision: exam.revision })).toThrow('inmutable');
    const forked = s.call('forkVersion', { examId: exam.id, version: 1, expectedRevision: exam.revision, requestId: uid(3000) });
    expect(forked.draftVersion).toBe(2); expect(forked.readyVersion).toBe(1); expect(s.call<ExamDraft>('getVersion', { examId: exam.id, version: 1 }).questions).toEqual(draft.questions);
  });
  it('fuentes personales propias mantienen examen privado y no se sanea cambiando visibilidad', () => {
    const s = setup(); let exam = s.approve(s.imported(1, ['2']));
    expect(() => s.call('setVisibility', { examId: exam.id, expectedRevision: exam.revision, visibility: 'group' })).toThrow('personal');
    exam = s.call('forkVersion', { examId: exam.id, version: 1, expectedRevision: exam.revision, requestId: uid(3000) });
    const g = s.seed(2, ['3']); exam = s.call('replaceQuestions', { examId: exam.id, version: 2, expectedRevision: exam.revision, requestId: uid(3001), generationId: g.generationId, questionIds: ['q1', 'q2'] });
    expect(exam.draft!.hasPersonalSources).toBe(false); exam = s.approve(exam); expect(s.call('setVisibility', { examId: exam.id, expectedRevision: exam.revision, visibility: 'group' }).visibility).toBe('group');
  });
  it('regenera selección conservando las preguntas restantes y exige misma procedencia para cambios parciales', () => {
    const s = setup(); let exam = s.imported(); const old = exam.draft!.questions[1]; const g = s.seed(2, ['1'], 1);
    exam = s.call('replaceQuestions', { examId: exam.id, version: 1, expectedRevision: exam.revision, requestId: uid(3000), generationId: g.generationId, questionIds: ['q1'] });
    expect(exam.draft!.questions[1]).toEqual(old); expect(exam.draft!.questions[0]!.id).toBe('q1');
    s.rows('note')[0]!.version = 2; s.rows('note')[0]!.body = 'Nueva versión'; const changed = s.seed(3, ['1'], 1);
    expect(() => s.call('replaceQuestions', { examId: exam.id, version: 1, expectedRevision: exam.revision, requestId: uid(3001), generationId: changed.generationId, questionIds: ['q1'] })).toThrow('fuentes');
  });
});
describe('EX-2: intentos privados y soluciones por fase', () => {
  it('la purga elimina copias de texto de todas las versiones y preserva puntuación y corrección pendiente', () => {
    const s = setup(); const exam = s.shared(); s.as(bob); let closed = s.start(exam); let active = s.start(exam, 'simulation', 2001);
    closed = s.call('saveAnswer', { attemptId: closed.id, expectedRevision: closed.revision, requestId: uid(4000), questionId: 'q1', optionId: 'b' });
    closed = s.call('finishAttempt', { attemptId: closed.id, expectedRevision: closed.revision, requestId: uid(4001) });
    active = s.call('saveAnswer', { attemptId: active.id, expectedRevision: active.revision, requestId: uid(4002), questionId: 'q1', optionId: 'b' });
    purgeExamSource(s.ctx, 'note', 1n); s.ctx.db.note.id.delete(1n);
    const copied = JSON.stringify(s.rows('examVersion').map((row) => row.json));
    expect(copied).not.toMatch(/repite instrucciones|Pregunta 1 sobre ciclos|Explicación protegida|Opción b/);
    const reread = s.call<ExamAttempt>('getAttempt', { attemptId: closed.id }); expect(reread.result).toEqual(closed.result);
    expect(reread.questions.every((question) => question.unavailable && !question.solution && question.options.length === 0)).toBe(true);
    const finished = s.call<ExamAttempt>('finishAttempt', { attemptId: active.id, expectedRevision: active.revision, requestId: uid(4003) });
    expect(finished.result).toMatchObject({ correct: 1, total: 2 }); expect(finished.contentUnavailable).toBe(true);
    purgeExamSource(s.ctx, 'note', 1n); expect(JSON.stringify(s.rows('examVersion').map((row) => row.json))).toBe(copied);
    s.as(alice); expect(s.call('getExam', { examId: exam.id }).draft).toBeUndefined();
  });
  it('práctica solo revela después de confirmar, la respuesta es irreversible y el orden persiste', () => {
    const s = setup(); const exam = s.shared(); s.as(bob); let attempt = s.start(exam, 'practice');
    expect(JSON.stringify(attempt)).not.toContain('correctOptionId'); const order = attempt.questions.map((question) => [question.id, question.options.map((option) => option.id)]);
    attempt = s.call('saveAnswer', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4000), questionId: 'q1', optionId: 'b' }); expect(JSON.stringify(attempt)).not.toContain('Explicación protegida');
    attempt = s.call('confirmAnswer', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4001), questionId: 'q1', optionId: 'b' });
    expect(attempt.questions.find((question) => question.id === 'q1')!.solution!.correctOptionId).toBe('b'); expect(attempt.questions.find((question) => question.id === 'q2')!.solution).toBeUndefined();
    expect(() => s.call('saveAnswer', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4002), questionId: 'q1', optionId: 'a' })).toThrow('irreversible');
    expect(s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id }).questions.map((question) => [question.id, question.options.map((option) => option.id)])).toEqual(order);
    s.as(alice); expect(() => s.call('getAttempt', { attemptId: attempt.id })).toThrow('disponible'); s.as(creator); expect(() => s.call('getAttempt', { attemptId: attempt.id })).toThrow('disponible');
  });
  it('simulacro permite corregir, cierra idempotente y revela solo al finalizar sin IA', () => {
    const s = setup(); const exam = s.shared(); s.as(bob); let attempt = s.start(exam);
    attempt = s.call('saveAnswer', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4000), questionId: 'q1', optionId: 'a' });
    attempt = s.call('saveAnswer', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4001), questionId: 'q1', optionId: 'b' });
    expect(JSON.stringify(attempt)).not.toContain('correctOptionId'); expect(() => s.call('confirmAnswer', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4002), questionId: 'q2', optionId: 'v' })).toThrow('cierre');
    const finish = { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4003) }; attempt = s.call('finishAttempt', finish);
    expect(attempt.result).toMatchObject({ correct: 1, total: 2, percentage: 50 }); expect(attempt.questions.every((question) => question.solution)).toBe(true);
    expect(s.call<ExamAttempt>('finishAttempt', finish).result).toEqual(attempt.result); expect(s.rows('aiReservation')).toHaveLength(0);
  });
  it('deadline vive en servidor; recargar no reinicia tiempo y una respuesta tardía no cambia puntaje', () => {
    const s = setup(); const exam = s.shared(60); s.as(bob); const attempt = s.start(exam); const deadline = attempt.deadlineAt!;
    s.tick(30); expect(s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id }).deadlineAt).toBe(deadline);
    s.tick(31); const late = s.call<ExamAttempt>('saveAnswer', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4000), questionId: 'q1', optionId: 'b' });
    expect(late.state).toBe('closed'); expect(late.closeReason).toBe('timeout'); expect(late.result!.correct).toBe(0); expect(late.answers[0]!.optionId).toBeUndefined();
  });
  it('desactualización conserva intentos, retirada o privacidad del examen oculta contenido pero guarda resultado', () => {
    const s = setup(); let exam = s.shared(); s.as(bob); let attempt = s.start(exam); attempt = s.call('finishAttempt', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4000) }); const score = attempt.result;
    s.rows('note')[0]!.version = 2; s.rows('note')[0]!.body = 'Corregido'; expect(s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id }).sourceIssues[0]!.state).toBe('outdated');
    expect(s.start(exam, 'simulation', 2001).state).toBe('active');
    s.ctx.db.contentStatus.insert({ key: 'note:1', kind: 'note', targetId: 1n, withdrawnAt: s.ctx.timestamp, withdrawnBy: alice, reason: 'Retirada' });
    const hidden = s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id }); expect(hidden.result).toEqual(score); expect(hidden.questions.every((question) => question.unavailable)).toBe(true); expect(JSON.stringify(hidden)).not.toContain('Explicación protegida');
    expect(() => s.start(exam, 'practice', 2002)).toThrow('fuente'); s.ctx.db.contentStatus.key.delete('note:1');
    s.as(alice); exam = s.call('setVisibility', { examId: exam.id, expectedRevision: exam.revision, visibility: 'personal' });
    s.as(bob); expect(s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id }).contentUnavailable).toBe(true); expect(s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id }).result).toEqual(score);
  });
  it('deduplicación conserva evidencia accesible y elimina todo origen retirado de citas', () => {
    const s = setup(); let exam = s.approve(s.imported(1, ['1', '3'])); exam = s.call('setVisibility', { examId: exam.id, expectedRevision: exam.revision, visibility: 'group' });
    s.as(bob); let attempt = s.start(exam); attempt = s.call('finishAttempt', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4000) });
    s.ctx.db.contentStatus.insert({ key: 'note:1', kind: 'note', targetId: 1n, withdrawnAt: s.ctx.timestamp, withdrawnBy: alice, reason: 'Retirada' });
    const reread = s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id }); expect(reread.contentUnavailable).toBe(false);
    expect(reread.questions.flatMap((question) => question.solution!.citations.flatMap((citation) => citation.origins)).every((origin) => origin.refId === '3')).toBe(true);
  });
  it('editar un borrador no revela actividad privada y publicar otra versión no recalifica intentos anteriores', () => {
    const s = setup(); let exam = s.shared(); s.as(bob); const before = s.call('getExam', { examId: exam.id }); let attempt = s.start(exam);
    attempt = s.call('saveAnswer', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4000), questionId: 'q1', optionId: 'b' });
    attempt = s.call('finishAttempt', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4001) }); expect(attempt.result!.correct).toBe(1);
    s.as(alice); s.tick(5); exam = s.call('forkVersion', { examId: exam.id, version: 1, expectedRevision: exam.revision, requestId: uid(3000) });
    exam = s.call('saveDraft', { examId: exam.id, version: 2, expectedRevision: exam.revision, title: 'Título todavía privado', config: exam.draft!.config,
      questions: exam.draft!.questions.map((question) => question.id === 'q1' ? { ...question, correctOptionId: 'a' } : question) });
    s.as(bob); const during = s.call('getExam', { examId: exam.id }); expect(during.revision).toBe(before.revision); expect(during.updatedAt).toBe(before.updatedAt); expect(during.title).toBe(before.title); expect(during.draft).toBeUndefined();
    s.as(alice); exam = s.approve(exam); s.as(bob); const old = s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id });
    expect(old.result).toEqual(attempt.result); expect(old.questions.find((question) => question.id === 'q1')!.solution!.correctOptionId).toBe('b');
    const next = s.start(exam, 'simulation', 2001); const closed = s.call<ExamAttempt>('finishAttempt', { attemptId: next.id, expectedRevision: next.revision, requestId: uid(4002) });
    expect(closed.questions.find((question) => question.id === 'q1')!.solution!.correctOptionId).toBe('a');
    s.as(alice); exam = s.call('setArchived', { examId: exam.id, expectedRevision: exam.revision, archived: true });
    expect(s.call<ExamDetail[]>('listExams', { includeArchived: true })).toHaveLength(1);
    s.as(bob); expect(s.call('listExams', { includeArchived: true })).toEqual([]);
    expect(s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id }).result).toEqual(attempt.result);
  });
  it('identificadores de preguntas que coinciden con propiedades de objetos conservan respuesta y puntuación', () => {
    const s = setup(); let exam = s.imported(); exam = s.call('saveDraft', { examId: exam.id, version: 1, expectedRevision: exam.revision,
      title: exam.title, config: exam.draft!.config, questions: exam.draft!.questions.map((question) => question.id === 'q1' ? { ...question, id: '__proto__' } : question) });
    exam = s.approve(exam); let attempt = s.start(exam);
    attempt = s.call('saveAnswer', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4000), questionId: '__proto__', optionId: 'b' });
    attempt = s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id }); expect(attempt.answers.find((answer) => answer.questionId === '__proto__')!.optionId).toBe('b');
    expect(s.call<ExamAttempt>('finishAttempt', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(4001) }).result!.correct).toBe(1);
  });
});
