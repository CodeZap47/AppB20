import { computeContributionOrigins, type ContributionOriginInput } from '@b20/core';
import type { ResourceFile, Snapshot } from './types';

type ContributionState = Pick<Snapshot, 'notes' | 'guides' | 'works' | 'evidences' | 'answers' | 'workFiles'>;

/** Calcula primero sobre el estado grupal completo y luego retira referencias no legibles. */
export function buildDemoContributionOrigins(state: ContributionState, resources: ResourceFile[], visible: Snapshot) {
  const rows: ContributionOriginInput[] = [];
  const at = (date: Date) => BigInt(date.getTime()) * 1000n;
  const files = (kind: string, id: string) => resources.filter((file) => file.targetKind === kind && file.targetId === id && !file.removedAt)
    .map((file) => file.url || file.id);
  for (const note of state.notes) if (note.visibility === 'group') rows.push({ kind: 'apunte', refId: note.id, memberId: note.authorId,
    createdAt: at(note.createdAt), context: [note.subjectId, note.termId ?? ''], content: [note.title, note.body, note.topic], files: files('note', note.id) });
  for (const guide of state.guides) rows.push({ kind: 'guia', refId: guide.id, memberId: guide.createdBy,
    createdAt: at(guide.createdAt), context: [guide.subjectId, guide.termId ?? ''], content: [guide.title, guide.topics, guide.sections], files: files('guide', guide.id) });
  for (const work of state.works) if (work.status !== 'draft') {
    let attachments = files('work', work.id);
    if (!attachments.length) attachments = state.workFiles.filter((file) => file.workId === work.id).map((file) => file.url || file.id);
    for (const memberId of new Set(work.authorIds)) rows.push({ kind: 'trabajo', refId: work.id, memberId,
      createdAt: at(work.createdAt), context: [work.assignmentId], content: [work.title, work.description, work.topic ?? ''], files: attachments });
  }
  for (const evidence of state.evidences) for (const memberId of new Set([evidence.authorId, ...evidence.participantIds])) rows.push({
    kind: 'evidencia', refId: evidence.id, memberId, createdAt: at(evidence.createdAt), context: [evidence.activityId], content: [evidence.content], files: files('evidence', evidence.id) });
  // La regla es una respuesta por pregunta, con independencia de cómo se redacte.
  for (const answer of state.answers) rows.push({ kind: 'respuesta', refId: answer.id, memberId: answer.authorId,
    createdAt: at(answer.createdAt), context: [answer.questionId], content: ['respuesta'] });
  const visibleIds = {
    apunte: new Set(visible.notes.map((row) => row.id)), guia: new Set(visible.guides.map((row) => row.id)),
    trabajo: new Set(visible.works.map((row) => row.id)), evidencia: new Set(visible.evidences.map((row) => row.id)), respuesta: new Set(visible.answers.map((row) => row.id)),
  };
  return computeContributionOrigins(rows).filter((origin) => visibleIds[origin.kind].has(origin.refId))
    .map((origin) => ({ ...origin, creditedAt: new Date(Number(origin.creditedAt / 1000n)) }));
}
