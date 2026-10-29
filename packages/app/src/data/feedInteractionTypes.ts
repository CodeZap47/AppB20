import type { FeedResourceRef, FeedShareLink, FeedShareRecord, FeedThread } from '@b20/core';
import type { MaybePromise, Snapshot } from './types';

export interface FeedInteractionActions {
  readFeedThread(target: FeedResourceRef): MaybePromise<FeedThread>;
  addFeedThreadComment(target: FeedResourceRef, text: string, requestId: string): MaybePromise<FeedThread>;
  deleteFeedThreadComment(target: FeedResourceRef, commentId: string): MaybePromise<FeedThread>;
  createFeedShare(target: FeedResourceRef): Promise<FeedShareLink>;
  listFeedShares(target: FeedResourceRef): Promise<FeedShareRecord[]>;
  revokeFeedShare(id: string): Promise<void>;
}

/** Los hilos nativos ya llegan en la suscripción; los demás se leen al abrirlos. */
export function feedThreadCommentCount(target: FeedResourceRef, snapshot: Snapshot): number | undefined {
  switch (target.kind) {
    case 'post': return snapshot.feedComments.filter((row) => row.postId === target.id).length;
    case 'note': return snapshot.noteComments.filter((row) => row.noteId === target.id).length;
    case 'work': case 'evidence': return snapshot.academicComments.filter((row) => row.targetKind === target.kind && row.targetId === target.id).length;
    case 'question': return snapshot.questionComments.filter((row) => row.questionId === target.id && !row.answerId).length;
    case 'answer': return snapshot.questionComments.filter((row) => row.answerId === target.id).length;
    case 'challenge': return snapshot.challengeComments.filter((row) => row.challengeId === target.id && !row.solutionId).length;
    case 'solution': return snapshot.challengeComments.filter((row) => row.solutionId === target.id).length;
    default: return undefined;
  }
}
