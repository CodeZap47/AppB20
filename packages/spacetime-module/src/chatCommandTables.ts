import { table, t } from 'spacetimedb/server';

/** Additive metadata: existing chat_command rows keep their IDs and private defaults. */
export const chatCommandDetail = table({ name: 'chat_command_detail' }, {
  commandId: t.u64().primaryKey(),
  shared: t.bool(),
  actionKind: t.string(),
  resourceKind: t.string().optional(),
  version: t.u32(),
  updatedAt: t.timestamp(),
});
