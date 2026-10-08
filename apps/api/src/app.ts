import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { aiRoutes } from './routes/ai.ts';
import type { SecretStore } from './lib/secrets.ts';
import { env } from './env.ts';

export function createApp(store: SecretStore) {
  const app = new Hono();
  app.use('*', secureHeaders());
  app.use('*', cors({ origin: env.corsOrigins, allowHeaders: ['Authorization', 'Content-Type'] }));

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/ai', aiRoutes(store));

  // TODO(Etapa 0): /files (URLs firmadas de Cloud Storage tras validar membresía) y
  // /push (suscripciones Web Push y tokens FCM, envío y limpieza de suscripciones inválidas).

  app.onError((err, c) => {
    console.error(err.message);
    return c.json({ error: 'Error interno' }, 500);
  });

  return app;
}
