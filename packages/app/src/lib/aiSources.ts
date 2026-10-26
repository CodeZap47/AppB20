import type { AiSourceKind } from '@b20/core';
import type { Snapshot } from '../data/types';

export type AiCandidateKind = AiSourceKind;
export const AI_SOURCE_LABELS: Record<AiCandidateKind, string> = {
  note: 'Nota de clase', assignment: 'Tarea', activity: 'Actividad de clase',
  work: 'Trabajo', evidence: 'Evidencia', guide: 'Guía de estudio', teaching: 'Tu explicación guardada', question: 'Pregunta y respuestas', spaced_card: 'Tarjeta de repaso', answer: 'Respuesta',
};

/** Presentation candidates only. The server resolves permissions and actual content again. */
export interface AiCandidate {
  kind: AiCandidateKind;
  refId: string;
  subjectId: string;
  termId?: string;
  title: string;
  topics: string[];
  personal: boolean;
  version: number;
  status?: string;
  /** In-memory invalidation token, never transmitted as an authoritative version. */
  revision: string;
  answers?: { id: string; text: string; accepted: boolean }[];
}
export const aiCandidateKey = (source: Pick<AiCandidate, 'kind' | 'refId'>) => `${source.kind}:${source.refId}`;

export function aiSourceCandidates(data: Snapshot, subjectId: string, termId?: string): AiCandidate[] {
  if (data.me?.status !== 'active') return [];
  const out: AiCandidate[] = [];
  const add = (candidate: Omit<AiCandidate, 'revision'>, content: unknown) => {
    if (candidate.subjectId !== subjectId || (termId && candidate.termId && candidate.termId !== termId)) return;
    out.push({ ...candidate, revision: JSON.stringify([candidate, content]) });
  };
  for (const note of data.notes) {
    if (note.withdrawnAt || (note.visibility === 'personal' && note.authorId !== data.me.id)) continue;
    add({ kind: 'note', refId: note.id, subjectId: note.subjectId, termId: note.termId, title: note.title,
      topics: note.topic ? [note.topic] : [], personal: note.visibility === 'personal', version: note.version }, note.body);
  }
  for (const assignment of data.assignments) {
    add({ kind: 'assignment', refId: assignment.id, subjectId: assignment.subjectId, termId: assignment.termId,
      title: assignment.title, topics: assignment.topic ? [assignment.topic] : [], personal: false, version: assignment.version }, assignment.instructions);
    for (const work of data.works.filter((entry) => entry.assignmentId === assignment.id && !entry.withdrawnAt)) {
      add({ kind: 'work', refId: work.id, subjectId: assignment.subjectId, termId: assignment.termId,
        title: work.title || assignment.title, topics: work.topic ? [work.topic] : assignment.topic ? [assignment.topic] : [],
        personal: false, version: work.version, status: work.status === 'reviewed' ? 'Revisado' : work.status === 'final' ? 'Final' : 'Borrador' }, [assignment, work.description]);
    }
  }
  for (const activity of data.activities) {
    add({ kind: 'activity', refId: activity.id, subjectId: activity.subjectId, termId: activity.termId,
      title: activity.title, topics: activity.topic ? [activity.topic] : [], personal: false, version: activity.version }, [activity.objective, activity.instructions]);
    for (const evidence of data.evidences.filter((entry) => entry.activityId === activity.id && !entry.withdrawnAt)) {
      add({ kind: 'evidence', refId: evidence.id, subjectId: activity.subjectId, termId: activity.termId,
        title: `Evidencia: ${activity.title}`, topics: activity.topic ? [activity.topic] : [], personal: false,
        version: evidence.version ?? 1 }, [activity, evidence.content]);
    }
  }
  for (const guide of data.guides) {
    if (guide.withdrawnAt) continue;
    add({ kind: 'guide', refId: guide.id, subjectId: guide.subjectId, termId: guide.termId,
      title: guide.title, topics: guide.topics, personal: false, version: guide.version }, [guide.sections, data.guideSources.filter((ref) => ref.guideId === guide.id)]);
  }
  for (const question of data.questions) {
    if (question.withdrawnAt) continue;
    const answers = data.answers.filter((answer) => answer.questionId === question.id && !answer.withdrawnAt);
    add({ kind: 'question', refId: question.id, subjectId: question.subjectId, title: question.title, topics: question.topic ? [question.topic] : [], personal: false, version: question.version ?? 1,
      answers: answers.map((answer) => ({ id: answer.id, text: answer.body, accepted: answer.id === question.acceptedAnswerId })) }, [question, answers]);
  }
  for (const card of data.spacedCards) {
    const collection = data.spacedCollections.find((entry) => entry.id === card.collectionId);
    if (card.archived || !collection || collection.archived || (collection.visibility !== 'group' && collection.ownerId !== data.me.id)) continue;
    const original = card.sourceKind === 'note' ? data.notes.find((entry) => entry.id === card.sourceId) : data.guides.find((entry) => entry.id === card.sourceId);
    if (card.sourceKind !== 'exam_question' && (!original || original.withdrawnAt)) continue;
    add({ kind: 'spaced_card', refId: card.id, subjectId: collection.subjectId, termId: collection.termId, title: card.question, topics: [], personal: collection.visibility === 'personal', version: card.version }, [card.question,card.explanation,card.hint,card.version,collection.version,original?.version]);
  }
  for (const practice of data.teachingPractices) {
    if (practice.ownerId !== data.me.id || !practice.initial.concept.trim() || !practice.initial.example.trim() || !practice.initial.limits.trim()) continue;
    add({ kind: 'teaching', refId: practice.id, subjectId: practice.subjectId, title: practice.topic, topics: [practice.topic], personal: true, version: practice.version ?? 1 }, [practice.initial,practice.revised]);
  }
  return out;
}
