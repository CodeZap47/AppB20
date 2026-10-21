import { table, t } from 'spacetimedb/server';
export const notificationServiceConfig = table({ name: 'notification_service_config' }, { id: t.u32().primaryKey(), identity: t.identity(), enabled: t.bool() });
export const notificationPreference = table({ name: 'notification_preference' }, {
  memberId: t.identity().primaryKey(), timeZone: t.string(), enabledKinds: t.array(t.string()), pushEnabled: t.bool(),
  quietStartMinute: t.u32(), quietEndMinute: t.u32(), reminderMinute: t.u32(), version: t.u32(), updatedAt: t.timestamp(),
});
export const notification = table({ name: 'notification' }, {
  id: t.u64().primaryKey().autoInc(), memberId: t.identity().index('btree'), dedupeKey: t.string().unique(),
  kind: t.string(), title: t.string(), route: t.string(), sourceKind: t.string(), sourceId: t.string(),
  conversationScope: t.string(), conversationId: t.string(), messageId: t.u64().optional(), actor: t.identity().optional(),
  createdAt: t.timestamp(), readAt: t.timestamp().optional(), reminderDay: t.string(),
});
export const pushInstallation = table({ name: 'push_installation' }, {
  id: t.string().primaryKey(), memberId: t.identity().index('btree'), label: t.string(), endpoint: t.string(),
  p256dh: t.string(), auth: t.string(), enabled: t.bool(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
export const notificationEvent = table({ name: 'notification_event' }, {
  key: t.string().primaryKey(), kind: t.string(), route: t.string(), sourceKind: t.string(), sourceId: t.string(),
  recipientIds: t.array(t.identity()), cursor: t.u32(), actor: t.identity().optional(),
  conversationScope: t.string(), conversationId: t.string(), messageId: t.u64().optional(), createdAt: t.timestamp(), completed: t.bool(),
});
export const notificationDelivery = table({ name: 'notification_delivery' }, {
  id: t.string().primaryKey(), notificationId: t.u64(), installationId: t.string(), memberId: t.identity(),
  status: t.string(), attempts: t.u32(), nextAttemptAt: t.timestamp(), leaseId: t.string(), leaseUntil: t.timestamp().optional(),
  installationUpdatedAt: t.timestamp().optional(),
});
export const notificationReminderCursor = table({ name: 'notification_reminder_cursor' }, {
  memberId: t.identity().primaryKey(), day: t.string(), updatedAt: t.timestamp(),
});
export const notificationPlannerState = table({ name: 'notification_planner_state' }, { id: t.u32().primaryKey(), lastMember: t.string() });
export const notificationTables = { notificationServiceConfig, notificationPreference, notification, pushInstallation, notificationEvent, notificationDelivery, notificationReminderCursor, notificationPlannerState };
