import { SenderError } from 'spacetimedb/server';
import { aiHash, aiRecord, aiSourceFingerprint, aiUuid, sanitizeAiText, validateAiGenerationConfig,
  type AiGenerationConfig, type AiPreparation } from '../../core/src/ai';
import { validateAiQuestionDraft, type AiQuestion } from '../../core/src/exam';
import { examAttemptOrder, examTopicDistribution, scoreExam, type ExamAttempt, type ExamAttemptSummary, type ExamDetail,
  type ExamDraft, type ExamEditableQuestion, type ExamGenerationSummary, type ExamScore, type ExamSourceIssue, type ExamSummary,
  type ExamVersionSummary } from '../../core/src/exams';
import { activeMember, expectVersion, type Ctx } from './moduleContext';
import { resolveAiSource } from './aiHandlers';

type ExamRow = NonNullable<ReturnType<Ctx['db']['studyExam']['id']['find']>>;
type VersionRow = NonNullable<ReturnType<Ctx['db']['examVersion']['key']['find']>>;
type AttemptRow = NonNullable<ReturnType<Ctx['db']['examAttempt']['id']['find']>>;
interface StoredVersion { title: string; config: AiGenerationConfig; timeLimitSeconds?: number; preparation: AiPreparation; questions: ExamEditableQuestion[];
  approvedAt?: number; hasPersonalSources: boolean }
interface StoredAttempt { title: string; mode: 'practice' | 'simulation'; startedAt: number; deadlineAt?: number; closedAt?: number;
  closeReason?: 'submitted' | 'timeout'; order: { questionId: string; optionIds: string[] }[];
  answers: Record<string, { optionId: string; confirmed: boolean }>; result?: ExamScore }
function fail(code: string, message: string): never { throw new SenderError(`${code}:${message}`); }
function obj(value: unknown) { if (!aiRecord(value)) fail('invalid', 'Se esperaba un objeto.'); return value; }
function uuid(value: unknown, label = 'El identificador') { if (!aiUuid(value)) fail('invalid', `${label} debe ser UUID.`); return value.toLowerCase(); }
function integer(value: unknown, label: string, max = 0xffffffff) { if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max) fail('invalid', `${label} inválida.`); return Number(value); }
function text(value: unknown, label: string, max = 200) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid', `${label} inválido.`); return sanitizeAiText(value.trim()); }
function now(ctx: Ctx) { return Number(ctx.timestamp.microsSinceUnixEpoch / 1000n); }
function at(timestamp: Ctx['timestamp']) { return Number(timestamp.microsSinceUnixEpoch / 1000n); }
function timeLimit(value: unknown) { if (value === undefined) return undefined; if (!Number.isInteger(value) || Number(value) < 60 || Number(value) > 10800) fail('invalid', 'El tiempo debe ser de 60 a 10 800 segundos.'); return Number(value); }
function own(ctx: Ctx, examId: unknown) { activeMember(ctx); const exam = ctx.db.studyExam.id.find(uuid(examId)); if (!exam || !exam.owner.isEqual(ctx.sender)) fail('unavailable', 'Este examen no está disponible para editarlo.'); return exam; }
function readable(ctx: Ctx, examId: unknown) { activeMember(ctx); const exam = ctx.db.studyExam.id.find(uuid(examId)); if (!exam || !(exam.owner.isEqual(ctx.sender) || exam.visibility === 'group')) fail('unavailable', 'El examen no está disponible.'); return exam; }
function requireVersion(ctx: Ctx, examId: string, version: unknown) { const row = ctx.db.examVersion.key.find(`${examId}:${integer(version, 'Versión')}`); if (!row) fail('unavailable', 'La versión no existe.'); return row; }
function data(row: VersionRow) { return JSON.parse(row.json) as StoredVersion; }
function attemptData(row: AttemptRow) { return JSON.parse(row.json) as StoredAttempt; }
function ownAttempt(ctx: Ctx, attemptId: unknown) { activeMember(ctx); const row = ctx.db.examAttempt.id.find(uuid(attemptId)); if (!row || !row.actor.isEqual(ctx.sender)) fail('unavailable', 'El intento no está disponible.'); return row; }
function bump(ctx: Ctx, exam: ExamRow, changes: Partial<ExamRow> = {}) { const next = { ...exam, ...changes, revision: exam.revision + 1, updatedAt: ctx.timestamp }; ctx.db.studyExam.id.update(next); return next; }
function mutable(ctx: Ctx, raw: Record<string, unknown>) {
  const exam = own(ctx, raw.examId); expectVersion(exam.revision, integer(raw.expectedRevision, 'Revisión'));
  const version = requireVersion(ctx, exam.id, raw.version);
  if (exam.archived || version.state !== 'draft' || version.version !== exam.draftVersion) fail('conflict', 'La versión lista es inmutable. Crea primero otro borrador.');
  return { exam, version, value: data(version) };
}
function operation(ctx: Ctx, raw: Record<string, unknown>) {
  const requestId = uuid(raw.requestId, 'La solicitud'); const key = `${ctx.sender.toHexString()}:${requestId}`;
  const hash = aiHash(raw); const previous = ctx.db.examOperation.key.find(key);
  if (previous && (previous.requestHash !== hash || previous.action !== raw.action)) fail('conflict', 'La solicitud ya pertenece a otra operación.');
  return { key, hash, previous, requestId };
}
function remember(ctx: Ctx, raw: Record<string, unknown>, op: ReturnType<typeof operation>, examId: string, attemptId = '') {
  ctx.db.examOperation.insert({ key: op.key, actor: ctx.sender, action: String(raw.action), requestHash: op.hash, examId, attemptId, createdAt: ctx.timestamp });
}
function preparations(version: StoredVersion) { return [version.preparation]; }
function prepIssues(ctx: Ctx, prep: AiPreparation): ExamSourceIssue[] {
  const issues: ExamSourceIssue[] = [];
  for (const source of prep.sources) {
    try {
      const current = resolveAiSource(ctx, source.kind, source.refId);
      if (current.subjectId !== prep.subjectId || (prep.termId && current.termId && prep.termId !== current.termId)) throw new Error('classification');
      for (const origin of source.origins) { const original = resolveAiSource(ctx, origin.kind, origin.refId); if (original.visibility !== 'group') throw new Error('origin'); }
      if (aiSourceFingerprint(current) !== source.fingerprint) issues.push({ kind: source.kind, refId: source.refId, state: 'outdated', message: 'La fuente cambió después de preparar esta versión.' });
    } catch { issues.push({ kind: source.kind, refId: source.refId, state: 'unavailable', message: 'La fuente ya no está disponible para esta persona.' }); }
  }
  return issues;
}
function versionIssues(ctx: Ctx, version: StoredVersion) { return [...new Map(preparations(version).flatMap((prep) => prepIssues(ctx, prep)).map((issue) => [`${issue.kind}:${issue.refId}:${issue.state}`, issue])).values()]; }
function questionAvailable(ctx: Ctx, version: StoredVersion, question: AiQuestion, issues?: ExamSourceIssue[]) {
  const prep = version.preparation;
  const inaccessible = new Set((issues ?? prepIssues(ctx, prep)).filter((issue) => issue.state === 'unavailable').map((issue) => `${issue.kind}:${issue.refId}`));
  return question.citations.every((citation) => {
    const fragment = prep.fragments.find((item) => item.id === citation); if (!fragment) return false;
    return fragment.origins.some((origin) => !inaccessible.has(`${origin.kind}:${origin.refId}`));
  });
}
function requireAccess(ctx: Ctx, version: StoredVersion, fresh = false) {
  const issues = versionIssues(ctx, version);
  if (issues.some((issue) => issue.state === 'unavailable' || fresh && issue.state === 'outdated')) fail('unavailable', fresh ? 'Las fuentes cambiaron. Prepara una generación nueva.' : 'Una fuente ya no está disponible.');
  return issues;
}
function validatedQuestions(value: unknown, prep: AiPreparation, config: AiGenerationConfig): ExamEditableQuestion[] {
  const checked = validateAiQuestionDraft({ questions: value }, prep, config).questions;
  return checked.map((question, index) => {
    const raw = obj((value as unknown[])[index]); const issue = typeof raw.issue === 'string' ? raw.issue.trim() : '';
    if (issue.length > 500) fail('invalid', 'La observación excede 500 caracteres.');
    for (const citation of question.citations) if (!prep.sources.some((source) => source.topics.includes(question.topic) && source.fragmentIds.includes(citation))) fail('invalid', 'La cita debe respaldar el tema seleccionado para la pregunta.');
    return { ...question, text: sanitizeAiText(question.text), explanation: sanitizeAiText(question.explanation),
      options: question.options.map((option) => ({ ...option, text: sanitizeAiText(option.text) })), ...(issue ? { issue: sanitizeAiText(issue) } : {}) };
  });
}
function versionSummary(ctx: Ctx, row: VersionRow): ExamVersionSummary {
  const value = data(row); return { version: row.version, state: row.state as 'draft' | 'ready', questionCount: value.questions.length, model: value.preparation.model,
    createdAt: at(row.createdAt), ...(value.approvedAt ? { approvedAt: value.approvedAt } : {}), hasPersonalSources: value.hasPersonalSources, sourceIssues: versionIssues(ctx, value) };
}
function versionDto(ctx: Ctx, exam: ExamRow, row: VersionRow): ExamDraft {
  const value = data(row); requireAccess(ctx, value); return { ...versionSummary(ctx, row), examId: exam.id, title: value.title, config: value.config,
    ...(value.timeLimitSeconds ? { timeLimitSeconds: value.timeLimitSeconds } : {}), preparation: value.preparation, questions: value.questions };
}
function examSummary(ctx: Ctx, exam: ExamRow): ExamSummary {
  const isOwner = exam.owner.isEqual(ctx.sender); const number = isOwner ? exam.draftVersion ?? exam.readyVersion : exam.readyVersion;
  const value = number ? data(requireVersion(ctx, exam.id, number)) : undefined;
  return { id: exam.id, revision: isOwner ? exam.revision : exam.readyVersion ?? 0, title: isOwner ? value?.title ?? exam.title : exam.title, subjectId: String(exam.subjectId), ...(exam.termId ? { termId: String(exam.termId) } : {}),
    ownerId: exam.owner.toHexString(), visibility: exam.visibility as 'personal' | 'group', archived: exam.archived, readyVersion: exam.readyVersion,
    ...(isOwner && exam.draftVersion ? { draftVersion: exam.draftVersion } : {}), questionCount: value?.questions.length ?? 0, topics: value?.preparation.topics ?? [],
    createdAt: at(exam.createdAt), updatedAt: isOwner ? at(exam.updatedAt) : value?.approvedAt ?? at(exam.createdAt), canEdit: isOwner, sourceIssues: value ? versionIssues(ctx, value) : [] };
}
function detail(ctx: Ctx, exam: ExamRow): ExamDetail {
  const owner = exam.owner.isEqual(ctx.sender);
  const rows = [...ctx.db.examVersion.examId.filter(exam.id)].filter((row) => owner || row.state === 'ready' && row.version === exam.readyVersion).sort((a, b) => b.version - a.version);
  let draft: ExamDraft | undefined;
  if (owner) { const row = rows.find((item) => item.version === (exam.draftVersion ?? exam.readyVersion)); if (row && !versionIssues(ctx, data(row)).some((issue) => issue.state === 'unavailable')) draft = versionDto(ctx, exam, row); }
  return { ...examSummary(ctx, exam), versions: rows.map((row) => versionSummary(ctx, row)), ...(draft ? { draft } : {}) };
}
function generation(ctx: Ctx, generationId: unknown) {
  const row = ctx.db.aiGeneration.id.find(uuid(generationId)); const prepRow = row && ctx.db.aiPreparation.id.find(row.preparationId);
  if (!row || !row.actor.isEqual(ctx.sender) || row.status !== 'succeeded' || !prepRow || !prepRow.actor.isEqual(ctx.sender)) fail('unavailable', 'La generación terminada no está disponible.');
  const preparation = JSON.parse(prepRow.json) as AiPreparation;
  const config = validateAiGenerationConfig(JSON.parse(row.configJson));
  const questions = validatedQuestions(obj(JSON.parse(row.resultJson)).questions, preparation, config);
  const version: StoredVersion = { title: '', config, preparation, questions, hasPersonalSources: preparation.sources.some((source) => source.visibility === 'personal') };
  requireAccess(ctx, version, true); return { row, value: version };
}
function importGeneration(ctx: Ctx, raw: Record<string, unknown>): ExamDetail {
  const op = operation(ctx, raw); if (op.previous) return detail(ctx, own(ctx, op.previous.examId));
  const generated = generation(ctx, raw.generationId); const used = ctx.db.examGenerationImport.generationId.find(generated.row.id);
  if (used) { const exam = own(ctx, used.examId); remember(ctx, raw, op, exam.id); return detail(ctx, exam); }
  const title = text(raw.title, 'El título'); const timeLimitSeconds = timeLimit(raw.timeLimitSeconds);
  if (ctx.db.studyExam.id.find(op.requestId)) fail('conflict', 'El identificador ya pertenece a otro examen.');
  const exam = ctx.db.studyExam.insert({ id: op.requestId, owner: ctx.sender, title, subjectId: BigInt(generated.value.preparation.subjectId), termId: generated.value.preparation.termId ? BigInt(generated.value.preparation.termId) : undefined,
    visibility: 'personal', archived: false, revision: 1, readyVersion: undefined, draftVersion: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
  ctx.db.examVersion.insert({ key: `${exam.id}:1`, examId: exam.id, version: 1, state: 'draft', json: JSON.stringify({ ...generated.value, title, timeLimitSeconds }), createdAt: ctx.timestamp });
  ctx.db.examGenerationImport.insert({ generationId: generated.row.id, actor: ctx.sender, examId: exam.id, version: 1 });
  remember(ctx, raw, op, exam.id); return detail(ctx, exam);
}

function saveExamDraft(ctx: Ctx, raw: Record<string, unknown>): ExamDetail {
  const { exam, version, value } = mutable(ctx, raw); requireAccess(ctx, value);
  const config = validateAiGenerationConfig(raw.config); const questions = validatedQuestions(raw.questions, value.preparation, config);
  const next = { ...value, title: text(raw.title, 'El título'), config, questions, timeLimitSeconds: timeLimit(raw.timeLimitSeconds) };
  ctx.db.examVersion.key.update({ ...version, json: JSON.stringify(next) }); return detail(ctx, bump(ctx, exam));
}
function replaceQuestions(ctx: Ctx, raw: Record<string, unknown>): ExamDetail {
  const op = operation(ctx, raw); if (op.previous) return detail(ctx, own(ctx, op.previous.examId));
  const { exam, version, value } = mutable(ctx, raw); requireAccess(ctx, value);
  if (!Array.isArray(raw.questionIds) || !raw.questionIds.length || raw.questionIds.some((id) => typeof id !== 'string' || !value.questions.some((question) => question.id === id)) || new Set(raw.questionIds).size !== raw.questionIds.length) fail('invalid', 'Selecciona preguntas existentes sin repetirlas.');
  const generated = generation(ctx, raw.generationId); const prep = generated.value.preparation;
  if (prep.subjectId !== value.preparation.subjectId || prep.termId !== value.preparation.termId || prep.topics.some((topic) => !value.preparation.topics.includes(topic)) || generated.value.questions.length !== raw.questionIds.length) fail('invalid', 'La generación no coincide con las preguntas y el alcance seleccionados.');
  const used = ctx.db.examGenerationImport.generationId.find(generated.row.id);
  if (used) fail('conflict', 'Esta generación ya se importó. Consulta el borrador antes de volver a solicitar cambios.');
  const ids = raw.questionIds as string[]; const questions = value.questions.map((question) => {
    const index = ids.indexOf(question.id); return index < 0 ? question : { ...generated.value.questions[index]!, id: question.id };
  });
  const all = ids.length === value.questions.length;
  const identity = (preparation: AiPreparation) => aiHash({ subjectId: preparation.subjectId, termId: preparation.termId, topics: preparation.topics, sources: preparation.sources, fragments: preparation.fragments });
  if (!all && identity(prep) !== identity(value.preparation)) fail('conflict', 'Las fuentes o sus versiones cambiaron. Sustituye todas las preguntas con una preparación nueva.');
  const preparation = all ? prep : value.preparation;
  const next = { ...value, questions, preparation, config: all ? generated.value.config : value.config,
    hasPersonalSources: all ? generated.value.hasPersonalSources : value.hasPersonalSources };
  ctx.db.examVersion.key.update({ ...version, json: JSON.stringify(next) }); ctx.db.examGenerationImport.insert({ generationId: generated.row.id, actor: ctx.sender, examId: exam.id, version: version.version });
  remember(ctx, raw, op, exam.id); return detail(ctx, bump(ctx, exam));
}
function forkVersion(ctx: Ctx, raw: Record<string, unknown>): ExamDetail {
  const op = operation(ctx, raw); if (op.previous) return detail(ctx, own(ctx, op.previous.examId));
  const exam = own(ctx, raw.examId); expectVersion(exam.revision, integer(raw.expectedRevision, 'Revisión'));
  if (exam.archived || exam.draftVersion) fail('conflict', 'Ya hay un borrador o el examen está archivado.');
  const previous = requireVersion(ctx, exam.id, raw.version); if (previous.state !== 'ready') fail('invalid', 'Copia una versión lista.');
  const value = data(previous); requireAccess(ctx, value);
  const number = Math.max(...[...ctx.db.examVersion.examId.filter(exam.id)].map((row) => row.version)) + 1;
  ctx.db.examVersion.insert({ key: `${exam.id}:${number}`, examId: exam.id, version: number, state: 'draft', json: JSON.stringify({ ...value, approvedAt: undefined }), createdAt: ctx.timestamp });
  remember(ctx, raw, op, exam.id); return detail(ctx, bump(ctx, exam, { draftVersion: number }));
}
function approveVersion(ctx: Ctx, raw: Record<string, unknown>): ExamDetail {
  const { exam, version, value } = mutable(ctx, raw); requireAccess(ctx, value);
  validatedQuestions(value.questions, value.preparation, value.config);
  if (value.questions.some((question) => question.issue)) fail('invalid', 'Corrige o retira las preguntas con observaciones antes de aprobar.');
  if (!Array.isArray(raw.reviewedQuestionIds) || new Set(raw.reviewedQuestionIds).size !== value.questions.length || raw.reviewedQuestionIds.length !== value.questions.length || value.questions.some((question) => !(raw.reviewedQuestionIds as unknown[]).includes(question.id))) fail('invalid', 'Confirma la revisión de todas las preguntas.');
  if (value.config.topicWeights && examTopicDistribution(value.preparation.topics, value.questions.length, value.config.topicWeights).some((item) => value.questions.filter((question) => question.topic === item.topic).length !== item.count)) fail('invalid', 'La distribución no coincide con el plano del examen.');
  const hasPersonalSources = value.hasPersonalSources || value.preparation.sources.some((source) => resolveAiSource(ctx, source.kind, source.refId).visibility === 'personal');
  ctx.db.examVersion.key.update({ ...version, state: 'ready', json: JSON.stringify({ ...value, hasPersonalSources, approvedAt: now(ctx) }) });
  return detail(ctx, bump(ctx, exam, { readyVersion: version.version, draftVersion: undefined, title: value.title,
    ...(hasPersonalSources ? { visibility: 'personal' } : {}) }));
}
function setVisibility(ctx: Ctx, raw: Record<string, unknown>): ExamDetail {
  const exam = own(ctx, raw.examId); expectVersion(exam.revision, integer(raw.expectedRevision, 'Revisión'));
  if (!['personal', 'group'].includes(String(raw.visibility))) fail('invalid', 'Visibilidad inválida.');
  if (raw.visibility === 'group') {
    if (!exam.readyVersion || exam.archived) fail('invalid', 'Aprueba una versión antes de compartir.');
    const value = data(requireVersion(ctx, exam.id, exam.readyVersion)); requireAccess(ctx, value);
    if (value.hasPersonalSources || preparations(value).some((prep) => prep.sources.some((source) => source.visibility !== 'group' || resolveAiSource(ctx, source.kind, source.refId).visibility !== 'group'))) fail('unauthorized', 'Una fuente personal impide compartir. Publica una copia de la fuente y genera una versión nueva con material de grupo.');
  }
  return detail(ctx, bump(ctx, exam, { visibility: String(raw.visibility) }));
}

function closeAttempt(ctx: Ctx, row: AttemptRow, reason: 'submitted' | 'timeout'): AttemptRow {
  if (row.state === 'closed') return row;
  const value = attemptData(row); const version = data(requireVersion(ctx, row.examId, row.version));
  value.result = scoreExam(version.questions, Object.fromEntries(Object.entries(value.answers).map(([id, answer]) => [id, answer.optionId])));
  value.closedAt = now(ctx); value.closeReason = reason;
  const next = { ...row, revision: row.revision + 1, state: 'closed', json: JSON.stringify(value) }; ctx.db.examAttempt.id.update(next); return next;
}
function expireAttempt(ctx: Ctx, row: AttemptRow) {
  const value = attemptData(row); return row.state === 'active' && value.deadlineAt !== undefined && now(ctx) >= value.deadlineAt ? closeAttempt(ctx, row, 'timeout') : row;
}
function attemptSummary(row: AttemptRow): ExamAttemptSummary {
  const value = attemptData(row); return { id: row.id, examId: row.examId, examVersion: row.version, title: value.title, mode: value.mode,
    state: row.state as 'active' | 'closed', revision: row.revision, startedAt: value.startedAt,
    ...(value.deadlineAt !== undefined ? { deadlineAt: value.deadlineAt } : {}), ...(value.closedAt !== undefined ? { closedAt: value.closedAt, closeReason: value.closeReason } : {}),
    ...(row.state === 'closed' && value.result ? { result: value.result } : {}) };
}
function attemptDto(ctx: Ctx, initial: AttemptRow): ExamAttempt {
  const row = expireAttempt(ctx, initial); const value = attemptData(row); const version = data(requireVersion(ctx, row.examId, row.version));
  const exam = ctx.db.studyExam.id.find(row.examId); const mayReadExam = !!exam && (exam.owner.isEqual(ctx.sender) || exam.visibility === 'group');
  const sourceIssues = versionIssues(ctx, version); const answers: ExamAttempt['answers'] = [];
  const unavailable = new Set(sourceIssues.filter((issue) => issue.state === 'unavailable').map((issue) => `${issue.kind}:${issue.refId}`));
  const questions = value.order.map((order): ExamAttempt['questions'][number] => {
    const question = version.questions.find((item) => item.id === order.questionId)!;
    const available = mayReadExam && questionAvailable(ctx, version, question, sourceIssues);
    const answer = Object.hasOwn(value.answers, question.id) ? value.answers[question.id] : undefined;
    const reveal = available && (row.state === 'closed' || value.mode === 'practice' && answer?.confirmed === true);
    answers.push({ questionId: question.id, ...(answer ? { optionId: answer.optionId } : {}), confirmed: answer?.confirmed ?? false,
      ...(reveal ? { correct: answer?.optionId === question.correctOptionId } : {}) });
    if (!available) return { id: question.id, type: question.type, topic: question.topic, text: 'Contenido no disponible', options: [], unavailable: true };
    const options = order.optionIds.map((id) => question.options.find((option) => option.id === id)!);
    const prep = version.preparation;
    return { id: question.id, type: question.type, topic: question.topic, text: question.text, options,
      ...(reveal ? { solution: { correctOptionId: question.correctOptionId, explanation: question.explanation,
        citations: question.citations.map((citation) => prep.fragments.find((fragment) => fragment.id === citation)!).map(({ id, text, origins }) => ({ id, text, origins: origins.filter((origin) => !unavailable.has(`${origin.kind}:${origin.refId}`)) })) } } : {}) };
  });
  return { ...attemptSummary(row), questions, answers, sourceIssues: mayReadExam ? sourceIssues : [{ kind: 'exam', refId: row.examId, state: 'unavailable', message: 'El examen ya no está compartido contigo.' }],
    contentUnavailable: questions.some((question) => question.unavailable) };
}
function startAttempt(ctx: Ctx, raw: Record<string, unknown>): ExamAttempt {
  const op = operation(ctx, raw); if (op.previous) return attemptDto(ctx, ownAttempt(ctx, op.previous.attemptId));
  const exam = readable(ctx, raw.examId); const version = requireVersion(ctx, exam.id, raw.version);
  if (exam.archived || version.state !== 'ready' || !exam.owner.isEqual(ctx.sender) && version.version !== exam.readyVersion) fail('unavailable', 'Elige una versión lista y disponible para iniciar.');
  if (raw.mode !== 'practice' && raw.mode !== 'simulation') fail('invalid', 'Modalidad inválida.');
  const value = data(version); requireAccess(ctx, value);
  if (ctx.db.examAttempt.id.find(op.requestId)) fail('conflict', 'El identificador ya pertenece a otro intento.');
  const startedAt = now(ctx); const stored: StoredAttempt = { title: value.title, mode: raw.mode, startedAt,
    ...(value.timeLimitSeconds ? { deadlineAt: startedAt + value.timeLimitSeconds * 1000 } : {}), order: examAttemptOrder(value.questions, op.requestId), answers: {} };
  const row = ctx.db.examAttempt.insert({ id: op.requestId, actor: ctx.sender, examId: exam.id, version: version.version, revision: 1, state: 'active', json: JSON.stringify(stored), startedAt: ctx.timestamp });
  remember(ctx, raw, op, exam.id, row.id); return attemptDto(ctx, row);
}
function answerAttempt(ctx: Ctx, raw: Record<string, unknown>): ExamAttempt {
  const op = operation(ctx, raw); if (op.previous) return attemptDto(ctx, ownAttempt(ctx, op.previous.attemptId));
  let row = expireAttempt(ctx, ownAttempt(ctx, raw.attemptId)); if (row.state === 'closed') return attemptDto(ctx, row);
  expectVersion(row.revision, integer(raw.expectedRevision, 'Revisión'));
  const value = attemptData(row); const version = data(requireVersion(ctx, row.examId, row.version)); const exam = ctx.db.studyExam.id.find(row.examId);
  if (!exam || !(exam.owner.isEqual(ctx.sender) || exam.visibility === 'group')) fail('unavailable', 'El examen ya no está disponible.');
  const question = version.questions.find((item) => item.id === raw.questionId);
  if (!question || !question.options.some((option) => option.id === raw.optionId)) fail('invalid', 'Elige una opción existente de esta pregunta.');
  if (!questionAvailable(ctx, version, question)) fail('unavailable', 'La fuente de esta pregunta ya no está disponible.');
  if (raw.action === 'confirmAnswer' && value.mode !== 'practice') fail('invalid', 'El simulacro revela las soluciones únicamente después del cierre.');
  const previous = Object.hasOwn(value.answers, question.id) ? value.answers[question.id] : undefined;
  if (previous?.confirmed) {
    if (previous.optionId !== raw.optionId) fail('conflict', 'La respuesta de práctica ya fue confirmada y es irreversible.');
    remember(ctx, raw, op, row.examId, row.id); return attemptDto(ctx, row);
  }
  value.answers = { ...value.answers, [question.id]: { optionId: String(raw.optionId), confirmed: raw.action === 'confirmAnswer' } };
  row = { ...row, revision: row.revision + 1, json: JSON.stringify(value) }; ctx.db.examAttempt.id.update(row);
  remember(ctx, raw, op, row.examId, row.id); return attemptDto(ctx, row);
}
function finishAttempt(ctx: Ctx, raw: Record<string, unknown>): ExamAttempt {
  const op = operation(ctx, raw); if (op.previous) return attemptDto(ctx, ownAttempt(ctx, op.previous.attemptId));
  let row = expireAttempt(ctx, ownAttempt(ctx, raw.attemptId));
  if (row.state !== 'closed') { expectVersion(row.revision, integer(raw.expectedRevision, 'Revisión')); row = closeAttempt(ctx, row, 'submitted'); }
  remember(ctx, raw, op, row.examId, row.id); return attemptDto(ctx, row);
}

function dispatch(ctx: Ctx, raw: Record<string, unknown>): unknown {
  activeMember(ctx);
  if (raw.action === 'listExams') return [...ctx.db.studyExam.iter()].filter((exam) => exam.owner.isEqual(ctx.sender)
    ? raw.includeArchived === true || !exam.archived
    : exam.visibility === 'group' && exam.readyVersion !== undefined && !exam.archived).map((exam) => examSummary(ctx, exam)).sort((a, b) => b.updatedAt - a.updatedAt);
  if (raw.action === 'getExam') return detail(ctx, readable(ctx, raw.examId));
  if (raw.action === 'getVersion') { const exam = own(ctx, raw.examId); return versionDto(ctx, exam, requireVersion(ctx, exam.id, raw.version)); }
  if (raw.action === 'listGenerations') return [...ctx.db.aiGeneration.actor.filter(ctx.sender)].filter((row) => !!ctx.db.aiPreparation.id.find(row.preparationId)).map((row): ExamGenerationSummary => ({
    id: row.id, state: row.status === 'queued' ? 'prepared' : row.status as ExamGenerationSummary['state'], preparationId: row.preparationId, createdAt: at(row.createdAt),
    ...(row.errorCode ? { error: row.errorCode } : {}), ...(ctx.db.examGenerationImport.generationId.find(row.id) ? { importedExamId: ctx.db.examGenerationImport.generationId.find(row.id)!.examId } : {}) })).sort((a, b) => b.createdAt - a.createdAt);
  if (raw.action === 'importGeneration') return importGeneration(ctx, raw);
  if (raw.action === 'saveDraft') return saveExamDraft(ctx, raw);
  if (raw.action === 'replaceQuestions') return replaceQuestions(ctx, raw);
  if (raw.action === 'forkVersion') return forkVersion(ctx, raw);
  if (raw.action === 'approveVersion') return approveVersion(ctx, raw);
  if (raw.action === 'setVisibility') return setVisibility(ctx, raw);
  if (raw.action === 'setArchived') { const exam = own(ctx, raw.examId); expectVersion(exam.revision, integer(raw.expectedRevision, 'Revisión')); if (typeof raw.archived !== 'boolean') fail('invalid', 'Archivo inválido.'); return detail(ctx, bump(ctx, exam, { archived: raw.archived })); }
  if (raw.action === 'startAttempt') return startAttempt(ctx, raw);
  if (raw.action === 'getAttempt') return attemptDto(ctx, ownAttempt(ctx, raw.attemptId));
  if (raw.action === 'listAttempts') return [...ctx.db.examAttempt.actor.filter(ctx.sender)].filter((row) => raw.examId === undefined || row.examId === raw.examId).map((row) => attemptSummary(expireAttempt(ctx, row))).sort((a, b) => b.startedAt - a.startedAt);
  if (raw.action === 'saveAnswer' || raw.action === 'confirmAnswer') return answerAttempt(ctx, raw);
  if (raw.action === 'finishAttempt') return finishAttempt(ctx, raw);
  return fail('invalid', 'Operación de Exámenes no admitida.');
}
export function examResponse(ctx: Ctx, payload: string): string {
  if (new TextEncoder().encode(payload).length > 2 * 1024 * 1024) fail('invalid', 'La solicitud excede el límite.');
  let raw: Record<string, unknown>;
  try { raw = obj(JSON.parse(payload)); } catch (error) { if (error instanceof SenderError) throw error; return fail('invalid', 'JSON inválido.'); }
  try { return JSON.stringify(dispatch(ctx, raw)); }
  catch (error) { if (error instanceof SenderError) throw error; if (error instanceof Error && 'code' in error && typeof error.code === 'string') return fail(error.code, error.message); throw error; }
}
