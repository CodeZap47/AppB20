import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { EncryptedMemoryStore } from './lib/secrets.ts';
import { env } from './env.ts';

const app = createApp(new EncryptedMemoryStore(env.byokEncryptionKey()));

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`API de B20 escuchando en http://localhost:${info.port}`);
});
