import { t, table } from 'spacetimedb/server';
/** Una reacción por persona y contenido; `target` = `tipo:id` para buscar todas las de un contenido. */
export const feedReaction = table({ name: 'feed_reaction' }, {
  key: t.string().primaryKey(), target: t.string().index('btree'), targetKind: t.string(), targetId: t.u64(),
  member: t.identity().index('btree'), emoji: t.string(), updatedAt: t.timestamp(),
});
export const feedPost = table({ name: 'feed_post' }, {
  id: t.u64().primaryKey().autoInc(), author: t.identity().index('btree'), text: t.string(), subjectId: t.u64().optional(),
  requestId: t.string(), createdAt: t.timestamp(), editedAt: t.timestamp().optional(),
  deletedAt: t.timestamp().optional(), deletedBy: t.identity().optional(),
});
export const feedComment = table({ name: 'feed_comment' }, {
  id: t.u64().primaryKey().autoInc(), postId: t.u64().index('btree'), author: t.identity().index('btree'), text: t.string(),
  requestId: t.string(), createdAt: t.timestamp(), deletedAt: t.timestamp().optional(), deletedBy: t.identity().optional(),
});
export const feedTables = { feedReaction, feedPost, feedComment };
