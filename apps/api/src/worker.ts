import { createWorkerApp } from './workerApp.ts';
import { createFileDatabase } from './files/database.ts';
import { cleanOrphans } from './files/storage.ts';

const app = createWorkerApp();
export default {
  fetch: app.fetch,
  async scheduled(_event, env) {
    const files = createFileDatabase(env);
    const removed = await cleanOrphans(env.FILES, (actor, uploadId) => files.status(actor, uploadId));
    console.log(JSON.stringify({ event: 'file_orphans_cleaned', removed }));
  },
} satisfies ExportedHandler<FileWorkerEnv>;
