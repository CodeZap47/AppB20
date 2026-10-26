import { purgeExamSpacedSource } from './examSpaced';
import { describe, expect, it, vi } from 'vitest';
import { AI_CONSENT_VERSION } from '../../core/src/ai';
import type { ExamEvaluationDraft } from '../../core/src/examEvaluation';
import { examEvaluationResponse } from './examEvaluationHandlers';
import { Identity, Timestamp } from 'spacetimedb';
import type { AiPreparation } from '../../core/src/ai';
import type { AiQuestion } from '../../core/src/exam';
import type { ExamAttempt, ExamDetail, ExamDraft, ExamGenerationSummary, ExamSummary, ExamBankDetail, ExamBankSummary, ExamVariantPreview } from '../../core/src/exams';
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
  const keys: Record<string, string> = { aiKey: 'actor', aiConsent: 'actor', member: 'identity', noteDetail: 'noteId', contentStatus: 'key', resourceVersion: 'key', examVersion: 'key', examBankVersion: 'key', examOperation: 'key', examGenerationImport: 'generationId' };
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
  it('el catálogo compartido excluye privados y archivados incluso para su autor', () => {
    const s = setup(); const draft = s.imported(2); const personal = s.approve(s.imported(3)); let shared = s.shared();
    expect(s.call<ExamSummary[]>('listExams').map((row) => row.id)).toEqual(expect.arrayContaining([draft.id, personal.id, shared.id]));
    expect(s.call<ExamSummary[]>('listExams', { sharedOnly: true, includeArchived: true }).map((row) => row.id)).toEqual([shared.id]);
    shared = s.call('setArchived', { examId: shared.id, expectedRevision: shared.revision, archived: true });
    expect(s.call('listExams', { sharedOnly: true, includeArchived: true })).toEqual([]);
    expect(s.call<ExamSummary[]>('listExams', { includeArchived: true }).map((row) => row.id)).toContain(shared.id);
    s.as(bob); expect(s.call('listExams', { sharedOnly: true })).toEqual([]);
  });
  it('el feed del autor conserva solo la versión aprobada cuando el borrador cambia y usa fuentes personales', () => {
    const s = setup(); let exam = s.shared();
    const before = s.call<ExamSummary[]>('listExams', { sharedOnly: true })[0]!;
    s.tick(5); exam = s.call('forkVersion', { examId: exam.id, version: 1, expectedRevision: exam.revision, requestId: uid(3000) });
    const generated = s.seed(2, ['2']);
    exam = s.call('replaceQuestions', { examId: exam.id, version: 2, expectedRevision: exam.revision, requestId: uid(3001), generationId: generated.generationId, questionIds: ['q1', 'q2'] });
    exam = s.call('saveDraft', { examId: exam.id, version: 2, expectedRevision: exam.revision, title: 'Título solo del borrador', config: { ...exam.draft!.config, questionCount: 1 }, questions: exam.draft!.questions.slice(0, 1) });
    s.ctx.db.contentStatus.insert({ key: 'note:2', kind: 'note', targetId: 2n, withdrawnAt: s.ctx.timestamp, withdrawnBy: alice, reason: 'Nota privada retirada' });
    const summary = s.call<ExamSummary[]>('listExams', { sharedOnly: true })[0]!;
    expect(summary).toEqual(before); expect(summary).not.toHaveProperty('draftVersion');
    expect(summary).toMatchObject({ readyVersion: 1, questionCount: 2, topics: ['Ciclos'], canEdit: true, sourceIssues: [] });
    const catalog = s.call<ExamSummary[]>('listExams')[0]!;
    expect(catalog).toMatchObject({ title: 'Título solo del borrador', draftVersion: 2, questionCount: 1 }); expect(catalog.sourceIssues).not.toEqual([]);
    s.as(bob); const peer = s.call<ExamSummary[]>('listExams', { sharedOnly: true })[0]!;
    expect(peer).toEqual({ ...before, canEdit: false });
  });
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

describe('EX-3: banco privado, variantes y abiertas', () => {
  it('conserva versiones del banco, publica sin solucionario y copia sin modificar el original', () => {
    const s = setup(); const exam = s.approve(s.imported()); const save = { examId: exam.id, version: 1, questionId: 'q1', requestId: uid(5000) };
    let bank = s.call<ExamBankDetail>('saveToBank', save); expect(bank.visibility).toBe('personal'); expect(s.call<ExamBankDetail>('saveToBank', save).id).toBe(bank.id);
    s.as(bob); expect(s.call('listBank')).toEqual([]); expect(() => s.call('getBankQuestion', { bankId: bank.id })).toThrow('disponible');
    s.as(alice); bank = s.call('setBankVisibility', { bankId: bank.id, expectedVersion: 1, visibility: 'group' });
    s.as(bob); const catalog = s.call<ExamBankSummary[]>('listBank'); expect(catalog).toHaveLength(1); expect(JSON.stringify(catalog)).not.toMatch(/correctOptionId|Explicación protegida|rubric/); expect(s.call<ExamBankDetail>('getBankQuestion', { bankId: bank.id }).question).toBeUndefined();
    expect(() => s.call('setBankVisibility', { bankId: bank.id, expectedVersion: 1, visibility: 'personal' })).toThrow('editar');
    const plan = { subjectId: '1', termId: '11', topics: ['Ciclos'], questionCount: 1, difficulty: 'basic', types: ['single'], seed: 'copia', bankIds: [bank.id] };
    const copied = s.call('createVariant', { plan, title: 'Mi copia', requestId: uid(5001) }); expect(copied.ownerId).toBe(bob.toHexString()); expect(copied.draft!.questions[0]!.correctOptionId).toBe('b'); expect(copied.visibility).toBe('personal'); expect(copied.draftVersion).toBe(1);
    s.as(alice); bank = s.call('saveToBank', { ...save, requestId: uid(5002), bankId: bank.id, expectedVersion: 1 }); expect(bank.version).toBe(2); expect(s.rows('examBankVersion')).toHaveLength(2); expect(s.call<ExamBankDetail>('getBankQuestion', { bankId: bank.id, version: 1 }).question!.text).toBe('Pregunta 1 sobre ciclos');
    s.as(bob); expect(s.call<ExamDetail>('getExam', { examId: copied.id }).draft!.questions[0]!.text).toBe('Pregunta 1 sobre ciclos');
  });
  it('impide publicar fuente personal y presenta déficit antes de crear una variante', () => {
    const s = setup(); const exam = s.approve(s.imported(1, ['2'])); const bank = s.call<ExamBankDetail>('saveToBank', { examId: exam.id, version: 1, questionId: 'q1', requestId: uid(5000) });
    expect(() => s.call('setBankVisibility', { bankId: bank.id, expectedVersion: 1, visibility: 'group' })).toThrow('personal');
    const plan = { subjectId: '1', topics: ['Ciclos'], questionCount: 2, difficulty: 'basic', types: ['single'], seed: 'semilla' }; expect(s.call<ExamVariantPreview>('previewVariant', { plan }).deficits).toEqual([{ topic: 'Ciclos', requested: 2, available: 1 }]); expect(() => s.call('createVariant', { plan, title: 'Faltan', requestId: uid(5001) })).toThrow('Faltan');
    purgeExamSource(s.ctx, 'note', 2n); expect(JSON.stringify(s.rows('examBankVersion').map((row) => row.json))).not.toContain('Pregunta 1 sobre ciclos'); expect(s.call('listBank')).toEqual([]);
  });
  it('oculta referencia y rúbrica mientras se responde y mantiene puntuaciones abiertas separadas', () => {
    const s = setup(); let exam = s.imported(); const draft = exam.draft!; exam = s.call('saveDraft', { examId: exam.id, expectedRevision: exam.revision, version: 1, title: exam.title, config: { ...draft.config, types: ['single', 'open'] }, questions: draft.questions.map((question, index) => index ? { ...question, type: 'open', options: [], correctOptionId: '', referenceAnswer: 'Referencia secreta', rubric: { version: 3, criteria: [{ id: 'logic', description: 'Razonamiento claro', maxPoints: 4 }] } } : question) }); exam = s.approve(exam); let attempt = s.start(exam);
    expect(JSON.stringify(attempt)).not.toMatch(/Referencia secreta|Razonamiento claro|rubric/); attempt = s.call('saveAnswer', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(5100), questionId: 'q2', text: 'Mi argumento' });
    expect(() => s.call('evaluateOpenAnswer', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(5101), questionId: 'q2', criteria: [{ criterionId: 'logic', points: 3, feedback: 'Bien' }], feedback: '' })).toThrow('Termina');
    attempt = s.call('finishAttempt', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(5102) }); expect(attempt.result).toMatchObject({ correct: 0, total: 1 }); expect(attempt.openResult).toMatchObject({ pending: 1, evaluated: 0, maxPoints: 0 }); expect(attempt.questions.find((question) => question.id === 'q2')!.solution!.referenceAnswer).toBe('Referencia secreta');
    const evaluate = { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(5103), questionId: 'q2', criteria: [{ criterionId: 'logic', points: 3, feedback: 'Sustentado' }], feedback: 'Mejorar ejemplo' }; attempt = s.call('evaluateOpenAnswer', evaluate); expect(attempt.openResult).toEqual({ evaluated: 1, pending: 0, points: 3, maxPoints: 4, percentage: 75 }); expect(s.call<ExamAttempt>('evaluateOpenAnswer', evaluate).revision).toBe(attempt.revision); expect(attempt.result!.total).toBe(1);
    expect(() => s.call('evaluateOpenAnswer', { ...evaluate, requestId: uid(5104), expectedRevision: attempt.revision, criteria: [{ criterionId: 'logic', points: 5, feedback: '' }] })).toThrow('criterio'); s.as(bob); expect(() => s.call('evaluateOpenAnswer', { ...evaluate, requestId: uid(5105) })).toThrow('disponible');
  });
});

describe('EX-3: nuevas fuentes y tarjetas privadas derivadas', () => {
  it('selecciona respuestas expresamente y conserva dependencias individuales', () => {
    const s = setup();
    s.ctx.db.question.insert({ id: 10n, subjectId: 1n, title: 'Pregunta sobre ciclos', topic: 'Ciclos', body: '¿Cuándo termina un ciclo?', status: 'answered', acceptedAnswerId: 11n, author: alice, createdAt: s.ctx.timestamp } as never);
    s.ctx.db.answer.insert({ id: 11n, questionId: 10n, body: 'Termina cuando deja de cumplirse su condición.', author: bob, createdAt: s.ctx.timestamp } as never);
    s.ctx.db.answer.insert({ id: 12n, questionId: 10n, body: 'Respuesta no elegida y sin sustento.', author: bob, createdAt: s.ctx.timestamp } as never);
    const proc = { withTx: (fn: (ctx: Ctx) => unknown) => fn(s.ctx) } as unknown as Parameters<typeof ai_prepare>[0];
    const preparation = JSON.parse(ai_prepare(proc, { payload: JSON.stringify({ id: uid(5500), model: 'gemini-test', subjectId: '1', topics: ['Ciclos'], sources: [{ kind: 'question', refId: '10', answerIds: ['11'], topics: ['Ciclos'], includeUnplaced: true }], config: { purpose: 'questions', questionCount: 1, types: ['open'], difficulty: 'basic' } }) })) as AiPreparation;
    expect(preparation.canGenerate).toBe(true);
    expect(JSON.stringify(preparation.fragments)).toContain('deja de cumplirse');
    expect(JSON.stringify(preparation.fragments)).not.toContain('Respuesta no elegida');
    expect(preparation.fragments.some((fragment) => fragment.origins.some((origin) => origin.kind === 'answer' && origin.refId === '11'))).toBe(true);
  });

  it('crea una sola tarjeta, no modifica progreso y rechaza intentos ajenos', () => {
    const s = setup(); const exam = s.approve(s.imported()); const attempt = s.start(exam);
    const closed = s.call<ExamAttempt>('finishAttempt', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(5600) });
    const input = { attemptId: closed.id, questionId: closed.questions[0]!.id, requestId: uid(5601), question: '¿Cómo termina el ciclo?', explanation: 'Revisa la condición antes de repetir.' };
    const first = s.call<{ collectionId: string; cardId: string; created: boolean }>('sendToSpaced', input);
    expect(first.created).toBe(true);
    expect(s.rows('spacedCard')).toHaveLength(1);
    expect(s.rows('spacedCollection')[0]).toMatchObject({ visibility: 'personal', ownerId: alice });
    expect(s.rows('spacedProgress')).toHaveLength(0);
    expect(s.call('sendToSpaced', { ...input, requestId: uid(5602) })).toMatchObject({ ...first, created: false });
    expect(s.rows('spacedCard')).toHaveLength(1);
    s.as(bob); expect(() => s.call('sendToSpaced', { ...input, requestId: uid(5603) })).toThrow('unavailable');
  });
});

describe('EX-3: sugerencias persistentes y dependencias individuales', () => {
  it('la retirada de una respuesta citada oculta también sus fragmentos con origen answer', () => {
    const s = setup(); const ctx = s.ctx; ctx.db.question.insert({ id: 8n, subjectId: 1n, topic: 'Ciclos', title: 'Duda', body: 'Pregunta pública', author: alice, status: 'resolved', acceptedAnswerId: 9n, resolvedAt: undefined, createdAt: ctx.timestamp }); ctx.db.answer.insert({ id: 9n, questionId: 8n, author: bob, body: 'ANSWER_PRIVATE_AFTER_WITHDRAWAL', createdAt: ctx.timestamp });
    const prep = JSON.parse(ai_prepare({ withTx: (fn: (ctx: Ctx) => unknown) => fn(ctx) } as Parameters<typeof ai_prepare>[0], { payload: JSON.stringify({ id: uid(6000), model: 'gemini-test', subjectId: '1', topics: ['Ciclos'], sources: [{ kind: 'question', refId: '8', answerIds: ['9'], topics: ['Ciclos'], includeUnplaced: true }], config: { questionCount: 1, types: ['single'], difficulty: 'basic' } }) })) as AiPreparation;
    const generated = { ...s.seed(6001, ['1'], 1) }; const answerFragment = prep.fragments.find((fragment) => fragment.origins.some((origin) => origin.kind === 'answer'))!; const q = { ...generated.questions[0]!, citations: [answerFragment.id] }; const generation = ctx.db.aiGeneration.id.find(generated.generationId)!; ctx.db.aiGeneration.id.update({ ...generation, preparationId: prep.id, configJson: JSON.stringify(prep.config), resultJson: JSON.stringify({ questions: [q] }) }); let exam = s.call('importGeneration', { generationId: generated.generationId, requestId: uid(6002), title: 'Con respuesta' }); exam = s.approve(exam); exam = s.call('setVisibility', { examId: exam.id, expectedRevision: exam.revision, visibility: 'group' }); s.as(bob); let attempt = s.start(exam); attempt = s.call('finishAttempt', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(6003) }); expect(JSON.stringify(attempt)).toContain('ANSWER_PRIVATE_AFTER_WITHDRAWAL'); ctx.db.contentStatus.insert({ key: 'answer:9', kind: 'answer', targetId: 9n, withdrawnAt: ctx.timestamp, withdrawnBy: bob, reason: 'Retirada' }); const reread = s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id }); expect(reread.contentUnavailable).toBe(true); expect(JSON.stringify(reread)).not.toContain('ANSWER_PRIVATE_AFTER_WITHDRAWAL'); expect(reread.result).toEqual(attempt.result);
  });
  it('reserva una vez, acepta ajustes una vez, valida CAS y descarta resultados tardíos cancelados', () => {
    const s = setup(); let exam = s.imported(); const draft = exam.draft!; exam = s.call('saveDraft', { examId: exam.id, version: 1, expectedRevision: exam.revision, title: exam.title, config: { ...draft.config, questionCount: 1, types: ['open'] }, questions: [{ ...draft.questions[0]!, type: 'open', options: [], correctOptionId: '', referenceAnswer: 'Referencia privada', rubric: { version: 1, criteria: [{ id: 'a', description: 'Argumenta', maxPoints: 4 }] } }] }); exam = s.approve(exam); let attempt = s.start(exam); attempt = s.call('finishAttempt', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(6100) });
    const technical = person('e'); s.ctx.db.aiServiceConfig.insert({ id: 0, identity: technical, enabled: true, dailyTokenBudget: 100000 }); s.ctx.db.aiKey.insert({ actor: alice, keyId: uid(6199), provider: 'gemini', ciphertext: 'encrypted', iv: 'iv', masterVersion: 'v1', updatedAt: s.ctx.timestamp }); s.ctx.db.aiConsent.insert({ actor: alice, version: AI_CONSENT_VERSION, accepted: true, updatedAt: s.ctx.timestamp });
    const evaluate = <T = ExamEvaluationDraft>(raw: Record<string, unknown>): T => { const value = JSON.parse(examEvaluationResponse(s.ctx, JSON.stringify(raw))); if (value.ok === false) throw new Error(value.message); return value as T; };
    let prepared = evaluate({ action: 'prepare', id: uid(6101), attemptId: attempt.id, questionId: 'q1', model: 'gemini-test' }); expect(prepared.state).toBe('prepared'); expect(s.rows('aiReservation')).toHaveLength(0); s.as(bob); expect(() => evaluate({ action: 'get', id: prepared.id })).toThrow('disponible'); s.as(alice);
    evaluate({ action: 'authorize', id: prepared.id, generationId: uid(6102), confirmed: true, fingerprint: prepared.fingerprint, model: prepared.model, allowNew: true }); s.as(technical); expect(evaluate<{ claimed: boolean }>({ action: 'claim', id: prepared.id, generationId: uid(6102), actor: alice.toHexString() }).claimed).toBe(true); expect(evaluate<{ claimed: boolean }>({ action: 'claim', id: prepared.id, generationId: uid(6102), actor: alice.toHexString() }).claimed).toBe(false); expect(s.rows('aiReservation')).toHaveLength(1);
    evaluate({ action: 'finish', id: prepared.id, generationId: uid(6102), actor: alice.toHexString(), state: 'succeeded', result: { criteria: [{ criterionId: 'a', points: 1, feedback: 'Sugerencia' }], feedback: 'Revisar' } }); s.as(alice); const accept = { action: 'accept', id: prepared.id, requestId: uid(6103), expectedRevision: attempt.revision, criteria: [{ criterionId: 'a', points: 3, feedback: 'Lo revisé' }], feedback: 'Ajustado' }; attempt = evaluate<ExamAttempt>(accept); expect(attempt.openResult!.points).toBe(3); expect(attempt.answers[0]!.evaluation!.origin).toBe('assisted'); expect(evaluate<ExamAttempt>(accept).revision).toBe(attempt.revision); expect(() => evaluate({ ...accept, criteria: [{ criterionId: 'a', points: 4, feedback: 'Otro' }] })).toThrow('pertenece');
    prepared = evaluate({ action: 'prepare', id: uid(6104), attemptId: attempt.id, questionId: 'q1', model: 'gemini-test' }); evaluate({ action: 'authorize', id: prepared.id, generationId: uid(6105), confirmed: true, fingerprint: prepared.fingerprint, model: prepared.model, allowNew: true }); s.as(technical); evaluate({ action: 'claim', id: prepared.id, generationId: uid(6105), actor: alice.toHexString() }); s.as(alice); evaluate({ action: 'cancel', id: prepared.id }); s.as(technical); const late = evaluate({ action: 'finish', id: prepared.id, generationId: uid(6105), actor: alice.toHexString(), state: 'succeeded', result: { criteria: [{ criterionId: 'a', points: 0, feedback: '' }], feedback: '' } }); expect(late.state).toBe('cancelled'); expect(late.result).toBeUndefined(); expect(s.rows('aiReservation').every((row) => row.status === 'consumed')).toBe(true);
  });
});

describe('EX-3: procedencia independiente al combinar el banco', () => {
  it('conserva selecciones distintas de la misma pregunta y retira solo la respuesta citada', () => {
    const s = setup(); const ctx = s.ctx;
    ctx.db.question.insert({ id: 80n, subjectId: 1n, topic: 'Ciclos', title: 'Dos explicaciones', body: '¿Cómo justificas un ciclo?', author: alice, status: 'resolved', acceptedAnswerId: 81n, resolvedAt: undefined, createdAt: ctx.timestamp });
    for (const [id, body] of [[81n, 'ANSWER_A_SOLO_ORIGEN_RETIRADO'], [82n, 'ANSWER_B_ORIGEN_DISPONIBLE']] as const) ctx.db.answer.insert({ id, questionId: 80n, author: alice, body, createdAt: ctx.timestamp });
    const fromAnswer = (n: number, answerId: string, label: string) => {
      const prep = JSON.parse(ai_prepare({ withTx: (fn: (tx: Ctx) => unknown) => fn(ctx) } as Parameters<typeof ai_prepare>[0], { payload: JSON.stringify({ id: uid(n), model: 'gemini-test', subjectId: '1', topics: ['Ciclos'], sources: [{ kind: 'question', refId: '80', answerIds: [answerId], topics: ['Ciclos'], includeUnplaced: true }], config: { questionCount: 1, types: ['single'], difficulty: 'basic' } }) })) as AiPreparation;
      const seed = s.seed(n + 1, ['1'], 1); const generation = ctx.db.aiGeneration.id.find(seed.generationId)!;
      const fragment = prep.fragments.find((entry) => entry.origins.some((origin) => origin.kind === 'answer' && origin.refId === answerId))!;
      ctx.db.aiGeneration.id.update({ ...generation, preparationId: prep.id, configJson: JSON.stringify(prep.config), resultJson: JSON.stringify({ questions: [{ ...seed.questions[0]!, text: `Pregunta distinta ${label}`, citations: [fragment.id] }] }) });
      const exam = s.approve(s.call<ExamDetail>('importGeneration', { generationId: generation.id, requestId: uid(n + 2), title: label }));
      let bank = s.call<ExamBankDetail>('saveToBank', { examId: exam.id, version: 1, questionId: 'q1', requestId: uid(n + 3) });
      bank = s.call<ExamBankDetail>('setBankVisibility', { bankId: bank.id, expectedVersion: bank.version, visibility: 'group' }); return bank;
    };
    const first = fromAnswer(6500, '81', 'A'); const second = fromAnswer(6520, '82', 'B');
    s.as(bob);
    let variant = s.call<ExamDetail>('createVariant', { requestId: uid(6540), title: 'Dos selecciones', plan: { subjectId: '1', topics: ['Ciclos'], questionCount: 2, types: ['single'], difficulty: 'basic', seed: 'selecciones', bankIds: [first.id, second.id] } });
    expect(variant.draft!.preparation.sources).toHaveLength(2);
    expect(variant.draft!.preparation.sources.map((source) => source.answerIds)).toEqual(expect.arrayContaining([['81'], ['82']]));
    variant = s.approve(variant); let attempt = s.start(variant, 'simulation', 6541);
    attempt = s.call<ExamAttempt>('finishAttempt', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(6542) }); const score = attempt.result;
    expect(JSON.stringify(attempt)).toContain('ANSWER_A_SOLO_ORIGEN_RETIRADO'); expect(JSON.stringify(attempt)).toContain('ANSWER_B_ORIGEN_DISPONIBLE');
    ctx.db.contentStatus.insert({ key: 'answer:81', kind: 'answer', targetId: 81n, withdrawnAt: ctx.timestamp, withdrawnBy: alice, reason: 'Retirada' });
    const reread = s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id });
    expect(reread.questions.find((question) => question.id === first.id)!.unavailable).toBe(true);
    expect(reread.questions.find((question) => question.id === second.id)!.unavailable).not.toBe(true);
    expect(JSON.stringify(reread)).not.toContain('ANSWER_A_SOLO_ORIGEN_RETIRADO'); expect(JSON.stringify(reread)).toContain('ANSWER_B_ORIGEN_DISPONIBLE'); expect(reread.result).toEqual(score);
    purgeExamSource(ctx, 'answer', 81n);
    const purged = s.call<ExamAttempt>('getAttempt', { attemptId: attempt.id });
    expect(purged.questions.find((question) => question.id === second.id)!.unavailable).not.toBe(true); expect(JSON.stringify(purged)).toContain('ANSWER_B_ORIGEN_DISPONIBLE');
  });
});

 it('purga el texto copiado a Repaso sin eliminar sus intervalos privados', () => {
  const s = setup(); const exam = s.approve(s.imported()); const attempt = s.start(exam);
  const closed = s.call<ExamAttempt>('finishAttempt', { attemptId: attempt.id, expectedRevision: attempt.revision, requestId: uid(5800) });
  s.call('sendToSpaced', { attemptId: closed.id, questionId: closed.questions[0]!.id, requestId: uid(5801), question: 'Texto copiado', explanation: 'Explicación privada derivada' });
  expect(s.rows('spacedExamOrigin')).toHaveLength(1);
  const cardId = s.rows('spacedCard')[0]!.id as bigint;
  s.ctx.db.spacedProgress.insert({ key: 'retained-progress', memberId: alice, cardId, cardVersion: 1, step: 3, revision: 2, dueAt: s.ctx.timestamp, reviewedAt: s.ctx.timestamp });
  purgeExamSpacedSource(s.ctx, 'note', 1n);
  expect(s.rows('spacedCard')[0]).toMatchObject({ question: '', explanation: '', hint: '', archived: true });
  expect(s.rows('spacedExamOrigin')).toHaveLength(0); expect(s.rows('spacedProgress')[0]).toMatchObject({ step: 3, revision: 2, dueAt: s.ctx.timestamp });
});
