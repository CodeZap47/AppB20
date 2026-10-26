import { t, table } from 'spacetimedb/server';

/** Un resultado por elemento permite reanudar lotes sin repetir retiradas. */
export const adminContentResult = table({ name: 'admin_content_result' }, {
  key: t.string().primaryKey(), operationId: t.string().index('btree'), actor: t.identity(),
  kind: t.string(), targetId: t.u64(), expectedVersion: t.u32(), withdrawn: t.bool(),
  reason: t.string(), acknowledgeImpact: t.bool(), expectedImpact: t.string().optional(), status: t.string(), error: t.string(), version: t.u32(), completedAt: t.timestamp(),
});
export const adminContentEntryType = t.object('AdminContentEntry', {
  kind: t.string(), targetId: t.u64(), owners: t.array(t.identity()), title: t.string(), version: t.u32(),
  withdrawn: t.bool(), collaborative: t.bool(), foreignDependencies: t.u32(), sharedFiles: t.u32(), reportReferences: t.u32(), safeForBulk: t.bool(),
});
export const adminContentTables = { adminContentResult };
