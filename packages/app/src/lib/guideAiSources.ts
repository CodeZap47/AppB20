import { aiSourceCandidates } from './aiSources';
import type { Snapshot, ResourceFile } from '../data/types';

export type GuideAiCandidateKind = 'assignment' | 'activity' | 'work' | 'evidence' | 'note' | 'question' | 'exam';
export const GUIDE_AI_SOURCE_LABELS: Record<GuideAiCandidateKind, string> = {
  assignment: 'Consigna', activity: 'Actividad', work: 'Trabajo entregado', evidence: 'Evidencia',
  note: 'Nota de clase', question: 'Pregunta y respuestas públicas', exam: 'Examen de estudio',
};
export type GuideAiMaterialModule = 'tasks' | 'activities' | 'notes' | 'exams' | 'questions';
export const GUIDE_AI_MODULE_LABELS: Record<GuideAiMaterialModule, string> = { tasks: 'Tareas', activities: 'Actividades', notes: 'Notas', exams: 'Exámenes', questions: 'Preguntas del grupo' };
export const GUIDE_MATERIAL_PRIMARY_TYPES: GuideAiMaterialModule[] = ['notes', 'tasks', 'activities', 'exams'];
export interface GuideExamMaterialLike {
  id: string; title: string; subjectId: string; termId?: string; version: number; topics: string[];
  ownerId: string; visibility: 'group' | 'personal'; canIncludeSolutions: boolean;
}
export interface GuideAiCandidate {
  kind: GuideAiCandidateKind; refId: string; subjectId: string; termId?: string;
  title: string; topics: string[]; version: number; revision: string; parentId?: string;
  authorIds?: string[]; module?: GuideAiMaterialModule; visibility?: 'group' | 'personal'; canIncludeSolutions?: boolean;
}
export const guideAiCandidateKey = (source: { kind: string; refId: string }) => `${source.kind}:${source.refId}`;
const assignmentModule = (kind: string | undefined): GuideAiMaterialModule => kind === 'examen' ? 'exams' : kind === 'actividad' || kind === 'exposicion' ? 'activities' : 'tasks';

/** Discovery includes every partial of this subject; the picker owns its filters. The server revalidates every selected source. */
export function guideAiCandidates(data: Snapshot, subjectId: string, _termId?: string, exams: readonly GuideExamMaterialLike[] = [], authorizedExamProjections = false): GuideAiCandidate[] {
  if (data.me?.status !== 'active') return [];
  const candidates: GuideAiCandidate[] = aiSourceCandidates(data, subjectId)
    .filter((source) => ['note', 'assignment', 'activity', 'work', 'evidence'].includes(source.kind))
    .map((source) => ({ kind: source.kind as GuideAiCandidateKind, refId: source.refId,
      subjectId: source.subjectId, termId: source.termId, title: source.title,
      topics: source.topics, version: source.version, revision: source.revision, visibility: source.personal ? 'personal' : 'group',
      ...(source.kind === 'evidence' ? { parentId: data.evidences.find((row) => row.id === source.refId)?.activityId } : {}) }));
  for (const question of data.questions) {
    if (question.withdrawnAt || question.subjectId !== subjectId) continue;
    const answers = data.answers.filter((row) => row.questionId === question.id && !row.withdrawnAt);
    candidates.push({ kind: 'question', refId: question.id, subjectId: question.subjectId,
      title: question.title, topics: question.topic ? [question.topic] : [], version: question.version ?? 1,
      revision: JSON.stringify([question, answers]), authorIds: [question.authorId], module: 'questions', visibility: 'group' });
  }
  const local = candidates.map((candidate): GuideAiCandidate => {
    if (candidate.kind === 'question') return candidate;
    const work = candidate.kind === 'work' ? data.works.find((row) => row.id === candidate.refId) : undefined;
    const assignment = candidate.kind === 'assignment' ? data.assignments.find((row) => row.id === candidate.refId)
      : work ? data.assignments.find((row) => row.id === work.assignmentId) : undefined;
    const authorIds = candidate.kind === 'note' ? [data.notes.find((row) => row.id === candidate.refId)?.authorId]
      : work ? work.authorIds
      : candidate.kind === 'evidence' ? (() => { const evidence = data.evidences.find((row) => row.id === candidate.refId); return evidence ? [evidence.authorId, ...evidence.participantIds] : []; })()
      : assignment ? [assignment.createdBy] : [data.activities.find((row) => row.id === candidate.refId)?.createdBy];
    return { ...candidate, authorIds: [...new Set(authorIds.filter((id): id is string => Boolean(id)))], module: candidate.kind === 'note' ? 'notes' : assignment ? assignmentModule(assignment.kind) : 'activities' };
  });
  return [...local, ...exams.filter((exam) => exam.subjectId === subjectId && (exam.visibility === 'group' || exam.ownerId === data.me!.id || authorizedExamProjections)).map((exam): GuideAiCandidate => ({
    kind: 'exam', refId: exam.id, subjectId: exam.subjectId, termId: exam.termId, title: exam.title, topics: exam.topics,
    version: exam.version, revision: JSON.stringify(exam), authorIds: [exam.ownerId], module: 'exams', visibility: exam.visibility, canIncludeSolutions: exam.canIncludeSolutions,
  }))];
}

/** Accessible text only. Examinations use the separate authorized on-demand projection. */
export function guideAiCandidateText(data: Snapshot, candidate: GuideAiCandidate): string {
  switch (candidate.kind) {
    case 'note': return data.notes.find((row) => row.id === candidate.refId && (row.visibility !== 'personal' || row.authorId === data.me?.id))?.body ?? '';
    case 'assignment': return data.assignments.find((row) => row.id === candidate.refId)?.instructions ?? '';
    case 'work': return data.works.find((row) => row.id === candidate.refId)?.description ?? '';
    case 'activity': { const row = data.activities.find((entry) => entry.id === candidate.refId); return row ? [row.objective, row.instructions].filter(Boolean).join('\n\n') : ''; }
    case 'evidence': return data.evidences.find((row) => row.id === candidate.refId)?.content ?? '';
    case 'question': return [data.questions.find((row) => row.id === candidate.refId)?.body ?? '', ...data.answers.filter((row) => row.questionId === candidate.refId && !row.withdrawnAt).map((row) => row.body)].filter(Boolean).join('\n\n');
    case 'exam': return '';
  }
}
export function guideAiAttachments(data: Snapshot, candidate: GuideAiCandidate): ResourceFile[] {
  return data.resourceFiles.filter((file) => !file.removedAt && file.targetKind === candidate.kind && file.targetId === candidate.refId);
}

export interface GuideMaterialFilters {
  origin: 'all' | 'own' | 'peers'; personIds: string[]; types: GuideAiMaterialModule[];
  allTerms: boolean; termIds: string[]; search: string; privacy: 'all' | 'group' | 'personal';
}
export const GUIDE_UNPLACED_TERM = '__unplaced';
export function filterGuideMaterials(candidates: readonly GuideAiCandidate[], filters: GuideMaterialFilters, data: Snapshot): GuideAiCandidate[] {
  const query = filters.search.trim().toLocaleLowerCase('es');
  return candidates.filter((candidate) => {
    const authors = candidate.authorIds ?? [];
    if (filters.origin === 'own' && !authors.includes(data.me?.id ?? '')) return false;
    if (filters.origin === 'peers' && !authors.some((id) => id !== data.me?.id)) return false;
    if (filters.personIds.length && !authors.some((id) => filters.personIds.includes(id))) return false;
    if (!filters.types.includes(candidate.module ?? 'tasks')) return false;
    if (!filters.allTerms && !filters.termIds.includes(candidate.termId ?? GUIDE_UNPLACED_TERM)) return false;
    if (filters.privacy !== 'all' && (candidate.visibility ?? 'group') !== filters.privacy) return false;
    if (query && ![candidate.title, ...candidate.topics, ...authors.map((id) => data.members.find((member) => member.id === id)?.displayName ?? ''), ...guideAiAttachments(data, candidate).map((file) => file.name)].join(' ').toLocaleLowerCase('es').includes(query)) return false;
    return true;
  });
}
