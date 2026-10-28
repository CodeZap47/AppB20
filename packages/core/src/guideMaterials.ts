import { AiError, aiDecimalId, aiRecord, aiUuid, sanitizeAiText } from './ai';
import type { GuideAiSourceRef, GuideAiSourceKind } from './guideAi';

export interface GuideExamMaterial {
  id: string; title: string; subjectId: string; termId?: string; version: number; topics: string[];
  ownerId: string; visibility: 'group' | 'personal'; canIncludeSolutions: boolean;
  sourceIssues: { state: 'outdated' | 'unavailable'; message: string }[];
}
export interface GuideExamMaterialDetail extends GuideExamMaterial {
  text: string; fields: { name: string; text: string }[]; omissions: string[];
}
export interface GuideMaterialTranscriptionRef {
  id: string; fileId: string; targetKind: GuideAiSourceKind; targetId: string; targetVersion: number;
}
export interface GuideMaterialSelectionInput {
  id: string; expectedRevision: number; subjectId: string; termId?: string; guideType: 'partial' | 'quarter';
  title: string; topicsText: string; sources: GuideAiSourceRef[]; chosenFileIds: string[]; manualSections?: string[];
}
export interface GuideMaterialSelection extends Omit<GuideMaterialSelectionInput, 'expectedRevision'> {
  revision: number; updatedAt: number; transcriptions: GuideMaterialTranscriptionRef[]; unavailableSourceKeys: string[];
}
export interface GuideMaterialSelectionSummary {
  id: string; revision: number; title: string; subjectId: string; termId?: string; guideType: 'partial' | 'quarter';
  materialCount: number; updatedAt: number;
}
const kinds = ['assignment', 'work', 'activity', 'evidence', 'note', 'question', 'exam'];
const key = (ref: { kind: string; refId: string }) => `${ref.kind}:${ref.refId}`;
/** Composition may be incomplete; permissions are resolved again by the actor-bound store. */
export function validateGuideMaterialSelectionInput(value: unknown): GuideMaterialSelectionInput {
  if (!aiRecord(value) || !aiUuid(value.id) || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0 || !aiDecimalId(value.subjectId)
    || value.termId !== undefined && !aiDecimalId(value.termId) || !['partial', 'quarter'].includes(String(value.guideType))
    || value.guideType === 'quarter' && value.termId !== undefined || typeof value.title !== 'string' || value.title.length > 200
    || typeof value.topicsText !== 'string' || value.topicsText.length > 4840 || !Array.isArray(value.sources) || value.sources.length > 1000
    || !Array.isArray(value.chosenFileIds) || value.chosenFileIds.length > 10_000 || value.chosenFileIds.some((id) => typeof id !== 'string' || !id || id.length > 300)) throw new AiError('invalid', 'Revisa el alcance y los materiales del borrador.');
  const sources = value.sources.map((raw): GuideAiSourceRef => {
    if (!aiRecord(raw) || !kinds.includes(String(raw.kind)) || !(raw.kind === 'exam' ? aiUuid(raw.refId) : aiDecimalId(raw.refId))
      || !Array.isArray(raw.topics) || raw.topics.length > 40 || raw.topics.some((topic) => typeof topic !== 'string' || !topic.trim() || topic.length > 120)
      || typeof raw.includeUnplaced !== 'boolean' || raw.includeOutsideTerm !== undefined && typeof raw.includeOutsideTerm !== 'boolean'
      || raw.includeSolutions !== undefined && typeof raw.includeSolutions !== 'boolean'
      || raw.examVersion !== undefined && (!Number.isSafeInteger(raw.examVersion) || Number(raw.examVersion) < 1)
      || raw.kind === 'exam' && raw.examVersion === undefined) throw new AiError('invalid', 'Una referencia de material no es válida.');
    for (const name of ['transcriptionIds', 'evidenceIds']) if (raw[name] !== undefined && (!Array.isArray(raw[name]) || raw[name].length > 1000 || raw[name].some((id: unknown) => name === 'transcriptionIds' ? !aiUuid(id) : !aiDecimalId(id)))) throw new AiError('invalid', 'Revisa los archivos y evidencias elegidos.');
    if (raw.evidenceIds !== undefined && raw.kind !== 'activity') throw new AiError('invalid', 'Las evidencias deben pertenecer a una actividad.');
    return { kind: raw.kind as GuideAiSourceRef['kind'], refId: raw.kind === 'exam' ? String(raw.refId).toLowerCase() : String(raw.refId),
      topics: [...new Set(raw.topics as string[])], includeUnplaced: raw.includeUnplaced,
      ...(raw.includeOutsideTerm !== undefined ? { includeOutsideTerm: raw.includeOutsideTerm } : {}),
      ...(raw.examVersion !== undefined ? { examVersion: Number(raw.examVersion) } : {}), ...(raw.includeSolutions !== undefined ? { includeSolutions: raw.includeSolutions } : {}),
      ...(raw.transcriptionIds ? { transcriptionIds: [...new Set(raw.transcriptionIds as string[])] } : {}), ...(raw.evidenceIds ? { evidenceIds: [...new Set(raw.evidenceIds as string[])] } : {}) };
  });
  if (new Set(sources.map(key)).size !== sources.length) throw new AiError('invalid', 'Un material solo puede agregarse una vez.');
  if (value.manualSections !== undefined && (!Array.isArray(value.manualSections) || value.manualSections.length !== 8 || value.manualSections.some((section) => typeof section !== 'string' || section.length > 20_000))) throw new AiError('invalid', 'Revisa las ocho secciones de la guía manual.');
  return { id: value.id.toLowerCase(), expectedRevision: Number(value.expectedRevision), subjectId: value.subjectId,
    ...(value.termId ? { termId: value.termId as string } : {}), guideType: value.guideType as 'partial' | 'quarter',
    title: sanitizeAiText(value.title), topicsText: sanitizeAiText(value.topicsText), sources, chosenFileIds: [...new Set(value.chosenFileIds as string[])],
    ...(value.manualSections ? { manualSections: (value.manualSections as string[]).map(sanitizeAiText) } : {}) };
}
export function guideMaterialSelectionSummary(value: GuideMaterialSelection): GuideMaterialSelectionSummary {
  return { id: value.id, revision: value.revision, subjectId: value.subjectId, termId: value.termId, guideType: value.guideType,
    title: value.title, materialCount: value.sources.length, updatedAt: value.updatedAt };
}
