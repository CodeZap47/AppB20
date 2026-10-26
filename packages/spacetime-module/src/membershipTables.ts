import { table, t } from 'spacetimedb/server';

/** El secreto permanece cifrado y solo sale mediante procedimientos administrativos. */
export const invitationLink = table({ name: 'invitation_link' }, {
  id: t.string().primaryKey(), name: t.string(), tokenHash: t.string().index('btree'),
  ciphertext: t.string(), iv: t.string(), keyVersion: t.string(),
  active: t.bool(), createdBy: t.identity(), createdAt: t.timestamp(),
  expiresAt: t.timestamp().optional(), maxUses: t.u32().optional(), usedCount: t.u32(),
  version: t.u32(), deactivatedAt: t.timestamp().optional(), replacementId: t.string().optional(),
});
/** Distingue reinvitaciones explícitas nuevas de pendientes históricas sin fecha de baja. */
export const individualInvitationGrant = table({ name: 'individual_invitation_grant' }, {
  email: t.string().primaryKey(), issuedAt: t.timestamp(),
});
/** Correos obtenidos exclusivamente de sesiones verificadas; jamás se publican en members. */
export const memberEmail = table({ name: 'member_email' }, {
  email: t.string().primaryKey(), memberIdentity: t.identity().index('btree'), verifiedAt: t.timestamp(),
});
/** Generación actual: una acción antigua no puede retirar una reincorporación posterior. */
export const memberAccess = table({ name: 'member_access' }, {
  memberIdentity: t.identity().primaryKey(), generation: t.u32(), origin: t.string(),
  sourceId: t.string().optional(), admittedAt: t.timestamp(), removedAt: t.timestamp().optional(),
});
export const memberAdmission = table({ name: 'member_admission' }, {
  id: t.string().primaryKey(), memberIdentity: t.identity().index('btree'), generation: t.u32(),
  origin: t.string(), sourceId: t.string().optional(), joinedAt: t.timestamp(),
});
/** Desbloquear nunca borra la baja ni habilita el acceso por un enlace compartido. */
export const emailRestriction = table({ name: 'email_restriction' }, {
  email: t.string().primaryKey(), blocked: t.bool(), removedAt: t.timestamp().optional(),
  blockedAt: t.timestamp().optional(), reason: t.string(), updatedBy: t.identity(), updatedAt: t.timestamp(),
});
export const membershipEvent = table({ name: 'membership_event' }, {
  id: t.u64().primaryKey().autoInc(), memberIdentity: t.identity().optional(), email: t.string().optional(),
  action: t.string(), reason: t.string(), actor: t.identity(), at: t.timestamp(),
});
/** Un resultado por envío, independiente de la posterior moderación de sus aportes. */
export const adminAccessOperation = table({ name: 'admin_access_operation' }, {
  id: t.string().primaryKey(), actor: t.identity(), request: t.string(), result: t.string(), createdAt: t.timestamp(),
});
export const invitationLinkMetadataType = t.object('InvitationLinkMetadata', {
  id: t.string(), name: t.string(), status: t.string(), active: t.bool(), createdAt: t.timestamp(),
  expiresAt: t.timestamp().optional(), maxUses: t.u32().optional(), usedCount: t.u32(), version: t.u32(),
});
export const adminMemberType = t.object('AdminMember', {
  identity: t.identity(), displayName: t.string(), status: t.string(), isCreator: t.bool(),
  email: t.string().optional(), emails: t.array(t.string()), generation: t.u32(), origin: t.string(),
  invitationLinkId: t.string().optional(), joinedAt: t.timestamp(), removedAt: t.timestamp().optional(),
});
export const membershipTables = { invitationLink, individualInvitationGrant, memberEmail, memberAccess, memberAdmission, emailRestriction, membershipEvent, adminAccessOperation };
