import { table, t } from 'spacetimedb/server';
/** Enlaces de invitación. Solo se guarda el hash SHA-256 del código: la base no permite reconstruir el enlace. */
export const inviteLink = table({ name: 'invite_link' }, {
  id: t.u64().primaryKey().autoInc(), tokenHash: t.string().unique(), createdBy: t.identity(),
  createdAt: t.timestamp(), expiresAt: t.timestamp(), maxUses: t.u32(), uses: t.u32(),
  revokedAt: t.timestamp().optional(),
});
/** Un registro por enlace y correo: cuenta un uso por persona y sabe qué retirar al revocar. */
export const inviteLinkRedemption = table({ name: 'invite_link_redemption' }, {
  key: t.string().primaryKey(), linkId: t.u64().index('btree'), email: t.string(), redeemedAt: t.timestamp(),
});
export const inviteLinkTables = { inviteLink, inviteLinkRedemption };
