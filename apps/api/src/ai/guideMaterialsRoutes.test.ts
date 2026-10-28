import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AiRouteContext } from './routes.ts';
import { guideMaterialsRoutes } from './guideMaterialsRoutes.ts';
import { AiApiError } from './database.ts';
const id = '10000000-0000-4000-8000-000000000001';
function setup() { const user = vi.fn().mockResolvedValue(null); const app = new Hono<AiRouteContext>(); app.use('*', async (c, next) => { c.set('ai', { user, service: vi.fn() }); c.set('sessionToken', 'session'); await next(); }); app.route('/ai/guide-materials', guideMaterialsRoutes()); app.onError((error, c) => c.json({ error: error instanceof AiApiError ? error.code : 'invalid' }, 400)); return { app, user }; }
describe('rutas autenticadas de catálogo y selección', () => {
  it('consulta catálogo y preview sin iniciar intentos ni generación', async () => {
    const s = setup(); expect((await s.app.request('/ai/guide-materials/exams?subjectId=1')).status).toBe(200);
    expect((await s.app.request(`/ai/guide-materials/exams/${id}/2?includeSolutions=true`)).status).toBe(200);
    expect(s.user.mock.calls).toEqual([['session', 'guide_materials', { action: 'listExams', subjectId: '1' }], ['session', 'guide_materials', { action: 'getExam', examId: id, version: 2, includeSolutions: true }]]);
  });
  it('guarda el borrador incompleto y rechaza identidades y versiones mal formadas', async () => {
    const s = setup(), input = { id, expectedRevision: 0, subjectId: '1', guideType: 'quarter', title: '', topicsText: '', sources: [], chosenFileIds: [] };
    expect((await s.app.request(`/ai/guide-materials/selections/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status).toBe(200);
    expect(s.user).toHaveBeenLastCalledWith('session', 'guide_materials', { action: 'saveSelection', input });
    s.user.mockClear(); for (const path of ['/ai/guide-materials/exams?subjectId=bad', `/ai/guide-materials/exams/${id}/0`, '/ai/guide-materials/selections/no-id']) expect((await s.app.request(path)).status).toBe(400); expect(s.user).not.toHaveBeenCalled();
  });
});
