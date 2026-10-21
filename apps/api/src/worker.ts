import { createWorkerApp } from './workerApp.ts';
import { createFileDatabase } from './files/database.ts';
import { cleanOrphans } from './files/storage.ts';
import { runScheduledMaintenance, type DeliveryMaintenanceEnv } from './scheduledMaintenance.ts';
import type { AiWorkerEnv } from './ai/database.ts';

type DeliveryWorkerEnv = AiWorkerEnv & DeliveryMaintenanceEnv;

const app = createWorkerApp();
export default {
  fetch: app.fetch,
  async scheduled(event, env) {
    await runScheduledMaintenance(env);
    if (event.cron === '23 9 * * *') {
      const files = createFileDatabase(env);
      const removed = await cleanOrphans(env.FILES, (actor, uploadId) => files.status(actor, uploadId));
      console.log(JSON.stringify({ event: 'file_orphans_cleaned', removed }));
    }
  },
} satisfies ExportedHandler<DeliveryWorkerEnv>;
