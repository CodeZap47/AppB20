import type { DbConnection } from '../module_bindings';
import type { FeedActions } from './feedTypes';
type Connection = { reducers: Pick<DbConnection['reducers'], keyof FeedActions> };
export function createFeedActions(getConnection: () => Connection): FeedActions {
  return {
    toggleFeedReaction: (input) => getConnection().reducers.toggleFeedReaction({ ...input, targetId: BigInt(input.targetId) }),
    createFeedPost: (input) => getConnection().reducers.createFeedPost({ ...input, subjectId: input.subjectId ? BigInt(input.subjectId) : undefined }),
    editFeedPost: (input) => getConnection().reducers.editFeedPost({ ...input, postId: BigInt(input.postId) }),
    deleteFeedPost: (input) => getConnection().reducers.deleteFeedPost({ postId: BigInt(input.postId) }),
    commentFeedPost: (input) => getConnection().reducers.commentFeedPost({ ...input, postId: BigInt(input.postId) }),
    deleteFeedComment: (input) => getConnection().reducers.deleteFeedComment({ commentId: BigInt(input.commentId) }),
  };
}
