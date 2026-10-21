import { aiDecimalId, aiHash, aiRecord, aiUuid, AiError, sanitizeAiText } from './ai';
import { GUIDE_SECTIONS, MAX_GUIDE_SECTION_LENGTH } from './guides';

export const GUIDE_AI_LIMITS = Object.freeze({ maxSources: 30, maxCharacters: 120_000, batchSources: 10, batchCharacters: 40_000,
  maxOutputTokens: 8_000, maxDocumentBytes: 10 * 1024 * 1024, maxPdfPages: 200, maxDocxExpandedBytes: 32 * 1024 * 1024 });
export const GUIDE_AI_SOURCE_KINDS = ['assignment', 'work', 'activity', 'evidence', 'note', 'question'] as const;
export type GuideAiSourceKind = typeof GUIDE_AI_SOURCE_KINDS[number];
export interface GuideAiSourceRef { kind: GuideAiSourceKind; refId: string; topics: string[]; includeUnplaced: boolean; evidenceIds?: string[]; transcriptionIds?: string[] }
export interface GuideAiPrepareInput { purpose: 'study_guide'; subjectId: string; termId?: string; title: string; topics: string[]; sources: GuideAiSourceRef[]; maxOutputTokens: number }
export interface GuideAiLocator { kind: 'page' | 'paragraph' | 'lines'; start: number; end: number }
export interface GuideAiSegment { id: string; text: string; locator: GuideAiLocator }
export interface GuideAiTranscriptionInput { id: string; fileId: string; fileHash: string; targetKind: GuideAiSourceKind; targetId: string; targetVersion: number; text: string; segments: GuideAiSegment[]; omissions: string[]; reviewed: true }
export interface GuideAiTranscription extends GuideAiTranscriptionInput { createdAt: number; label: string }
export interface GuideAiOrigin { kind: GuideAiSourceKind; refId: string; version: number; field: string; startLine: number; endLine: number; fileId?: string; fileHash?: string; transcriptionId?: string; locator?: GuideAiLocator }
export interface GuideAiFragment { id: string; text: string; origins: GuideAiOrigin[] }
export interface GuideAiSnapshot { kind: GuideAiSourceKind; refId: string; version: number; subjectId: string; termId?: string; title: string; visibility: 'group' | 'personal'; fields: { name: string; text: string; origin?: Partial<GuideAiOrigin> }[]; context?: string; omissions?: string[] }
export interface GuideAiPreparedSource { kind: GuideAiSourceKind; refId: string; version: number; title: string; subjectId: string; termId?: string; fingerprint: string; topics: string[]; status: 'prepared' | 'pending' | 'failed'; reason?: string; fragmentIds: string[] }
export interface GuideAiBatch { id: string; sourceIds: string[]; fragmentIds: string[]; characters: number }
export interface GuideAiPreparation { id: string; purpose: 'study_guide'; input: GuideAiPrepareInput; sources: GuideAiPreparedSource[]; fragments: GuideAiFragment[]; batches: GuideAiBatch[]; omissions: string[]; fingerprint: string; model: string; estimatedInputTokens: number; estimatedOutputTokens: number; estimatedCalls: number; canGenerate: boolean; createdAt: number; expiresAt: number }
export interface GuideAiSection { id: typeof GUIDE_SECTIONS[number]['id']; content: string; citations: string[] }
export interface GuideAiResult { title: string; sections: GuideAiSection[] }
export interface GuideAiSummary { paragraphs: { text: string; citations: string[] }[] }
export type GuideAiStepState = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
export interface GuideAiStep { id: string; kind: 'direct' | 'summary' | 'synthesis'; batchId?: string; state: GuideAiStepState; generationId?: string; startedAt?: number; finishedAt?: number; result?: GuideAiResult | GuideAiSummary; error?: string; usage?: { inputTokens: number; outputTokens: number } }
export interface GuideAiDraftSummary { id: string; revision: number; title: string; subjectId: string; termId?: string; state: 'prepared' | 'running' | 'ready' | 'failed' | 'unknown' | 'cancelled' | 'published'; createdAt: number; updatedAt: number; completedSteps: number; totalSteps: number; publishedGuideId?: string }
export interface GuideAiDraft extends GuideAiDraftSummary { preparation: GuideAiPreparation; steps: GuideAiStep[]; result?: GuideAiResult; publishedGuideVersion?: number; publicationRequestId?: string; needsCitationReview?: boolean; generationModel?: string; editedAfterGeneration?: boolean; refreshRequestId?: string }
export interface GuideAiClaim { claimed: boolean; actor: string; draft: GuideAiDraft; step?: GuideAiStep; fragments?: GuideAiFragment[]; summaries?: GuideAiSummary[]; key?: { keyId: string; provider: 'gemini'; ciphertext: string; iv: string; masterVersion: string }; estimatedTokens?: number }
export interface GuideAiPublishInput { id: string; expectedRevision: number; requestId: string; guideId?: string; expectedVersion?: number }
export interface GuideAiProvenance { purpose: 'study_guide'; model: string; draftId?: string; editedAfterGeneration?: boolean; preparationFingerprint: string; sources: GuideAiPreparedSource[]; fragments: GuideAiFragment[]; citations: GuideAiSection[]; generatedAt: number }

export function validateGuideAiPrepareInput(value: unknown): GuideAiPrepareInput {
  if (!aiRecord(value) || value.purpose !== 'study_guide' || !aiDecimalId(value.subjectId) || (value.termId !== undefined && !aiDecimalId(value.termId)) ||
    typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200 || !Array.isArray(value.topics) || !value.topics.length || value.topics.length > 40 ||
    !Array.isArray(value.sources) || !value.sources.length || value.sources.length > GUIDE_AI_LIMITS.maxSources) throw new AiError('invalid', 'Elige materia, título, temas y entre 1 y 30 fuentes compartidas.');
  const topics = value.topics.map((topic) => { if (typeof topic !== 'string' || !topic.trim() || topic.length > 120) throw new AiError('invalid', 'Revisa los temas de la guía.'); return topic.trim(); });
  if (new Set(topics.map((t) => t.toLocaleLowerCase('es'))).size !== topics.length) throw new AiError('invalid', 'No repitas temas.');
  const sources = value.sources.map((source): GuideAiSourceRef => {
    if (!aiRecord(source) || !GUIDE_AI_SOURCE_KINDS.includes(source.kind as GuideAiSourceKind) || !aiDecimalId(source.refId) || !Array.isArray(source.topics) || source.topics.some((t) => !topics.includes(String(t))) || typeof source.includeUnplaced !== 'boolean') throw new AiError('invalid', 'Revisa la selección de fuentes.');
    for (const key of ['evidenceIds', 'transcriptionIds'] as const) if (source[key] !== undefined && (!Array.isArray(source[key]) || source[key].length > 30 || source[key].some((id) => key === 'evidenceIds' ? !aiDecimalId(id) : !aiUuid(id)))) throw new AiError('invalid', 'Revisa los adjuntos y evidencias seleccionados.');
    if (source.kind !== 'activity' && source.evidenceIds !== undefined) throw new AiError('invalid', 'Las evidencias deben seleccionarse desde su actividad.');
    return { kind: source.kind as GuideAiSourceKind, refId: source.refId, topics: [...new Set(source.topics as string[])], includeUnplaced: source.includeUnplaced,
      ...(source.evidenceIds ? { evidenceIds: [...new Set(source.evidenceIds as string[])] } : {}), ...(source.transcriptionIds ? { transcriptionIds: [...new Set(source.transcriptionIds as string[])] } : {}) };
  });
  if (new Set(sources.map((s) => `${s.kind}:${s.refId}`)).size !== sources.length) throw new AiError('invalid', 'No repitas fuentes.');
  const maxOutputTokens = value.maxOutputTokens ?? GUIDE_AI_LIMITS.maxOutputTokens;
  if (!Number.isInteger(maxOutputTokens) || Number(maxOutputTokens) < 256 || Number(maxOutputTokens) > GUIDE_AI_LIMITS.maxOutputTokens) throw new AiError('invalid', 'El límite de salida debe ser de 256 a 8 000 tokens.');
  return { purpose: 'study_guide', subjectId: value.subjectId, ...(value.termId ? { termId: value.termId } : {}), title: sanitizeAiText(value.title.trim()), topics, sources, maxOutputTokens: Number(maxOutputTokens) };
}
export function buildGuideAiPreparation(raw: unknown, snapshots: GuideAiSnapshot[], options: { id: string; model: string; now: number }): GuideAiPreparation {
  const input = validateGuideAiPrepareInput(raw);
  if (!aiUuid(options.id) || !options.model.trim() || options.model.length > 200) throw new AiError('invalid', 'La preparación no está configurada.');
  const fragments: GuideAiFragment[] = []; const byText = new Map<string, GuideAiFragment>(); const omissions: string[] = [];
  let characters = 0;
  const sources = input.sources.map((ref): GuideAiPreparedSource => {
    const snapshot = snapshots.find((s) => s.kind === ref.kind && s.refId === ref.refId);
    if (!snapshot || snapshot.visibility !== 'group') throw new AiError('unauthorized', 'Solo puedes usar material compartido disponible para el grupo.');
    if (snapshot.subjectId !== input.subjectId || (input.termId && snapshot.termId && snapshot.termId !== input.termId)) throw new AiError('conflict', 'La clasificación de una fuente cambió.');
    const source: GuideAiPreparedSource = { kind: ref.kind, refId: ref.refId, version: snapshot.version, title: sanitizeAiText(snapshot.title), subjectId: snapshot.subjectId,
      ...(snapshot.termId ? { termId: snapshot.termId } : {}), fingerprint: aiHash(snapshot), topics: ref.topics, status: 'prepared', fragmentIds: [] };
    if (!snapshot.termId && !ref.includeUnplaced) { source.status = 'pending'; source.reason = 'Incluye expresamente el material sin parcial.'; return source; }
    omissions.push(...(snapshot.omissions ?? []).map((o) => `${ref.kind}:${ref.refId}: ${sanitizeAiText(o)}`));
    for (const field of snapshot.fields) {
      const lines = sanitizeAiText(field.text.replace(/\r\n?/g, '\n')).split('\n'); let offset = 0;
      while (offset < lines.length) {
        const start = offset; let text = lines[offset++]!;
        while (offset < lines.length && text.length + lines[offset]!.length + 1 <= 4000) text += `\n${lines[offset++]!}`;
        // Split a very long line without losing a character or its original line locator.
        for (let i = 0; i < text.length; i += 4000) {
          const part = text.slice(i, i + 4000); if (!part.trim()) continue;
          const hash = aiHash(part); let fragment = byText.get(hash);
          if (!fragment) { characters += part.length; if (characters > GUIDE_AI_LIMITS.maxCharacters) throw new AiError('quota', 'Las fuentes superan 120 000 caracteres. Reduce la selección; no se recortó contenido.');
            fragment = { id: `guide-fragment-${hash.slice(0, 24)}`, text: part, origins: [] }; fragments.push(fragment); byText.set(hash, fragment); }
          fragment.origins.push({ kind: snapshot.kind, refId: snapshot.refId, version: snapshot.version, field: field.name, startLine: start + 1, endLine: offset, ...field.origin });
          source.fragmentIds.push(fragment.id);
        }
      }
    }
    source.fragmentIds = [...new Set(source.fragmentIds)];
    if (!source.fragmentIds.length) { source.status = 'failed'; source.reason = 'No hay texto preparado utilizable.'; }
    return source;
  });
  const batches: GuideAiBatch[] = []; let batch: GuideAiBatch | undefined;
  for (const source of sources.filter((s) => s.status === 'prepared')) {
    const key = `${source.kind}:${source.refId}`;
    for (const id of source.fragmentIds) {
      const fragment = fragments.find((f) => f.id === id)!;
      if (!batch || (!batch.sourceIds.includes(key) && batch.sourceIds.length >= 10) || (!batch.fragmentIds.includes(id) && batch.characters + fragment.text.length > 40_000)) {
        batch = { id: `batch-${batches.length + 1}`, sourceIds: [], fragmentIds: [], characters: 0 }; batches.push(batch);
      }
      if (!batch.sourceIds.includes(key)) batch.sourceIds.push(key);
      if (!batch.fragmentIds.includes(id)) { batch.fragmentIds.push(id); batch.characters += fragment.text.length; }
    }
  }
  const estimatedCalls = batches.length <= 1 ? 1 : batches.length + 1;
  const estimatedInputTokens = batches.length <= 1
    ? estimateGuideAiCallTokens(input, 'direct', fragments, []) - input.maxOutputTokens
    : batches.reduce((total, batch) => total + estimateGuideAiCallTokens(input, 'summary', fragments.filter((f) => batch.fragmentIds.includes(f.id)), []) - Math.min(3000, input.maxOutputTokens), 0)
      + Math.ceil(new TextEncoder().encode(JSON.stringify({ title: input.title, topics: input.topics, allowedCitations: fragments.map((f) => f.id) })).length / 3) + 1024 + 12_000;
  return { id: options.id, purpose: 'study_guide', input, sources, fragments, batches, omissions,
    fingerprint: aiHash({ input, sources, fragments, batches, model: options.model }), model: options.model,
    estimatedInputTokens, estimatedOutputTokens: input.maxOutputTokens * estimatedCalls, estimatedCalls,
    canGenerate: sources.every((s) => s.status === 'prepared') && input.topics.every((t) => sources.some((s) => s.topics.includes(t) && s.fragmentIds.length)),
    createdAt: options.now, expiresAt: options.now + 30 * 60_000 };
}
export function validateGuideAiResult(value: unknown, preparation: GuideAiPreparation): GuideAiResult {
  if (!aiRecord(value) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200 || !Array.isArray(value.sections) || value.sections.length !== 8) throw new AiError('invalid', 'La respuesta debe contener título y las ocho secciones.');
  const allowed = new Set(preparation.fragments.map((f) => f.id));
  const sections = GUIDE_SECTIONS.map((section): GuideAiSection => {
    const matches = (value.sections as unknown[]).filter((s) => aiRecord(s) && s.id === section.id);
    if (matches.length !== 1) throw new AiError('invalid', 'Falta una sección o está repetida.');
    const raw = matches[0] as Record<string, unknown>;
    if (typeof raw.content !== 'string' || !raw.content.trim() || raw.content.length > MAX_GUIDE_SECTION_LENGTH || !Array.isArray(raw.citations) || !raw.citations.length || raw.citations.some((c) => typeof c !== 'string' || !allowed.has(c))) throw new AiError('invalid', 'Cada sección requiere texto y citas de fragmentos existentes.');
    return { id: section.id, content: sanitizeAiText(raw.content), citations: [...new Set(raw.citations as string[])] };
  });
  return { title: sanitizeAiText(value.title.trim()), sections };
}
export function validateGuideAiSummary(value: unknown, fragments: readonly GuideAiFragment[], maxCharacters = 8000): GuideAiSummary {
  const allowed = new Set(fragments.map((f) => f.id));
  if (!aiRecord(value) || !Array.isArray(value.paragraphs) || !value.paragraphs.length || value.paragraphs.length > 30) throw new AiError('invalid', 'El resumen intermedio no es válido.');
  let characters = 0;
  const paragraphs = value.paragraphs.map((p) => {
    if (!aiRecord(p) || typeof p.text !== 'string' || !p.text.trim() || p.text.length > 4000 || !Array.isArray(p.citations) || !p.citations.length || p.citations.some((id) => typeof id !== 'string' || !allowed.has(id))) throw new AiError('invalid', 'El resumen contiene citas inexistentes.');
    characters += p.text.length;
    return { text: sanitizeAiText(p.text), citations: [...new Set(p.citations as string[])] };
  });
  if (characters > maxCharacters) throw new AiError('invalid', 'El resumen intermedio supera el límite.');
  return { paragraphs };
}
export const GUIDE_AI_RESULT_SCHEMA = { type: 'object', required: ['title', 'sections'], properties: { title: { type: 'string' }, sections: { type: 'array', minItems: 8, maxItems: 8, items: { type: 'object', required: ['id', 'content', 'citations'], properties: { id: { type: 'string', enum: GUIDE_SECTIONS.map((s) => s.id) }, content: { type: 'string' }, citations: { type: 'array', items: { type: 'string' }, minItems: 1 } } } } } };
export const GUIDE_AI_SUMMARY_SCHEMA = { type: 'object', required: ['paragraphs'], properties: { paragraphs: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', required: ['text', 'citations'], properties: { text: { type: 'string' }, citations: { type: 'array', items: { type: 'string' }, minItems: 1 } } } } } };

/** Exact student-data envelope shared by preview estimation, reservation and provider. */
export function buildGuideAiProviderPayload(input: GuideAiPrepareInput, kind: GuideAiStep['kind'], fragments: readonly GuideAiFragment[], summaries: readonly GuideAiSummary[]) {
  return { purpose: 'study_guide', title: input.title, topics: input.topics,
    ...(kind === 'synthesis' ? { summaries, allowedCitations: fragments.map((f) => f.id) }
      : { fragments: fragments.map(({ id, text }) => ({ id, text })) }) };
}
export function estimateGuideAiCallTokens(input: GuideAiPrepareInput, kind: GuideAiStep['kind'], fragments: readonly GuideAiFragment[], summaries: readonly GuideAiSummary[]) {
  const serialized = JSON.stringify(buildGuideAiProviderPayload(input, kind, fragments, summaries));
  return Math.ceil(new TextEncoder().encode(serialized).byteLength / 3) + 1024
    + (kind === 'summary' ? Math.min(3000, input.maxOutputTokens) : input.maxOutputTokens);
}
