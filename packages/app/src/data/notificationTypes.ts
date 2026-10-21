import type { NotificationKind, NotificationPreferencesInput } from '../../../core/src/notifications';
import type { Id, MaybePromise } from './types';
export type { NotificationKind, NotificationPreferencesInput } from '../../../core/src/notifications';
export interface NotificationPreferences extends NotificationPreferencesInput { version: number }
export interface InboxNotification { id: Id; kind: NotificationKind; title: string; route: string; createdAt: Date; readAt?: Date }
export interface PushInstallation { id: Id; label: string; enabled: boolean; createdAt: Date; updatedAt: Date }
export interface RegisterPushInstallationInput { id: string; label: string; endpoint: string; p256dh: string; auth: string }
export interface NotificationsSnapshot {
  notificationPreferences?: NotificationPreferences;
  notifications: InboxNotification[];
  pushInstallations: PushInstallation[];
}
export interface NotificationActions {
  saveNotificationPreferences(input: NotificationPreferencesInput): MaybePromise<void>;
  markNotificationRead(notificationId: Id): MaybePromise<void>;
  markAllNotificationsRead(): MaybePromise<void>;
  registerPushInstallation(input: RegisterPushInstallationInput): MaybePromise<void>;
  removePushInstallation(installationId: Id): MaybePromise<void>;
  requestNotificationTest(): MaybePromise<void>;
}
export function emptyNotifications(): NotificationsSnapshot { return { notificationPreferences: undefined, notifications: [], pushInstallations: [] }; }
