import { createWorkerApp } from './workerApp.ts';
import { runScheduledMaintenance, type DeliveryMaintenanceEnv } from './scheduledMaintenance.ts';
import type { AiWorkerEnv } from './ai/database.ts';

/** Authenticated integrations and optional scheduling, without legacy R2 cleanup. */
export default {
  fetch: createWorkerApp().fetch,
  async scheduled(_event, env) { await runScheduledMaintenance(env); },
} satisfies ExportedHandler<AiWorkerEnv & DeliveryMaintenanceEnv>;
