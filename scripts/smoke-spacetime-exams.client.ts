import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Identity, setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
import { AI_CONSENT_VERSION, type AiGenerationConfig, type AiPreparation } from '../packages/core/src/ai';
import { GUIDE_SECTIONS } from '../packages/core/src/guides';
import type { AiQuestionDraft } from '../packages/core/src/exam';
import type { ExamActionRequest, ExamAttempt, ExamDetail, ExamDraft, ExamSummary } from '../packages/core/src/exams';
import type { ExamBankDetail, ExamBankSummary, ExamVariantPlan, ExamVariantPreview } from '../packages/core/src/exams';
import type { ExamEvaluationDraft } from '../packages/core/src/examEvaluation';
import { encryptAiKey } from '../apps/api/src/ai/crypto';
import { smokeDocumentExpansion } from './smoke-spacetime-documents.client';

interface Baseline { subjectId: string; noteId: string; guideId: string; noteBody: string; guideTitle: string }
interface Options { address: string; database: string; tokens: string[]; baseline?: Baseline; baselineRef?: string; restart(): Promise<void> }
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function clients(options: Pick<Options, 'address' | 'database'>) {
  const open = new Set<DbConnection>();
  return {
    connect: (token: string) => new Promise<DbConnection>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Conexión local vencida.')), 20_000);
      const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none')
        .onConnect((ready) => { clearTimeout(timer); resolve(ready); })
        .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
      open.add(connection);
    }),
    close: () => { for (const connection of open) connection.disconnect(); open.clear(); },
  };
}
function subscribe(connection: DbConnection, views = ['subjects', 'terms', 'notes', 'study_guides', 'change_history']) {
  return new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(views.map((name) => `SELECT * FROM ${name}`));
  });
}
async function initialize(connect: (token: string) => Promise<DbConnection>, tokens: string[]) {
  const owner = await connect(tokens[0]!);
  await owner.reducers.setAuthConfig({ issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['b20-local-smoke'] });
  for (const [index, name] of ['owner', 'author', 'reviewer'].entries())
    await owner.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator: index === 0 });
  await owner.reducers.joinGroup({ displayName: 'Synthetic owner' });
  const author = await connect(tokens[1]!); await author.reducers.joinGroup({ displayName: 'Synthetic author' });
  const peer = await connect(tokens[2]!); await peer.reducers.joinGroup({ displayName: 'Synthetic peer' });
  return { owner, author, peer };
}
export async function seedBaseline(options: Pick<Options, 'address' | 'database' | 'tokens'>): Promise<Baseline> {
  setGlobalLogLevel('error'); const pool = clients(options);
  try {
    const { author } = await initialize(pool.connect, options.tokens); await subscribe(author, ['subjects', 'notes', 'study_guides']);
    await author.reducers.createSubject({ name: 'Synthetic pre-EX2 subject', period: 1 });
    const subjectId = [...author.db.subjects.iter()][0]!.id;
    const noteBody = 'Nota anterior a EX-2, preservada íntegramente durante la migración aditiva.';
    await author.reducers.saveNoteV2({ noteId: undefined, expectedVersion: undefined, subjectId, termId: undefined, session: '',
      topic: 'Ciclos', title: 'Existing shared note', body: noteBody, tags: ['synthetic'], visibility: 'group', source: 'student', assignmentIds: [], activityIds: [], questionIds: [] });
    const noteId = [...author.db.notes.iter()][0]!.id; const guideTitle = 'Existing manual guide before EX-2';
    await author.reducers.createGuide({ subjectId, termId: undefined, title: guideTitle, topics: ['Ciclos'],
      sections: GUIDE_SECTIONS.map(() => 'Contenido manual existente.'), sources: [{ kind: 'nota', refId: noteId }] });
    const guideId = [...author.db.studyGuides.iter()][0]!.id;
    return { subjectId: String(subjectId), noteId: String(noteId), guideId: String(guideId), noteBody, guideTitle };
  } finally { pool.close(); }
}
const noSolutions = (value: unknown, label: string) => {
  const json = JSON.stringify(value);
  assert.ok(!json.includes('correctOptionId') && !json.includes('PRIVATE_SOLUTION') && !json.includes('correct":'), label);
};

export async function runSmoke(options: Options) {
  setGlobalLogLevel('error'); const pool = clients(options); const checks: string[] = [];
  const exam = async <T>(connection: DbConnection, request: ExamActionRequest): Promise<T> => {
    const response = JSON.parse(await connection.procedures.examAction({ payload: JSON.stringify(request) }));
    if (response && typeof response === 'object' && !Array.isArray(response) && response.ok === false)
      throw Object.assign(new Error(String(response.message ?? 'La operación de Exámenes fue rechazada.')), { code: response.code });
    return response as T;
  };
  try {
    let owner: DbConnection, author: DbConnection, peer: DbConnection;
    if (options.baseline) {
      owner = await pool.connect(options.tokens[0]!); author = await pool.connect(options.tokens[1]!); peer = await pool.connect(options.tokens[2]!);
    } else ({ owner, author, peer } = await initialize(pool.connect, options.tokens));
    await subscribe(owner); await subscribe(author); await subscribe(peer);
    const outsider = await pool.connect(options.tokens[3]!);
    await assert.rejects(exam(outsider, { action: 'listExams' }));
    if (options.baseline) {
      const baseline = options.baseline;
      assert.equal([...author.db.notes.iter()].find((row) => String(row.id) === baseline.noteId)?.body, baseline.noteBody);
      const oldGuide = [...author.db.studyGuides.iter()].find((row) => String(row.id) === baseline.guideId)!;
      assert.equal(oldGuide.title, baseline.guideTitle); assert.equal(oldGuide.version, 1);
      assert.equal(oldGuide.sections[0], 'Contenido manual existente.');
      checks.push(`migración aditiva desde ${options.baselineRef ?? 'el bundle indicado'} conserva IDs, notas, guías manuales y versiones con delete-data=never`);
    }
    await author.reducers.createSubject({ name: 'Synthetic EX-2', period: 1 });
    const subjectId = [...author.db.subjects.iter()].find((row) => row.name === 'Synthetic EX-2')!.id;
    await author.reducers.createTerm({ subjectId, name: 'Synthetic term', position: 1 });
    const termId = [...author.db.terms.iter()].find((row) => row.subjectId === subjectId)!.id;
    const noteFields = { subjectId, termId, session: '', topic: 'Ciclos', tags: ['synthetic'], source: 'student', assignmentIds: [], activityIds: [], questionIds: [] };
    const addNote = async (title: string, body: string, visibility: 'group' | 'personal') => {
      await author.reducers.saveNoteV2({ ...noteFields, noteId: undefined, expectedVersion: undefined, title, body, visibility });
      return [...author.db.notes.iter()].find((row) => row.title === title)!.id;
    };
    const sharedId = await addNote('Synthetic public source', 'SOURCE_SHARED_SENTINEL: un ciclo repite instrucciones.', 'group');
    const privateId = await addNote('Synthetic personal source', 'SOURCE_PRIVATE_SENTINEL: material personal del autor.', 'personal');

    const technicalResponse = await fetch(`${options.address}/v1/identity`, { method: 'POST' });
    assert.ok(technicalResponse.ok); const technical = await technicalResponse.json() as { identity: string; token: string };
    await owner.reducers.setAiService({ identity: Identity.fromString(technical.identity), enabled: true, dailyTokenBudget: 100_000 });
    let service = await pool.connect(technical.token);
    const actor = author.identity!.toHexString().replace(/^0x/, '');
    const secret = { AI_MASTER_VERSION: 'v1', AI_MASTER_KEYS_JSON: JSON.stringify({ v1: randomBytes(32).toString('base64') }) };
    await author.procedures.aiSetConsent({ payload: JSON.stringify({ version: AI_CONSENT_VERSION, accepted: true }) });
    const keyId = randomUUID(), intentId = randomUUID();
    await author.procedures.aiAuthorizeKey({ payload: JSON.stringify({ keyId, intentId, provider: 'gemini' }) });
    const envelope = await encryptAiKey(secret, { actor, keyId, provider: 'gemini' }, 'synthetic-exam-key-never-a-real-key');
    await service.procedures.aiCommitKey({ payload: JSON.stringify({ actor, keyId, intentId, provider: 'gemini', ...envelope }) });
    assert.equal(JSON.parse(await peer.procedures.aiKeyStatus({ payload: '{}' })).configured, false);
    const generationResults = new Map<string, AiQuestionDraft>(); let syntheticProviderCalls = 0;
    const generate = async (noteId: bigint | bigint[], questionCount = 2) => {
      const config: AiGenerationConfig = { purpose: 'questions', questionCount, types: questionCount === 1 ? ['single'] : ['single', 'boolean'], difficulty: 'basic', topicWeights: [{ topic: 'Ciclos', weight: 1 }] };
      const preparation = JSON.parse(await author.procedures.aiPrepare({ payload: JSON.stringify({ id: randomUUID(), subjectId: String(subjectId), termId: String(termId),
        topics: ['Ciclos'], sources: (Array.isArray(noteId) ? noteId : [noteId]).map((id) => ({ kind: 'note', refId: String(id), topics: ['Ciclos'], includeUnplaced: false })), config, model: 'synthetic-no-network' }) })) as AiPreparation;
      assert.equal(preparation.canGenerate, true);
      assert.deepEqual(preparation.config, config, 'la preparación conserva el propósito y el plano de Exámenes');
      assert.ok(preparation.estimatedInputTokens > 0 && preparation.estimatedOutputTokens > 0);
      const generationId = randomUUID();
      await author.procedures.aiAuthorizeGeneration({ payload: JSON.stringify({ id: generationId, preparationId: preparation.id, fingerprint: preparation.fingerprint, config, model: preparation.model, confirmed: true, allowNew: true }) });
      const claimed = JSON.parse(await service.procedures.aiClaimGeneration({ payload: JSON.stringify({ id: generationId, actor }) })); assert.equal(claimed.claimed, true);
      assert.deepEqual(claimed.config, config);
      assert.equal(claimed.preparation.fingerprint, preparation.fingerprint);
      assert.equal(claimed.preparation.model, 'synthetic-no-network');
      const citations = preparation.fragments.map((fragment) => fragment.id);
      const result: AiQuestionDraft = { questions: [{ id: 'loop', type: 'single', text: 'QUESTION_LOOP_SENTINEL: ¿qué hace un ciclo?',
        options: [{ id: 'a', text: 'Repite instrucciones' }, { id: 'b', text: 'Borra todo' }, { id: 'c', text: 'Cierra la app' }, { id: 'd', text: 'Envía correo' }],
        correctOptionId: 'a', explanation: 'PRIVATE_SOLUTION_LOOP: repite instrucciones mientras se cumple su condición.', topic: 'Ciclos', citations },
      ...(questionCount === 2 ? [{ id: 'condition', type: 'boolean' as const, text: 'QUESTION_CONDITION_SENTINEL: un ciclo puede tener una condición.', options: [{ id: 'true', text: 'Verdadero' }, { id: 'false', text: 'Falso' }], correctOptionId: 'true', explanation: 'PRIVATE_SOLUTION_CONDITION: la condición decide la repetición.', topic: 'Ciclos', citations }] : [])] };
      await service.procedures.aiFinishGeneration({ payload: JSON.stringify({ id: generationId, actor, state: 'succeeded', result, usage: { inputTokens: 100, outputTokens: 200 } }) });
      syntheticProviderCalls++; generationResults.set(generationId, result); return generationId;
    };
    const groupGenerationId = await generate(sharedId);
    const ownGenerations = await exam<{ id: string }[]>(author, { action: 'listGenerations' });
    assert.ok(ownGenerations.some((row) => row.id === groupGenerationId)); noSolutions(ownGenerations, 'las generaciones se listan sin resultado ni solucionario');
    assert.deepEqual(await exam(peer, { action: 'listGenerations' }), []);
    await assert.rejects(exam(peer, { action: 'importGeneration', requestId: randomUUID(), generationId: groupGenerationId, title: 'Steal another generation' }));
    await assert.rejects(exam(service, { action: 'listExams' }));
    for (const table of ['exam', 'exam_version', 'exam_attempt', 'exam_operation', 'exam_generation_import', 'ai_key']) await assert.rejects(subscribe(peer, [table]));
    const importedRequest: ExamActionRequest = { action: 'importGeneration', requestId: randomUUID(), generationId: groupGenerationId, title: 'Synthetic shared exam', timeLimitSeconds: 60 };
    const imported = await Promise.all([exam<ExamDetail>(author, importedRequest), exam<ExamDetail>(author, importedRequest)]);
    let detail = imported[0]!; assert.equal(imported[1]!.id, detail.id); assert.equal(detail.visibility, 'personal'); assert.ok(detail.draft);
    const examId = detail.id;
    assert.ok(!(await exam<ExamSummary[]>(peer, { action: 'listExams' })).some((row) => row.id === examId));
    await assert.rejects(exam(peer, { action: 'getExam', examId }));
    await assert.rejects(exam(author, { action: 'approveVersion', examId, version: 1, expectedRevision: detail.revision, reviewedQuestionIds: ['loop'] }));
    detail = await exam<ExamDetail>(author, { action: 'approveVersion', examId, version: 1, expectedRevision: detail.revision, reviewedQuestionIds: detail.draft!.questions.map((question) => question.id) });
    await assert.rejects(exam(author, { action: 'saveDraft', examId, version: 1, expectedRevision: detail.revision, title: detail.title, config: imported[0]!.draft!.config, questions: imported[0]!.draft!.questions, timeLimitSeconds: 60 }));
    detail = await exam<ExamDetail>(author, { action: 'setVisibility', examId, expectedRevision: detail.revision, visibility: 'group' });
    const publicDetail = await exam<ExamDetail>(peer, { action: 'getExam', examId }); noSolutions(publicDetail, 'el catálogo compartido no revela soluciones'); assert.equal(publicDetail.draft, undefined);
    await assert.rejects(exam(peer, { action: 'getVersion', examId, version: 1 }));
    await assert.rejects(exam(owner, { action: 'getVersion', examId, version: 1 }));
    checks.push('generación EX-1 autorizada se importa una vez, borrador privado, revisión expresa y versión lista inmutable; catálogo sin solucionario');

    let timed = await exam<ExamAttempt>(peer, { action: 'startAttempt', examId, version: 1, mode: 'simulation', requestId: randomUUID() });
    assert.equal(timed.state, 'active'); assert.ok(timed.deadlineAt! >= timed.startedAt + 60_000); noSolutions(timed, 'simulacro inicial no contiene corrección');
    const timedId = timed.id, timedDeadline = timed.deadlineAt!, initialOrder = JSON.stringify(timed.questions.map((question) => [question.id, question.options.map((option) => option.id)]));
    const attemptRequest: ExamActionRequest = { action: 'startAttempt', examId, version: 1, mode: 'practice', requestId: randomUUID() };
    const duplicateAttempts = await Promise.all([exam<ExamAttempt>(peer, attemptRequest), exam<ExamAttempt>(peer, attemptRequest)]);
    let practice = duplicateAttempts[0]!; assert.equal(practice.id, duplicateAttempts[1]!.id); noSolutions(practice, 'práctica inicial oculta todas las respuestas');
    const firstAnswer: ExamActionRequest = { action: 'confirmAnswer', attemptId: practice.id, expectedRevision: practice.revision, requestId: randomUUID(), questionId: 'loop', optionId: 'a' };
    const confirmations = await Promise.all([exam<ExamAttempt>(peer, firstAnswer), exam<ExamAttempt>(peer, firstAnswer)]);
    practice = confirmations[0]!; assert.equal(practice.revision, confirmations[1]!.revision);
    assert.equal(practice.questions.find((question) => question.id === 'loop')?.solution?.correctOptionId, 'a');
    assert.equal(practice.questions.find((question) => question.id === 'condition')?.solution, undefined);
    await assert.rejects(exam(peer, { ...firstAnswer, expectedRevision: practice.revision, requestId: randomUUID(), optionId: 'b' }));
    const conflicting = await Promise.allSettled(['true', 'false'].map((optionId) => exam<ExamAttempt>(peer, { action: 'confirmAnswer', attemptId: practice.id, expectedRevision: practice.revision, requestId: randomUUID(), questionId: 'condition', optionId })));
    assert.equal(conflicting.filter((reply) => reply.status === 'fulfilled').length, 1);
    practice = await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: practice.id });
    const expectedCorrect = 1 + Number(practice.answers.find((answer) => answer.questionId === 'condition')?.optionId === 'true');
    const finishPractice: ExamActionRequest = { action: 'finishAttempt', attemptId: practice.id, expectedRevision: practice.revision, requestId: randomUUID() };
    const closedPractice = await Promise.all([exam<ExamAttempt>(peer, finishPractice), exam<ExamAttempt>(peer, finishPractice)]);
    practice = closedPractice[0]!; assert.deepEqual(practice.result, closedPractice[1]!.result);
    assert.equal(practice.result?.correct, expectedCorrect); assert.equal(practice.result?.total, 2);
    for (const person of [owner, author]) {
      await assert.rejects(exam(person, { action: 'getAttempt', attemptId: practice.id }));
      assert.ok(!(await exam<{ id: string }[]>(person, { action: 'listAttempts' })).some((row) => row.id === practice.id));
    }
    checks.push('práctica confirma irreversiblemente por pregunta, duplicados no escriben dos veces, CAS resuelve respuestas simultáneas e intentos/resultados son privados incluso para autor y administración');

    const beforeSave = timed.revision;
    const simulationRace = await Promise.allSettled(['a', 'b'].map((optionId) => exam<ExamAttempt>(peer, { action: 'saveAnswer', attemptId: timed.id, expectedRevision: beforeSave, requestId: randomUUID(), questionId: 'loop', optionId })));
    assert.equal(simulationRace.filter((reply) => reply.status === 'fulfilled').length, 1);
    timed = await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: timed.id });
    timed = await exam<ExamAttempt>(peer, { action: 'saveAnswer', attemptId: timed.id, expectedRevision: timed.revision, requestId: randomUUID(), questionId: 'loop', optionId: 'a' });
    noSolutions(timed, 'guardar respuesta en simulacro no revela corrección ni puntaje');
    const savedRevision = timed.revision, practiceResult = practice.result, practiceId = practice.id;
    pool.close(); await options.restart();
    owner = await pool.connect(options.tokens[0]!); author = await pool.connect(options.tokens[1]!); peer = await pool.connect(options.tokens[2]!); service = await pool.connect(technical.token);
    await subscribe(owner); await subscribe(author); await subscribe(peer);
    timed = await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: timedId });
    assert.equal(timed.revision, savedRevision); assert.equal(timed.deadlineAt, timedDeadline); assert.equal(timed.answers.find((answer) => answer.questionId === 'loop')?.optionId, 'a');
    assert.equal(JSON.stringify(timed.questions.map((question) => [question.id, question.options.map((option) => option.id)])), initialOrder);
    assert.deepEqual((await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: practiceId })).result, practiceResult);
    await author.procedures.aiDeleteKey({ payload: '{}' });
    checks.push('reinicio real conserva versión, orden, respuestas, resultados y vencimiento; reanudar y resolver no necesitan clave ni llamadas a Gemini');

    detail = await exam<ExamDetail>(author, { action: 'getExam', examId });
    detail = await exam<ExamDetail>(author, { action: 'setArchived', examId, expectedRevision: detail.revision, archived: true });
    await assert.rejects(exam(peer, { action: 'startAttempt', examId, version: 1, mode: 'practice', requestId: randomUUID() }));
    assert.equal((await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: timedId })).contentUnavailable, false);
    detail = await exam<ExamDetail>(author, { action: 'setArchived', examId, expectedRevision: detail.revision, archived: false });
    detail = await exam<ExamDetail>(author, { action: 'setVisibility', examId, expectedRevision: detail.revision, visibility: 'personal' });
    const unshared = await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: practiceId });
    assert.deepEqual(unshared.result, practiceResult); assert.equal(unshared.contentUnavailable, true);
    assert.ok(unshared.questions.every((question) => question.unavailable && !question.solution));
    await assert.rejects(exam(peer, { action: 'startAttempt', examId, version: 1, mode: 'practice', requestId: randomUUID() }));
    detail = await exam<ExamDetail>(author, { action: 'setVisibility', examId, expectedRevision: detail.revision, visibility: 'group' });
    timed = await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: timedId });
    assert.equal(timed.deadlineAt, timedDeadline); assert.equal(timed.contentUnavailable, false);
    checks.push('archivar bloquea solo intentos nuevos; dejar de compartir redacta intentos existentes y conserva sus resultados; restaurar acceso no reinicia el plazo');

    const nextKey = randomUUID(), nextIntent = randomUUID();
    await author.procedures.aiAuthorizeKey({ payload: JSON.stringify({ keyId: nextKey, intentId: nextIntent, provider: 'gemini' }) });
    await service.procedures.aiCommitKey({ payload: JSON.stringify({ actor, keyId: nextKey, intentId: nextIntent, provider: 'gemini', ...await encryptAiKey(secret, { actor, keyId: nextKey, provider: 'gemini' }, 'synthetic-exam-key-never-a-real-key') }) });

    detail = await exam<ExamDetail>(author, { action: 'getExam', examId });
    detail = await exam<ExamDetail>(author, { action: 'forkVersion', examId, expectedRevision: detail.revision, version: 1, requestId: randomUUID() });
    assert.equal(detail.draft!.version, 2);
    const replacementId = await generate(sharedId, 1);
    const replacement: ExamActionRequest = { action: 'replaceQuestions', examId, expectedRevision: detail.revision, version: 2,
      requestId: randomUUID(), generationId: replacementId, questionIds: ['loop'] };
    const replacementReplies = await Promise.all([exam<ExamDetail>(author, replacement), exam<ExamDetail>(author, replacement)]);
    detail = replacementReplies[0]!; assert.equal(detail.revision, replacementReplies[1]!.revision);
    assert.equal(detail.draft!.questions.length, 2);
    assert.equal(detail.draft!.questions.find((question) => question.id === 'condition')?.text, generationResults.get(groupGenerationId)!.questions.find((question) => question.id === 'condition')?.text);
    const modified = structuredClone(detail.draft!);
    modified.questions[0]!.text = 'QUESTION_NEW_VERSION_SENTINEL: versión nueva.'; modified.questions[0]!.correctOptionId = 'b';
    detail = await exam<ExamDetail>(author, { action: 'saveDraft', examId, expectedRevision: detail.revision, version: 2, title: modified.title, config: modified.config, timeLimitSeconds: modified.timeLimitSeconds, questions: modified.questions });
    detail = await exam<ExamDetail>(author, { action: 'approveVersion', examId, version: 2, expectedRevision: detail.revision, reviewedQuestionIds: modified.questions.map((question) => question.id) });
    const versionOne = await exam<ExamDraft>(author, { action: 'getVersion', examId, version: 1 });
    assert.equal(versionOne.questions.find((question) => question.id === 'loop')?.correctOptionId, 'a');
    assert.deepEqual((await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: practiceId })).result, practiceResult);
    timed = await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: timedId }); assert.equal(timed.examVersion, 1);
    assert.ok(timed.questions.some((question) => question.text.includes('QUESTION_LOOP_SENTINEL')));
    checks.push('regeneración parcial idempotente conserva las preguntas no seleccionadas; editar una versión lista crea otra y mantiene corrección y puntaje anteriores');
    const privateGenerationId = await generate(privateId);
    let privateExam = await exam<ExamDetail>(author, { action: 'importGeneration', requestId: randomUUID(), generationId: privateGenerationId, title: 'Synthetic personal exam' });
    privateExam = await exam<ExamDetail>(author, { action: 'approveVersion', examId: privateExam.id, expectedRevision: privateExam.revision, version: 1, reviewedQuestionIds: privateExam.draft!.questions.map((question) => question.id) });
    await assert.rejects(exam(author, { action: 'setVisibility', examId: privateExam.id, expectedRevision: privateExam.revision, visibility: 'group' }));
    await author.reducers.publishNoteVersion({ noteId: privateId, expectedVersion: 1 });
    await assert.rejects(exam(author, { action: 'setVisibility', examId: privateExam.id, expectedRevision: privateExam.revision, visibility: 'group' }));
    await assert.rejects(exam(peer, { action: 'getExam', examId: privateExam.id }));
    checks.push('una fuente personal fuerza examen privado; publicar una copia de la nota no sanea ni comparte el examen anterior');

    const publishedCopy = [...author.db.notes.iter()].find((note) => note.visibility === 'group' && note.title === 'Synthetic personal source')!;
    assert.ok(publishedCopy); const groupCopyGeneration = await generate(publishedCopy.id);
    privateExam = await exam<ExamDetail>(author, { action: 'forkVersion', examId: privateExam.id, expectedRevision: privateExam.revision, version: 1, requestId: randomUUID() });
    privateExam = await exam<ExamDetail>(author, { action: 'replaceQuestions', examId: privateExam.id, expectedRevision: privateExam.revision, version: 2,
      requestId: randomUUID(), generationId: groupCopyGeneration, questionIds: privateExam.draft!.questions.map((question) => question.id) });
    privateExam = await exam<ExamDetail>(author, { action: 'approveVersion', examId: privateExam.id, expectedRevision: privateExam.revision, version: 2, reviewedQuestionIds: privateExam.draft!.questions.map((question) => question.id) });
    privateExam = await exam<ExamDetail>(author, { action: 'setVisibility', examId: privateExam.id, expectedRevision: privateExam.revision, visibility: 'group' });
    const oldPrivateVersion = await exam<ExamDraft>(author, { action: 'getVersion', examId: privateExam.id, version: 1 });
    assert.equal(oldPrivateVersion.hasPersonalSources, true);
    const newPublicVersion = await exam<ExamDetail>(peer, { action: 'getExam', examId: privateExam.id });
    assert.equal(newPublicVersion.readyVersion, 2); assert.ok(newPublicVersion.versions.every((version) => version.version === 2 && !version.hasPersonalSources));
    checks.push('una versión nueva que reemplaza todas sus preguntas desde copias públicas sí se comparte, conservando inaccesible la versión personal original');

    const duplicateId = await addNote('Synthetic duplicate source', 'SOURCE_SHARED_SENTINEL: un ciclo repite instrucciones.', 'group');
    const deduplicatedGenerationId = await generate([sharedId, duplicateId]);
    let deduplicatedExam = await exam<ExamDetail>(author, { action: 'importGeneration', requestId: randomUUID(), generationId: deduplicatedGenerationId, title: 'Synthetic deduplicated citations' });
    assert.equal(deduplicatedExam.draft!.preparation.fragments.length, 1);
    assert.equal(deduplicatedExam.draft!.preparation.fragments[0]!.origins.length, 2);
    deduplicatedExam = await exam<ExamDetail>(author, { action: 'approveVersion', examId: deduplicatedExam.id, expectedRevision: deduplicatedExam.revision, version: 1, reviewedQuestionIds: deduplicatedExam.draft!.questions.map((question) => question.id) });
    deduplicatedExam = await exam<ExamDetail>(author, { action: 'setVisibility', examId: deduplicatedExam.id, expectedRevision: deduplicatedExam.revision, visibility: 'group' });
    let deduplicatedAttempt = await exam<ExamAttempt>(peer, { action: 'startAttempt', examId: deduplicatedExam.id, version: 1, mode: 'practice', requestId: randomUUID() });
    deduplicatedAttempt = await exam<ExamAttempt>(peer, { action: 'confirmAnswer', attemptId: deduplicatedAttempt.id, expectedRevision: deduplicatedAttempt.revision, requestId: randomUUID(), questionId: 'loop', optionId: 'a' });
    await author.reducers.withdrawContent({ kind: 'note', targetId: duplicateId, expectedVersion: 1, withdrawn: true, reason: 'Synthetic duplicate withdrawal' });
    deduplicatedAttempt = await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: deduplicatedAttempt.id });
    const survivingCitation = deduplicatedAttempt.questions.find((question) => question.id === 'loop')!.solution!.citations[0]!;
    assert.ok(survivingCitation.text.includes('SOURCE_SHARED_SENTINEL')); assert.ok(survivingCitation.origins.length);
    assert.ok(survivingCitation.origins.every((origin) => origin.refId === String(sharedId)));
    checks.push('una cita deduplicada conserva texto por el origen todavía accesible y elimina los orígenes retirados');
    const documentSmoke = await smokeDocumentExpansion({ author, peer, owner, service, subjectId, termId, secret });
    checks.push(...documentSmoke.checks); syntheticProviderCalls += documentSmoke.syntheticProviderCalls;

    const ex3 = await smokeExamBankAndOpen({ author, peer, service, subjectId: String(subjectId), termId: String(termId), examId, privateExamId: privateExam.id, secret, checks });
    pool.close(); await options.restart(); owner = await pool.connect(options.tokens[0]!); author = await pool.connect(options.tokens[1]!); peer = await pool.connect(options.tokens[2]!); service = await pool.connect(technical.token); await subscribe(owner); await subscribe(author); await subscribe(peer);
    assert.ok((await exam<ExamBankSummary[]>(peer, { action: 'listBank' })).some((row) => row.id === ex3.bankId)); assert.equal((await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: ex3.attemptId })).openResult?.points, 3); checks.push('reinicio EX-3 conserva banco, versiones de preguntas, evaluación abierta y aceptación IA idempotente');

    await author.reducers.saveNoteV2({ ...noteFields, noteId: sharedId, expectedVersion: 1, title: 'Synthetic public source', body: 'SOURCE_NEW_SENTINEL: texto cambiado sin retirar el material.', visibility: 'group' });
    const outdated = await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: practiceId });
    assert.deepEqual(outdated.result, practiceResult); assert.ok(outdated.sourceIssues.some((issue) => issue.state === 'outdated'));
    const normalChangeAttempt = await exam<ExamAttempt>(peer, { action: 'startAttempt', examId, version: detail.readyVersion!, mode: 'practice', requestId: randomUUID() });
    assert.equal(normalChangeAttempt.examVersion, 2);

    // The real server clock enforces the original 60-second deadline. No input can override it.
    const remaining = timedDeadline - Date.now() + 75;
    if (remaining > 0) await pause(Math.min(60_000, remaining));
    timed = await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: timedId });
    assert.equal(timed.state, 'closed'); assert.equal(timed.closeReason, 'timeout');
    assert.equal(timed.result?.correct, 1); assert.equal(timed.result?.total, 2); assert.equal(timed.result?.percentage, 50);
    assert.ok(timed.questions.every((question) => question.solution));
    const lateAnswer = await exam<ExamAttempt>(peer, { action: 'saveAnswer', attemptId: timedId, expectedRevision: timed.revision, requestId: randomUUID(), questionId: 'condition', optionId: 'true' }).catch(() => undefined);
    if (lateAnswer) { assert.equal(lateAnswer.state, 'closed'); assert.equal(lateAnswer.answers.find((answer) => answer.questionId === 'condition')?.optionId, undefined); assert.deepEqual(lateAnswer.result, timed.result); }
    const timeoutRetry = await exam<ExamAttempt>(peer, { action: 'finishAttempt', attemptId: timedId, expectedRevision: timed.revision, requestId: randomUUID() });
    assert.deepEqual(timeoutRetry.result, timed.result); assert.equal(timeoutRetry.deadlineAt, timedDeadline);
    checks.push('vencimiento real original cierra simulacro, lo no respondido cuenta incorrecto, revela soluciones solo al cerrar y prohíbe respuestas tardías');

    await author.reducers.withdrawContent({ kind: 'note', targetId: sharedId, expectedVersion: 2, withdrawn: true, reason: 'Synthetic source withdrawal' });
    const redacted = await exam<ExamAttempt>(peer, { action: 'getAttempt', attemptId: practiceId });
    assert.deepEqual(redacted.result, practiceResult); assert.equal(redacted.contentUnavailable, true);
    const historical = JSON.stringify(redacted);
    for (const sentinel of ['QUESTION_LOOP_SENTINEL', 'QUESTION_CONDITION_SENTINEL', 'PRIVATE_SOLUTION', 'SOURCE_SHARED_SENTINEL']) assert.ok(!historical.includes(sentinel), `no exponer origen retirado: ${sentinel}`);
    await assert.rejects(exam(peer, { action: 'startAttempt', examId, version: 1, mode: 'practice', requestId: randomUUID() }));
    await owner.reducers.removeMember({ identity: peer.identity! });
    await assert.rejects(exam(peer, { action: 'listAttempts' })); await assert.rejects(exam(peer, { action: 'getAttempt', attemptId: practiceId }));
    const publicHistory = JSON.stringify([...owner.db.changeHistory.iter()], (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value);
    assert.ok(!publicHistory.includes(examId) && !publicHistory.includes(practiceId) && !publicHistory.includes(timedId));
    checks.push('retirada bloquea intentos nuevos y redacta preguntas, explicación y citas históricas sin recalificar; baja revoca acceso y acciones privadas no llegan al historial público');
    return { checks, migrationRehearsed: !!options.baseline, ...(options.baseline ? { baselineRef: options.baselineRef ?? 'provided bundle' } : {}), syntheticProviderCalls, realGeminiCalls: 0,
      persistedQuestionFingerprint: createHash('sha256').update(JSON.stringify(generationResults.get(groupGenerationId))).digest('hex') };
  } finally { pool.close(); }
}

async function smokeExamBankAndOpen(input: { author: DbConnection; peer: DbConnection; service: DbConnection; subjectId: string; termId: string; examId: string; privateExamId: string; secret: { AI_MASTER_VERSION: string; AI_MASTER_KEYS_JSON: string }; checks: string[] }) {
  const { author, peer, service } = input;
  const action = async <T>(connection: DbConnection, value: ExamActionRequest): Promise<T> => { const result = JSON.parse(await connection.procedures.examAction({ payload: JSON.stringify(value) })); if (result?.ok === false) throw new Error(result.message); return result as T; };
  const evaluation = async <T>(connection: DbConnection, value: Record<string, unknown>): Promise<T> => { const result = JSON.parse(await connection.procedures.examEvaluationAi({ payload: JSON.stringify(value) })); if (result?.ok === false) throw new Error(result.message); return result as T; };
  const save = { action: 'saveToBank' as const, examId: input.examId, version: 2, questionId: 'loop', requestId: randomUUID() }; let bank = await action<ExamBankDetail>(author, save); assert.equal(bank.visibility, 'personal'); assert.equal((await action<ExamBankDetail>(author, save)).id, bank.id); assert.equal((await action<ExamBankSummary[]>(peer, { action: 'listBank' })).length, 0);
  bank = await action(author, { action: 'setBankVisibility', bankId: bank.id, expectedVersion: 1, visibility: 'group' }); const second = await action<ExamBankDetail>(author, { ...save, questionId: 'condition', requestId: randomUUID() }); await action(author, { action: 'setBankVisibility', bankId: second.id, expectedVersion: 1, visibility: 'group' }); const catalog = await action<ExamBankSummary[]>(peer, { action: 'listBank' }); noSolutions(catalog, 'banco compartido oculta soluciones'); await assert.rejects(action(peer, { action: 'setBankVisibility', bankId: bank.id, expectedVersion: 1, visibility: 'personal' }));
  const plan: ExamVariantPlan = { subjectId: input.subjectId, termId: input.termId, topics: ['Ciclos'], questionCount: 2, types: ['single', 'boolean'], difficulty: 'basic', seed: 'synthetic-repeatable', bankIds: [bank.id, second.id] }; const preview = await action<ExamVariantPreview>(peer, { action: 'previewVariant', plan }); assert.equal(preview.deficits.length, 0); assert.deepEqual(await action(peer, { action: 'previewVariant', plan }), preview); assert.ok((await action<ExamVariantPreview>(peer, { action: 'previewVariant', plan: { ...plan, questionCount: 3 } })).deficits.length);
  let copy = await action<ExamDetail>(author, { action: 'createVariant', plan, title: 'Synthetic EX-3 open copy', requestId: randomUUID() }); assert.equal(copy.visibility, 'personal'); const draft = copy.draft!; const openId = draft.questions[0]!.id; const questions = draft.questions.map((question, index) => index ? question : { ...question, type: 'open' as const, options: [], correctOptionId: '', referenceAnswer: 'PRIVATE_SOLUTION_OPEN_REFERENCE', rubric: { version: 1, criteria: [{ id: 'logic', description: 'PRIVATE_RUBRIC_LOGIC', maxPoints: 4 }] } }); copy = await action(author, { action: 'saveDraft', examId: copy.id, expectedRevision: copy.revision, version: 1, title: copy.title, config: { ...draft.config, types: ['single', 'boolean', 'open'] }, questions }); copy = await action(author, { action: 'approveVersion', examId: copy.id, expectedRevision: copy.revision, version: 1, reviewedQuestionIds: questions.map((question) => question.id) }); copy = await action(author, { action: 'setVisibility', examId: copy.id, expectedRevision: copy.revision, visibility: 'group' });
  let attempt = await action<ExamAttempt>(peer, { action: 'startAttempt', examId: copy.id, version: 1, mode: 'simulation', requestId: randomUUID() }); noSolutions(attempt, 'respuesta abierta en curso oculta referencia y rúbrica'); assert.ok(!JSON.stringify(attempt).includes('PRIVATE_RUBRIC_LOGIC')); attempt = await action(peer, { action: 'saveAnswer', attemptId: attempt.id, expectedRevision: attempt.revision, requestId: randomUUID(), questionId: openId, text: 'Argumento sintético' }); attempt = await action(peer, { action: 'finishAttempt', attemptId: attempt.id, expectedRevision: attempt.revision, requestId: randomUUID() }); assert.equal(attempt.result!.total, 1); assert.equal(attempt.openResult!.pending, 1); const manual = { action: 'evaluateOpenAnswer' as const, attemptId: attempt.id, expectedRevision: attempt.revision, requestId: randomUUID(), questionId: openId, criteria: [{ criterionId: 'logic', points: 2, feedback: 'Revisión manual' }], feedback: 'Mi evaluación manual' }; attempt = await action(peer, manual); assert.equal(attempt.openResult!.points, 2); assert.equal((await action<ExamAttempt>(peer, manual)).revision, attempt.revision);
  const privateBank = await action<ExamBankDetail>(author, { action: 'saveToBank', examId: input.privateExamId, version: 1, questionId: 'loop', requestId: randomUUID() }); await assert.rejects(action(author, { action: 'setBankVisibility', bankId: privateBank.id, expectedVersion: 1, visibility: 'group' }));
  input.checks.push('EX-3 banco privado y voluntariamente compartido, catálogo sin solucionario, copia independiente, plano reproducible y déficit; abiertas ocultas hasta cierre y evaluación manual por rúbrica separada');
  const actor = peer.identity!.toHexString().replace(/^0x/, ''); const keyId = randomUUID(), intentId = randomUUID(); await peer.procedures.aiSetConsent({ payload: JSON.stringify({ version: AI_CONSENT_VERSION, accepted: true }) }); await peer.procedures.aiAuthorizeKey({ payload: JSON.stringify({ keyId, intentId, provider: 'gemini' }) }); await service.procedures.aiCommitKey({ payload: JSON.stringify({ actor, keyId, intentId, provider: 'gemini', ...await encryptAiKey(input.secret, { actor, keyId, provider: 'gemini' }, 'synthetic-ex3-evaluation-key') }) });
  const prepared = await evaluation<ExamEvaluationDraft>(peer, { action: 'prepare', id: randomUUID(), attemptId: attempt.id, questionId: openId, model: 'synthetic-no-network' }); await assert.rejects(evaluation(author, { action: 'get', id: prepared.id })); const generationId = randomUUID(); await evaluation(peer, { action: 'authorize', id: prepared.id, generationId, confirmed: true, fingerprint: prepared.fingerprint, model: prepared.model, allowNew: true }); const claim = await evaluation<{ claimed: boolean }>(service, { action: 'claim', actor, id: prepared.id, generationId }); assert.equal(claim.claimed, true); assert.equal((await evaluation<{ claimed: boolean }>(service, { action: 'claim', actor, id: prepared.id, generationId })).claimed, false); await evaluation(service, { action: 'finish', actor, id: prepared.id, generationId, state: 'succeeded', result: { criteria: [{ criterionId: 'logic', points: 1, feedback: 'Sugerencia revisable' }], feedback: 'Sugerencia sintética' }, usage: { inputTokens: 100, outputTokens: 200 } });
  const accept = { action: 'accept', id: prepared.id, expectedRevision: attempt.revision, requestId: randomUUID(), criteria: [{ criterionId: 'logic', points: 3, feedback: 'Ajustado expresamente por mí' }], feedback: 'Mi evaluación revisada' }; attempt = await evaluation(peer, accept); assert.equal(attempt.openResult!.points, 3); assert.equal(attempt.answers.find((answer) => answer.questionId === openId)!.evaluation!.origin, 'assisted'); assert.equal((await evaluation<ExamAttempt>(peer, accept)).revision, attempt.revision); input.checks.push('EX-3 sugerencia IA persistente autorizada con BYOK y cuota compartida; claim repetido no reenvía, solo dueño acepta o ajusta criterios y aceptación idempotente');
  return { bankId: bank.id, attemptId: attempt.id };
}
