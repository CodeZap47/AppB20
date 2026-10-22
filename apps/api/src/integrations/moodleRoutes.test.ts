import { describe, expect, it, vi } from 'vitest';
import { dueDay, moodleRoutes, type MoodleEnv } from './moodleRoutes.ts';

const env: MoodleEnv = { SPACETIMEDB_URI: 'wss://db.example.test', SPACETIMEDB_MODULE: 'test-b20',
  MOODLE_INGEST_TOKEN: 'ingest-secret', MOODLE_SERVICE_TOKEN: 'service-token' };
const assignment = { moodleId: 'cesun:assign:42', course: 'Lógica de Programación', title: 'Diagrama',
  description: 'PDF', url: 'https://cursos.cesun.edu.mx/mod/assign/view.php?id=7', dueAt: '2026-10-31T06:59:00.000Z' };
const summary = { ok: true, created: 1, updated: 0, unchanged: 0, skipped: [] };
function setup(reply: () => Response = () => Response.json(JSON.stringify(summary))) {
  const fetchFn = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => reply());
  const app = moodleRoutes({ fetchFn: fetchFn as unknown as typeof fetch });
  const post = (body: unknown, token = 'ingest-secret', bindings: MoodleEnv = env) => app.request('/assignments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body) }, bindings);
  return { fetchFn, post };
}

describe('POST /integrations/moodle/assignments', () => {
  it('exige el token de la extensión', async () => {
    const { post, fetchFn } = setup();
    expect((await post({ assignments: [] }, '')).status).toBe(401);
    expect((await post({ assignments: [] }, 'otro')).status).toBe(401);
    expect((await post({ assignments: [] }, 'x', { ...env, MOODLE_INGEST_TOKEN: undefined })).status).toBe(503);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('una lista vacía solo verifica el token', async () => {
    const { post, fetchFn } = setup();
    const response = await post({ assignments: [] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ created: 0, updated: 0, unchanged: 0, skipped: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('convierte la entrega al día de Tijuana y llama al procedure con la identidad técnica', async () => {
    const { post, fetchFn } = setup();
    const response = await post({ assignments: [assignment] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: [] });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe('https://db.example.test/v1/database/test-b20/call/moodle_ingest');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer service-token');
    const [payload] = JSON.parse(String(init!.body)) as [string];
    expect(JSON.parse(payload).items[0]).toMatchObject({ moodleId: 'cesun:assign:42', dueDate: '2026-10-30' });
    expect(JSON.parse(payload).items[0]).not.toHaveProperty('dueAt');
  });
  it('rechaza cuerpos inválidos', async () => {
    const { post } = setup();
    expect((await post('{')).status).toBe(400);
    expect((await post({ assignments: [{ ...assignment, dueAt: 'mañana' }] })).status).toBe(400);
    expect((await post({ assignments: [{ ...assignment, title: '' }] })).status).toBe(400);
    expect((await post({ assignments: Array.from({ length: 201 }, () => assignment) })).status).toBe(400);
  });
  it('traduce los códigos del módulo sin reenviar su texto', async () => {
    const { post } = setup(() => Response.json(JSON.stringify({ ok: false, code: 'unauthorized', message: 'interno' })));
    const response = await post({ assignments: [assignment] });
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain('interno');
    const offline = setup(() => new Response('', { status: 500 }));
    expect((await offline.post({ assignments: [assignment] })).status).toBe(503);
  });
  it('dueDay usa la zona de Tijuana', () => {
    expect(dueDay('2026-10-31T06:59:00Z')).toBe('2026-10-30');
    expect(dueDay('2026-10-31T08:00:00Z')).toBe('2026-10-31');
  });
});
