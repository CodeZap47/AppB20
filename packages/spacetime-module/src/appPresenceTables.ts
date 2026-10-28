import { t, table } from 'spacetimedb/server';

/** One private row per app connection; inactive rows retain only its current revision. */
export const appPresenceSession = table({ name: 'app_presence_session' }, {
  connectionId: t.string().primaryKey(),
  memberId: t.identity().index('btree'),
  active: t.bool(),
  revision: t.u64(),
  expiresAt: t.timestamp(),
});

/** A single job follows the next active session deadline, rather than polling the group. */
export const appPresenceExpiry = table({ name: 'app_presence_expiry' }, {
  id: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  expiresAt: t.timestamp(),
});

/** No connection identifiers or activity timestamps leave the server. */
export const onlineMemberRow = t.object('OnlineMember', { memberId: t.identity() });
export const appPresenceTables = { appPresenceSession, appPresenceExpiry };
