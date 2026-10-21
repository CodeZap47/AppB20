import { NOTIFICATION_KINDS, notificationRoute } from '@b20/core';
import type { DbConnection } from '../module_bindings';
import type { Snapshot } from './types';
import { emptyNotifications, type NotificationKind } from './notificationTypes';

function kind(value: string): NotificationKind {
  const found = NOTIFICATION_KINDS.find((entry) => entry === value);
  if (!found) throw new Error('Actualiza la aplicación para consultar estos avisos.');
  return found;
}
export function enrichNotificationsSnapshot(connection: Pick<DbConnection, 'db'>, snapshot: Snapshot, identity: string): Snapshot {
  if (snapshot.me?.status !== 'active' || snapshot.me.id !== identity) return { ...snapshot, ...emptyNotifications() };
  const db = connection.db;
  const preferences = [...(db.myNotificationPreferences?.iter() ?? [])].find((row) => row.memberId.toHexString() === identity);
  return { ...snapshot,
    notificationPreferences: preferences && { timeZone: preferences.timeZone, enabledKinds: preferences.enabledKinds.map(kind), pushEnabled: preferences.pushEnabled,
      quietStartMinute: preferences.quietStartMinute, quietEndMinute: preferences.quietEndMinute, reminderMinute: preferences.reminderMinute, version: preferences.version },
    notifications: [...(db.myNotifications?.iter() ?? [])].filter((row) => row.memberId.toHexString() === identity).map((row) => ({
      id: row.id.toString(), kind: kind(row.kind), title: row.title, route: notificationRoute(row.route), createdAt: row.createdAt.toDate(), readAt: row.readAt?.toDate(),
    })),
    pushInstallations: [...(db.myPushInstallations?.iter() ?? [])].map((row) => ({ id: row.id, label: row.label, enabled: row.enabled, createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate() })),
  };
}
