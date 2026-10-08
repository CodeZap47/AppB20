import { Hono } from 'hono';
import { GoogleGenAI } from '@google/genai';
import { requireAuth, type AuthVariables } from '../lib/auth.ts';
import type { SecretStore } from '../lib/secrets.ts';
import { env } from '../env.ts';

const MAX_PROMPT_LENGTH = 20_000;

/**
 * Gemini con BYOK (sección 4). Cada solicitud usa la clave de quien la pide.
 * Los resultados son borradores: el cliente los marca como generados con IA y el alumno
 * decide si publicarlos.
 *
 * TODO(Etapa 0): habilitar solo tras confirmar edad y acceso a AI Studio; límites de
 * solicitudes y presupuesto; retirar datos personales de las fuentes; fuentes y omisiones.
 */
export function aiRoutes(store: SecretStore) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', requireAuth);

  // Solo informa si existe una clave; nunca la devuelve.
  app.get('/key', async (c) => c.json({ configured: await store.has(c.get('user').subject) }));

  app.put('/key', async (c) => {
    const body = await c.req.json<{ apiKey?: unknown }>().catch(() => ({ apiKey: undefined }));
    if (typeof body.apiKey !== 'string' || body.apiKey.trim().length < 10) {
      return c.json({ error: 'Clave inválida' }, 400);
    }
    await store.put(c.get('user').subject, body.apiKey.trim());
    return c.json({ configured: true });
  });

  app.delete('/key', async (c) => {
    await store.delete(c.get('user').subject);
    return c.json({ configured: false });
  });

  app.post('/generate', async (c) => {
    const apiKey = await store.get(c.get('user').subject);
    if (!apiKey) return c.json({ error: 'Configura tu clave de Gemini primero' }, 409);
    const body = await c.req.json<{ prompt?: unknown }>().catch(() => ({ prompt: undefined }));
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return c.json({ error: 'Falta el texto de la solicitud' }, 400);
    }
    if (body.prompt.length > MAX_PROMPT_LENGTH) return c.json({ error: 'Solicitud demasiado larga' }, 413);

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: env.geminiModel(),
      contents: body.prompt,
    });
    return c.json({ draft: true, provider: 'gemini', text: response.text ?? '' });
  });

  return app;
}
