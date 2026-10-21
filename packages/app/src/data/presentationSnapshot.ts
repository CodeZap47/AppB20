import type { DbConnection } from '../module_bindings';
import type { Member } from './types';
import type { PresentationAttempt, PresentationPractice, PresentationsSnapshot } from './presentationTypes';
export const PRESENTATION_VIEWS = ['presentation_practices', 'presentation_attempts', 'my_presentation_personal', 'presentation_questions', 'presentation_feedback'] as const;
const rows = <T,>(table: { iter(): Iterable<T> } | undefined): T[] => table ? [...table.iter()] : [];
const checked = <const T extends readonly string[]>(value: string, allowed: T): T[number] => {
  if (!allowed.includes(value)) throw new Error('Las exposiciones requieren una actualización de B20.');
  return value;
};
/** Revalida el contenido de la caché al cambiar de revisor, dar bajas o archivar. */
export function readPresentationsSnapshot(connection: Pick<DbConnection, 'db'>, identity: string, members: Member[]): PresentationsSnapshot {
  const db = connection.db; const active = new Set(members.filter((member) => member.status === 'active').map((member) => member.id));
  const practices = rows(db.presentationPractices).filter((row) => active.has(row.ownerId.toHexString()) &&
    (row.ownerId.toHexString() === identity || (row.reviewerId?.toHexString() === identity && !row.archived)));
  const practiceMap = new Map(practices.map((row) => [row.id, row]));
  const attempts = rows(db.presentationAttempts).filter((row) => {
    const parent = practiceMap.get(row.practiceId);
    return parent && (parent.ownerId.toHexString() === identity || row.status === 'completed');
  });
  const visiblePractices = practices.filter((row) => row.ownerId.toHexString() === identity || attempts.some((attempt) => attempt.practiceId === row.id));
  const ownPracticeIds = new Set(visiblePractices.filter((row) => row.ownerId.toHexString() === identity).map((row) => row.id));
  const ownAttempts = new Set(attempts.filter((row) => ownPracticeIds.has(row.practiceId)).map((row) => row.id));
  const attemptIds = new Set(attempts.map((row) => row.id));
  const readableSource = (subjectId: bigint, kind?: string, id?: bigint) => kind === 'note'
    ? rows(db.notes).some((row) => row.id === id && row.subjectId === subjectId && (row.visibility === 'group' || row.author.toHexString() === identity))
    : kind === 'guide' && rows(db.studyGuides).some((row) => row.id === id && row.subjectId === subjectId);
  const source = (row: { subjectId: bigint; sourceKind?: string; sourceId?: bigint; sourceVersion?: number }, own: boolean) =>
    own || readableSource(row.subjectId, row.sourceKind, row.sourceId) ? {
      sourceKind: row.sourceKind ? checked(row.sourceKind, ['note', 'guide']) : undefined,
      sourceId: row.sourceId?.toString(), sourceVersion: row.sourceVersion,
    } : {};
  const config = (row: { title: string; topic: string; audience: string; targetMinutes: number; keyPoints: string[] }) => ({
    title: row.title, topic: row.topic, audience: row.audience, targetMinutes: row.targetMinutes, keyPoints: [...row.keyPoints],
  });
  return {
    presentationPractices: visiblePractices.map((row): PresentationPractice => {
      const own = row.ownerId.toHexString() === identity;
      const completed = own ? row : attempts.filter((attempt) => attempt.practiceId === row.id && attempt.status === 'completed').sort((a, b) => b.number - a.number)[0]!;
      return { id: row.id.toString(), ownerId: row.ownerId.toHexString(), reviewerId: row.reviewerId?.toHexString(), subjectId: completed.subjectId.toString(), termId: completed.termId?.toString(),
        ...config(completed), ...source(completed, own), archived: row.archived, version: row.version,
        createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate() };
    }),
    presentationAttempts: attempts.map((row): PresentationAttempt => ({ id: row.id.toString(), practiceId: row.practiceId.toString(), subjectId: row.subjectId.toString(), termId: row.termId?.toString(), number: row.number,
      status: checked(row.status, ['draft', 'completed']), body: row.body, ...config(row), ...source(row, ownAttempts.has(row.id)), version: row.version,
      createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate(), completedAt: row.completedAt?.toDate(),
    })),
    presentationPersonal: rows(db.myPresentationPersonal).filter((row) => ownAttempts.has(row.attemptId)).map((row) => ({ attemptId: row.attemptId.toString(),
      clarity: row.clarity, examples: row.examples, decisions: row.decisions, limitations: row.limitations, nextSteps: row.nextSteps })),
    presentationQuestions: rows(db.presentationQuestions).filter((row) => attemptIds.has(row.attemptId)).map((row) => ({ id: row.id.toString(), attemptId: row.attemptId.toString(),
      authorId: row.authorId.toHexString(), kind: checked(row.kind, ['guided', 'personal', 'peer']), text: row.text, answer: row.answer, version: row.version,
      createdAt: row.createdAt.toDate(), answeredAt: row.answeredAt?.toDate() })),
    presentationFeedback: rows(db.presentationFeedback).filter((row) => ownAttempts.has(row.attemptId) || (attemptIds.has(row.attemptId) && row.authorId.toHexString() === identity)).map((row) => ({
      id: row.id.toString(), attemptId: row.attemptId.toString(), authorId: row.authorId.toHexString(), clarity: row.clarity, examples: row.examples,
      decisions: row.decisions, limitations: row.limitations, comment: row.comment, version: row.version,
      createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate(),
    })),
  };
}
