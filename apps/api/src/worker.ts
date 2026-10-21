import { createWorkerApp } from './workerApp.ts';
import { createFileDatabase } from './files/database.ts';
import { cleanOrphans } from './files/storage.ts';
import { runNotificationCron, type NotificationRuntimeConfiguration } from './notifications/runner.ts';
import { runRetentionMaintenance } from './maintenance.ts';
import type { AiWorkerEnv } from './ai/database.ts';

type DeliveryWorkerEnv = AiWorkerEnv & NotificationRuntimeConfiguration & { MAINTENANCE_SERVICE_TOKEN?: string };

const app = createWorkerApp();
export default {
  fetch: app.fetch,
  async scheduled(event, env) {
    const tasks = [
      { name: 'notifications', run: () => runNotificationCron(env) },
      { name: 'retention', run: () => runRetentionMaintenance({ uri: env.SPACETIMEDB_URI, module: env.SPACETIMEDB_MODULE, token: env.MAINTENANCE_SERVICE_TOKEN }) },
    ];
    const results = await Promise.allSettled(tasks.map((task) => task.run()));
    for (let index = 0; index < results.length; index++) console.log(JSON.stringify({ event: 'scheduled_maintenance', task: tasks[index]!.name, ok: results[index]!.status === 'fulfilled' }));
    if (event.cron === '23 9 * * *') {
      const files = createFileDatabase(env);
      const removed = await cleanOrphans(env.FILES, (actor, uploadId) => files.status(actor, uploadId));
      console.log(JSON.stringify({ event: 'file_orphans_cleaned', removed }));
    }
  },
} satisfies ExportedHandler<DeliveryWorkerEnv>;
