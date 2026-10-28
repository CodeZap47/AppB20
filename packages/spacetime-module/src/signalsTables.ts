import { t, table } from 'spacetimedb/server';

/** Discriminated JSON records remain private. Only the actor projection is subscribed. */
export const signalRecord = table({ name: 'signal_record' }, {
  key: t.string().primaryKey(), collection: t.string().index('btree'), json: t.string(),
});

/** A single next deadline refreshes invitations and purges expired private trash. */
export const signalExpiry = table({ name: 'signal_expiry' }, {
  id: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), at: t.u64(),
});

export const signalSnapshotRow = t.object('SignalSnapshotRow', { id: t.string(), json: t.string() });
export const signalsTables = { signalRecord, signalExpiry };
