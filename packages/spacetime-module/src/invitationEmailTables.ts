import { table, t } from 'spacetimedb/server';
/** Cola del correo de invitación: la vacía el cron del worker con la identidad de notificaciones. */
export const invitationEmail = table({ name: 'invitation_email' }, {
  email: t.string().primaryKey(), status: t.string(), attempts: t.u32(),
  leaseId: t.string().optional(), leaseUntil: t.timestamp().optional(), nextAttemptAt: t.timestamp(),
  requestedAt: t.timestamp(), sentAt: t.timestamp().optional(), lastError: t.string().optional(),
});
export const invitationEmailTables = { invitationEmail };
