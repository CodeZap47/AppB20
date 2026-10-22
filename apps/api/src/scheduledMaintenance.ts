import { runNotificationCron, type NotificationRuntimeConfiguration } from './notifications/runner.ts';
import { runRetentionMaintenance } from './maintenance.ts';
import { runInvitationEmailCron, type InvitationEmailRuntimeConfiguration } from './invitations/emailRunner.ts';

export type DeliveryMaintenanceEnv = NotificationRuntimeConfiguration & InvitationEmailRuntimeConfiguration & { MAINTENANCE_SERVICE_TOKEN?: string };

/** Shared by the current integration Worker and the legacy R2 Worker. */
export async function runScheduledMaintenance(env: DeliveryMaintenanceEnv): Promise<void> {
  const tasks = [
    { name: 'notifications', run: () => runNotificationCron(env) },
    { name: 'invitation-emails', run: () => runInvitationEmailCron(env) },
    { name: 'retention', run: () => runRetentionMaintenance({ uri: env.SPACETIMEDB_URI, module: env.SPACETIMEDB_MODULE, token: env.MAINTENANCE_SERVICE_TOKEN }) },
  ];
  const results = await Promise.allSettled(tasks.map((task) => task.run()));
  for (let index = 0; index < results.length; index++) {
    console.log(JSON.stringify({ event: 'scheduled_maintenance', task: tasks[index]!.name, ok: results[index]!.status === 'fulfilled' }));
  }
}
