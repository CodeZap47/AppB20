import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

/** Secretos del Worker: el que pega la extensión y el token de la identidad técnica en SpacetimeDB. */
export interface MoodleEnv { SPACETIMEDB_URI: string; SPACETIMEDB_MODULE: string; MOODLE_INGEST_TOKEN?: string; MOODLE_SERVICE_TOKEN?: string }
export interface MoodleSummary { created: number; updated: number; unchanged: number; skipped: { moodleId: string; reason: string }[] }

const MAX_BODY_BYTES = 256 * 1024;
const MAX_ITEMS = 200;
const TIME_ZONE = 'America/Tijuana';
const ERRORS: Record<string, [400 | 401 | 403 | 503, string]> = {
  invalid: [400, 'Revisa los datos de las tareas.'],
  unauthorized: [403, 'El servicio de Moodle no está autorizado en B20.'],
  disabled: [503, 'La sincronización con Moodle está desactivada en B20.'],
};
class MoodleApiError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 413 | 503, message: string) { super(message); }
}

async function sameSecret(given: string, expected: string): Promise<boolean> {
  // Compara resúmenes de longitud fija para no filtrar por tiempo cuánto del secreto coincide.
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

const tijuanaDay = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Moodle guarda la entrega como instante; el calendario de B20 usa el día civil de Tijuana. */
export function dueDay(value: unknown): string {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(at)) throw new MoodleApiError(400, 'Fecha de entrega inválida.');
  return tijuanaDay.format(new Date(at));
}

function field(item: Record<string, unknown>, name: string, max: number, required = true): string {
  const value = item[name] ?? (required ? undefined : '');
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new MoodleApiError(400, `El campo ${name} no es válido.`);
  }
  return value;
}

export function parseAssignments(body: unknown) {
  const list = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).assignments : undefined;
  if (!Array.isArray(list)) throw new MoodleApiError(400, 'Envía { assignments: [...] }.');
  if (list.length > MAX_ITEMS) throw new MoodleApiError(400, `Envía hasta ${MAX_ITEMS} tareas por solicitud.`);
  return list.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MoodleApiError(400, 'Cada tarea debe ser un objeto.');
    const item = raw as Record<string, unknown>;
    return { moodleId: field(item, 'moodleId', 40), course: field(item, 'course', 300), title: field(item, 'title', 200),
      description: field(item, 'description', 20_000, false), url: field(item, 'url', 520), dueDate: dueDay(item.dueAt) };
  });
}

async function ingest(env: MoodleEnv, items: ReturnType<typeof parseAssignments>, fetchFn: typeof fetch): Promise<MoodleSummary> {
  let origin: string;
  try {
    const uri = new URL(env.SPACETIMEDB_URI);
    if (uri.protocol === 'wss:') uri.protocol = 'https:';
    if (uri.protocol === 'ws:') uri.protocol = 'http:';
    origin = uri.origin;
  } catch { throw new MoodleApiError(503, 'La sincronización con Moodle todavía no está configurada.'); }
  let response: Response;
  try {
    response = await fetchFn(new URL(`/v1/database/${encodeURIComponent(env.SPACETIMEDB_MODULE)}/call/moodle_ingest`, origin), {
      method: 'POST', headers: { Authorization: `Bearer ${env.MOODLE_SERVICE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([JSON.stringify({ items })]), redirect: 'manual', signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new MoodleApiError(503, 'No pudimos contactar a B20. Se reintentará en la próxima sincronización.'); }
  if (!response.ok) throw new MoodleApiError(503, 'B20 no aceptó la sincronización. Se reintentará en la próxima sincronización.');
  let parsed: Record<string, unknown>;
  try {
    const data: unknown = await response.json();
    parsed = (typeof data === 'string' ? JSON.parse(data) : data) as Record<string, unknown>;
  } catch { throw new MoodleApiError(503, 'La versión de B20 no coincide con esta integración.'); }
  if (parsed?.ok !== true) {
    const [status, message] = ERRORS[String(parsed?.code)] ?? [503, 'B20 no pudo importar las tareas.'];
    throw new MoodleApiError(status, message);
  }
  const { created, updated, unchanged, skipped } = parsed as unknown as MoodleSummary;
  return { created, updated, unchanged, skipped };
}

/** `POST /integrations/moodle/assignments`: la extensión CESUN → Notion publica también al calendario compartido. */
export function moodleRoutes(options: { fetchFn?: typeof fetch } = {}) {
  const app = new Hono<{ Bindings: MoodleEnv }>();
  app.post('/assignments', bodyLimit({ maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: 'La solicitud supera 256 KB. Envía menos tareas.' }, 413) }), async (c) => {
    c.header('Cache-Control', 'no-store');
    try {
      if (!c.env.MOODLE_INGEST_TOKEN || !c.env.MOODLE_SERVICE_TOKEN) throw new MoodleApiError(503, 'La sincronización con Moodle todavía no está configurada.');
      const given = /^Bearer\s+(.+)$/i.exec(c.req.header('Authorization') ?? '')?.[1]?.trim() ?? '';
      if (!given || !(await sameSecret(given, c.env.MOODLE_INGEST_TOKEN))) throw new MoodleApiError(401, 'El token de B20 no es válido.');
      let body: unknown;
      try { body = await c.req.json(); } catch { throw new MoodleApiError(400, 'JSON inválido.'); }
      const items = parseAssignments(body);
      if (!items.length) return c.json({ created: 0, updated: 0, unchanged: 0, skipped: [] });
      return c.json(await ingest(c.env, items, options.fetchFn ?? fetch));
    } catch (error) {
      if (error instanceof MoodleApiError) return c.json({ error: error.message }, error.status);
      console.error(JSON.stringify({ event: 'moodle_ingest_error', error: error instanceof Error ? error.name : 'unknown' }));
      return c.json({ error: 'No se pudo completar la sincronización.' }, 503);
    }
  });
  return app;
}
