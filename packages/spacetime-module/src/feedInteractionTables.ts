import { t, table } from 'spacetimedb/server';

/** Threads only for resources without an existing public conversation. All tables stay private. */
export const feedThreadComment = table({ name: 'feed_thread_comment' }, {
  id: t.u64().primaryKey().autoInc(), target: t.string().index('btree'), author: t.identity(),
  text: t.string(), createdAt: t.timestamp(),
});
/** Durable receipt survives deleting a comment, so retrying cannot recreate it. */
export const feedThreadReceipt = table({ name: 'feed_thread_receipt' }, {
  key: t.string().primaryKey(), target: t.string().index('btree'), actor: t.identity(),
  requestHash: t.string(), commentId: t.string(), createdAt: t.timestamp(),
});
export const feedShare = table({ name: 'feed_share' }, {
  id: t.u64().primaryKey().autoInc(), tokenHash: t.string().unique(), target: t.string().index('btree'),
  targetKind: t.string(), targetId: t.string(), createdBy: t.identity().index('btree'), createdAt: t.timestamp(),
  revokedAt: t.timestamp().optional(), invalidatedAt: t.timestamp().optional(),
});
/** Dedicated server-to-server projection identity; never a member or another technical service. */
export const feedShareServiceConfig = table({ name: 'feed_share_service_config' }, {
  id: t.u8().primaryKey(), identity: t.identity(), enabled: t.bool(),
});
export const feedInteractionTables = { feedThreadComment, feedThreadReceipt, feedShare, feedShareServiceConfig };
