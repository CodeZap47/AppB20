import { AI_LIMITS, aiHash, buildAiPreparation, examAttemptOrder, examTopicDistribution, scoreExam, validateAiQuestionDraft,
  type AiGeneration, type AiGenerationRequest, type AiPreparation, type AiPrepareInput, type AiQuestion, type ExamActionRequest,
  type ExamAttempt, type ExamDetail, type ExamDraft, type ExamGenerationSummary, type ExamSourceIssue, type ExamSummary } from '@b20/core';
import { aiCandidateKey, aiSourceCandidates } from '../lib/aiSources';
import type { Snapshot } from './types';
import type { ExamActions, ExamActionResponse } from './examTypes';
interface Context { snapshot(): Snapshot; now(): Date }
interface Version { draft: ExamDraft; sourceRevisions: Record<string, string>; purgedQuestionIds?: string[] }
interface StoredExam { summary: ExamSummary; versions: Map<number, Version> }
interface StoredAttempt { actor: string; version: Version; exam: StoredExam; value: ExamAttempt; order: ReturnType<typeof examAttemptOrder>; requests: Map<string, string> }
interface Prepared { actor: string; preparation: AiPreparation; sourceRevisions: Record<string, string> }
interface Generated extends Prepared { generation: AiGeneration; importedExamId?: string; requestHash: string }
interface SharedExams { references: number; prepared: Map<string, Prepared>; generated: Map<string, Generated>; exams: Map<string, StoredExam>; attempts: Map<string, StoredAttempt>; requests: Map<string, { actor: string; hash: string; examId: string; attemptId?: string }> }
const sharedExams = new WeakMap<object, SharedExams>();
/** All simulation content is fictitious and remains in memory; no key or provider is contacted. */
export class DemoExamStore implements ExamActions {
  private prepared = new Map<string, Prepared>(); private generated = new Map<string, Generated>();
  private exams = new Map<string, StoredExam>(); private attempts = new Map<string, StoredAttempt>(); private requests = new Map<string, { actor: string; hash: string; examId: string; attemptId?: string }>();
  private shared?: SharedExams;
  constructor(private ctx: Context, sharedKey?: object) { if (sharedKey) { let shared = sharedExams.get(sharedKey); if (!shared) { shared = { references: 0, prepared: this.prepared, generated: this.generated, exams: this.exams, attempts: this.attempts, requests: this.requests }; sharedExams.set(sharedKey, shared); } shared.references++; this.shared = shared; this.prepared = shared.prepared; this.generated = shared.generated; this.exams = shared.exams; this.attempts = shared.attempts; this.requests = shared.requests; } }
  private actor() { const me = this.ctx.snapshot().me; if (me?.status !== 'active') throw new Error('Necesitas acceso vigente al grupo.'); return me.id; }
  private now() { return this.ctx.now().getTime(); }
  private issues(version: Version): ExamSourceIssue[] { const data = this.ctx.snapshot(); const input = version.draft.preparation; const candidates = data.subjects.flatMap((subject) => aiSourceCandidates(data, subject.id));
    return [...(version.purgedQuestionIds?.length ? [{ kind: 'exam', refId: version.draft.examId, state: 'unavailable' as const, message: 'Un material de esta versión fue eliminado definitivamente.' }] : []), ...input.sources.flatMap<ExamSourceIssue>((ref) => { const candidate = candidates.find((row) => aiCandidateKey(row) === aiCandidateKey(ref));
      if (ref.status === 'unauthorized' || !candidate || (ref.visibility === 'group' && candidate.personal)) return [{ kind: ref.kind, refId: ref.refId, state: 'unavailable' as const, message: 'Una fuente fue retirada o dejó de estar disponible.' }];
      return candidate.revision !== version.sourceRevisions[aiCandidateKey(ref)] ? [{ kind: ref.kind, refId: ref.refId, state: 'outdated' as const, message: 'La fuente cambió después de preparar esta versión.' }] : []; })]; }
  private access(examId: string, edit = false) { const actor = this.actor(); const exam = this.exams.get(examId); if (!exam || (exam.summary.ownerId !== actor && (edit || exam.summary.visibility !== 'group' || !exam.summary.readyVersion))) throw new Error('El examen no existe o no tienes acceso.'); return exam; }
  private version(exam: StoredExam, number: number) { const version = exam.versions.get(number); if (!version) throw new Error('La versión no está disponible.'); return version; }
  private readable(version: Version) { if (this.issues(version).some((issue) => issue.state === 'unavailable')) throw new Error('Una fuente ya no está disponible. Su texto y las preguntas se ocultaron.'); }
  private expected(exam: StoredExam, revision: number) { if (exam.summary.revision !== revision) throw new Error('El examen cambió. Recarga antes de guardar.'); }
  private editable(exam: StoredExam, version: number) { const stored = this.version(exam, version); if (stored.draft.state !== 'draft') throw new Error('Esta versión está lista y es inmutable. Crea una nueva versión para editarla.'); this.readable(stored); return stored; }
  private summaries(exam: StoredExam) { return [...exam.versions.values()].map(({ draft, ...rest }) => { const stored = { draft, ...rest }; return { version: draft.version, state: draft.state, questionCount: draft.questions.length, model: draft.model, createdAt: draft.createdAt, approvedAt: draft.approvedAt, hasPersonalSources: draft.hasPersonalSources, sourceIssues: this.issues(stored) }; }); }
  private detail(exam: StoredExam): ExamDetail { const owned = exam.summary.ownerId === this.actor(); const latest = owned ? exam.summary.draftVersion ?? exam.summary.readyVersion : exam.summary.readyVersion; const version = latest ? this.version(exam, latest) : undefined;
    return structuredClone({ ...exam.summary, ...(!owned && version ? { title: version.draft.title, topics: version.draft.preparation.topics, questionCount: version.draft.questions.length, draftVersion: undefined } : {}), canEdit: owned, sourceIssues: version ? this.issues(version) : [], versions: this.summaries(exam).filter((row) => owned || row.version === exam.summary.readyVersion), ...(owned && version && !this.issues(version).some((issue) => issue.state === 'unavailable') ? { draft: { ...version.draft, sourceIssues: this.issues(version) } } : {}) }); }
  private changed(exam: StoredExam) { exam.summary.revision++; exam.summary.updatedAt = this.now(); const selected = this.version(exam, exam.summary.draftVersion ?? exam.summary.readyVersion!); exam.summary.questionCount = selected.draft.questions.length; return this.detail(exam); }
  async prepareExamMaterial(input: AiPrepareInput): Promise<AiPreparation> {
    const actor = this.actor(); const data = this.ctx.snapshot(); const candidates = aiSourceCandidates(data, input.subjectId, input.termId);
    const selected = input.sources.map((ref) => { const candidate = candidates.find((row) => aiCandidateKey(row) === aiCandidateKey(ref)); if (!candidate) throw new Error('Una fuente no está disponible.'); return { ref, candidate }; });
    const normalized = { ...input, subjectId: '1', ...(input.termId ? { termId: '1' } : {}), sources: selected.map(({ ref }, i) => ({ ...ref, refId: String(i + 1) })) };
    const preparation = buildAiPreparation(normalized, selected.map(({ ref, candidate }, index) => ({ kind: ref.kind, refId: String(index + 1), version: candidate.version, subjectId: '1', ...(candidate.termId ? { termId: '1' } : {}), title: candidate.title,
      visibility: candidate.personal ? 'personal' as const : 'group' as const, fields: [{ name: 'Material ficticio', text: `Contenido ficticio para estudiar ${ref.topics.join(', ') || 'los temas elegidos'}.\nLa simulación no envía material a Gemini.` }], omissions: ['Texto ficticio de demostración; los adjuntos quedan excluidos.'] })), { id: crypto.randomUUID(), model: 'simulado', now: this.now() });
    preparation.subjectId = input.subjectId; preparation.termId = input.termId;
    preparation.sources.forEach((row, index) => { row.refId = selected[index]!.ref.refId; row.subjectId = input.subjectId; row.termId = selected[index]!.candidate.termId; });
    for (const fragment of preparation.fragments) for (const origin of fragment.origins) origin.refId = selected[Number(origin.refId) - 1]!.ref.refId;
    for (const coverage of preparation.coverage) coverage.sourceIds = coverage.sourceIds.map((key) => { const numeric = Number(key.slice(key.indexOf(':') + 1)) - 1; return aiCandidateKey(selected[numeric]!.ref); });
    const sourceRevisions = Object.fromEntries(selected.map(({ ref, candidate }) => [aiCandidateKey(ref), candidate.revision])); preparation.fingerprint = aiHash({ input, fragments: preparation.fragments, sourceRevisions });
    this.prepared.set(preparation.id, { actor, preparation, sourceRevisions }); return structuredClone(preparation);
  }
  async generateExamQuestions(input: AiGenerationRequest) {
    const actor = this.actor(); const requestHash = aiHash({ preparationId: input.preparationId, fingerprint: input.fingerprint, config: input.config }); const prior = this.generated.get(input.id); if (prior) { if (prior.actor !== actor) throw new Error('No tienes acceso a esta generación.'); if (prior.requestHash !== requestHash) throw new Error('El identificador del envío pertenece a otra configuración.'); return this.getExamGeneration(input.id); }
    const prepared = this.prepared.get(input.preparationId); if (!prepared || prepared.actor !== actor || !input.confirmed || input.fingerprint !== prepared.preparation.fingerprint || !prepared.preparation.canGenerate) throw new Error('Prepara y confirma el material antes de generar.');
    if (prepared.preparation.expiresAt <= this.now()) throw new Error('La preparación venció. Prepara el material nuevamente.');
    if (aiHash(input.config) !== aiHash(prepared.preparation.config)) throw new Error('La configuración cambió. Prepara nuevamente la vista previa.');
    const config = input.config; const topics = prepared.preparation.topics;
    const distribution = examTopicDistribution(topics, config.questionCount, config.topicWeights); const assignedTopics = distribution.flatMap((entry) => Array.from({ length: entry.count }, () => entry.topic));
    const questions: AiQuestion[] = Array.from({ length: config.questionCount }, (_, i) => { const type = config.types[i % config.types.length]!; const options = type === 'boolean' ? [{ id: 'true', text: 'Verdadero' }, { id: 'false', text: 'Falso' }] : [{ id: 'a', text: 'Respuesta ficticia correcta' }, { id: 'b', text: 'Primera alternativa de prueba' }, { id: 'c', text: 'Segunda alternativa de prueba' }, { id: 'd', text: 'Tercera alternativa de prueba' }];
      const fragmentId = prepared.preparation.sources.find((source) => source.topics.includes(assignedTopics[i]!))?.fragmentIds[0] ?? prepared.preparation.fragments[0]!.id;
      return { id: `question-${i + 1}`, type, text: `Pregunta ficticia ${i + 1} sobre ${assignedTopics[i]}.`, options, correctOptionId: options[0]!.id, explanation: 'Explicación ficticia sustentada en el material de demostración.', topic: assignedTopics[i]!, citations: [fragmentId] }; });
    const generation: AiGeneration = { id: input.id, preparationId: input.preparationId, state: 'succeeded', createdAt: this.now(), updatedAt: this.now(), result: { questions }, estimatedTokens: prepared.preparation.estimatedInputTokens + AI_LIMITS.maxOutputTokens };
    this.generated.set(input.id, { ...structuredClone(prepared), generation, requestHash }); return structuredClone(generation);
  }
  async getExamGeneration(id: string) { const row = this.generated.get(id); if (!row || row.actor !== this.actor()) throw new Error('La generación no está disponible.'); const candidates = this.ctx.snapshot().subjects.flatMap((subject) => aiSourceCandidates(this.ctx.snapshot(), subject.id)); if (row.preparation.sources.some((ref) => !candidates.some((candidate) => aiCandidateKey(candidate) === aiCandidateKey(ref) && (ref.visibility !== 'group' || !candidate.personal)))) throw new Error('Una fuente de la generación no está disponible.'); return structuredClone(row.generation); }
  private attempt(id: string) { const value = this.attempts.get(id); if (!value || value.actor !== this.actor()) throw new Error('El intento no existe o no tienes acceso.'); if (value.value.state === 'active' && value.value.deadlineAt !== undefined && value.value.deadlineAt <= this.now()) this.close(value, 'timeout'); return value; }
  private close(stored: StoredAttempt, reason: 'submitted' | 'timeout') { if (stored.value.state === 'closed') return; stored.value.state = 'closed'; stored.value.closedAt = this.now(); stored.value.closeReason = reason;
    stored.value.result = scoreExam(stored.version.draft.questions, Object.fromEntries(stored.value.answers.map((answer) => [answer.questionId, answer.optionId]))); stored.value.revision++; }
  private attemptDetail(stored: StoredAttempt): ExamAttempt { const issues = this.issues(stored.version); const unavailableRefs = new Set(issues.filter((issue) => issue.state === 'unavailable').map((issue) => `${issue.kind}:${issue.refId}`)); const mayReadExam = stored.exam.summary.ownerId === this.actor() || stored.exam.summary.visibility === 'group';
    const questions = stored.order.map((order) => { const question = stored.version.draft.questions.find((entry) => entry.id === order.questionId)!; const answer = stored.value.answers.find((entry) => entry.questionId === question.id);
      const unavailable = !mayReadExam || stored.version.purgedQuestionIds?.includes(question.id) || !question.citations.every((citation) => stored.version.draft.preparation.fragments.find((fragment) => fragment.id === citation)?.origins.some((origin) => !unavailableRefs.has(aiCandidateKey(origin))));
      if (unavailable) return { id: question.id, type: question.type, text: '', topic: '', options: [], unavailable: true };
      return { id: question.id, type: question.type, text: question.text, topic: question.topic, options: order.optionIds.map((id) => question.options.find((entry) => entry.id === id)!),
        ...(stored.value.state === 'closed' || (stored.value.mode === 'practice' && answer?.confirmed) ? { solution: { correctOptionId: question.correctOptionId, explanation: question.explanation, citations: stored.version.draft.preparation.fragments.filter((fragment) => question.citations.includes(fragment.id)).map((fragment) => ({ ...fragment, origins: fragment.origins.filter((origin) => !unavailableRefs.has(aiCandidateKey(origin))) })) } } : {}) }; });
    return structuredClone({ ...stored.value, questions, sourceIssues: mayReadExam ? issues : [{ kind: 'exam', refId: stored.exam.summary.id, state: 'unavailable' as const, message: 'El examen ya no está compartido contigo.' }], contentUnavailable: questions.some((question) => question.unavailable), answers: stored.value.answers.map((answer) => (!questions.find((question) => question.id === answer.questionId)?.unavailable && (stored.value.state === 'closed' || answer.confirmed)) ? answer : { ...answer, correct: undefined }) }); }
  async examAction<R extends ExamActionRequest>(request: R): Promise<ExamActionResponse<R['action']>> {
    const actor = this.actor(); const replayable = 'requestId' in request && ['importGeneration', 'forkVersion', 'replaceQuestions', 'startAttempt'].includes(request.action);
    const key = replayable ? `${actor}:${request.requestId}` : undefined; const hash = replayable ? aiHash(request) : undefined; const previous = key ? this.requests.get(key) : undefined;
    if (previous) { if (previous.hash !== hash) throw new Error('El identificador ya pertenece a otra operación.'); return (previous.attemptId ? this.attemptDetail(this.attempt(previous.attemptId)) : this.detail(this.access(previous.examId, true))) as ExamActionResponse<R['action']>; }
    const result = this.action(request);
    if (key && hash) { const value = result as ExamDetail | ExamAttempt; this.requests.set(key, { actor, hash, examId: 'examVersion' in value ? value.examId : value.id, ...('examVersion' in value ? { attemptId: value.id } : {}) }); }
    return result as ExamActionResponse<R['action']>;
  }
  private action(request: ExamActionRequest): unknown {
    const actor = this.actor();
    if ('timeLimitSeconds' in request && request.timeLimitSeconds !== undefined && (!Number.isInteger(request.timeLimitSeconds) || request.timeLimitSeconds < 60 || request.timeLimitSeconds > 10_800)) throw new Error('El tiempo debe estar entre 1 y 180 minutos.');
    if ('title' in request && (!request.title.trim() || request.title.length > 200)) throw new Error('Escribe un título de hasta 200 caracteres.');
    if (request.action === 'listExams') return [...this.exams.values()].filter((exam) => (exam.summary.ownerId === actor && (request.includeArchived || !exam.summary.archived)) || (exam.summary.visibility === 'group' && !exam.summary.archived && !!exam.summary.readyVersion)).map((exam) => { const { draft: _draft, versions: _versions, ...summary } = this.detail(exam); return summary; });
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
        const question = stored.version.draft.questions.find((row) => row.id === request.questionId); if (!question || !question.options.some((option) => option.id === request.optionId)) throw new Error('Elige una opción de esta pregunta.');
        if (request.action === 'confirmAnswer' && stored.value.mode !== 'practice') throw new Error('El simulacro muestra las explicaciones al terminar.');
        const current = stored.value.answers.find((row) => row.questionId === question.id); if (current?.confirmed) { if (current.optionId === request.optionId) return this.attemptDetail(stored); throw new Error('La respuesta de práctica ya se confirmó y no puede cambiarse.'); }
        const answer = { questionId: question.id, optionId: request.optionId, confirmed: request.action === 'confirmAnswer' && stored.value.mode === 'practice', correct: request.optionId === question.correctOptionId };
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
    for (const [id, row] of this.prepared) if (touches(row.preparation)) this.prepared.delete(id);
    for (const [id, row] of this.generated) if (touches(row.preparation)) this.generated.delete(id);
    const purgeVersion = (version: Version) => {
      const preparation = version.draft.preparation; if (!touches(preparation)) return;
      const affectedSources = preparation.sources.filter((source) => targets.has(aiCandidateKey(source)) || source.origins.some((origin) => targets.has(aiCandidateKey(origin))));
      const removed = new Set([...affectedSources.flatMap((source) => source.fragmentIds), ...preparation.fragments.filter((fragment) => fragment.origins.some((origin) => targets.has(aiCandidateKey(origin)))).map((fragment) => fragment.id)]);
      version.draft.questions = version.draft.questions.map((question) => {
        if (!question.citations.some((id) => removed.has(id))) return question;
        version.purgedQuestionIds = [...new Set([...(version.purgedQuestionIds ?? []), question.id])];
        return { ...question, text: '', options: question.options.map((option) => ({ id: option.id, text: '' })), explanation: '', citations: [], issue: undefined };
      });
      preparation.fragments = preparation.fragments.filter((fragment) => !removed.has(fragment.id));
      preparation.sources = preparation.sources.map((source) => ({ ...source, ...(targets.has(aiCandidateKey(source)) || source.origins.some((origin) => targets.has(aiCandidateKey(origin))) ? { title: 'Fuente eliminada', status: 'unauthorized' as const, reason: 'El material original fue eliminado definitivamente.', origins: [] } : {}), fragmentIds: source.fragmentIds.filter((id) => !removed.has(id)) }));
      preparation.canGenerate = false;
    };
    for (const exam of this.exams.values()) for (const version of exam.versions.values()) purgeVersion(version);
    for (const attempt of this.attempts.values()) purgeVersion(attempt.version);
  }
  dispose() { if (this.shared && --this.shared.references > 0) return; this.prepared.clear(); this.generated.clear(); this.exams.clear(); this.attempts.clear(); this.requests.clear(); }
}
