import type { DbConnection } from '../module_bindings';
import type { NotificationActions } from './notificationTypes';

export function createNotificationActions(connection: () => DbConnection): NotificationActions {
  return {
    saveNotificationPreferences: (input) => connection().reducers.saveNotificationPreferences(input),
    markNotificationRead: (notificationId) => connection().reducers.markNotificationRead({ notificationId: BigInt(notificationId) }),
    markAllNotificationsRead: () => connection().reducers.markAllNotificationsRead({}),
    registerPushInstallation: (input) => connection().reducers.registerPushInstallation({ id: input.id, label: input.label, endpoint: input.endpoint, p256Dh: input.p256dh, auth: input.auth }),
    removePushInstallation: (installationId) => connection().reducers.removePushInstallation({ installationId }),
    requestNotificationTest: () => connection().reducers.requestNotificationTest({}),
  };
}
