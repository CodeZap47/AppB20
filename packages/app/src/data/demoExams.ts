import { AI_LIMITS, aiHash, buildAiPreparation, examAttemptOrder, examPreparedSourceKey, examTopicDistribution, scoreExam, scoreOpenExam, selectExamVariant, validateOpenEvaluation, validateAiQuestionDraft,
  type ExamEvaluationActionRequest, type ExamEvaluationActionResponse, type ExamEvaluationDraft, type AiGeneration, type AiGenerationRequest, type AiPreparation, type AiPrepareInput, type AiQuestion, type ExamActionRequest,
  type ExamBankSummary, type ExamBankDetail, type ExamVariantPlan, type ExamAttempt, type ExamDetail, type ExamDraft, type ExamGenerationSummary, type ExamSourceIssue, type ExamSummary } from '@b20/core';
import { aiCandidateKey, aiSourceCandidates } from '../lib/aiSources';
import type { Snapshot } from './types';
import type { GuideExamMaterial, GuideExamMaterialDetail } from '@b20/core';
import type { ExamActions, ExamActionResponse } from './examTypes';
interface Context { getDocumentTranscription?: import('./documentTypes').DocumentActions['getDocumentTranscription']; resolveReviewedTranscription?: import('./documentTypes').DocumentActions['getDocumentTranscription']; snapshot(): Snapshot; now(): Date; sendToSpaced?(request: Extract<ExamActionRequest, {action:'sendToSpaced'}>): Promise<{collectionId:string;cardId:string;created:boolean}> }
interface Version { draft: ExamDraft; sourceRevisions: Record<string, string>; purgedQuestionIds?: string[]; unavailableDocumentIds?: string[] }
interface StoredExam { summary: ExamSummary; versions: Map<number, Version> }
interface StoredAttempt { actor: string; version: Version; exam: StoredExam; value: ExamAttempt; order: ReturnType<typeof examAttemptOrder>; requests: Map<string, string> }
interface Prepared { actor: string; preparation: AiPreparation; sourceRevisions: Record<string, string> }
interface Generated extends Prepared { generation: AiGeneration; importedExamId?: string; requestHash: string }
interface StoredBank { summary: ExamBankSummary; versions: Map<number, Version> }
interface SharedExams { evaluations: Map<string, { actor: string; value: ExamEvaluationDraft }>; bank: Map<string, StoredBank>; references: number; prepared: Map<string, Prepared>; generated: Map<string, Generated>; exams: Map<string, StoredExam>; attempts: Map<string, StoredAttempt>; requests: Map<string, { actor: string; hash: string; examId: string; attemptId?: string }> }
const sharedExams = new WeakMap<object, SharedExams>();
/** All simulation content is fictitious and remains in memory; no key or provider is contacted. */
export class DemoExamStore implements ExamActions {
  private evaluations = new Map<string, { actor: string; value: ExamEvaluationDraft }>(); private bank = new Map<string, StoredBank>(); private prepared = new Map<string, Prepared>(); private generated = new Map<string, Generated>();
  private exams = new Map<string, StoredExam>(); private attempts = new Map<string, StoredAttempt>(); private requests = new Map<string, { actor: string; hash: string; examId: string; attemptId?: string }>();
  private shared?: SharedExams;
  constructor(private ctx: Context, sharedKey?: object) { if (sharedKey) { let shared = sharedExams.get(sharedKey); if (!shared) { shared = { evaluations: this.evaluations, bank: this.bank, references: 0, prepared: this.prepared, generated: this.generated, exams: this.exams, attempts: this.attempts, requests: this.requests }; sharedExams.set(sharedKey, shared); } shared.references++; this.shared = shared; this.bank = shared.bank; this.evaluations = shared.evaluations; this.prepared = shared.prepared; this.generated = shared.generated; this.exams = shared.exams; this.attempts = shared.attempts; this.requests = shared.requests; } }
  /** Authorized content projection for guides; never starts, expires or changes an attempt. */
  async listGuideExamMaterials(subjectId: string): Promise<GuideExamMaterial[]> {
    this.actor(); await this.reviewedDocuments(); const rows: GuideExamMaterial[] = [];
    for (const exam of this.exams.values()) {
      if (exam.summary.archived || exam.summary.subjectId !== subjectId || !(exam.summary.ownerId === this.actor() || exam.summary.visibility === 'group' && exam.summary.readyVersion)) continue;
      const number = exam.summary.ownerId === this.actor() ? exam.summary.draftVersion ?? exam.summary.readyVersion : exam.summary.readyVersion;
      if (!number) continue;
      try { const { text: _text, fields: _fields, omissions: _omissions, ...summary } = this.guideExamMaterial(exam.summary.id, number); rows.push(summary); }
      catch { const version = this.version(exam, number); rows.push({ id: exam.summary.id, title: version.draft.title, subjectId, termId: exam.summary.termId, version: number,
        topics: version.draft.preparation.topics, ownerId: exam.summary.ownerId, visibility: exam.summary.visibility, canIncludeSolutions: false,
        sourceIssues: [{ state: 'unavailable', message: 'Una fuente del examen dejó de estar disponible.' }] }); }
    }
    return rows.sort((a, b) => a.title.localeCompare(b.title, 'es'));
  }
  async getGuideExamMaterial(examId: string, version: number, includeSolutions = false): Promise<GuideExamMaterialDetail> {
    await this.reviewedDocuments(); return this.guideExamMaterial(examId, version, includeSolutions);
  }
  private guideExamMaterial(examId: string, number: number, includeSolutions = false): GuideExamMaterialDetail {
    const actor = this.actor(), exam = this.access(examId), version = this.version(exam, number);
    if (exam.summary.archived || exam.summary.ownerId !== actor && (number !== exam.summary.readyVersion || version.draft.state !== 'ready')) throw new Error('El examen no está disponible para esta guía.');
    this.readable(version);
    const allowed = (question: AiQuestion) => exam.summary.ownerId === actor || [...this.attempts.values()].some((attempt) => attempt.actor === actor && attempt.exam.summary.id === examId && attempt.value.examVersion === number
      && (attempt.value.state === 'closed' || attempt.value.mode === 'practice' && question.type !== 'open' && attempt.value.answers.some((answer) => answer.questionId === question.id && answer.confirmed)));
    const fields: { name: string; text: string }[] = [];
    for (const question of version.draft.questions) {
      fields.push({ name: `pregunta:${question.id}`, text: `${question.topic}: ${question.text}` });
      if (question.options.length) fields.push({ name: `opciones:${question.id}`, text: question.options.map((option) => `${option.id}. ${option.text}`).join('\n') });
      if (includeSolutions && allowed(question)) fields.push({ name: `solucion:${question.id}`, text: [question.correctOptionId ? `Opción correcta: ${question.correctOptionId}` : '', question.explanation, question.referenceAnswer ?? '', question.rubric ? JSON.stringify(question.rubric) : ''].filter(Boolean).join('\n') });
    }
    const hidden = includeSolutions ? version.draft.questions.filter((question) => !allowed(question)).length : 0;
    return structuredClone({ id: examId, title: version.draft.title, subjectId: exam.summary.subjectId, termId: exam.summary.termId, version: number,
      topics: version.draft.preparation.topics, ownerId: exam.summary.ownerId, visibility: includeSolutions || exam.summary.visibility === 'personal' || version.draft.hasPersonalSources || version.draft.state !== 'ready' ? 'personal' : 'group',
      canIncludeSolutions: version.draft.questions.some(allowed), sourceIssues: this.issues(version).map(({ state, message }) => ({ state, message })),
      fields, text: fields.map((field) => field.text).join('\n\n'), omissions: hidden ? [`${hidden} soluciones ocultas por permisos; no se incluyeron.`] : [] });
  }
  private actor() { const me = this.ctx.snapshot().me; if (me?.status !== 'active') throw new Error('Necesitas acceso vigente al grupo.'); return me.id; }
  private now() { return this.ctx.now().getTime(); }
  private sourceUnavailable(version: { draft: Pick<ExamDraft, 'preparation'>; unavailableDocumentIds?: string[] }, ref: AiPreparation['sources'][number], data = this.ctx.snapshot(), fragment?: AiPreparation['fragments'][number]) {
    const candidate = aiSourceCandidates(data, version.draft.preparation.subjectId).find((row) => aiCandidateKey(row) === aiCandidateKey(ref));
    if (ref.status === 'unauthorized' || !candidate || ref.visibility === 'group' && candidate.personal) return true;
    const relevant = fragment ? [fragment] : version.draft.preparation.fragments.filter((entry) => ref.fragmentIds.includes(entry.id));
    const dependencies = ref.kind === 'question' ? relevant.flatMap((entry) => entry.origins).filter((origin) => origin.kind === 'answer' && ref.origins.some((dependency) => dependency.kind === origin.kind && dependency.refId === origin.refId)) : ref.origins;
    if (dependencies.some((origin) => origin.kind === 'answer' && !data.answers.some((answer) => answer.id === origin.refId && !answer.withdrawnAt))) return true;
    if (ref.transcriptionIds?.some((id) => version.unavailableDocumentIds?.includes(id))) return true;
    const sourceFragments = version.draft.preparation.fragments.filter((entry) => ref.fragmentIds.includes(entry.id));
    return sourceFragments.some((fragment) => fragment.origins.some((origin) =>
      origin.transcriptionId && version.unavailableDocumentIds?.includes(origin.transcriptionId) || origin.fileId && !data.resourceFiles.some((file) => file.id === origin.fileId && !file.removedAt)));
  }
  private issues(version: Version): ExamSourceIssue[] {
    const data = this.ctx.snapshot(); const candidates = aiSourceCandidates(data, version.draft.preparation.subjectId);
    return [...(version.purgedQuestionIds?.length ? [{ kind: 'exam', refId: version.draft.examId, state: 'unavailable' as const, message: 'Un material de esta versión fue eliminado definitivamente.' }] : []),
      ...version.draft.preparation.sources.flatMap<ExamSourceIssue>((ref) => {
        if (this.sourceUnavailable(version, ref, data)) return [{ kind: ref.kind, refId: ref.refId, state: 'unavailable', message: 'Una fuente fue retirada o dejó de estar disponible.' }];
        const candidate = candidates.find((row) => aiCandidateKey(row) === aiCandidateKey(ref))!;
        const recorded = version.sourceRevisions[examPreparedSourceKey(ref)] ?? version.sourceRevisions[aiCandidateKey(ref)];
        return candidate.revision !== recorded ? [{ kind: ref.kind, refId: ref.refId, state: 'outdated', message: 'La fuente cambió después de preparar esta versión.' }] : [];
      })];
  }
  private availableOrigins(version: Version, fragment: AiPreparation['fragments'][number], data = this.ctx.snapshot()) {
    return fragment.origins.filter((origin) => {
      if (origin.kind === 'answer' && !data.answers.some((answer) => answer.id === origin.refId && !answer.withdrawnAt)) return false;
      if (origin.transcriptionId && version.unavailableDocumentIds?.includes(origin.transcriptionId)) return false;
      if (origin.fileId && !data.resourceFiles.some((file) => file.id === origin.fileId && !file.removedAt)) return false;
      return version.draft.preparation.sources.some((ref) => ref.fragmentIds.includes(fragment.id) && !this.sourceUnavailable(version, ref, data, fragment)
        && (ref.kind === origin.kind && ref.refId === origin.refId || ref.origins.some((dependency) => dependency.kind === origin.kind && dependency.refId === origin.refId)));
    });
  }
  private access(examId: string, edit = false) { const actor = this.actor(); const exam = this.exams.get(examId); if (!exam || (exam.summary.ownerId !== actor && (edit || exam.summary.visibility !== 'group' || !exam.summary.readyVersion))) throw new Error('El examen no existe o no tienes acceso.'); return exam; }
  private version(exam: StoredExam, number: number) { const version = exam.versions.get(number); if (!version) throw new Error('La versión no está disponible.'); return version; }
  private readable(version: Version) { if (this.issues(version).some((issue) => issue.state === 'unavailable')) throw new Error('Una fuente ya no está disponible. Su texto y las preguntas se ocultaron.'); }
  private async reviewedDocuments() {
    const actor = this.actor(); const versions = new Set<Version>();
    for (const exam of this.exams.values()) if (exam.summary.ownerId === actor || exam.summary.visibility === 'group') for (const [number, version] of exam.versions) {
      if (exam.summary.ownerId === actor || number === exam.summary.readyVersion) versions.add(version);
    }
    for (const attempt of this.attempts.values()) if (attempt.actor === actor) versions.add(attempt.version);
    for (const row of this.bank.values()) if (row.summary.ownerId === actor || row.summary.visibility === 'group') for (const version of row.versions.values()) versions.add(version);
    const checked = new Map<string, boolean>();
    for (const version of versions) {
      const ids = [...new Set([...version.draft.preparation.sources.flatMap((ref) => ref.transcriptionIds ?? []), ...version.draft.preparation.fragments.flatMap((fragment) => fragment.origins.flatMap((origin) => origin.transcriptionId ? [origin.transcriptionId] : []))])];
      for (const id of ids) if (!checked.has(id)) {
        try { if (!this.ctx.resolveReviewedTranscription) throw new Error('Preparación documental no disponible.'); await this.ctx.resolveReviewedTranscription(id); checked.set(id, true); }
        catch { checked.set(id, false); }
      }
      version.unavailableDocumentIds = ids.filter((id) => !checked.get(id));
    }
  }
  private expected(exam: StoredExam, revision: number) { if (exam.summary.revision !== revision) throw new Error('El examen cambió. Recarga antes de guardar.'); }
  private editable(exam: StoredExam, version: number) { const stored = this.version(exam, version); if (stored.draft.state !== 'draft') throw new Error('Esta versión está lista y es inmutable. Crea una nueva versión para editarla.'); this.readable(stored); return stored; }
  private summaries(exam: StoredExam) { return [...exam.versions.values()].map(({ draft, ...rest }) => { const stored = { draft, ...rest }; return { version: draft.version, state: draft.state, questionCount: draft.questions.length, model: draft.model, createdAt: draft.createdAt, approvedAt: draft.approvedAt, hasPersonalSources: draft.hasPersonalSources, sourceIssues: this.issues(stored) }; }); }
  private detail(exam: StoredExam): ExamDetail { const owned = exam.summary.ownerId === this.actor(); const latest = owned ? exam.summary.draftVersion ?? exam.summary.readyVersion : exam.summary.readyVersion; const version = latest ? this.version(exam, latest) : undefined;
    return structuredClone({ ...exam.summary, ...(!owned && version ? { title: version.draft.title, topics: version.draft.preparation.topics, questionCount: version.draft.questions.length, draftVersion: undefined } : {}), canEdit: owned, sourceIssues: version ? this.issues(version) : [], versions: this.summaries(exam).filter((row) => owned || row.version === exam.summary.readyVersion), ...(owned && version && !this.issues(version).some((issue) => issue.state === 'unavailable') ? { draft: { ...version.draft, sourceIssues: this.issues(version) } } : {}) }); }
  /** The feed always projects the approved version, including for its author. */
  private sharedSummary(exam: StoredExam): ExamSummary {
    const { draftVersion: _draftVersion, ...summary } = exam.summary;
    const version = this.version(exam, summary.readyVersion!);
    return structuredClone({ ...summary, revision: summary.readyVersion!, title: version.draft.title,
      questionCount: version.draft.questions.length, topics: version.draft.preparation.topics,
      updatedAt: version.draft.approvedAt ?? summary.createdAt, canEdit: summary.ownerId === this.actor(), sourceIssues: this.issues(version) });
  }
  private changed(exam: StoredExam) { exam.summary.revision++; exam.summary.updatedAt = this.now(); const selected = this.version(exam, exam.summary.draftVersion ?? exam.summary.readyVersion!); exam.summary.questionCount = selected.draft.questions.length; return this.detail(exam); }
  async prepareExamMaterial(input: AiPrepareInput): Promise<AiPreparation> {
    const actor = this.actor(); const data = this.ctx.snapshot(); const candidates = aiSourceCandidates(data, input.subjectId, input.termId);
    const selected = input.sources.map((ref) => { const candidate = candidates.find((row) => aiCandidateKey(row) === aiCandidateKey(ref)); if (!candidate) throw new Error('Una fuente no está disponible.'); return { ref, candidate }; });
    const transcriptions = await Promise.all(selected.map(async ({ ref, candidate }) => {
      if (!ref.transcriptionIds?.length) return []; if (!this.ctx.getDocumentTranscription) throw new Error('La preparación documental no está disponible.');
      return Promise.all(ref.transcriptionIds.map(async (id) => { const value = await this.ctx.getDocumentTranscription!(id); if (value.targetKind !== ref.kind || value.targetId !== ref.refId || value.targetVersion !== candidate.version) throw new Error('La transcripción no pertenece a la versión seleccionada.'); return value; }));
    }));
    const normalized = { ...input, subjectId: '1', ...(input.termId ? { termId: '1' } : {}), sources: selected.map(({ ref }, i) => ({ ...ref, refId: String(i + 1), answerIds: undefined })) };
    const selectedAnswers = selected.map(({ ref, candidate }) => ref.kind !== 'question' ? [] : (ref.answerIds ?? candidate.answers?.filter((answer) => answer.accepted).map((answer) => answer.id) ?? []).map((id) => { const answer = data.answers.find((answer) => answer.id === id && answer.questionId === ref.refId && !answer.withdrawnAt); if (!answer) throw new Error('Una respuesta seleccionada ya no está disponible.'); return answer; }));
    const snapshots: import('@b20/core').AiSourceSnapshot[] = selected.map(({ ref, candidate }, index) => ({ kind: ref.kind, refId: String(index + 1), version: candidate.version, subjectId: '1', ...(candidate.termId ? { termId: '1' } : {}), title: candidate.title,
      visibility: candidate.personal ? 'personal' : 'group', origins: selectedAnswers[index]!.map((answer) => ({ kind: 'answer' as const, refId: answer.id, version: answer.version ?? 1 })), fields: [...selectedAnswers[index]!.map((answer) => ({ name: `Respuesta ${answer.id}`, text: answer.body, origin: { kind: 'answer' as const, refId: answer.id, version: answer.version ?? 1 } })), { name: 'Material ficticio', text: `Contenido ficticio para estudiar ${ref.topics.join(', ') || 'los temas elegidos'}.\nLa simulación no envía material a Gemini.` }, ...transcriptions[index]!.flatMap((value) => { const segments = value.segments.filter((segment) => !ref.segmentIds?.length || ref.segmentIds.includes(segment.id)); if (!segments.length) throw new Error('Selecciona segmentos existentes de la transcripción.'); return segments.map((segment) => ({ name: `Documento ${value.fileId} · ${segment.id}`, text: segment.text, origin: { kind: ref.kind, refId: String(index + 1), version: value.targetVersion, fileId: value.fileId, fileHash: value.fileHash, transcriptionId: value.id, locator: segment.locator } })); })], omissions: ['Texto base ficticio de demostración; el documento revisado se añade únicamente si lo seleccionas.', ...transcriptions[index]!.flatMap((value) => value.omissions)] }));
    const preparation = buildAiPreparation(normalized, snapshots, { id: crypto.randomUUID(), model: 'simulado', now: this.now() });
    preparation.subjectId = input.subjectId; preparation.termId = input.termId;
    preparation.sources.forEach((row, index) => { row.refId = selected[index]!.ref.refId; row.subjectId = input.subjectId; row.termId = selected[index]!.candidate.termId; row.answerIds = row.kind === 'question' ? selectedAnswers[index]!.map((answer) => answer.id) : selected[index]!.ref.answerIds; });
    for (const fragment of preparation.fragments) for (const origin of fragment.origins) { const ref = selected[Number(origin.refId) - 1]?.ref; if (ref && ref.kind === origin.kind) origin.refId = ref.refId; }
    for (const coverage of preparation.coverage) coverage.sourceIds = coverage.sourceIds.map((key) => { const numeric = Number(key.slice(key.indexOf(':') + 1)) - 1; return aiCandidateKey(selected[numeric]!.ref); });
    const sourceRevisions = Object.fromEntries(preparation.sources.map((ref, index) => [examPreparedSourceKey(ref), selected[index]!.candidate.revision])); preparation.fingerprint = aiHash({ input, fragments: preparation.fragments, sourceRevisions });
    this.prepared.set(preparation.id, { actor, preparation, sourceRevisions }); return structuredClone(preparation);
  }
  private currentPrepared(value: Prepared) {
    const data = this.ctx.snapshot(); const candidates = aiSourceCandidates(data, value.preparation.subjectId);
    for (const ref of value.preparation.sources) {
      if (this.sourceUnavailable({ draft: { preparation: value.preparation } }, ref, data)) throw new Error('Una fuente de la generación no está disponible.');
      const candidate = candidates.find((entry) => aiCandidateKey(entry) === aiCandidateKey(ref))!;
      if (candidate.revision !== (value.sourceRevisions[examPreparedSourceKey(ref)] ?? value.sourceRevisions[aiCandidateKey(ref)])) throw new Error('La fuente cambió. Prepara nuevamente el material.');
    }
  }
  async generateExamQuestions(input: AiGenerationRequest) {
    const actor = this.actor(); const requestHash = aiHash({ preparationId: input.preparationId, fingerprint: input.fingerprint, config: input.config }); const prior = this.generated.get(input.id); if (prior) { if (prior.actor !== actor) throw new Error('No tienes acceso a esta generación.'); if (prior.requestHash !== requestHash) throw new Error('El identificador del envío pertenece a otra configuración.'); return this.getExamGeneration(input.id); }
    const prepared = this.prepared.get(input.preparationId); if (!prepared || prepared.actor !== actor || !input.confirmed || input.fingerprint !== prepared.preparation.fingerprint || !prepared.preparation.canGenerate) throw new Error('Prepara y confirma el material antes de generar.');
    this.currentPrepared(prepared);
    if (prepared.preparation.expiresAt <= this.now()) throw new Error('La preparación venció. Prepara el material nuevamente.');
    if (aiHash(input.config) !== aiHash(prepared.preparation.config)) throw new Error('La configuración cambió. Prepara nuevamente la vista previa.');
    for (const ref of prepared.preparation.sources) for (const transcriptionId of ref.transcriptionIds ?? []) { if (!this.ctx.getDocumentTranscription) throw new Error('La transcripción no está disponible.'); await this.ctx.getDocumentTranscription(transcriptionId); }
    const config = input.config; const topics = prepared.preparation.topics;
    const distribution = examTopicDistribution(topics, config.questionCount, config.topicWeights); const assignedTopics = distribution.flatMap((entry) => Array.from({ length: entry.count }, () => entry.topic));
    const questions: AiQuestion[] = Array.from({ length: config.questionCount }, (_, i) => { const type = config.types[i % config.types.length]!; const options = type === 'open' ? [] : type === 'boolean' ? [{ id: 'true', text: 'Verdadero' }, { id: 'false', text: 'Falso' }] : [{ id: 'a', text: 'Respuesta ficticia correcta' }, { id: 'b', text: 'Primera alternativa de prueba' }, { id: 'c', text: 'Segunda alternativa de prueba' }, { id: 'd', text: 'Tercera alternativa de prueba' }];
      const fragmentId = prepared.preparation.sources.find((source) => source.topics.includes(assignedTopics[i]!))?.fragmentIds[0] ?? prepared.preparation.fragments[0]!.id;
      return { id: `question-${i + 1}`, type, text: `Pregunta ficticia ${i + 1} sobre ${assignedTopics[i]}.`, options, correctOptionId: options[0]?.id ?? '', ...(type === 'open' ? { referenceAnswer: 'Respuesta ficticia de referencia.', rubric: { version: 1, criteria: [{ id: 'clarity', description: 'Explica la idea con claridad y evidencia.', maxPoints: 4 }] } } : {}), explanation: 'Explicación ficticia sustentada en el material de demostración.', topic: assignedTopics[i]!, citations: [fragmentId] }; });
    const generation: AiGeneration = { id: input.id, preparationId: input.preparationId, state: 'succeeded', createdAt: this.now(), updatedAt: this.now(), result: { questions }, estimatedTokens: prepared.preparation.estimatedInputTokens + AI_LIMITS.maxOutputTokens };
    this.generated.set(input.id, { ...structuredClone(prepared), generation, requestHash }); return structuredClone(generation);
  }
  async getExamGeneration(id: string) {
    const row = this.generated.get(id); if (!row || row.actor !== this.actor()) throw new Error('La generación no está disponible.');
    this.currentPrepared(row);
    for (const ref of row.preparation.sources) for (const transcriptionId of ref.transcriptionIds ?? []) { if (!this.ctx.getDocumentTranscription) throw new Error('La transcripción no está disponible.'); await this.ctx.getDocumentTranscription(transcriptionId); }
    return structuredClone(row.generation);
  }
  private attempt(id: string) { const value = this.attempts.get(id); if (!value || value.actor !== this.actor()) throw new Error('El intento no existe o no tienes acceso.'); if (value.value.state === 'active' && value.value.deadlineAt !== undefined && value.value.deadlineAt <= this.now()) this.close(value, 'timeout'); return value; }
  private close(stored: StoredAttempt, reason: 'submitted' | 'timeout') { if (stored.value.state === 'closed') return; stored.value.state = 'closed'; stored.value.closedAt = this.now(); stored.value.closeReason = reason;
    stored.value.result = scoreExam(stored.version.draft.questions, Object.fromEntries(stored.value.answers.map((answer) => [answer.questionId, answer.optionId]))); stored.value.openResult = scoreOpenExam(stored.version.draft.questions, stored.value.answers); stored.value.revision++; }
  private attemptDetail(stored: StoredAttempt): ExamAttempt { const issues = this.issues(stored.version); const mayReadExam = stored.exam.summary.ownerId === this.actor() || stored.exam.summary.visibility === 'group';
    const questions = stored.order.map((order) => { const question = stored.version.draft.questions.find((entry) => entry.id === order.questionId)!; const answer = stored.value.answers.find((entry) => entry.questionId === question.id);
      const unavailable = !mayReadExam || stored.version.purgedQuestionIds?.includes(question.id) || !question.citations.every((citation) => (() => { const fragment = stored.version.draft.preparation.fragments.find((fragment) => fragment.id === citation); return !!fragment && this.availableOrigins(stored.version, fragment).length > 0; })());
      if (unavailable) return { id: question.id, type: question.type, text: '', topic: '', options: [], unavailable: true };
      return { id: question.id, type: question.type, text: question.text, topic: question.topic, options: order.optionIds.map((id) => question.options.find((entry) => entry.id === id)!),
        ...(stored.value.state === 'closed' || (stored.value.mode === 'practice' && question.type !== 'open' && answer?.confirmed) ? { solution: { correctOptionId: question.correctOptionId, explanation: question.explanation, ...(question.type === 'open' ? { referenceAnswer: question.referenceAnswer, rubric: question.rubric } : {}), citations: stored.version.draft.preparation.fragments.filter((fragment) => question.citations.includes(fragment.id)).map((fragment) => ({ ...fragment, origins: this.availableOrigins(stored.version, fragment) })) } } : {}) }; });
    return structuredClone({ ...stored.value, ...(stored.value.state === 'closed' && stored.version.draft.questions.some((question) => question.type === 'open') ? { openResult: scoreOpenExam(stored.version.draft.questions, stored.value.answers) } : {}), questions, sourceIssues: mayReadExam ? issues : [{ kind: 'exam', refId: stored.exam.summary.id, state: 'unavailable' as const, message: 'El examen ya no está compartido contigo.' }], contentUnavailable: questions.some((question) => question.unavailable), answers: stored.value.answers.map((answer) => (!questions.find((question) => question.id === answer.questionId)?.unavailable && (stored.value.state === 'closed' || answer.confirmed)) ? answer : { ...answer, correct: undefined }) }); }
  async examAction<R extends ExamActionRequest>(request: R): Promise<ExamActionResponse<R['action']>> {
    await this.reviewedDocuments();
    const actor = this.actor(); const replayable = 'requestId' in request && ['importGeneration', 'forkVersion', 'replaceQuestions', 'startAttempt', 'saveToBank', 'createVariant'].includes(request.action);
    const key = replayable ? `${actor}:${request.requestId}` : undefined; const hash = replayable ? aiHash(request) : undefined; const previous = key ? this.requests.get(key) : undefined;
    if (previous) { if (previous.hash !== hash) throw new Error('El identificador ya pertenece a otra operación.'); return (previous.attemptId ? this.attemptDetail(this.attempt(previous.attemptId)) : request.action === 'saveToBank' ? this.bankDetail(previous.examId) : this.detail(this.access(previous.examId, true))) as ExamActionResponse<R['action']>; }
    const result = this.action(request);
    if (key && hash) { const value = result as ExamDetail | ExamAttempt; this.requests.set(key, { actor, hash, examId: 'examVersion' in value ? value.examId : value.id, ...('examVersion' in value ? { attemptId: value.id } : {}) }); }
    return result as ExamActionResponse<R['action']>;
  }
  async examEvaluationAction<R extends ExamEvaluationActionRequest>(request: R): Promise<ExamEvaluationActionResponse<R['action']>> {
    await this.reviewedDocuments();
    const actor = this.actor(); if (request.action === 'list') return structuredClone([...this.evaluations.values()].filter((row) => row.actor === actor && row.value.attemptId === request.attemptId).map((row) => row.value).sort((a, b) => b.createdAt - a.createdAt)) as ExamEvaluationActionResponse<R['action']>; if (request.action === 'prepare') { const attempt = this.attempt(request.attemptId); const detail = this.attemptDetail(attempt); const question = attempt.version.draft.questions.find((question) => question.id === request.questionId); if (detail.state !== 'closed' || !question || question.type !== 'open' || detail.questions.find((question) => question.id === request.questionId)?.unavailable) throw new Error('Termina un intento disponible antes de preparar una sugerencia.'); const snapshot = { attemptId: request.attemptId, questionId: request.questionId, revision: detail.revision, question, answer: detail.answers.find((answer) => answer.questionId === question.id)?.text ?? '', citations: structuredClone(attempt.version.draft.preparation.fragments.filter((fragment) => question.citations.includes(fragment.id))), fingerprint: aiHash([detail.id, detail.revision, question]) }; const previous = this.evaluations.get(request.id); if (previous) { if (previous.actor !== actor || previous.value.fingerprint !== snapshot.fingerprint) throw new Error('El identificador pertenece a otra sugerencia.'); return structuredClone(previous.value) as ExamEvaluationActionResponse<R['action']>; } const value: ExamEvaluationDraft = { id: request.id, attemptId: request.attemptId, questionId: question.id, revision: detail.revision, fingerprint: snapshot.fingerprint, snapshot, model: 'simulado', estimatedTokens: 4000, state: 'prepared', createdAt: this.now() }; this.evaluations.set(request.id, { actor, value }); return structuredClone(value) as ExamEvaluationActionResponse<R['action']>; }
    const stored = this.evaluations.get(request.id); if (!stored || stored.actor !== actor) throw new Error('La sugerencia no está disponible.'); const value = stored.value; const attempt = this.attempt(value.attemptId); const detail = this.attemptDetail(attempt); if (detail.questions.find((question) => question.id === value.questionId)?.unavailable) throw new Error('La fuente ya no está disponible.');
    if (request.action === 'cancel') { value.state = 'cancelled'; value.result = undefined; }
    if (request.action === 'generate') { if (value.generationId) { if (value.generationId !== request.generationId) throw new Error('Consulta la solicitud guardada.'); } else { if (!request.confirmed || request.fingerprint !== value.fingerprint || detail.revision !== value.revision) throw new Error('Revisa y confirma la sugerencia actual.'); value.generationId = request.generationId; value.state = 'succeeded'; value.result = { feedback: 'Sugerencia ficticia, revísala antes de aceptar.', criteria: value.snapshot.question.rubric!.criteria.map((criterion) => ({ criterionId: criterion.id, points: 0, feedback: 'Sugerencia ficticia pendiente de tu revisión.' })) }; } }
    if (request.action === 'accept') { if (value.state === 'accepted') { if (value.acceptedRequestHash !== aiHash(request)) throw new Error('La solicitud aceptada pertenece a otra evaluación.'); return structuredClone(value.acceptedAttempt!) as ExamEvaluationActionResponse<R['action']>; } if (value.state !== 'succeeded' || !value.result || detail.revision !== value.revision) throw new Error('La sugerencia cambió o no está terminada.'); const result = this.action({ action: 'evaluateOpenAnswer', attemptId: value.attemptId, questionId: value.questionId, expectedRevision: request.expectedRevision, requestId: request.requestId, criteria: request.criteria, feedback: request.feedback }) as ExamAttempt; const answer = attempt.value.answers.find((answer) => answer.questionId === value.questionId)!; answer.evaluation!.origin = 'assisted'; value.state = 'accepted'; value.acceptedRequestHash = aiHash(request); value.acceptedAttempt = this.attemptDetail(attempt); return structuredClone({ ...result, answers: value.acceptedAttempt.answers }) as ExamEvaluationActionResponse<R['action']>; }
    return structuredClone(value) as ExamEvaluationActionResponse<R['action']>;
  }
  private bankList(): ExamBankSummary[] { return [...this.bank.values()].filter((row) => row.summary.ownerId === this.actor() || row.summary.visibility === 'group').map((row) => ({ ...row.summary, canEdit: row.summary.ownerId === this.actor(), sourceIssues: this.issues(row.versions.get(row.summary.version)!) })).filter((row) => !row.sourceIssues.some((issue) => issue.state === 'unavailable')); }
  private bankDetail(id: string, version?: number): ExamBankDetail { const row = this.bank.get(id); if (!row || !(row.summary.ownerId === this.actor() || row.summary.visibility === 'group')) throw new Error('La pregunta del banco no está disponible.'); const value = row.versions.get(version ?? row.summary.version); if (!value) throw new Error('La versión no existe.'); this.readable(value); return structuredClone({ ...row.summary, canEdit: row.summary.ownerId === this.actor(), sourceIssues: this.issues(value), ...(row.summary.ownerId === this.actor() ? { question: value.draft.questions[0], preparation: value.draft.preparation } : {}) }); }
  private createVariant(plan: ExamVariantPlan, title: string, id: string, timeLimitSeconds?: number) { const preview = selectExamVariant(this.bankList(), plan); if (preview.deficits.length) throw new Error(`Faltan preguntas: ${preview.deficits.map((slot) => `${slot.topic} (${slot.available}/${slot.requested})`).join(', ')}.`); const values = preview.selected.map((row) => ({ id: row.id, value: this.bank.get(row.id)!.versions.get(row.version)! })); const base = values[0]!.value; const preparation = structuredClone(base.draft.preparation); preparation.topics = plan.topics; preparation.fragments = []; preparation.sources = []; const revisions: Record<string, string> = {}; const questions: AiQuestion[] = [];
    for (const { id: bankId, value } of values) { this.readable(value); const mapping = new Map(value.draft.preparation.fragments.map((fragment) => [fragment.id, `${bankId}:${fragment.id}`])); preparation.fragments.push(...value.draft.preparation.fragments.map((fragment) => ({ ...fragment, id: mapping.get(fragment.id)! }))); for (const ref of value.draft.preparation.sources) { const existing = preparation.sources.find((source) => examPreparedSourceKey(source) === examPreparedSourceKey(ref)); if (existing) { existing.topics = [...new Set([...existing.topics, ...ref.topics])]; existing.fragmentIds = [...new Set([...existing.fragmentIds, ...ref.fragmentIds.map((id) => mapping.get(id)!)])]; } else preparation.sources.push({ ...ref, fragmentIds: ref.fragmentIds.map((id) => mapping.get(id)!) }); } Object.assign(revisions, value.sourceRevisions); const question = value.draft.questions[0]!; questions.push({ ...question, id: bankId, citations: question.citations.map((id) => mapping.get(id)!) }); }
    const config = { purpose: 'questions' as const, questionCount: questions.length, types: plan.types, difficulty: plan.difficulty, topicWeights: plan.topicWeights }; preparation.config = config; const createdAt = this.now(); const draft: ExamDraft = { ...structuredClone(base.draft), examId: id, version: 1, state: 'draft', title, config, timeLimitSeconds, preparation, questions, questionCount: questions.length, approvedAt: undefined, createdAt, hasPersonalSources: preparation.sources.some((source) => source.visibility === 'personal') }; const summary: ExamSummary = { id, revision: 1, title, subjectId: plan.subjectId, termId: plan.termId, ownerId: this.actor(), visibility: 'personal', archived: false, draftVersion: 1, questionCount: questions.length, topics: plan.topics, createdAt, updatedAt: createdAt, canEdit: true, sourceIssues: [] }; const exam = { summary, versions: new Map([[1, { draft, sourceRevisions: revisions }]]) }; this.exams.set(id, exam); return this.detail(exam); }
  private action(request: ExamActionRequest): unknown {
    if (request.action === 'sendToSpaced') { if (!this.ctx.sendToSpaced) throw new Error('Repaso no disponible.'); return this.ctx.sendToSpaced(request); }
    const actor = this.actor();
    if ('timeLimitSeconds' in request && request.timeLimitSeconds !== undefined && (!Number.isInteger(request.timeLimitSeconds) || request.timeLimitSeconds < 60 || request.timeLimitSeconds > 10_800)) throw new Error('El tiempo debe estar entre 1 y 180 minutos.');
    if ('title' in request && (!request.title.trim() || request.title.length > 200)) throw new Error('Escribe un título de hasta 200 caracteres.');
    if (request.action === 'listBank') return this.bankList().filter((row) => (!request.subjectId || row.subjectId === request.subjectId) && (!request.termId || row.termId === request.termId));
    if (request.action === 'getBankQuestion') return this.bankDetail(request.bankId, request.version);
    if (request.action === 'setBankVisibility') { const row = this.bank.get(request.bankId); if (!row || row.summary.ownerId !== actor) throw new Error('La pregunta no está disponible para editar.'); if (row.summary.version !== request.expectedVersion) throw new Error('La versión cambió.'); const value = row.versions.get(row.summary.version)!; this.readable(value); if (request.visibility === 'group' && (value.draft.hasPersonalSources || value.draft.preparation.sources.some((source) => source.visibility !== 'group'))) throw new Error('Una fuente personal impide compartir.'); row.summary.visibility = request.visibility; return this.bankDetail(row.summary.id); }
    if (request.action === 'saveToBank') { const exam = this.access(request.examId, true); const value = this.version(exam, request.version); this.readable(value); if (value.draft.state !== 'ready') throw new Error('Aprueba la versión antes de guardar en el banco.'); const question = value.draft.questions.find((question) => question.id === request.questionId); if (!question) throw new Error('La pregunta no existe.'); const previous = request.bankId ? this.bank.get(request.bankId) : undefined; if (request.bankId && (!previous || previous.summary.ownerId !== actor || previous.summary.version !== request.expectedVersion)) throw new Error('La pregunta cambió o no te pertenece.'); if (previous?.summary.visibility === 'group' && value.draft.hasPersonalSources) throw new Error('Una fuente personal impide compartir.'); const id = previous?.summary.id ?? request.requestId; const number = (previous?.summary.version ?? 0) + 1; const version = structuredClone(value); version.draft.questions = [{ ...question, difficulty: question.difficulty ?? value.draft.config.difficulty }]; version.draft.preparation.topics = [question.topic]; const cited = new Set(question.citations); version.draft.preparation.fragments = version.draft.preparation.fragments.filter((fragment) => cited.has(fragment.id)); version.draft.preparation.sources = version.draft.preparation.sources.filter((ref) => ref.fragmentIds.some((id) => cited.has(id))).map((ref) => ({ ...ref, topics: [question.topic], fragmentIds: ref.fragmentIds.filter((id) => cited.has(id)) })); version.draft.hasPersonalSources = version.draft.preparation.sources.some((ref) => ref.visibility === 'personal'); const summary: ExamBankSummary = { id, version: number, ownerId: actor, visibility: previous?.summary.visibility ?? 'personal', subjectId: exam.summary.subjectId, termId: exam.summary.termId, topic: question.topic, type: question.type, difficulty: question.difficulty ?? value.draft.config.difficulty, text: question.text, updatedAt: this.now(), canEdit: true, sourceIssues: [] }; const row = previous ?? { summary, versions: new Map<number, Version>() }; row.summary = summary; row.versions.set(number, version); this.bank.set(id, row); return this.bankDetail(id); }
    if (request.action === 'previewVariant') return selectExamVariant(this.bankList(), request.plan);
    if (request.action === 'createVariant') return this.createVariant(request.plan, request.title, request.requestId, request.timeLimitSeconds);
    if (request.action === 'evaluateOpenAnswer') { const stored = this.attempt(request.attemptId); const signature = aiHash(request); const prior = stored.requests.get(request.requestId); if (prior) { if (prior !== signature) throw new Error('La solicitud ya pertenece a otra operación.'); return this.attemptDetail(stored); } if (stored.value.state !== 'closed' || stored.value.revision !== request.expectedRevision) throw new Error('Termina el intento o recarga su revisión antes de corregir.'); const question = stored.version.draft.questions.find((question) => question.id === request.questionId); if (!question || this.attemptDetail(stored).questions.find((question) => question.id === request.questionId)?.unavailable) throw new Error('La pregunta no está disponible.'); validateOpenEvaluation(question, request.criteria, request.feedback); const answer = stored.value.answers.find((answer) => answer.questionId === question.id) ?? { questionId: question.id, confirmed: true, text: '' }; answer.evaluation = { rubricVersion: question.rubric!.version, criteria: structuredClone(request.criteria), feedback: request.feedback, evaluatedAt: this.now(), origin: 'manual' }; stored.value.answers = [...stored.value.answers.filter((entry) => entry.questionId !== question.id), answer]; stored.value.openResult = scoreOpenExam(stored.version.draft.questions, stored.value.answers); stored.value.revision++; stored.requests.set(request.requestId, signature); return this.attemptDetail(stored); }
    if (request.action === 'listExams') return [...this.exams.values()].filter((exam) => request.sharedOnly === true
      ? exam.summary.visibility === 'group' && !exam.summary.archived && !!exam.summary.readyVersion && exam.versions.get(exam.summary.readyVersion)?.draft.state === 'ready'
      : (exam.summary.ownerId === actor && (request.includeArchived || !exam.summary.archived)) || (exam.summary.visibility === 'group' && !exam.summary.archived && !!exam.summary.readyVersion))
      .map((exam) => { if (request.sharedOnly === true) return this.sharedSummary(exam); const { draft: _draft, versions: _versions, ...summary } = this.detail(exam); return summary; });
    if (request.action === 'listGenerations') return [...this.generated.values()].filter((row) => row.actor === actor).map((row): ExamGenerationSummary => ({ id: row.generation.id, state: row.generation.state, preparationId: row.preparation.id, createdAt: row.generation.createdAt, error: row.generation.error, importedExamId: row.importedExamId }));
    if (request.action === 'listAttempts') return [...this.attempts.values()].filter((row) => row.actor === actor && (!request.examId || row.value.examId === request.examId)).map((row) => { this.attempt(row.value.id); const { questions: _questions, answers: _answers, sourceIssues: _issues, contentUnavailable: _unavailable, ...summary } = row.value; return structuredClone(summary); });
    if (request.action === 'getAttempt') return this.attemptDetail(this.attempt(request.attemptId));
    if ('attemptId' in request) {
      const stored = this.attempt(request.attemptId); const signature = aiHash(request); const prior = stored.requests.get(request.requestId);
      if (prior) { if (prior !== signature) throw new Error('Este reintento pertenece a otra respuesta.'); return this.attemptDetail(stored); }
      if (stored.value.state === 'closed') { if (request.action === 'finishAttempt') return this.attemptDetail(stored); throw new Error('El intento ya terminó.'); }
      if (stored.value.revision !== request.expectedRevision) throw new Error('El intento cambió. Recarga para continuar.');
      if (request.action === 'finishAttempt') this.close(stored, 'submitted'); else {
        const dto = this.attemptDetail(stored); if (dto.questions.find((question) => question.id === request.questionId)?.unavailable) throw new Error('La pregunta ya no está disponible.');
        const question = stored.version.draft.questions.find((row) => row.id === request.questionId); if (!question || (question.type === 'open' ? typeof request.text !== 'string' || request.text.length > 12000 : !question.options.some((option) => option.id === request.optionId))) throw new Error('Elige una opción de esta pregunta.');
        if (request.action === 'confirmAnswer' && question.type === 'open') throw new Error('Las respuestas abiertas se revisan después de finalizar el intento.');
        if (request.action === 'confirmAnswer' && stored.value.mode !== 'practice') throw new Error('El simulacro muestra las explicaciones al terminar.');
        const current = stored.value.answers.find((row) => row.questionId === question.id); if (current?.confirmed) { if (question.type === 'open' ? current.text === request.text : current.optionId === request.optionId) return this.attemptDetail(stored); throw new Error('La respuesta de práctica ya se confirmó y no puede cambiarse.'); }
        const answer = { questionId: question.id, ...(question.type === 'open' ? { text: request.text } : { optionId: request.optionId }), confirmed: request.action === 'confirmAnswer' && stored.value.mode === 'practice', correct: question.type === 'open' ? undefined : request.optionId === question.correctOptionId };
        stored.value.answers = [...stored.value.answers.filter((row) => row.questionId !== question.id), answer]; stored.value.revision++;
      }
      stored.requests.set(request.requestId, signature); return this.attemptDetail(stored);
    }
    if (request.action === 'importGeneration') {
      const generated = this.generated.get(request.generationId); if (!generated || generated.actor !== actor || generated.generation.state !== 'succeeded') throw new Error('Consulta primero una generación completada.');
      if (generated.importedExamId) return this.detail(this.access(generated.importedExamId, true));
      const questions = validateAiQuestionDraft(generated.generation.result, generated.preparation, generated.preparation.config).questions; const id = crypto.randomUUID(); const now = this.now();
      const draft: ExamDraft = { examId: id, version: 1, state: 'draft', title: request.title.trim() || 'Mi autoevaluación', questionCount: questions.length, model: generated.preparation.model, createdAt: now,
        hasPersonalSources: generated.preparation.sources.some((source) => source.visibility === 'personal'), sourceIssues: [], config: generated.preparation.config, timeLimitSeconds: request.timeLimitSeconds, preparation: generated.preparation, questions };
      const summary: ExamSummary = { id, revision: 1, title: draft.title, subjectId: generated.preparation.subjectId, termId: generated.preparation.termId, ownerId: actor, visibility: 'personal', archived: false, draftVersion: 1, questionCount: questions.length, topics: generated.preparation.topics, createdAt: now, updatedAt: now, canEdit: true, sourceIssues: [] };
      const stored = { summary, versions: new Map([[1, { draft, sourceRevisions: generated.sourceRevisions }]]) }; this.readable(this.version(stored, 1)); this.exams.set(id, stored); generated.importedExamId = id; return this.detail(stored);
    }
    const exam = this.access(request.examId, request.action !== 'getExam' && request.action !== 'startAttempt');
    if (request.action === 'getExam') return this.detail(exam);
    if (request.action === 'getVersion') { const version = this.version(exam, request.version); this.readable(version); return structuredClone({ ...version.draft, sourceIssues: this.issues(version) }); }
    if (request.action === 'startAttempt') {
      for (const stored of this.attempts.values()) if (stored.value.id === request.requestId) { if (stored.actor !== actor || stored.value.examId !== exam.summary.id || stored.value.examVersion !== request.version || stored.value.mode !== request.mode) throw new Error('El identificador del intento pertenece a otra configuración.'); return this.attemptDetail(stored); }
      if (exam.summary.archived) throw new Error('Este examen está archivado.'); const version = this.version(exam, request.version); if (version.draft.state !== 'ready') throw new Error('Aprueba una versión antes de resolverla.'); this.readable(version);
      const order = examAttemptOrder(version.draft.questions, request.requestId); const value: ExamAttempt = { id: request.requestId, examId: exam.summary.id, examVersion: request.version, title: version.draft.title, mode: request.mode, state: 'active', revision: 1,
        startedAt: this.now(), ...(version.draft.timeLimitSeconds ? { deadlineAt: this.now() + version.draft.timeLimitSeconds * 1000 } : {}), questions: [], answers: [], sourceIssues: [], contentUnavailable: false };
      const stored = { actor, exam, version: structuredClone(version), value, order, requests: new Map<string, string>() }; this.attempts.set(value.id, stored); return this.attemptDetail(stored);
    }
    this.expected(exam, request.expectedRevision);
    if (request.action === 'setArchived') { exam.summary.archived = request.archived; return this.changed(exam); }
    if (request.action === 'setVisibility') { const version = exam.summary.readyVersion ? this.version(exam, exam.summary.readyVersion) : undefined; if (!version || exam.summary.draftVersion) throw new Error('Aprueba el borrador antes de compartir.'); this.readable(version); if (request.visibility === 'group' && version.draft.hasPersonalSources) throw new Error('La versión incluye una nota personal. Publica una copia y prepara otra versión con fuentes compartidas.'); exam.summary.visibility = request.visibility; return this.changed(exam); }
    if (request.action === 'forkVersion') { const prior = this.version(exam, request.version); this.readable(prior); if (exam.summary.draftVersion) throw new Error('Ya existe un borrador para este examen.'); const number = Math.max(...exam.versions.keys()) + 1; const draft = structuredClone(prior); draft.draft.version = number; draft.draft.state = 'draft'; draft.draft.createdAt = this.now(); draft.draft.approvedAt = undefined; exam.versions.set(number, draft); exam.summary.draftVersion = number; return this.changed(exam); }
    const version = this.editable(exam, request.version);
    if (request.action === 'saveDraft') { const config = { ...request.config, questionCount: request.questions.length }; validateAiQuestionDraft({ questions: request.questions }, version.draft.preparation, config); if (!request.title.trim()) throw new Error('Escribe un título.'); version.draft.title = request.title; version.draft.config = config; version.draft.questions = structuredClone(request.questions); version.draft.questionCount = request.questions.length; version.draft.timeLimitSeconds = request.timeLimitSeconds; if (!exam.summary.readyVersion) exam.summary.title = request.title; return this.changed(exam); }
    if (request.action === 'replaceQuestions') { const generation = this.generated.get(request.generationId); if (!generation || generation.actor !== actor || generation.generation.state !== 'succeeded' || generation.importedExamId) throw new Error('La regeneración no está lista o ya fue aplicada.'); if (request.questionIds.length !== new Set(request.questionIds).size || !request.questionIds.length || request.questionIds.some((id) => !version.draft.questions.some((question) => question.id === id))) throw new Error('Elige las preguntas que quieres reemplazar.'); const replacements = validateAiQuestionDraft(generation.generation.result, generation.preparation, generation.preparation.config).questions; if (replacements.length !== request.questionIds.length) throw new Error('La cantidad de preguntas no coincide.');
      const full = request.questionIds.length === version.draft.questions.length;
      const materialHash = (preparation: AiPreparation) => aiHash({ subjectId: preparation.subjectId, termId: preparation.termId, topics: preparation.topics, sources: preparation.sources, fragments: preparation.fragments });
      if (!full && materialHash(version.draft.preparation) !== materialHash(generation.preparation)) throw new Error('La regeneración parcial debe usar exactamente las mismas fuentes y versiones. Reemplaza todas las preguntas para actualizar el material.');
      if (generation.preparation.subjectId !== exam.summary.subjectId || generation.preparation.termId !== exam.summary.termId) throw new Error('La materia y el parcial de la regeneración no coinciden.');
      let offset = 0; const questions = version.draft.questions.map((question) => request.questionIds.includes(question.id) ? { ...replacements[offset++]!, id: question.id } : question);
      const preparation = full ? generation.preparation : version.draft.preparation; const config = full ? generation.preparation.config : version.draft.config; validateAiQuestionDraft({ questions }, preparation, config);
      version.draft.questions = questions; if (full) { version.draft.preparation = preparation; version.draft.config = config; version.draft.hasPersonalSources = preparation.sources.some((source) => source.visibility === 'personal'); version.sourceRevisions = generation.sourceRevisions; exam.summary.topics = preparation.topics; } generation.importedExamId = exam.summary.id; return this.changed(exam); }
    if (request.action === 'approveVersion') { if (version.draft.questions.some((question) => question.issue) || request.reviewedQuestionIds.length !== version.draft.questions.length || version.draft.questions.some((question) => !request.reviewedQuestionIds.includes(question.id))) throw new Error('Revisa todas las preguntas y corrige sus avisos antes de aprobar.'); validateAiQuestionDraft({ questions: version.draft.questions }, version.draft.preparation, version.draft.config); this.readable(version); version.draft.state = 'ready'; version.draft.approvedAt = this.now(); exam.summary.readyVersion = request.version; exam.summary.draftVersion = undefined; if (version.draft.hasPersonalSources) exam.summary.visibility = 'personal'; exam.summary.title = version.draft.title; exam.summary.topics = version.draft.preparation.topics; return this.changed(exam); }
    throw new Error('Acción no disponible.');
  }
  /** Remove copied text when the original reaches its definitive retention purge. */
  purgeTargets(targets: ReadonlySet<string>) {
    const touches = (preparation: AiPreparation) => preparation.sources.some((source) => targets.has(aiCandidateKey(source)) || source.origins.some((origin) => targets.has(aiCandidateKey(origin)))) || preparation.fragments.some((fragment) => fragment.origins.some((origin) => targets.has(aiCandidateKey(origin))));
    for (const stored of this.evaluations.values()) { const citations = stored.value.snapshot.citations as { origins?: { kind: string; refId: string }[] }[]; if (citations.some((citation) => citation.origins?.some((origin) => targets.has(aiCandidateKey(origin as import('@b20/core').AiSourceOrigin))))) { stored.value.state = 'cancelled'; stored.value.result = undefined; stored.value.acceptedAttempt = undefined; stored.value.snapshot.question = { ...stored.value.snapshot.question, text: '', options: [], referenceAnswer: undefined, rubric: undefined, explanation: '', citations: [] }; stored.value.snapshot.citations = []; } }
    for (const [id, row] of this.prepared) if (touches(row.preparation)) this.prepared.delete(id);
    for (const [id, row] of this.generated) if (touches(row.preparation)) this.generated.delete(id);
    const purgeVersion = (version: Version) => {
      const preparation = version.draft.preparation; if (!touches(preparation)) return;
      const affectedSources = preparation.sources.filter((source) => targets.has(aiCandidateKey(source)) || source.origins.some((origin) => targets.has(aiCandidateKey(origin))));
      const removed = new Set([...affectedSources.flatMap((source) => source.fragmentIds), ...preparation.fragments.filter((fragment) => fragment.origins.some((origin) => targets.has(aiCandidateKey(origin)))).map((fragment) => fragment.id)]);
      version.draft.questions = version.draft.questions.map((question) => {
        if (!question.citations.some((id) => removed.has(id))) return question;
        version.purgedQuestionIds = [...new Set([...(version.purgedQuestionIds ?? []), question.id])];
        return { ...question, text: '', options: question.options.map((option) => ({ id: option.id, text: '' })), explanation: '', referenceAnswer: undefined, rubric: undefined, citations: [], issue: undefined };
      });
      preparation.fragments = preparation.fragments.filter((fragment) => !removed.has(fragment.id));
      preparation.sources = preparation.sources.map((source) => ({ ...source, ...(targets.has(aiCandidateKey(source)) || source.origins.some((origin) => targets.has(aiCandidateKey(origin))) ? { title: 'Fuente eliminada', status: 'unauthorized' as const, reason: 'El material original fue eliminado definitivamente.', origins: [] } : {}), fragmentIds: source.fragmentIds.filter((id) => !removed.has(id)) }));
      preparation.canGenerate = false;
    };
    for (const bank of this.bank.values()) for (const version of bank.versions.values()) purgeVersion(version);
    for (const exam of this.exams.values()) for (const version of exam.versions.values()) purgeVersion(version);
    for (const attempt of this.attempts.values()) purgeVersion(attempt.version);
  }
  dispose() { if (this.shared && --this.shared.references > 0) return; this.evaluations.clear(); this.bank.clear(); this.prepared.clear(); this.generated.clear(); this.exams.clear(); this.attempts.clear(); this.requests.clear(); }
}
