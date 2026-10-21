import type { DbConnection } from '../module_bindings';
import type { Member } from './types';
import { emptyPractice, type PracticeSnapshot } from './practiceTypes';
import type { ChallengeDifficulty, CodeReviewCommentKind, CodeReviewResolution } from '../../../core/src/practice';
export const PRACTICE_VIEWS = ['coding_challenges', 'challenge_hints', 'my_challenge_progress', 'challenge_solutions', 'challenge_comments', 'code_reviews', 'code_review_versions', 'code_review_comments'] as const;
const rows = <T,>(table: { iter(): Iterable<T> } | undefined): T[] => table ? [...table.iter()] : [];
export function readPracticeSnapshot(connection: Pick<DbConnection, 'db'>, identity: string, members: Member[]): PracticeSnapshot {
  if (!members.some((member) => member.id === identity && member.status === 'active')) return emptyPractice();
  const db = connection.db; const challenges = rows(db.codingChallenges); const challengeIds = new Set(challenges.map((row) => row.id)); const reviews = rows(db.codeReviews); const reviewIds = new Set(reviews.map((row) => row.id));
  const progress = rows(db.myChallengeProgress).filter((row) => row.memberId.toHexString() === identity && challengeIds.has(row.challengeId));
  return {
    codingChallenges: challenges.map((row) => ({ id: row.id.toString(), authorId: row.author.toHexString(), requestId: row.requestId, subjectId: row.subjectId.toString(), title: row.title, topic: row.topic, difficulty: row.difficulty as ChallengeDifficulty, objective: row.objective, instructions: row.instructions, examples: row.examples, hintCount: row.hintCount, closed: row.closed, closure: row.closure, version: row.version, createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate() })),
    challengeHints: rows(db.challengeHints).filter((row) => challengeIds.has(row.challengeId) && (challenges.find((challenge) => challenge.id === row.challengeId)?.author.toHexString() === identity || row.number <= (progress.find((entry) => entry.challengeId === row.challengeId)?.unlockedHints ?? 0))).map((row) => ({ challengeId: row.challengeId.toString(), number: row.number, body: row.body })),
    challengeProgress: progress.map((row) => ({ challengeId: row.challengeId.toString(), unlockedHints: row.unlockedHints })),
    challengeSolutions: rows(db.challengeSolutions).filter((row) => challengeIds.has(row.challengeId)).map((row) => ({ id: row.id.toString(), challengeId: row.challengeId.toString(), authorId: row.author.toHexString(), body: row.body, explanation: row.explanation, version: row.version, requestId: row.requestId, createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate() })),
    challengeComments: rows(db.challengeComments).filter((row) => challengeIds.has(row.challengeId)).map((row) => ({ id: row.id.toString(), challengeId: row.challengeId.toString(), solutionId: row.solutionId?.toString(), authorId: row.author.toHexString(), body: row.body, requestId: row.requestId, createdAt: row.createdAt.toDate() })),
    codeReviews: reviews.map((row) => ({ id: row.id.toString(), authorId: row.author.toHexString(), subjectId: row.subjectId.toString(), title: row.title, language: row.language, requestId: row.requestId, currentVersion: row.currentVersion, closed: row.closed, version: row.version, createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate() })),
    codeReviewVersions: rows(db.codeReviewVersions).filter((row) => reviewIds.has(row.reviewId)).map((row) => ({ reviewId: row.reviewId.toString(), number: row.number, code: row.code, repositoryUrl: row.repositoryUrl, summary: row.summary, requestId: row.requestId, createdAt: row.createdAt.toDate() })),
    codeReviewComments: rows(db.codeReviewComments).filter((row) => reviewIds.has(row.reviewId)).map((row) => ({ id: row.id.toString(), reviewId: row.reviewId.toString(), versionNumber: row.versionNumber, lineStart: row.lineStart, lineEnd: row.lineEnd, kind: row.kind as CodeReviewCommentKind, authorId: row.author.toHexString(), body: row.body, status: row.status as CodeReviewResolution, resolution: row.resolution, version: row.version, requestId: row.requestId, createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate() })),
  };
}
