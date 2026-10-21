import type { DbConnection } from '../module_bindings';
import type { PracticeActions } from './practiceTypes';
export function createPracticeActions(getConnection: () => DbConnection, identity: () => string): PracticeActions {
  let queue = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> { const result = queue.then(fn); queue = result.then(() => {}, () => {}); return result; }
  const payload = (value: unknown) => ({ payload: JSON.stringify(value) });
  return {
    createCodingChallenge: (input) => serial(async () => { const c = getConnection(); const owner = identity(); await c.reducers.practiceCreateChallenge(payload(input)); const row = [...c.db.codingChallenges.iter()].find((entry) => entry.author.toHexString() === owner && entry.requestId === input.requestId.trim()); if (!row) throw new Error('El reto se guardó. Actualiza y reintenta el mismo envío.'); return row.id.toString(); }),
    unlockChallengeHint: (challengeId, expectedUnlocked) => getConnection().reducers.practiceUnlockHint(payload({ challengeId, expectedUnlocked })),
    saveChallengeSolution: (input) => getConnection().reducers.practiceSaveSolution(payload(input)),
    addChallengeComment: (input) => getConnection().reducers.practiceAddChallengeComment(payload(input)),
    closeCodingChallenge: (challengeId, closure, expectedVersion) => getConnection().reducers.practiceCloseChallenge(payload({ challengeId, closure, expectedVersion })),
    createCodeReview: (input) => serial(async () => { const c = getConnection(); const owner = identity(); await c.reducers.practiceCreateCodeReview(payload(input)); const row = [...c.db.codeReviews.iter()].find((entry) => entry.author.toHexString() === owner && entry.requestId === input.requestId.trim()); if (!row) throw new Error('La revisión se guardó. Actualiza y reintenta el mismo envío.'); return row.id.toString(); }),
    addCodeReviewVersion: (input) => getConnection().reducers.practiceAddCodeVersion(payload(input)),
    addCodeReviewComment: (input) => getConnection().reducers.practiceAddCodeComment(payload(input)),
    resolveCodeReviewComment: (commentId, status, resolution, expectedVersion) => getConnection().reducers.practiceResolveCodeComment(payload({ commentId, status, resolution, expectedVersion })),
    closeCodeReview: (reviewId, expectedVersion) => getConnection().reducers.practiceCloseCodeReview(payload({ reviewId, expectedVersion })),
  };
}
