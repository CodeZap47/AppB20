import { sendExamToSpaced } from './examSpaced';
import { memberIdentityFor } from './authIdentity';
import { invalidateFeedShares } from './feedInteractionLifecycle';
import { SenderError } from 'spacetimedb/server';
import { aiHash, aiRecord, aiSourceFingerprint, aiUuid, sanitizeAiText, validateAiGenerationConfig,
  type AiGenerationConfig, type AiPreparation } from '../../core/src/ai';
import { validateAiQuestionDraft, type AiQuestion } from '../../core/src/exam';
import { examAttemptOrder, examPreparedSourceKey, examTopicDistribution, scoreExam, scoreOpenExam, selectExamVariant, validateOpenEvaluation, type ExamAttempt, type ExamAttemptSummary, type ExamDetail,
  type ExamDraft, type ExamEditableQuestion, type ExamGenerationSummary, type ExamScore, type ExamSourceIssue, type ExamSummary,
  type ExamVersionSummary, type ExamOpenEvaluation, type ExamBankSummary, type ExamBankDetail, type ExamVariantPlan } from '../../core/src/exams';
import { activeMember, type Ctx } from './moduleContext';
import { validateDocumentOrigins } from './documentHandlers';
import { resolveAiSource, resolveAiSelection } from './aiHandlers';

type ExamRow = NonNullable<ReturnType<Ctx['db']['studyExam']['id']['find']>>;
type VersionRow = NonNullable<ReturnType<Ctx['db']['examVersion']['key']['find']>>;
type AttemptRow = NonNullable<ReturnType<Ctx['db']['examAttempt']['id']['find']>>;
interface StoredVersion { title: string; config: AiGenerationConfig; timeLimitSeconds?: number; preparation: AiPreparation; questions: ExamEditableQuestion[];
  approvedAt?: number; hasPersonalSources: boolean; purgedQuestionIds?: string[] }
interface StoredAttempt { title: string; mode: 'practice' | 'simulation'; startedAt: number; deadlineAt?: number; closedAt?: number;
  closeReason?: 'submitted' | 'timeout'; order: { questionId: string; optionIds: string[] }[];
  answers: Record<string, { optionId?: string; text?: string; confirmed: boolean; evaluation?: ExamOpenEvaluation }>; result?: ExamScore; openResult?: import('../../core/src/exams').ExamOpenScore }
function fail(code: string, message: string): never { throw new SenderError(`${code}:${message}`); }
function expectVersion(actual: number, expected: number) { if (actual !== expected) fail('conflict', 'El contenido cambió. Recarga antes de guardar otra vez.'); }
function obj(value: unknown) { if (!aiRecord(value)) fail('invalid', 'Se esperaba un objeto.'); return value; }
function uuid(value: unknown, label = 'El identificador') { if (!aiUuid(value)) fail('invalid', `${label} debe ser UUID.`); return value.toLowerCase(); }
function integer(value: unknown, label: string, max = 0xffffffff) { if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max) fail('invalid', `${label} inválida.`); return Number(value); }
function text(value: unknown, label: string, max = 200) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid', `${label} inválido.`); return sanitizeAiText(value.trim()); }
function now(ctx: Ctx) { return Number(ctx.timestamp.microsSinceUnixEpoch / 1000n); }
function at(timestamp: Ctx['timestamp']) { return Number(timestamp.microsSinceUnixEpoch / 1000n); }
function timeLimit(value: unknown) { if (value === undefined) return undefined; if (!Number.isInteger(value) || Number(value) < 60 || Number(value) > 10800) fail('invalid', 'El tiempo debe ser de 60 a 10 800 segundos.'); return Number(value); }
function examConfig(value: unknown) {
  const config = validateAiGenerationConfig(value);
  if (config.purpose !== undefined && config.purpose !== 'questions') fail('invalid', 'Exámenes solo admite generaciones de preguntas.');
  return config;
}
function own(ctx: Ctx, examId: unknown) { activeMember(ctx); const exam = ctx.db.studyExam.id.find(uuid(examId)); if (!exam || !exam.owner.isEqual(memberIdentityFor(ctx))) fail('unavailable', 'Este examen no está disponible para editarlo.'); return exam; }
function readable(ctx: Ctx, examId: unknown) { activeMember(ctx); const exam = ctx.db.studyExam.id.find(uuid(examId)); if (!exam || !(exam.owner.isEqual(memberIdentityFor(ctx)) || exam.visibility === 'group')) fail('unavailable', 'El examen no está disponible.'); return exam; }
function requireVersion(ctx: Ctx, examId: string, version: unknown) { const row = ctx.db.examVersion.key.find(`${examId}:${integer(version, 'Versión')}`); if (!row) fail('unavailable', 'La versión no existe.'); return row; }
function data(row: VersionRow) { return JSON.parse(row.json) as StoredVersion; }
function attemptData(row: AttemptRow) { return JSON.parse(row.json) as StoredAttempt; }
function ownAttempt(ctx: Ctx, attemptId: unknown) { activeMember(ctx); const row = ctx.db.examAttempt.id.find(uuid(attemptId)); if (!row || !row.actor.isEqual(memberIdentityFor(ctx))) fail('unavailable', 'El intento no está disponible.'); return row; }
function bump(ctx: Ctx, exam: ExamRow, changes: Partial<ExamRow> = {}) {
  const next = { ...exam, ...changes, revision: exam.revision + 1, updatedAt: ctx.timestamp };
  if (exam.visibility === 'group' && (next.visibility !== 'group' || next.archived || !next.readyVersion)) invalidateFeedShares(ctx, 'exam', exam.id);
  ctx.db.studyExam.id.update(next); return next;
}
function mutable(ctx: Ctx, raw: Record<string, unknown>) {
  const exam = own(ctx, raw.examId); expectVersion(exam.revision, integer(raw.expectedRevision, 'Revisión'));
  const version = requireVersion(ctx, exam.id, raw.version);
  if (exam.archived || version.state !== 'draft' || version.version !== exam.draftVersion) fail('conflict', 'La versión lista es inmutable. Crea primero otro borrador.');
  return { exam, version, value: data(version) };
}
function operation(ctx: Ctx, raw: Record<string, unknown>) {
  const requestId = uuid(raw.requestId, 'La solicitud'); const key = `${memberIdentityFor(ctx).toHexString()}:${requestId}`;
  const hash = aiHash(raw); const previous = ctx.db.examOperation.key.find(key);
  if (previous && (previous.requestHash !== hash || previous.action !== raw.action)) fail('conflict', 'La solicitud ya pertenece a otra operación.');
  return { key, hash, previous, requestId };
}
function remember(ctx: Ctx, raw: Record<string, unknown>, op: ReturnType<typeof operation>, examId: string, attemptId = '') {
  ctx.db.examOperation.insert({ key: op.key, actor: memberIdentityFor(ctx), action: String(raw.action), requestHash: op.hash, examId, attemptId, createdAt: ctx.timestamp });
}
function preparations(version: StoredVersion) { return [version.preparation]; }
function resolvedPreparedSource(ctx: Ctx, prep: AiPreparation, source: AiPreparation['sources'][number], actor = memberIdentityFor(ctx), fragment?: AiPreparation['fragments'][number]) {
  if (source.status === 'unauthorized') fail('unavailable', 'La fuente fue eliminada.');
  const relevantFragments = fragment ? [fragment] : prep.fragments.filter((entry) => source.fragmentIds.includes(entry.id));
  const selectedOrigins = relevantFragments.flatMap((entry) => entry.origins).filter((origin) => source.kind === origin.kind && source.refId === origin.refId || source.origins.some((dependency) => dependency.kind === origin.kind && dependency.refId === origin.refId));
  const scoped = { ...source,
    ...(source.kind === 'question' ? { answerIds: [...new Set(selectedOrigins.filter((origin) => origin.kind === 'answer').map((origin) => origin.refId))] } : {}),
    ...(fragment ? { transcriptionIds: [...new Set(selectedOrigins.flatMap((origin) => origin.transcriptionId ? [origin.transcriptionId] : []))] } : {}),
  };
  let current: ReturnType<typeof resolveAiSelection>;
  if (fragment) current = resolveAiSource(ctx, scoped.kind, scoped.refId, actor, scoped);
  else {
    try { current = resolveAiSelection(ctx, source, actor, { reuseReviewed: true }); }
    catch { current = resolveAiSource(ctx, scoped.kind, scoped.refId, actor, scoped); validateDocumentOrigins(ctx, { fragments: relevantFragments }, actor); }
  }
  if (current.subjectId !== prep.subjectId || (prep.termId && current.termId && prep.termId !== current.termId)) fail('unavailable', 'La clasificación de la fuente cambió.');
  // Selected answers have their own fragment provenance. A question body never adopts a newly accepted answer.
  const dependencies = source.kind === 'question' ? (fragment ? selectedOrigins : (scoped.answerIds ?? []).map((refId) => ({ kind: 'answer' as const, refId, version: 1 }))) : source.origins;
  for (const origin of dependencies) resolveAiSource(ctx, origin.kind, origin.refId, actor, origin.kind === 'question' ? { answerIds: [] } : undefined);
  return current;
}
function prepIssues(ctx: Ctx, prep: AiPreparation, actor = memberIdentityFor(ctx)): ExamSourceIssue[] {
  return prep.sources.flatMap<ExamSourceIssue>((source) => {
    try { const current = resolvedPreparedSource(ctx, prep, source, actor);
      return aiSourceFingerprint(current) !== source.fingerprint ? [{ kind: source.kind, refId: source.refId, state: 'outdated', message: 'La fuente cambió después de preparar esta versión.' }] : [];
    } catch { return [{ kind: source.kind, refId: source.refId, state: 'unavailable', message: 'La fuente ya no está disponible para esta persona.' }]; }
  });
}
function versionIssues(ctx: Ctx, version: StoredVersion) { return [...new Map(preparations(version).flatMap((prep) => prepIssues(ctx, prep)).map((issue) => [`${issue.kind}:${issue.refId}:${issue.state}`, issue])).values()]; }
function availableOrigins(ctx: Ctx, version: StoredVersion, fragment: AiPreparation['fragments'][number], _issues: ExamSourceIssue[], actor = memberIdentityFor(ctx)) {
  return fragment.origins.filter((origin) => {
    const backed = version.preparation.sources.some((source) => {
      if (!source.fragmentIds.includes(fragment.id) || !(source.kind === origin.kind && source.refId === origin.refId || source.origins.some((dependency) => dependency.kind === origin.kind && dependency.refId === origin.refId))) return false;
      try { resolvedPreparedSource(ctx, version.preparation, source, actor, fragment); return true; } catch { return false; }
    });
    if (!backed) return false;
    try { validateDocumentOrigins(ctx, { fragments: [{ ...fragment, origins: [origin] }] }, actor); return true; } catch { return false; }
  });
}
function questionAvailable(ctx: Ctx, version: StoredVersion, question: AiQuestion, issues = prepIssues(ctx, version.preparation), actor = memberIdentityFor(ctx)) {
  if (version.purgedQuestionIds?.includes(question.id)) return false;
  return question.citations.every((citation) => { const fragment = version.preparation.fragments.find((item) => item.id === citation); return !!fragment && availableOrigins(ctx, version, fragment, issues, actor).length > 0; });
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
      options: question.options.map((option) => ({ ...option, text: sanitizeAiText(option.text) })), ...(question.type === 'open' ? { referenceAnswer: sanitizeAiText(question.referenceAnswer!), rubric: { ...question.rubric!, criteria: question.rubric!.criteria.map((criterion) => ({ ...criterion, description: sanitizeAiText(criterion.description) })) } } : {}), ...(issue ? { issue: sanitizeAiText(issue) } : {}) };
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
function examSummary(ctx: Ctx, exam: ExamRow, sharedOnly = false): ExamSummary {
  const isOwner = exam.owner.isEqual(memberIdentityFor(ctx)); const ownerProjection = isOwner && !sharedOnly;
  const number = ownerProjection ? exam.draftVersion ?? exam.readyVersion : exam.readyVersion;
  const value = number ? data(requireVersion(ctx, exam.id, number)) : undefined;
  return { id: exam.id, revision: ownerProjection ? exam.revision : exam.readyVersion ?? 0, title: sharedOnly || isOwner ? value?.title ?? exam.title : exam.title, subjectId: String(exam.subjectId), ...(exam.termId ? { termId: String(exam.termId) } : {}),
    ownerId: exam.owner.toHexString(), visibility: exam.visibility as 'personal' | 'group', archived: exam.archived, readyVersion: exam.readyVersion,
    ...(ownerProjection && exam.draftVersion ? { draftVersion: exam.draftVersion } : {}), questionCount: value?.questions.length ?? 0, topics: value?.preparation.topics ?? [],
    createdAt: at(exam.createdAt), updatedAt: ownerProjection ? at(exam.updatedAt) : value?.approvedAt ?? at(exam.createdAt), canEdit: isOwner, sourceIssues: value ? versionIssues(ctx, value) : [] };
}
function detail(ctx: Ctx, exam: ExamRow): ExamDetail {
  const owner = exam.owner.isEqual(memberIdentityFor(ctx));
  const rows = [...ctx.db.examVersion.examId.filter(exam.id)].filter((row) => owner || row.state === 'ready' && row.version === exam.readyVersion).sort((a, b) => b.version - a.version);
  let draft: ExamDraft | undefined;
  if (owner) { const row = rows.find((item) => item.version === (exam.draftVersion ?? exam.readyVersion)); if (row && !versionIssues(ctx, data(row)).some((issue) => issue.state === 'unavailable')) draft = versionDto(ctx, exam, row); }
  return { ...examSummary(ctx, exam), versions: rows.map((row) => versionSummary(ctx, row)), ...(draft ? { draft } : {}) };
}
function generation(ctx: Ctx, generationId: unknown) {
  const row = ctx.db.aiGeneration.id.find(uuid(generationId)); const prepRow = row && ctx.db.aiPreparation.id.find(row.preparationId);
  if (!row || !row.actor.isEqual(memberIdentityFor(ctx)) || row.status !== 'succeeded' || !prepRow || !prepRow.actor.isEqual(memberIdentityFor(ctx))) fail('unavailable', 'La generación terminada no está disponible.');
  const preparation = JSON.parse(prepRow.json) as AiPreparation;
  const config = examConfig(JSON.parse(row.configJson));
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
  const exam = ctx.db.studyExam.insert({ id: op.requestId, owner: memberIdentityFor(ctx), title, subjectId: BigInt(generated.value.preparation.subjectId), termId: generated.value.preparation.termId ? BigInt(generated.value.preparation.termId) : undefined,
    visibility: 'personal', archived: false, revision: 1, readyVersion: undefined, draftVersion: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
  ctx.db.examVersion.insert({ key: `${exam.id}:1`, examId: exam.id, version: 1, state: 'draft', json: JSON.stringify({ ...generated.value, title, timeLimitSeconds }), createdAt: ctx.timestamp });
  ctx.db.examGenerationImport.insert({ generationId: generated.row.id, actor: memberIdentityFor(ctx), examId: exam.id, version: 1 });
  remember(ctx, raw, op, exam.id); return detail(ctx, exam);
}

function saveExamDraft(ctx: Ctx, raw: Record<string, unknown>): ExamDetail {
  const { exam, version, value } = mutable(ctx, raw); requireAccess(ctx, value);
  const config = examConfig(raw.config); const questions = validatedQuestions(raw.questions, value.preparation, config);
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
  ctx.db.examVersion.key.update({ ...version, json: JSON.stringify(next) }); ctx.db.examGenerationImport.insert({ generationId: generated.row.id, actor: memberIdentityFor(ctx), examId: exam.id, version: version.version });
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
  const hasPersonalSources = value.hasPersonalSources || value.preparation.sources.some((source) => resolveAiSelection(ctx, source, memberIdentityFor(ctx), { reuseReviewed: true }).visibility === 'personal');
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
    if (value.hasPersonalSources || preparations(value).some((prep) => prep.sources.some((source) => source.visibility !== 'group' || resolveAiSelection(ctx, source, memberIdentityFor(ctx), { reuseReviewed: true }).visibility !== 'group'))) fail('unauthorized', 'Una fuente personal impide compartir. Publica una copia de la fuente y genera una versión nueva con material de grupo.');
  }
  return detail(ctx, bump(ctx, exam, { visibility: String(raw.visibility) }));
}

function closeAttempt(ctx: Ctx, row: AttemptRow, reason: 'submitted' | 'timeout'): AttemptRow {
  if (row.state === 'closed') return row;
  const value = attemptData(row); const version = data(requireVersion(ctx, row.examId, row.version));
  value.result = scoreExam(version.questions, Object.fromEntries(Object.entries(value.answers).map(([id, answer]) => [id, answer.optionId])));
  if (version.questions.some((question) => question.type === 'open')) value.openResult = scoreOpenExam(version.questions, Object.entries(value.answers).map(([questionId, answer]) => ({ questionId, ...answer })));
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
    ...(row.state === 'closed' && value.result ? { result: value.result } : {}), ...(row.state === 'closed' && value.openResult ? { openResult: value.openResult } : {}) };
}
function attemptDto(ctx: Ctx, initial: AttemptRow): ExamAttempt {
  const row = expireAttempt(ctx, initial); const value = attemptData(row); const version = data(requireVersion(ctx, row.examId, row.version));
  const exam = ctx.db.studyExam.id.find(row.examId); const mayReadExam = !!exam && (exam.owner.isEqual(memberIdentityFor(ctx)) || exam.visibility === 'group');
  const sourceIssues = versionIssues(ctx, version); const answers: ExamAttempt['answers'] = [];
  const questions = value.order.map((order): ExamAttempt['questions'][number] => {
    const question = version.questions.find((item) => item.id === order.questionId)!;
    const available = mayReadExam && questionAvailable(ctx, version, question, sourceIssues);
    const answer = Object.hasOwn(value.answers, question.id) ? value.answers[question.id] : undefined;
    const reveal = available && (row.state === 'closed' || value.mode === 'practice' && question.type !== 'open' && answer?.confirmed === true);
    answers.push({ questionId: question.id, ...(answer ? { optionId: answer.optionId, text: answer.text, evaluation: answer.evaluation } : {}), confirmed: answer?.confirmed ?? false,
      ...(reveal && question.type !== 'open' ? { correct: answer?.optionId === question.correctOptionId } : {}) });
    if (!available) return { id: question.id, type: question.type, topic: question.topic, text: 'Contenido no disponible', options: [], unavailable: true };
    const options = order.optionIds.map((id) => question.options.find((option) => option.id === id)!);
    const prep = version.preparation;
    return { id: question.id, type: question.type, topic: question.topic, text: question.text, options,
      ...(reveal ? { solution: { correctOptionId: question.correctOptionId, explanation: question.explanation, ...(question.type === 'open' ? { referenceAnswer: question.referenceAnswer, rubric: question.rubric } : {}),
        citations: question.citations.map((citation) => prep.fragments.find((fragment) => fragment.id === citation)!).map(({ id, text, origins }) => ({ id, text, origins: availableOrigins(ctx, version, { id, text, origins }, sourceIssues) })) } } : {}) };
  });
  return { ...attemptSummary(row), ...(row.state === 'closed' && version.questions.some((question) => question.type === 'open') ? { openResult: scoreOpenExam(version.questions, answers) } : {}), questions, answers, sourceIssues: mayReadExam ? sourceIssues : [{ kind: 'exam', refId: row.examId, state: 'unavailable', message: 'El examen ya no está compartido contigo.' }],
    contentUnavailable: questions.some((question) => question.unavailable) };
}
function startAttempt(ctx: Ctx, raw: Record<string, unknown>): ExamAttempt {
  const op = operation(ctx, raw); if (op.previous) return attemptDto(ctx, ownAttempt(ctx, op.previous.attemptId));
  const exam = readable(ctx, raw.examId); const version = requireVersion(ctx, exam.id, raw.version);
  if (exam.archived || version.state !== 'ready' || !exam.owner.isEqual(memberIdentityFor(ctx)) && version.version !== exam.readyVersion) fail('unavailable', 'Elige una versión lista y disponible para iniciar.');
  if (raw.mode !== 'practice' && raw.mode !== 'simulation') fail('invalid', 'Modalidad inválida.');
  const value = data(version); requireAccess(ctx, value);
  if (ctx.db.examAttempt.id.find(op.requestId)) fail('conflict', 'El identificador ya pertenece a otro intento.');
  const startedAt = now(ctx); const stored: StoredAttempt = { title: value.title, mode: raw.mode, startedAt,
    ...(value.timeLimitSeconds ? { deadlineAt: startedAt + value.timeLimitSeconds * 1000 } : {}), order: examAttemptOrder(value.questions, op.requestId), answers: {} };
  const row = ctx.db.examAttempt.insert({ id: op.requestId, actor: memberIdentityFor(ctx), examId: exam.id, version: version.version, revision: 1, state: 'active', json: JSON.stringify(stored), startedAt: ctx.timestamp });
  remember(ctx, raw, op, exam.id, row.id); return attemptDto(ctx, row);
}
function answerAttempt(ctx: Ctx, raw: Record<string, unknown>): ExamAttempt {
  const op = operation(ctx, raw); if (op.previous) return attemptDto(ctx, ownAttempt(ctx, op.previous.attemptId));
  let row = expireAttempt(ctx, ownAttempt(ctx, raw.attemptId)); if (row.state === 'closed') return attemptDto(ctx, row);
  expectVersion(row.revision, integer(raw.expectedRevision, 'Revisión'));
  const value = attemptData(row); const version = data(requireVersion(ctx, row.examId, row.version)); const exam = ctx.db.studyExam.id.find(row.examId);
  if (!exam || !(exam.owner.isEqual(memberIdentityFor(ctx)) || exam.visibility === 'group')) fail('unavailable', 'El examen ya no está disponible.');
  const question = version.questions.find((item) => item.id === raw.questionId);
  if (!question) fail('invalid', 'La pregunta no existe.');
  if (question.type === 'open') { if (typeof raw.text !== 'string' || raw.text.length > 12000) fail('invalid', 'La respuesta abierta admite hasta 12.000 caracteres.'); }
  else if (!question.options.some((option) => option.id === raw.optionId)) fail('invalid', 'Elige una opción existente de esta pregunta.');
  if (!questionAvailable(ctx, version, question)) fail('unavailable', 'La fuente de esta pregunta ya no está disponible.');
  if (raw.action === 'confirmAnswer' && question.type === 'open') fail('invalid', 'Las respuestas abiertas se revisan después de finalizar el intento.');
  if (raw.action === 'confirmAnswer' && value.mode !== 'practice') fail('invalid', 'El simulacro revela las soluciones únicamente después del cierre.');
  const previous = Object.hasOwn(value.answers, question.id) ? value.answers[question.id] : undefined;
  if (previous?.confirmed) {
    if (question.type === 'open' ? previous.text !== raw.text : previous.optionId !== raw.optionId) fail('conflict', 'La respuesta de práctica ya fue confirmada y es irreversible.');
    remember(ctx, raw, op, row.examId, row.id); return attemptDto(ctx, row);
  }
  value.answers = { ...value.answers, [question.id]: { ...(question.type === 'open' ? { text: sanitizeAiText(String(raw.text)) } : { optionId: String(raw.optionId) }), confirmed: raw.action === 'confirmAnswer' } };
  row = { ...row, revision: row.revision + 1, json: JSON.stringify(value) }; ctx.db.examAttempt.id.update(row);
  remember(ctx, raw, op, row.examId, row.id); return attemptDto(ctx, row);
}
function finishAttempt(ctx: Ctx, raw: Record<string, unknown>): ExamAttempt {
  const op = operation(ctx, raw); if (op.previous) return attemptDto(ctx, ownAttempt(ctx, op.previous.attemptId));
  let row = expireAttempt(ctx, ownAttempt(ctx, raw.attemptId));
  if (row.state !== 'closed') { expectVersion(row.revision, integer(raw.expectedRevision, 'Revisión')); row = closeAttempt(ctx, row, 'submitted'); }
  remember(ctx, raw, op, row.examId, row.id); return attemptDto(ctx, row);
}


type BankRow = NonNullable<ReturnType<Ctx['db']['examBankQuestion']['id']['find']>>;
function bankVersion(ctx: Ctx, row: BankRow, number = row.version) { const stored = ctx.db.examBankVersion.key.find(`${row.id}:${number}`); if (!stored) fail('unavailable', 'La versión del banco no está disponible.'); return JSON.parse(stored.json) as StoredVersion; }
function bankOwn(ctx: Ctx, id: unknown) { const row = ctx.db.examBankQuestion.id.find(uuid(id)); if (!row || !row.owner.isEqual(memberIdentityFor(ctx))) fail('unavailable', 'La pregunta no está disponible para editar.'); return row; }
function bankSummary(ctx: Ctx, row: BankRow): ExamBankSummary { const value = bankVersion(ctx, row); const question = value.questions[0]!; return { id: row.id, version: row.version, ownerId: row.owner.toHexString(), visibility: row.visibility as 'personal' | 'group', subjectId: String(row.subjectId), termId: row.termId ? String(row.termId) : undefined, topic: question.topic, type: question.type, difficulty: question.difficulty ?? value.config.difficulty, text: question.text, updatedAt: at(row.updatedAt), canEdit: row.owner.isEqual(memberIdentityFor(ctx)), sourceIssues: versionIssues(ctx, value) }; }
function bankList(ctx: Ctx, raw: Record<string, unknown>): ExamBankSummary[] { return [...ctx.db.examBankQuestion.iter()].filter((row) => (row.owner.isEqual(memberIdentityFor(ctx)) || row.visibility === 'group') && (raw.subjectId === undefined || String(row.subjectId) === raw.subjectId) && (raw.termId === undefined || String(row.termId) === raw.termId)).map((row) => bankSummary(ctx, row)).filter((row) => !row.sourceIssues.some((issue) => issue.state === 'unavailable')).sort((a, b) => b.updatedAt - a.updatedAt); }
function bankDetail(ctx: Ctx, raw: Record<string, unknown>): ExamBankDetail { const row = ctx.db.examBankQuestion.id.find(uuid(raw.bankId)); if (!row || !(row.owner.isEqual(memberIdentityFor(ctx)) || row.visibility === 'group')) fail('unavailable', 'La pregunta no está disponible.'); const summary = bankSummary(ctx, row); const value = bankVersion(ctx, row, raw.version === undefined ? row.version : integer(raw.version, 'Versión')); requireAccess(ctx, value); return { ...summary, ...(row.owner.isEqual(memberIdentityFor(ctx)) ? { question: value.questions[0], preparation: value.preparation } : {}) }; }
function shareable(ctx: Ctx, value: StoredVersion) { requireAccess(ctx, value); validateDocumentOrigins(ctx, value.preparation, memberIdentityFor(ctx), { sharing: true }); if (value.hasPersonalSources || value.preparation.sources.some((source) => source.visibility !== 'group' || resolveAiSelection(ctx, source, memberIdentityFor(ctx), { reuseReviewed: true }).visibility !== 'group')) fail('unauthorized', 'Una fuente personal impide compartir esta pregunta.'); }
function saveToBank(ctx: Ctx, raw: Record<string, unknown>) { const op = operation(ctx, raw); if (op.previous) return bankDetail(ctx, { bankId: op.previous.examId }); const exam = own(ctx, raw.examId); const version = requireVersion(ctx, exam.id, raw.version); if (version.state !== 'ready') fail('invalid', 'Solo se guardan preguntas de una versión aprobada.'); const value = data(version); requireAccess(ctx, value); const question = value.questions.find((question) => question.id === raw.questionId); if (!question) fail('invalid', 'La pregunta no existe.');
  const previous = raw.bankId === undefined ? undefined : bankOwn(ctx, raw.bankId); if (previous) expectVersion(previous.version, integer(raw.expectedVersion, 'Versión'));
  const citationIds = new Set(question.citations); const fragments = value.preparation.fragments.filter((fragment) => citationIds.has(fragment.id)); const sources = value.preparation.sources.filter((source) => source.fragmentIds.some((id) => citationIds.has(id))).map((source) => ({ ...source, topics: [question.topic], fragmentIds: source.fragmentIds.filter((id) => citationIds.has(id)) }));
  const preparation = { ...value.preparation, topics: [question.topic], sources, fragments, coverage: [{ topic: question.topic, sourceIds: sources.map((source) => `${source.kind}:${source.refId}`) }] }; const config = { ...value.config, questionCount: 1, types: [question.type], topicWeights: [{ topic: question.topic, weight: 1 }] }; const stored: StoredVersion = { ...value, config, preparation, questions: [{ ...question, difficulty: question.difficulty ?? config.difficulty }], hasPersonalSources: sources.some((source) => source.visibility === 'personal') };
  if (previous?.visibility === 'group') shareable(ctx, stored); const number = previous ? previous.version + 1 : 1; const id = previous?.id ?? op.requestId; if (!previous && ctx.db.examBankQuestion.id.find(id)) fail('conflict', 'El identificador ya existe.');
  const row = { id, owner: memberIdentityFor(ctx), subjectId: exam.subjectId, termId: exam.termId, visibility: previous?.visibility ?? 'personal', version: number, updatedAt: ctx.timestamp }; if (previous) ctx.db.examBankQuestion.id.update(row); else ctx.db.examBankQuestion.insert(row); ctx.db.examBankVersion.insert({ key: `${id}:${number}`, bankId: id, version: number, json: JSON.stringify(stored), createdAt: ctx.timestamp }); remember(ctx, raw, op, id); return bankDetail(ctx, { bankId: id });
}
function variantPlan(raw: unknown): ExamVariantPlan { const value = obj(raw); const config = examConfig({ questionCount: value.questionCount, types: value.types, difficulty: value.difficulty, topicWeights: value.topicWeights }); if (typeof value.subjectId !== 'string' || !/^\d+$/.test(value.subjectId) || value.termId !== undefined && (typeof value.termId !== 'string' || !/^\d+$/.test(value.termId)) || !Array.isArray(value.topics) || !value.topics.length || value.topics.some((topic) => typeof topic !== 'string' || !topic.trim() || topic.length > 120) || new Set(value.topics).size !== value.topics.length || value.bankIds !== undefined && (!Array.isArray(value.bankIds) || value.bankIds.some((id) => !aiUuid(id)))) fail('invalid', 'El plano de la variante no es válido.'); return { ...config, subjectId: value.subjectId, termId: value.termId as string | undefined, topics: value.topics as string[], seed: text(value.seed, 'La semilla'), bankIds: value.bankIds as string[] | undefined }; }
function createVariant(ctx: Ctx, raw: Record<string, unknown>) { const op = operation(ctx, raw); if (op.previous) return detail(ctx, own(ctx, op.previous.examId)); const plan = variantPlan(raw.plan); const preview = selectExamVariant(bankList(ctx, {}), plan); if (preview.deficits.length) fail('invalid', `Faltan preguntas: ${preview.deficits.map((slot) => `${slot.topic} (${slot.available}/${slot.requested})`).join(', ')}.`); const values = preview.selected.map((summary) => ({ id: summary.id, value: bankVersion(ctx, ctx.db.examBankQuestion.id.find(summary.id)!) }));
  const fragments: AiPreparation['fragments'] = []; const sources = new Map<string, AiPreparation['sources'][number]>(); const questions: ExamEditableQuestion[] = [];
  for (const item of values) { requireAccess(ctx, item.value); const mapping = new Map(item.value.preparation.fragments.map((fragment) => [fragment.id, `${item.id}:${fragment.id}`])); fragments.push(...item.value.preparation.fragments.map((fragment) => ({ ...fragment, id: mapping.get(fragment.id)! }))); for (const source of item.value.preparation.sources) { const key = examPreparedSourceKey(source); const existing = sources.get(key); sources.set(key, { ...source, topics: [...new Set([...(existing?.topics ?? []), ...source.topics])], fragmentIds: [...new Set([...(existing?.fragmentIds ?? []), ...source.fragmentIds.map((id) => mapping.get(id)!)])] }); } questions.push({ ...item.value.questions[0]!, id: item.id, citations: item.value.questions[0]!.citations.map((id) => mapping.get(id)!) }); }
  const base = values[0]!.value.preparation; const config: AiGenerationConfig = { purpose: 'questions', questionCount: questions.length, types: plan.types, difficulty: plan.difficulty, topicWeights: plan.topicWeights }; const preparation: AiPreparation = { ...base, id: op.requestId, subjectId: plan.subjectId, termId: plan.termId, topics: plan.topics, sources: [...sources.values()], fragments, config, fingerprint: aiHash([plan, preview.selected]), coverage: plan.topics.map((topic) => ({ topic, sourceIds: [...sources.entries()].filter(([, source]) => source.topics.includes(topic)).map(([key]) => key) })) };
  const title = text(raw.title, 'El título'); const value: StoredVersion = { title, config, preparation, questions, timeLimitSeconds: timeLimit(raw.timeLimitSeconds), hasPersonalSources: preparation.sources.some((source) => source.visibility === 'personal') }; validatedQuestions(questions, preparation, config); const exam = ctx.db.studyExam.insert({ id: op.requestId, owner: memberIdentityFor(ctx), title, subjectId: BigInt(plan.subjectId), termId: plan.termId ? BigInt(plan.termId) : undefined, visibility: 'personal', archived: false, revision: 1, readyVersion: undefined, draftVersion: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp }); ctx.db.examVersion.insert({ key: `${exam.id}:1`, examId: exam.id, version: 1, state: 'draft', json: JSON.stringify(value), createdAt: ctx.timestamp }); remember(ctx, raw, op, exam.id); return detail(ctx, exam);
}
export function evaluateOpen(ctx: Ctx, raw: Record<string, unknown>, origin: 'manual' | 'assisted' = 'manual') { const op = operation(ctx, raw); if (op.previous) return attemptDto(ctx, ownAttempt(ctx, op.previous.attemptId)); const row = ownAttempt(ctx, raw.attemptId); if (row.state !== 'closed') fail('invalid', 'Termina el intento antes de evaluar respuestas abiertas.'); expectVersion(row.revision, integer(raw.expectedRevision, 'Revisión')); const value = attemptData(row); const version = data(requireVersion(ctx, row.examId, row.version)); const question = version.questions.find((question) => question.id === raw.questionId); if (!question || !questionAvailable(ctx, version, question)) fail('unavailable', 'La pregunta no está disponible.'); if (raw.suggestionId !== undefined) fail('invalid', 'Acepta la sugerencia desde su solicitud guardada.'); const criteria = raw.criteria as ExamOpenEvaluation['criteria']; const feedback = typeof raw.feedback === 'string' ? raw.feedback : ''; validateOpenEvaluation(question, criteria, feedback); const answer = value.answers[question.id] ?? { text: '', confirmed: true }; value.answers = { ...value.answers, [question.id]: { ...answer, evaluation: { rubricVersion: question.rubric!.version, criteria: criteria.map((criterion) => ({ ...criterion, feedback: sanitizeAiText(criterion.feedback) })), feedback: sanitizeAiText(feedback), evaluatedAt: now(ctx), origin } } }; value.openResult = scoreOpenExam(version.questions, Object.entries(value.answers).map(([questionId, answer]) => ({ questionId, ...answer }))); const next = { ...row, revision: row.revision + 1, json: JSON.stringify(value) }; ctx.db.examAttempt.id.update(next); remember(ctx, raw, op, row.examId, row.id); return attemptDto(ctx, next); }

function dispatch(ctx: Ctx, raw: Record<string, unknown>): unknown {
  activeMember(ctx);
  if (raw.action === 'listBank') return bankList(ctx, raw);
  if (raw.action === 'getBankQuestion') return bankDetail(ctx, raw);
  if (raw.action === 'saveToBank') return saveToBank(ctx, raw);
  if (raw.action === 'setBankVisibility') { const row = bankOwn(ctx, raw.bankId); expectVersion(row.version, integer(raw.expectedVersion, 'Versión')); if (!['personal', 'group'].includes(String(raw.visibility))) fail('invalid', 'Visibilidad inválida.'); if (raw.visibility === 'group') shareable(ctx, bankVersion(ctx, row)); ctx.db.examBankQuestion.id.update({ ...row, visibility: String(raw.visibility), updatedAt: ctx.timestamp }); return bankDetail(ctx, { bankId: row.id }); }
  if (raw.action === 'previewVariant') return selectExamVariant(bankList(ctx, {}), variantPlan(raw.plan));
  if (raw.action === 'createVariant') return createVariant(ctx, raw);
  if (raw.action === 'evaluateOpenAnswer') return evaluateOpen(ctx, raw);
  if (raw.action === 'sendToSpaced') return sendExamToSpaced(ctx, raw);
  if (raw.action === 'listExams') return [...ctx.db.studyExam.iter()].filter((exam) => raw.sharedOnly === true
    ? exam.visibility === 'group' && exam.readyVersion !== undefined && !exam.archived && ctx.db.examVersion.key.find(`${exam.id}:${exam.readyVersion}`)?.state === 'ready'
    : exam.owner.isEqual(memberIdentityFor(ctx))
    ? raw.includeArchived === true || !exam.archived
    : exam.visibility === 'group' && exam.readyVersion !== undefined && !exam.archived).map((exam) => examSummary(ctx, exam, raw.sharedOnly === true)).sort((a, b) => b.updatedAt - a.updatedAt);
  if (raw.action === 'getExam') return detail(ctx, readable(ctx, raw.examId));
  if (raw.action === 'getVersion') { const exam = own(ctx, raw.examId); return versionDto(ctx, exam, requireVersion(ctx, exam.id, raw.version)); }
  if (raw.action === 'listGenerations') return [...ctx.db.aiGeneration.actor.filter(memberIdentityFor(ctx))].filter((row) => {
    if (!ctx.db.aiPreparation.id.find(row.preparationId)) return false;
    const config = JSON.parse(row.configJson) as AiGenerationConfig;
    return config.purpose === undefined || config.purpose === 'questions';
  }).map((row): ExamGenerationSummary => ({
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
  if (raw.action === 'listAttempts') return [...ctx.db.examAttempt.actor.filter(memberIdentityFor(ctx))].filter((row) => raw.examId === undefined || row.examId === raw.examId).map((row) => attemptSummary(expireAttempt(ctx, row))).sort((a, b) => b.startedAt - a.startedAt);
  if (raw.action === 'saveAnswer' || raw.action === 'confirmAnswer') return answerAttempt(ctx, raw);
  if (raw.action === 'finishAttempt') return finishAttempt(ctx, raw);
  return fail('invalid', 'Operación de Exámenes no admitida.');
}
export function examResponse(ctx: Ctx, payload: string): string {
  try {
    if (new TextEncoder().encode(payload).length > 2 * 1024 * 1024) fail('invalid', 'La solicitud excede el límite.');
    let raw: Record<string, unknown>;
    try { raw = obj(JSON.parse(payload)); } catch (error) { if (error instanceof SenderError) throw error; return fail('invalid', 'JSON inválido.'); }
    return JSON.stringify(dispatch(ctx, raw));
  } catch (error) {
    // Preserve stable errors through the HTTP procedure runtime, like EX-1.
    if (error instanceof SenderError) return JSON.stringify({ ok: false, code: /^([a-z_]{3,40}):/.exec(error.message)?.[1] ?? 'unauthorized', message: error.message });
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') return JSON.stringify({ ok: false, code: error.code, message: error.message });
    throw error;
  }
}

/** Permanently remove copied source text; frozen answer IDs still permit numeric scoring. */
export function purgeExamSource(ctx: Ctx, kind: string, targetId: bigint): void {
  const refId = String(targetId);
  const matches = (source: { kind: string; refId: string }) => source.kind === kind && source.refId === refId;
  for (const row of [...ctx.db.examVersion.iter(), ...ctx.db.examBankVersion.iter()]) {
    const value = JSON.parse(row.json) as StoredVersion; const prep = value.preparation;
    const affectedSources = new Set(prep.sources.filter((source) => matches(source) || source.origins.some(matches)).map(examPreparedSourceKey));
    const affectedFragments = new Set(prep.sources.filter((source) => affectedSources.has(examPreparedSourceKey(source))).flatMap((source) => source.fragmentIds));
    const removed = new Set(prep.fragments.filter((fragment) => fragment.origins.some(matches) || affectedFragments.has(fragment.id)).map((fragment) => fragment.id));
    if (!removed.size && !affectedSources.size) continue;
    const purgedQuestionIds = new Set(value.purgedQuestionIds ?? []);
    for (const question of value.questions) if (question.citations.some((id) => removed.has(id))) purgedQuestionIds.add(question.id);
    const preparation: AiPreparation = { ...prep, canGenerate: false, omissions: [],
      sources: prep.sources.map((source) => affectedSources.has(examPreparedSourceKey(source))
        ? { ...source, title: 'Fuente eliminada', status: 'unauthorized', reason: 'El material original fue eliminado definitivamente.', fragmentIds: [], origins: [] }
        : { ...source, fragmentIds: source.fragmentIds.filter((id) => !removed.has(id)), origins: source.origins.filter((origin) => !matches(origin)) }),
      fragments: prep.fragments.filter((fragment) => !removed.has(fragment.id)),
      coverage: prep.coverage.map((item) => ({ ...item, sourceIds: item.sourceIds.filter((id) => !affectedSources.has(id) && prep.sources.some((source) => !affectedSources.has(examPreparedSourceKey(source)) && (id === `${source.kind}:${source.refId}` || id === examPreparedSourceKey(source)))) })) };
    const questions = value.questions.map((question) => purgedQuestionIds.has(question.id)
      ? { ...question, text: '', explanation: '', referenceAnswer: undefined, rubric: undefined, options: question.options.map((option) => ({ id: option.id, text: '' })), citations: [], issue: undefined }
      : question);
    if ('examId' in row) ctx.db.examVersion.key.update({ ...row, json: JSON.stringify({ ...value, preparation, questions, purgedQuestionIds: [...purgedQuestionIds] }) });
    else ctx.db.examBankVersion.key.update({ ...row, json: JSON.stringify({ ...value, preparation, questions, purgedQuestionIds: [...purgedQuestionIds] }) });
  }
  for (const row of [...ctx.db.examEvaluationDraft.iter()]) {
    const value = JSON.parse(row.json) as import('../../core/src/examEvaluation').ExamEvaluationDraft;
    const origins = value.snapshot.citations as { origins?: { kind: string; refId: string }[] }[];
    if (!origins.some((citation) => citation.origins?.some(matches))) continue;
    ctx.db.examEvaluationDraft.id.update({ ...row, json: JSON.stringify({ ...value, state: 'cancelled', result: undefined, acceptedAttempt: undefined, error: 'La fuente fue eliminada definitivamente.', snapshot: { ...value.snapshot, question: { ...value.snapshot.question, text: '', referenceAnswer: undefined, rubric: undefined, explanation: '', citations: [], options: [] }, citations: [] } }) });
  }

}

/** Service operations still resolve every original with the student's identity. */
export function getExamEvaluationSnapshot(ctx: Ctx, actor: import('spacetimedb').Identity, attemptId: unknown, questionId: unknown) {
  const row = ctx.db.examAttempt.id.find(uuid(attemptId)); if (!row || !row.actor.isEqual(actor) || row.state !== 'closed') fail('unavailable', 'El intento concluido no está disponible.'); const exam = ctx.db.studyExam.id.find(row.examId); if (!exam || !(exam.owner.isEqual(actor) || exam.visibility === 'group')) fail('unavailable', 'El examen ya no está disponible.'); const value = attemptData(row); const version = data(requireVersion(ctx, row.examId, row.version)); const question = version.questions.find((question) => question.id === questionId); const issues = prepIssues(ctx, version.preparation, actor); if (!question || question.type !== 'open' || !questionAvailable(ctx, version, question, issues, actor)) fail('unavailable', 'La pregunta abierta ya no está disponible.'); const answer = Object.hasOwn(value.answers, question.id) ? value.answers[question.id]?.text ?? '' : ''; const citations = version.preparation.fragments.filter((fragment) => question.citations.includes(fragment.id)).map((fragment) => ({ ...fragment, origins: availableOrigins(ctx, version, fragment, issues, actor) })); const snapshot = { attemptId: row.id, questionId: question.id, revision: row.revision, question, answer, citations }; return { ...snapshot, fingerprint: aiHash(snapshot) };
}

/** Authorized study-material projection. It never starts an attempt or exposes another student's answers. */
export function resolveGuideExamMaterial(ctx: Ctx, examId: string, person = memberIdentityFor(ctx), options: { examVersion?: number; includeSolutions?: boolean } = {}) {
  const exam = ctx.db.studyExam.id.find(uuid(examId));
  const owner = !!exam?.owner.isEqual(person);
  if (!exam || exam.archived || !ctx.db.member.identity.find(person) || ctx.db.member.identity.find(person)?.status !== 'active' || !owner && exam.visibility !== 'group') fail('unavailable', 'El examen no está disponible como material de estudio.');
  const number = options.examVersion ?? (owner ? exam.draftVersion ?? exam.readyVersion : exam.readyVersion);
  if (!number || owner && number !== exam.draftVersion && number !== exam.readyVersion || !owner && number !== exam.readyVersion) fail('unavailable', 'Elige una versión vigente del examen.');
  const row = requireVersion(ctx, exam.id, number);
  if (!owner && row.state !== 'ready') fail('unavailable', 'El examen todavía no tiene una versión compartida lista.');
  const value = data(row); const issues = prepIssues(ctx, value.preparation, person);
  if (issues.some((issue) => issue.state === 'unavailable') || value.questions.some((question) => !questionAvailable(ctx, value, question, issues, person))) fail('unavailable', 'Una fuente del examen ya no está disponible para tu cuenta.');
  const revealed = new Set<string>();
  if (!owner) for (const attempt of ctx.db.examAttempt.actor.filter(person)) {
    if (attempt.examId !== exam.id || attempt.version !== number) continue;
    const saved = attemptData(attempt);
    for (const question of value.questions) if (attempt.state === 'closed' || saved.mode === 'practice' && question.type !== 'open' && saved.answers[question.id]?.confirmed) revealed.add(question.id);
  }
  const canIncludeSolutions = owner || revealed.size > 0;
  const fields = value.questions.flatMap((question, index) => {
    const base = [{ name: `pregunta:${question.id}`, text: `${index + 1}. ${question.text}\n${question.options.map((option) => `${option.id}. ${option.text}`).join('\n')}` }];
    if (options.includeSolutions && (owner || revealed.has(question.id))) base.push({ name: `solucion:${question.id}`, text: [question.type === 'open' ? question.referenceAnswer : `Respuesta correcta: ${question.options.find((option) => option.id === question.correctOptionId)?.text ?? question.correctOptionId}`, question.explanation, question.rubric ? JSON.stringify(question.rubric) : ''].filter(Boolean).join('\n') });
    return base;
  });
  return { kind: 'exam' as const, refId: exam.id, version: number, examVersion: number, subjectId: String(exam.subjectId), ...(exam.termId ? { termId: String(exam.termId) } : {}), title: value.title,
    visibility: (exam.visibility === 'personal' || value.hasPersonalSources || row.state !== 'ready' || options.includeSolutions === true && canIncludeSolutions ? 'personal' : 'group') as 'group' | 'personal', ownerId: exam.owner.toHexString(), topics: value.preparation.topics,
    canIncludeSolutions, sourceIssues: issues, fields, context: aiHash({ revision: exam.revision, version: number, json: row.json, issues, selectedSolutions: options.includeSolutions ? [...revealed].sort() : [], includeSolutions: options.includeSolutions === true }),
    omissions: options.includeSolutions && !owner && revealed.size < value.questions.length ? ['Las soluciones todavía ocultas no se incluyen; solo se usan las que ya puedes consultar.'] : [] };
}
