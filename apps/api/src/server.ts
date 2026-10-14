import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { EncryptedMemoryStore, type SecretStore } from './lib/secrets.ts';
import { metadataTokenProvider, SecretManagerStore } from './lib/secretManager.ts';
import { env } from './env.ts';

function createStore(): SecretStore {
  if (env.secretStore === 'gcp') {
    return new SecretManagerStore({
      projectId: env.gcpProjectId(),
      getAccessToken: metadataTokenProvider(),
    });
  }
  if (env.secretStore !== 'memory') throw new Error('SECRET_STORE debe ser gcp o memory');
  return new EncryptedMemoryStore(env.byokEncryptionKey());
}

const app = createApp(createStore());

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`API de B20 escuchando en http://localhost:${info.port}`);
});
