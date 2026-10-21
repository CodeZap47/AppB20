import { aiSourceCandidates } from './aiSources';
import type { Snapshot, ResourceFile } from '../data/types';

export type GuideAiCandidateKind = 'assignment' | 'activity' | 'work' | 'evidence' | 'note' | 'question';
export const GUIDE_AI_SOURCE_LABELS: Record<GuideAiCandidateKind, string> = {
  assignment: 'Consigna de tarea', activity: 'Actividad', work: 'Trabajo', evidence: 'Evidencia seleccionada',
  note: 'Nota compartida', question: 'Pregunta y respuestas públicas',
};
export interface GuideAiCandidate {
  kind: GuideAiCandidateKind; refId: string; subjectId: string; termId?: string;
  title: string; topics: string[]; version: number; revision: string; parentId?: string;
}
export const guideAiCandidateKey = (source: { kind: string; refId: string }) => `${source.kind}:${source.refId}`;

/** Only shared records enter this picker. The server checks access and versions again. */
export function guideAiCandidates(data: Snapshot, subjectId: string, termId?: string): GuideAiCandidate[] {
  if (data.me?.status !== 'active') return [];
  const candidates: GuideAiCandidate[] = aiSourceCandidates(data, subjectId, termId)
    .filter((source) => source.kind !== 'guide' && !source.personal)
    .map((source) => ({ kind: source.kind as GuideAiCandidateKind, refId: source.refId,
      subjectId: source.subjectId, termId: source.termId, title: source.title,
      topics: source.topics, version: source.version, revision: source.revision,
      ...(source.kind === 'evidence' ? { parentId: data.evidences.find((row) => row.id === source.refId)?.activityId } : {}) }));
  for (const question of data.questions) {
    if (question.withdrawnAt || question.subjectId !== subjectId) continue;
    const answers = data.answers.filter((row) => row.questionId === question.id && !row.withdrawnAt);
    candidates.push({ kind: 'question', refId: question.id, subjectId: question.subjectId,
      title: question.title, topics: question.topic ? [question.topic] : [], version: question.version ?? 1,
      revision: JSON.stringify([question, answers]) });
  }
  return candidates;
}

/** Selection never follows external links and never adds evidence implicitly. */
export function guideAiAttachments(data: Snapshot, candidate: GuideAiCandidate): ResourceFile[] {
  return data.resourceFiles.filter((file) => !file.removedAt && file.targetKind === candidate.kind && file.targetId === candidate.refId);
}
