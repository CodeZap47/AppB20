import type { ChallengeDifficulty, ChallengeInput, ChallengeSolutionInput, ChallengeCommentInput, CodeReviewInput, CodeReviewVersionInput, CodeReviewCommentInput, CodeReviewCommentKind, CodeReviewResolution } from '../../../core/src/practice';
import type { Id, MaybePromise } from './types';
export type { ChallengeInput, ChallengeSolutionInput, ChallengeCommentInput, CodeReviewInput, CodeReviewVersionInput, CodeReviewCommentInput };
export interface CodingChallenge { id: Id; authorId: Id; requestId: string; subjectId: Id; title: string; topic: string; difficulty: ChallengeDifficulty; objective: string; instructions: string; examples: string; hintCount: number; closed: boolean; closure: string; version: number; createdAt: Date; updatedAt: Date; }
export interface ChallengeHint { challengeId: Id; number: number; body: string; }
export interface ChallengeProgress { challengeId: Id; unlockedHints: number; }
export interface ChallengeSolution { id: Id; challengeId: Id; authorId: Id; body: string; explanation: string; version: number; requestId: string; createdAt: Date; updatedAt: Date; }
export interface ChallengeComment { id: Id; challengeId: Id; solutionId?: Id; authorId: Id; body: string; requestId: string; createdAt: Date; }
export interface CodeReview { id: Id; authorId: Id; requestId: string; subjectId: Id; title: string; language: string; currentVersion: number; closed: boolean; version: number; createdAt: Date; updatedAt: Date; }
export interface CodeReviewVersion { reviewId: Id; number: number; code: string; repositoryUrl: string; summary: string; requestId: string; createdAt: Date; }
export interface CodeReviewComment { id: Id; reviewId: Id; versionNumber: number; lineStart: number; lineEnd: number; kind: CodeReviewCommentKind; authorId: Id; body: string; status: CodeReviewResolution; resolution: string; version: number; requestId: string; createdAt: Date; updatedAt: Date; }
export interface PracticeSnapshot { codingChallenges: CodingChallenge[]; challengeHints: ChallengeHint[]; challengeProgress: ChallengeProgress[]; challengeSolutions: ChallengeSolution[]; challengeComments: ChallengeComment[]; codeReviews: CodeReview[]; codeReviewVersions: CodeReviewVersion[]; codeReviewComments: CodeReviewComment[]; }
export interface PracticeActions {
  createCodingChallenge(input: ChallengeInput): MaybePromise<Id>;
  unlockChallengeHint(challengeId: Id, expectedUnlocked: number): MaybePromise<void>;
  saveChallengeSolution(input: ChallengeSolutionInput): MaybePromise<void>;
  addChallengeComment(input: ChallengeCommentInput): MaybePromise<void>;
  closeCodingChallenge(challengeId: Id, closure: string, expectedVersion: number): MaybePromise<void>;
  createCodeReview(input: CodeReviewInput): MaybePromise<Id>;
  addCodeReviewVersion(input: CodeReviewVersionInput): MaybePromise<void>;
  addCodeReviewComment(input: CodeReviewCommentInput): MaybePromise<void>;
  resolveCodeReviewComment(commentId: Id, status: CodeReviewResolution, resolution: string, expectedVersion: number): MaybePromise<void>;
  closeCodeReview(reviewId: Id, expectedVersion: number): MaybePromise<void>;
}
export const emptyPractice = (): PracticeSnapshot => ({ codingChallenges: [], challengeHints: [], challengeProgress: [], challengeSolutions: [], challengeComments: [], codeReviews: [], codeReviewVersions: [], codeReviewComments: [] });
