import { t, table } from 'spacetimedb/server';

/** Plazos y estado sin títulos, cuerpos, nombres ni identidades. */
export const contentRetention = table({ name: 'content_retention' }, {
  key: t.string().primaryKey(), kind: t.string(), targetId: t.u64(), generation: t.u32(),
  withdrawnAt: t.timestamp(), expiresAt: t.timestamp(), state: t.string(), purgedAt: t.timestamp().optional(),
});
export const retentionAudit = table({ name: 'retention_audit' }, {
  id: t.u64().primaryKey().autoInc(), key: t.string().index('btree'), generation: t.u32(),
  action: t.string(), actorRole: t.string(), at: t.timestamp(),
});
/** Hashes internos: una copia futura nunca recupera los puntos de un original purgado. */
export const contributionTombstone = table({ name: 'contribution_tombstone' }, {
  fingerprint: t.string().primaryKey(), kind: t.string(), canonicalId: t.u64(), creditedAt: t.timestamp(),
});
export const maintenanceService = table({ name: 'maintenance_service' }, {
  id: t.u32().primaryKey(), identity: t.identity(),
});
export const trashTables = { contentRetention, retentionAudit, contributionTombstone, maintenanceService };
