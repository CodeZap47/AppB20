import { AI_CONSENT_VERSION, AI_LIMITS, GUIDE_SECTIONS, aiHash, aiUuid, buildGuideAiPreparation, guideAiSteps, guideAiClarificationsFromReview, preserveGuideAiClarifications, validateGuideAiResult,
  type GuideAiDraft, type GuideAiDraftSummary, type GuideAiProvenance, type GuideAiResult,
  type GuideAiSourceKind, type GuideAiSourceRef, type GuideAiSnapshot, type GuideAiTranscription } from '@b20/core';
import { guideAiCandidateKey, guideAiCandidates } from '../lib/guideAiSources';
import type { GuideAiActions } from './guideAiTypes';
import type { GuideAiSourceAvailability, GuideInput, GuideSourceRef, Snapshot } from './types';

interface Context {
  snapshot(): Snapshot;
  publish(input: GuideInput, sources: (GuideSourceRef & { used: boolean; topics: string[] })[], target?: { id: string; expectedVersion: number }): { id: string; version: number };
  download(fileId: string): Promise<Blob>;
  now(): Date;
  resolveExamMaterial?(ref: GuideAiSourceRef): Promise<GuideAiSnapshot>;
  changed(): void;
}
const manualKind: Partial<Record<GuideAiSourceKind, GuideSourceRef['kind']>> = { assignment: 'tarea', work: 'trabajo', activity: 'actividad', evidence: 'actividad', note: 'nota', question: 'pregunta' };
/** In-memory simulation only: no real key, HTTP request or contribution before publication. */
export class DemoGuideAiStore implements GuideAiActions {
  private drafts = new Map<string, Map<string, GuideAiDraft>>();
  private transcriptions = new Map<string, Map<string, GuideAiTranscription>>();
  private provenance = new Map<string, GuideAiProvenance>();
  private availabilityBindings = new Map<string, Record<string, { sourceKey: string; revision: string }[]>>();
  private refreshRequests = new Map<string, { actor: string; draftId: string; hash: string }>();
  constructor(private ctx: Context) {}
  private actor() { const me = this.ctx.snapshot().me; if (me?.status !== 'active') throw new Error('Necesitas acceso vigente al grupo.'); return me.id; }
  private owned() { const actor = this.actor(); if (!this.drafts.has(actor)) this.drafts.set(actor, new Map()); return this.drafts.get(actor)!; }
  private draft(id: string) { const draft = this.owned().get(id); if (!draft) throw new Error('El borrador no existe o no tienes acceso.'); return draft; }
  private canReadDraft(draft: GuideAiDraft) { const data = this.ctx.snapshot(); const candidates = data.subjects.flatMap((subject) => guideAiCandidates(data, subject.id)); return draft.preparation.input.sources.every((ref) => ref.kind === 'exam' || candidates.some((candidate) => guideAiCandidateKey(candidate) === guideAiCandidateKey(ref))); }
  private expected(draft: GuideAiDraft, revision: number) { if (draft.revision !== revision) throw new Error('El borrador cambió. Vuelve a abrirlo antes de guardar.'); }
  private async current(draft: GuideAiDraft, requireSame = true) {
    const data = this.ctx.snapshot(); const input = draft.preparation.input;
    if (requireSame && input.period !== undefined && input.period !== String(data.subjects.find((subject) => subject.id === input.subjectId)?.period)) throw new Error('El cuatrimestre de la materia cambió.');
    const candidates = guideAiCandidates(data, input.subjectId);
    const stored = (draft as GuideAiDraft & { sourceRevisions?: Record<string, string> }).sourceRevisions ?? {};
    for (const ref of input.sources) {
      if (ref.kind === 'exam') { if (!this.ctx.resolveExamMaterial) throw new Error('El examen no está disponible.'); const current = await this.ctx.resolveExamMaterial(ref); const prior = draft.preparation.sources.find((row) => row.kind === 'exam' && row.refId === ref.refId); if (requireSame && (current.version !== prior?.version || aiHash(current) !== (draft as GuideAiDraft & { examFingerprints?: Record<string, string> }).examFingerprints?.[ref.refId])) throw new Error('Una fuente cambió o ya no está disponible. Prepara el material nuevamente.'); continue; }
      const candidate = candidates.find((row) => guideAiCandidateKey(row) === guideAiCandidateKey(ref));
      if (!candidate || requireSame && candidate.revision !== stored[guideAiCandidateKey(ref)]) throw new Error('Una fuente cambió o ya no está disponible. Prepara el material nuevamente.');
    }
  }
  private put(draft: GuideAiDraft) { this.owned().set(draft.id, draft); return structuredClone(draft); }
  materialTranscription(id: string) { const value = this.transcriptions.get(this.actor())?.get(id); return value ? structuredClone(value) : undefined; }
  async createGuideFromMaterials(input: { subjectId: string; termId?: string; guideType: 'partial' | 'quarter'; period: string; title: string; topics: string[]; sources: GuideAiSourceRef[]; sections: string[]; requestId: string }) {
    const hash = aiHash(input); const existing = this.owned().get(input.requestId) as GuideAiDraft & { manualRequestHash?: string } | undefined;
    if (existing) { if (existing.manualRequestHash !== hash) throw new Error('La creación pertenece a otro contenido.'); if (existing.state === 'published') return { id: existing.publishedGuideId!, version: existing.publishedGuideVersion! }; }
    if (input.sections.length !== 8 || input.sections.some((section) => section.length > 20_000)) throw new Error('Revisa las ocho secciones de la guía.');
    const draft = await this.prepareGuideAiDraft({ id: input.requestId, input: { ...input, purpose: 'study_guide', maxOutputTokens: 1500 } });
    draft.result = { title: input.title, sections: GUIDE_SECTIONS.map((section, index) => ({ id: section.id, content: input.sections[index]!, citations: [] })) }; draft.state = 'ready'; draft.generationModel = 'manual';
    this.put({ ...draft, manualRequestHash: hash } as GuideAiDraft);
    const published = await this.publishGuideAiDraft({ id: draft.id, expectedRevision: draft.revision, requestId: input.requestId });
    return { id: published.publishedGuideId!, version: published.publishedGuideVersion! };
  }
  async getGuideAiStatus() { this.actor(); return { status: { actor: this.actor(), enabled: true, configured: true, model: 'simulado', limits: AI_LIMITS, consentVersion: AI_CONSENT_VERSION, consented: true, reason: 'Simulación local sin llamadas a Gemini.' }, key: { configured: true, provider: 'gemini' } }; }
  async prepareGuideAiDraft({ id, input }: Parameters<GuideAiActions['prepareGuideAiDraft']>[0], trustedReview = false) {
    if (!trustedReview && (input.clarifications?.length || input.topicReview)) throw new Error('Las aclaraciones se guardan desde las preguntas del diagnóstico de este borrador.');
    const data = this.ctx.snapshot(); const candidates = guideAiCandidates(data, input.subjectId);
    if (!data.subjects.some((subject) => subject.id === input.subjectId) || (input.termId && !data.terms.some((term) => term.id === input.termId && term.subjectId === input.subjectId))) throw new Error('La materia y el parcial no coinciden.');
    if (input.period !== undefined && input.period !== String(data.subjects.find((subject) => subject.id === input.subjectId)!.period)) throw new Error('El cuatrimestre no corresponde a la materia.');
    const examFingerprints: Record<string, string> = {};
    const selected = await Promise.all(input.sources.map(async (ref) => {
      if (ref.kind === 'exam') {
        if (!this.ctx.resolveExamMaterial) throw new Error('El examen no está disponible.');
        const snapshot = await this.ctx.resolveExamMaterial(ref); examFingerprints[ref.refId] = aiHash(snapshot);
        return { ref, candidate: { ...snapshot, revision: aiHash(snapshot), topics: ref.topics }, snapshot };
      }
      const candidate = candidates.find((row) => guideAiCandidateKey(row) === guideAiCandidateKey(ref));
      if (!candidate) throw new Error('Una fuente no está disponible.');
      if (input.termId && candidate.termId && input.termId !== candidate.termId && !ref.includeOutsideTerm) throw new Error('La clasificación de una fuente cambió.');
      return { ref, candidate, snapshot: undefined };
    }));
    const existing = this.owned().get(id); if (existing) { if (!this.canReadDraft(existing)) throw new Error('Una fuente del borrador no está disponible.'); if (aiHash(existing.preparation.input) !== aiHash(input)) throw new Error('El identificador del borrador pertenece a otra selección.'); return structuredClone(existing); }
    const aliases = selected.map(({ ref }, index) => ref.kind === 'exam' ? ref.refId : String(index + 1));
    const numeric = { ...input, subjectId: '1', ...(input.termId ? { termId: '1' } : {}), sources: selected.map(({ ref }, i) => ({ ...ref, refId: aliases[i]!, evidenceIds: undefined, transcriptionIds: undefined })) };
    const preparation = buildGuideAiPreparation(numeric, selected.map(({ ref, candidate, snapshot }, index) => ({ kind: ref.kind, refId: aliases[index]!, version: candidate.version,
      subjectId: '1', ...(candidate.termId ? { termId: '1' } : {}), title: candidate.title, visibility: snapshot?.visibility ?? (ref.kind === 'note' ? data.notes.find((row) => row.id === ref.refId)?.visibility ?? 'group' : 'group'),
      fields: snapshot?.fields ?? [{ name: 'Texto ficticio de demostración', text: `Material ficticio para estudiar ${ref.topics.join(', ') || 'el temario seleccionado'}.\nEste fragmento permite probar el recorrido sin enviar datos a Gemini.` }],
      omissions: ['La simulación sustituye el texto por material ficticio.'] })), { id, model: 'simulado', now: this.ctx.now().getTime() });
    preparation.input = structuredClone(input);
    preparation.sources.forEach((source, index) => { source.refId = selected[index]!.ref.refId; source.subjectId = input.subjectId; source.termId = selected[index]!.candidate.termId; });
    for (const fragment of preparation.fragments) for (const origin of fragment.origins) { const index = aliases.indexOf(origin.refId); origin.refId = selected[index]!.ref.refId; }
    for (const batch of preparation.batches) batch.sourceIds = batch.sourceIds.map((key) => { const alias = key.slice(key.indexOf(':') + 1); const pos = aliases.indexOf(alias); return guideAiCandidateKey(selected[pos]!.ref); });
    preparation.fingerprint = aiHash({ input, fragments: preparation.fragments, model: 'simulado', revisions: selected.map(({ ref, candidate }) => [guideAiCandidateKey(ref), candidate.revision]) });
    const now = this.ctx.now().getTime();
    const draft: GuideAiDraft & { sourceRevisions: Record<string, string>; examFingerprints: Record<string, string> } = { id, revision: 1, title: input.title, subjectId: input.subjectId, termId: input.termId, guideType: input.guideType, period: input.period, state: 'prepared',
      createdAt: now, updatedAt: now, completedSteps: 0, totalSteps: preparation.estimatedCalls, preparation,
      steps: guideAiSteps(preparation),
      examFingerprints, sourceRevisions: Object.fromEntries(selected.map(({ ref, candidate }) => [guideAiCandidateKey(ref), candidate.revision])) };
    return this.put(draft);
  }
  async listGuideAiDrafts(): Promise<GuideAiDraftSummary[]> { return [...this.owned().values()].sort((a, b) => b.updatedAt - a.updatedAt).map(({ id, revision, title, subjectId, termId, guideType, period, state, createdAt, updatedAt, completedSteps, totalSteps, publishedGuideId }) => ({ id, revision, title, subjectId, termId, ...(guideType ? { guideType, period } : {}), state, createdAt, updatedAt, completedSteps, totalSteps, publishedGuideId })); }
  async refreshGuideAiDraft(input: Parameters<GuideAiActions['refreshGuideAiDraft']>[0]) {
    const actor = this.actor(); const draft = this.draft(input.id);
    if (!this.canReadDraft(draft)) throw new Error('Una fuente anterior dejó de estar compartida. Prepara un borrador nuevo con material disponible.');
    const proposed = input.input; const stored = draft.preparation.input;
    if ((proposed.clarifications !== undefined || proposed.topicReview !== undefined) && (!draft.topicsReviewed || aiHash({ clarifications: proposed.clarifications, topicReview: proposed.topicReview }) !== aiHash({ clarifications: stored.clarifications, topicReview: stored.topicReview }))) throw new Error('Solo puedes conservar las respuestas ya revisadas de este borrador.');
    const sameScope = proposed.subjectId === stored.subjectId && proposed.termId === stored.termId && proposed.guideType === stored.guideType && proposed.period === stored.period && aiHash(proposed.topics) === aiHash(stored.topics);
    if (draft.result && stored.reviewBeforeGenerate && (!sameScope || proposed.reviewBeforeGenerate !== true)) throw new Error('Para cambiar la materia, el tipo o el temario, prepara otro borrador. Tu texto actual se conserva.');
    const normalized = { ...proposed }; delete normalized.clarifications; delete normalized.topicReview;
    if (draft.result && draft.topicsReviewed && sameScope && proposed.reviewBeforeGenerate) { normalized.clarifications = stored.clarifications; normalized.topicReview = stored.topicReview; }
    input = { ...input, input: normalized };
    const hash = aiHash(input); const prior = this.refreshRequests.get(input.requestId);
    if (prior) { if (prior.actor !== actor || prior.draftId !== draft.id || prior.hash !== hash) throw new Error('El identificador de actualización pertenece a otra solicitud.'); return structuredClone(draft); }
    if (!aiUuid(input.requestId)) throw new Error('La actualización no tiene un identificador válido.');
    this.expected(draft, input.expectedRevision); if (['running', 'published', 'cancelled'].includes(draft.state)) throw new Error('Espera a que termine el envío; elige otro borrador si este ya se publicó o canceló.');
    const temporaryId = crypto.randomUUID(); const prepared = await this.prepareGuideAiDraft({ id: temporaryId, input: input.input }, true); this.owned().delete(temporaryId);
    if (prepared.preparation.fingerprint === draft.preparation.fingerprint) { draft.preparation = prepared.preparation; draft.preparation.id = draft.id; draft.revision++; draft.updatedAt = this.ctx.now().getTime(); draft.refreshRequestId = input.requestId; this.refreshRequests.set(input.requestId, { actor, draftId: draft.id, hash }); return this.put(draft); }
    const valid = new Set(prepared.preparation.fragments.map((fragment) => fragment.id));
    const refreshed: GuideAiDraft = { ...draft, ...prepared, assessment: draft.result ? draft.assessment : undefined, topicsReviewed: draft.result ? draft.topicsReviewed : false, previousClarifications: draft.result ? draft.previousClarifications : preserveGuideAiClarifications(draft), id: draft.id, createdAt: draft.createdAt, revision: draft.revision + 1, refreshRequestId: input.requestId,
      ...(draft.result ? { result: { ...structuredClone(draft.result), sections: draft.result.sections.map((section) => ({ ...section, citations: section.citations.filter((id) => valid.has(id)) })) },
        title: draft.result.title, state: 'ready', needsCitationReview: true, generationModel: draft.generationModel ?? draft.preparation.model, editedAfterGeneration: true, steps: draft.steps, totalSteps: draft.totalSteps, completedSteps: draft.completedSteps } : {}) };
    refreshed.preparation.id = draft.id;
    this.refreshRequests.set(input.requestId, { actor, draftId: draft.id, hash }); return this.put(refreshed);
  }
  async getGuideAiDraft(id: string) { const draft = this.draft(id); await this.current(draft, false); if (!this.canReadDraft(draft)) throw new Error('Una fuente del borrador no está disponible.'); return structuredClone(draft); }
  async getGuideAiFile(fileId: string) {
    this.actor(); const data = this.ctx.snapshot(); const file = data.resourceFiles.find((row) => row.id === fileId && !row.removedAt);
    if (!file) throw new Error('El archivo ya no está disponible.');
    const candidate = guideAiCandidates(data, data.subjects.find((s) => guideAiCandidates(data, s.id).some((c) => c.kind === file.targetKind && c.refId === file.targetId))?.id ?? '').find((row) => row.kind === file.targetKind && row.refId === file.targetId);
    if (!candidate) throw new Error('El archivo no pertenece a material compartido disponible.');
    const bytes = await (await this.ctx.download(fileId)).arrayBuffer();
    const fileHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return { fileId, fileHash, targetKind: candidate.kind, targetId: candidate.refId, targetVersion: candidate.version, name: file.name, size: file.size, contentType: file.contentType };
  }
  async saveGuideAiTranscription(input: Parameters<GuideAiActions['saveGuideAiTranscription']>[0]) {
    const actor = this.actor(); const file = await this.getGuideAiFile(input.fileId);
    if (input.fileHash !== file.fileHash || input.targetKind !== file.targetKind || input.targetId !== file.targetId || input.targetVersion !== file.targetVersion) throw new Error('El archivo o su versión cambió. Prepara otra transcripción.');
    if (!aiUuid(input.id) || !input.reviewed || !input.text.trim() || input.text.length > 120_000 || !input.segments.length || input.segments.map((segment) => segment.text).join('\n') !== input.text || input.segments.some((segment) => !segment.text.trim() || !['page', 'paragraph', 'lines'].includes(segment.locator.kind) || !Number.isInteger(segment.locator.start) || segment.locator.start < 1 || !Number.isInteger(segment.locator.end) || segment.locator.end < segment.locator.start)) throw new Error('Revisa la transcripción y sus localizadores antes de guardarla.');
    if (!this.transcriptions.has(actor)) this.transcriptions.set(actor, new Map());
    const transcript = { ...structuredClone(input), createdAt: this.ctx.now().getTime(), label: 'Material preparado por el alumno · simulación' };
    this.transcriptions.get(actor)!.set(input.id, transcript); return structuredClone(transcript);
  }
  async runGuideAiStep(id: string, input: Parameters<GuideAiActions['runGuideAiStep']>[1]) {
    const draft = this.draft(id); this.expected(draft, input.expectedRevision); await this.current(draft);
    if (!input.confirmed || input.fingerprint !== draft.preparation.fingerprint || !draft.preparation.canGenerate) throw new Error('Confirma la vista previa vigente.');
    if (draft.state === 'cancelled' || draft.state === 'published') throw new Error('Este borrador ya no admite generación.');
    const next = draft.steps.find((step) => step.state === 'pending'); if (!next) return structuredClone(draft);
    if (draft.preparation.input.reviewBeforeGenerate && !['assessment', 'summary'].includes(next.kind) && !draft.topicsReviewed) throw new Error('Responde o reconoce las preguntas del diagnóstico antes de generar la guía.');
    if (next.kind === 'assessment') {
      const topics = draft.preparation.input.topics.map((topic) => {
        const references = draft.preparation.sources.filter((entry) => entry.topics.includes(topic));
        return { topic, coverage: references.length ? 'thin' as const : 'missing' as const, reason: references.length ? 'La simulación encontró referencias; confirma el alcance y añade detalles del docente.' : 'La selección no identifica material para este tema.', citations: [...new Set(references.flatMap((entry) => entry.fragmentIds))] };
      });
      draft.assessment = { topics, questions: topics.map((topic, index) => ({ id: `topic-${index + 1}`, topic: topic.topic, question: `¿Qué procedimientos, ejemplos o indicaciones del docente debemos incluir sobre ${topic.topic}?` })) };
      draft.topicsReviewed = false; next.result = structuredClone(draft.assessment);
    } else if (next.kind === 'summary') next.result = { paragraphs: [{ text: 'Resumen ficticio preparado para la simulación.', citations: draft.preparation.fragments.map((f) => f.id) }] };
    else { const result: GuideAiResult = { title: draft.title, sections: GUIDE_SECTIONS.map((section) => ({ id: section.id, content: `${section.title}: contenido ficticio de demostración. Revisa y adapta esta sección antes de compartirla.`, citations: draft.preparation.fragments.map((f) => f.id) })) }; draft.result = result; draft.generationModel = draft.preparation.model; next.result = result; }
    next.state = 'succeeded'; next.generationId = input.generationId; next.finishedAt = this.ctx.now().getTime();
    draft.completedSteps++; draft.revision++; draft.updatedAt = this.ctx.now().getTime(); draft.state = draft.result ? 'ready' : 'prepared'; return this.put(draft);
  }
  async reviewGuideAiTopics(id: string, input: Parameters<GuideAiActions['reviewGuideAiTopics']>[1]) {
    const draft = this.draft(id); this.expected(draft, input.expectedRevision); await this.current(draft);
    if (!draft.preparation.input.reviewBeforeGenerate || !draft.assessment || draft.topicsReviewed || draft.state !== 'prepared' || !draft.steps.some((step) => step.kind === 'assessment' && step.state === 'succeeded') || draft.steps.some((step) => step.kind !== 'assessment' && !(step.kind === 'summary' && step.state === 'succeeded') && step.state !== 'pending')) throw new Error('Completa el diagnóstico antes de revisar sus preguntas.');
    const clarifications = guideAiClarificationsFromReview(draft.assessment, input);
    const topicReview = { topics: draft.assessment.topics.map(({ topic, coverage, reason }) => ({ topic, coverage, reason })), acknowledgeGaps: input.acknowledgeGaps };
    const temporaryId = crypto.randomUUID(); const refreshed = await this.prepareGuideAiDraft({ id: temporaryId, input: { ...draft.preparation.input, clarifications, topicReview } }, true); this.owned().delete(temporaryId);
    draft.preparation = refreshed.preparation; draft.preparation.id = draft.id; draft.topicsReviewed = true; draft.revision++; draft.updatedAt = this.ctx.now().getTime();
    return this.put(draft);
  }
  async updateGuideAiDraft(id: string, input: Parameters<GuideAiActions['updateGuideAiDraft']>[1]) { const draft = this.draft(id); this.expected(draft, input.expectedRevision); if (!draft.result || draft.state === 'published' || draft.state === 'cancelled') throw new Error('Este borrador no admite edición.'); draft.result = validateGuideAiResult(input.result, draft.preparation); draft.needsCitationReview = false; draft.editedAfterGeneration = true; draft.title = draft.result.title; draft.revision++; draft.updatedAt = this.ctx.now().getTime(); return this.put(draft); }
  async cancelGuideAiDraft(id: string, expectedRevision: number) { const draft = this.draft(id); this.expected(draft, expectedRevision); if (draft.state === 'published') throw new Error('La guía ya se publicó.'); for (const step of draft.steps) if (['pending', 'failed', 'unknown'].includes(step.state)) step.state = 'cancelled'; draft.state = 'cancelled'; draft.revision++; const cancelled = this.put(draft); let readable = this.canReadDraft(draft); try { await this.current(draft, false); } catch { readable = false; } return readable ? cancelled : { ...cancelled, result: undefined, assessment: undefined, previousClarifications: undefined, preparation: { ...cancelled.preparation, fragments: [], omissions: [], input: { ...cancelled.preparation.input, topicReview: undefined, sources: [] }, sources: cancelled.preparation.sources.map((source) => ({ ...source, title: 'Fuente no disponible', status: 'pending' as const, reason: 'La fuente no está disponible.', fragmentIds: [] })) }, steps: cancelled.steps.map((step) => ({ ...step, result: undefined, error: undefined })) }; }
  async publishGuideAiDraft(input: Parameters<GuideAiActions['publishGuideAiDraft']>[0]) {
    const draft = this.draft(input.id); if (draft.state === 'published' && draft.publicationRequestId === input.requestId) return structuredClone(draft);
    this.expected(draft, input.expectedRevision); await this.current(draft); if (!draft.result || draft.state !== 'ready') throw new Error('Termina y revisa el borrador antes de publicarlo.');
    if (draft.needsCitationReview) throw new Error('Revisa y guarda las citas del material actualizado antes de publicar.');
    if (draft.preparation.input.reviewBeforeGenerate && !draft.topicsReviewed) throw new Error('Revisa las preguntas pendientes antes de publicar.');
    if (draft.preparation.sources.some((row) => row.visibility === 'personal')) throw new Error('La guía contiene materiales personales. Conserva el borrador privado; comparte sus fuentes o quítalas antes de publicar.');
    const result = draft.generationModel === 'manual' ? draft.result : validateGuideAiResult(draft.result, draft.preparation); const data = this.ctx.snapshot();
    const guideInput = { subjectId: draft.subjectId, termId: draft.termId, title: result.title, topicsText: draft.preparation.input.topics.join('\n'), sections: result.sections.map((section) => section.content) };
    const guide = input.guideId ? data.guides.find((row) => row.id === input.guideId && !row.withdrawnAt) : undefined;
    if (input.guideId && (!guide || guide.subjectId !== draft.subjectId || guide.termId !== draft.termId || input.expectedVersion !== guide.version)) throw new Error('La guía cambió. Recarga antes de publicar.');
    const cited = new Set(result.sections.flatMap((section) => section.citations));
    const grouped = new Map<string, GuideSourceRef & { used: boolean; topics: string[] }>();
    for (const source of draft.preparation.sources) { if (source.kind === 'exam') continue; const ref = { kind: manualKind[source.kind]!, refId: source.kind === 'evidence' ? data.evidences.find((row) => row.id === source.refId)!.activityId : source.refId, used: source.fragmentIds.some((id) => cited.has(id)), topics: [...source.topics] };
      const key = guideAiCandidateKey(ref); const prior = grouped.get(key); if (prior) { prior.used ||= ref.used; prior.topics = [...new Set([...prior.topics, ...ref.topics])]; } else grouped.set(key, ref); }
    const published = this.ctx.publish(guideInput, [...grouped.values()], guide ? { id: guide.id, expectedVersion: guide.version } : undefined);
    const guideId = published.id; const version = published.version;
    draft.state = 'published'; draft.publishedGuideId = guideId; draft.publishedGuideVersion = version; draft.publicationRequestId = input.requestId; draft.revision++;
    this.provenance.set(`${guideId}:${version}`, { purpose: 'study_guide', guideType: draft.preparation.input.guideType, period: draft.preparation.input.period, clarifications: structuredClone(draft.preparation.input.clarifications), topicReview: structuredClone(draft.preparation.input.topicReview), model: draft.generationModel ?? draft.preparation.model, editedAfterGeneration: draft.editedAfterGeneration, draftId: draft.id, preparationFingerprint: draft.preparation.fingerprint,
      sources: structuredClone(draft.preparation.sources), fragments: structuredClone(draft.preparation.fragments), citations: structuredClone(result.sections), generatedAt: this.ctx.now().getTime() });
    const bindings: Record<string, { sourceKey: string; revision: string }[]> = {}; const candidates = guideAiCandidates(data, draft.subjectId, draft.termId);
    for (const entry of draft.preparation.sources) { if (entry.kind === 'exam') continue; const manualId = entry.kind === 'evidence' ? data.evidences.find((row) => row.id === entry.refId)!.activityId : entry.refId;
      const manualKey = `${manualKind[entry.kind]}:${manualId}`; const sourceKey = guideAiCandidateKey(entry); const candidate = candidates.find((row) => guideAiCandidateKey(row) === sourceKey);
      (bindings[manualKey] ??= []).push({ sourceKey, revision: candidate?.revision ?? '' }); }
    this.availabilityBindings.set(`${guideId}:${version}`, bindings); const saved = this.put(draft); this.ctx.changed(); return saved;
  }
  async getGuideAiProvenance(guideId: string, version: number) {
    this.actor(); const data = this.ctx.snapshot(); const guide = data.guides.find((row) => row.id === guideId); if (!guide) throw new Error('La guía no está disponible.');
    const value = this.provenance.get(`${guideId}:${version}`); if (!value) return null;
    const placement = data.guideVersions.find((row) => row.guideId === guideId && row.version === version) ?? guide;
    const candidates = guideAiCandidates(data, placement.subjectId);
    const examKeys = new Set<string>();
    for (const entry of value.sources.filter((entry) => entry.kind === 'exam')) { try { const current = await this.ctx.resolveExamMaterial?.({ kind: 'exam', refId: entry.refId, examVersion: entry.examVersion ?? entry.version, includeSolutions: entry.includeSolutions, topics: entry.topics, includeUnplaced: true }); if (current?.visibility === 'group') examKeys.add(guideAiCandidateKey(entry)); } catch { /* Retired exam content is hidden. */ } }
    const available = (origin: GuideAiProvenance['fragments'][number]['origins'][number]) => (examKeys.has(guideAiCandidateKey(origin)) || candidates.some((candidate) => guideAiCandidateKey(candidate) === guideAiCandidateKey(origin)))
      && (!origin.field.startsWith('respuesta:') || data.answers.some((answer) => answer.id === origin.field.split(':')[1] && !answer.withdrawnAt));
    const result = structuredClone(value); delete result.draftId; result.fragments = result.fragments.filter((fragment) => fragment.origins.every(available));
    const allowed = new Set(result.fragments.map((fragment) => fragment.id)); result.citations = result.citations.map((section) => ({ ...section, citations: section.citations.filter((id) => allowed.has(id)) }));
    result.sources = result.sources.map((entry) => examKeys.has(guideAiCandidateKey(entry)) || candidates.some((candidate) => guideAiCandidateKey(candidate) === guideAiCandidateKey(entry)) ? entry : { ...entry, title: 'Fuente no disponible', status: 'pending', reason: 'La fuente fue retirada o dejó de estar compartida.', fragmentIds: [] }); return result;
  }
  sourceAvailability(data: Snapshot): GuideAiSourceAvailability[] {
    const rows: GuideAiSourceAvailability[] = [];
    for (const guide of data.guides) { const key = `${guide.id}:${guide.version}`; const bindings = this.availabilityBindings.get(key); if (!bindings) continue;
      const candidates = guideAiCandidates(data, guide.subjectId, guide.termId);
      for (const source of data.guideSources.filter((row) => row.guideId === guide.id)) { const refs = bindings[`${source.kind}:${source.refId}`]; if (!refs?.length) continue;
        const current = refs.map((ref) => candidates.find((candidate) => guideAiCandidateKey(candidate) === ref.sourceKey));
        const available = current.every(Boolean); const outdated = available && current.some((candidate, index) => candidate!.revision !== refs[index]!.revision);
        rows.push({ sourceId: source.id, guideId: guide.id, guideVersion: guide.version, available, outdated, reason: !available ? 'Una fuente citada fue retirada o dejó de estar compartida.' : outdated ? 'Cambió material citado; se conserva la cobertura de la versión utilizada.' : '' });
      }
    }
    return rows;
  }
  inheritProvenance(guideId: string, previousVersion: number, version: number, sections?: string[]) { const previous = this.provenance.get(`${guideId}:${previousVersion}`); if (previous) this.provenance.set(`${guideId}:${version}`, { ...structuredClone(previous), citations: previous.citations.map((section, index) => ({ ...section, content: sections?.[index] ?? section.content })), editedAfterGeneration: Boolean(previous.editedAfterGeneration || (sections && previous.citations.some((section, index) => section.content !== sections[index]))) }); const bindings = this.availabilityBindings.get(`${guideId}:${previousVersion}`); if (bindings) this.availabilityBindings.set(`${guideId}:${version}`, structuredClone(bindings)); }
  restoreProvenance(guideId: string, previousVersion: number, version: number) { const previous = this.provenance.get(`${guideId}:${previousVersion}`); if (previous) this.provenance.set(`${guideId}:${version}`, structuredClone(previous)); const bindings = this.availabilityBindings.get(`${guideId}:${previousVersion}`); if (bindings) this.availabilityBindings.set(`${guideId}:${version}`, structuredClone(bindings)); this.ctx.changed(); }
  dispose() { this.drafts.clear(); this.transcriptions.clear(); this.provenance.clear(); this.availabilityBindings.clear(); this.refreshRequests.clear(); }
}
