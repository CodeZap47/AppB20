import { createWorkerApp } from './workerApp.ts';
/** Same authenticated Hono API, without R2 bindings or scheduled R2 cleanup. */
export default { fetch: createWorkerApp().fetch } satisfies ExportedHandler<FileWorkerEnv>;
