import { addLocalDays, nextNotificationPushAt, notificationDayBounds, notificationLocalClock, reminderCatchupDays, type NotificationPreferencesInput } from '@b20/core';
import { createNotificationCall, type NotificationCall } from './database.ts';
import { InvalidPushSubscription, prepareVapid, sendWebPush } from './webPush.ts';

export interface NotificationRuntimeConfiguration {
  NOTIFICATIONS_ENABLED?: string; NOTIFICATION_SERVICE_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string;
  SPACETIMEDB_URI: string; SPACETIMEDB_MODULE: string;
}
interface Job { jobId: string; notificationId: string; endpoint: string; p256dh: string; auth: string; title: string; route: string; preferences: NotificationPreferencesInput }
export async function runNotificationCron(configuration: NotificationRuntimeConfiguration, options: { call?: NotificationCall; fetch?: typeof fetch } = {}) {
  if (configuration.NOTIFICATIONS_ENABLED !== 'true') return { enabled: false, sent: 0 };
  if (!configuration.NOTIFICATION_SERVICE_TOKEN) throw new Error('Notification service is not configured.');
  const call = options.call ?? createNotificationCall({ uri: configuration.SPACETIMEDB_URI, module: configuration.SPACETIMEDB_MODULE, serviceToken: configuration.NOTIFICATION_SERVICE_TOKEN }, options.fetch);
  await call('notifications_sweep', { limit: 100 });
  const planning = await call<{ now: number; members: { memberId: string; cursorDay?: string; preferences: NotificationPreferencesInput }[] }>('notification_reminder_context', { limit: 4 });
  for (const member of planning.members.slice(0, 4)) {
    const local = notificationLocalClock(planning.now, member.preferences.timeZone);
    if (!member.cursorDay && local.minute < member.preferences.reminderMinute) continue;
    const through = local.minute >= member.preferences.reminderMinute ? local.day : addLocalDays(local.day, -1);
    for (const day of reminderCatchupDays(member.cursorDay, through, 2)) {
      const result = await call<{ complete: boolean }>('notification_commit_reminders', { memberId: member.memberId, day, ...notificationDayBounds(day, member.preferences.timeZone) });
      if (!result.complete) break;
    }
  }
  const vapid = configuration.VAPID_PUBLIC_KEY && configuration.VAPID_PRIVATE_KEY && configuration.VAPID_SUBJECT ? await prepareVapid({ publicKey: configuration.VAPID_PUBLIC_KEY, privateKey: configuration.VAPID_PRIVATE_KEY, subject: configuration.VAPID_SUBJECT }) : undefined;
  if (!vapid) return { enabled: true, pushConfigured: false, sent: 0 };
  const leaseId = crypto.randomUUID();
  const claimed = await call<{ now: number; jobs: Job[] }>('notifications_claim', { leaseId, limit: 8 });
  let sent = 0;
  for (const job of claimed.jobs.slice(0, 8)) {
    const pushAt = nextNotificationPushAt(claimed.now, job.preferences);
    if (pushAt > claimed.now) { await call('notifications_finish', { jobId: job.jobId, leaseId, outcome: 'deferred', retryAfterSeconds: Math.ceil((pushAt - claimed.now) / 1000) }); continue; }
    if (!await call<boolean>('notifications_authorize', { jobId: job.jobId, leaseId })) continue;
    let result: { outcome: string; retryAfterSeconds?: number };
    try {
      const payload = JSON.stringify({ notificationId: job.notificationId, title: job.title, body: 'Tienes una novedad en App B20. Abre la app para consultarla.', url: job.route, tag: `b20:${job.notificationId}` });
      result = await sendWebPush({ ...job, payload, topic: job.jobId }, vapid, options.fetch);
    } catch (error) { result = { outcome: error instanceof InvalidPushSubscription ? 'invalid' : 'retry' }; }
    await call('notifications_finish', { jobId: job.jobId, leaseId, ...result });
    if (result.outcome === 'sent') sent++;
  }
  return { enabled: true, pushConfigured: true, sent };
}
