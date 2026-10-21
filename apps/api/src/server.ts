import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { EncryptedMemoryStore, type SecretStore } from './lib/secrets.ts';
import { env } from './env.ts';

function createStore(): SecretStore {
  if (env.secretStore !== 'memory') throw new Error('La API de desarrollo solo admite SECRET_STORE=memory. El despliegue usa SpacetimeDB y Cloudflare.');
  return new EncryptedMemoryStore(env.byokEncryptionKey());
}

const app = createApp(createStore());

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`API de B20 escuchando en http://localhost:${info.port}`);
});
