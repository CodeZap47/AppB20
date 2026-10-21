import { Identity } from 'spacetimedb';
import type { DbConnection } from '../module_bindings';
import type { PresentationActions } from './presentationTypes';

const id = (value: string) => BigInt(value);
const optionalId = (value?: string) => value ? id(value) : undefined;
/** Identifica el resultado mediante el envío estable; un reintento nunca depende de filas nuevas. */
export function createPresentationActions(getConnection: () => DbConnection, identity: () => string): PresentationActions {
  let queue = Promise.resolve();
  const serial = <T,>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task); queue = result.then(() => {}, () => {}); return result;
  };
  const missing = () => new Error('El cambio se guardó, pero aún no llegó a la lista. Vuelve a conectar y reintenta el mismo envío.');
  return {
    savePresentationPractice: (input) => serial(async () => {
      const connection = getConnection(); const author = identity();
      await connection.reducers.savePresentationPractice({ practiceId: optionalId(input.id), subjectId: id(input.subjectId), termId: optionalId(input.termId),
        title: input.title, topic: input.topic, audience: input.audience, targetMinutes: input.targetMinutes, keyPoints: input.keyPoints,
        sourceKind: input.source?.kind, sourceId: optionalId(input.source?.id), expectedVersion: input.expectedVersion, requestId: input.requestId });
      if (input.id) return input.id;
      const found = [...connection.db.presentationPractices.iter()].filter((row) => row.ownerId.toHexString() === author && row.requestId === input.requestId.trim());
      if (found.length !== 1) throw missing(); return found[0]!.id.toString();
    }),
    setPresentationReviewer: (practiceId, reviewerId, expectedVersion) => getConnection().reducers.setPresentationReviewer({
      practiceId: id(practiceId), reviewerId: reviewerId ? Identity.fromString(reviewerId) : undefined, expectedVersion }),
    archivePresentationPractice: (practiceId, archived, expectedVersion) => getConnection().reducers.archivePresentationPractice({ practiceId: id(practiceId), archived, expectedVersion }),
    createPresentationAttempt: (practiceId, requestId, expectedVersion) => serial(async () => {
      const connection = getConnection();
      await connection.reducers.createPresentationAttempt({ practiceId: id(practiceId), requestId, expectedVersion });
      const found = [...connection.db.presentationAttempts.iter()].filter((row) => row.practiceId === id(practiceId) && row.requestId === requestId.trim());
      if (found.length !== 1) throw missing(); return found[0]!.id.toString();
    }),
    savePresentationAttempt: (attemptId, input, expectedVersion) => getConnection().reducers.savePresentationAttempt({ attemptId: id(attemptId), ...input, expectedVersion }),
    completePresentationAttempt: (attemptId, expectedVersion) => getConnection().reducers.completePresentationAttempt({ attemptId: id(attemptId), expectedVersion }),
    askPresentationQuestion: (attemptId, text, requestId) => serial(async () => {
      const connection = getConnection(); const author = identity();
      await connection.reducers.askPresentationQuestion({ attemptId: id(attemptId), text, requestId });
      const found = [...connection.db.presentationQuestions.iter()].filter((row) => row.attemptId === id(attemptId) && row.authorId.toHexString() === author && row.requestId === requestId.trim());
      if (found.length !== 1) throw missing(); return found[0]!.id.toString();
    }),
    answerPresentationQuestion: (questionId, answer, expectedVersion) => getConnection().reducers.answerPresentationQuestion({ questionId: id(questionId), answer, expectedVersion }),
    savePresentationFeedback: (attemptId, input, expectedVersion) => getConnection().reducers.savePresentationFeedback({ attemptId: id(attemptId), ...input, expectedVersion }),
  };
}
