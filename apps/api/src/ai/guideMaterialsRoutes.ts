import { Hono } from 'hono';
import { aiDecimalId, aiUuid, validateGuideMaterialSelectionInput } from '@b20/core';
import { AiApiError } from './database.ts';
import { readAiBody } from './body.ts';
import type { AiRouteContext } from './routes.ts';
function uuid(value: unknown) { if (!aiUuid(value)) throw new AiApiError(400, 'invalid', 'Identificador de borrador o examen inválido.'); return value.toLowerCase(); }
export function guideMaterialsRoutes() {
  const app = new Hono<AiRouteContext>();
  app.get('/exams', async (c) => { const subjectId = c.req.query('subjectId'); if (!aiDecimalId(subjectId)) throw new AiApiError(400, 'invalid', 'Elige una materia.'); return c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_materials', { action: 'listExams', subjectId })); });
  app.get('/exams/:examId/:version', async (c) => { const version = Number(c.req.param('version')); if (!Number.isSafeInteger(version) || version < 1) throw new AiApiError(400, 'invalid', 'Versión inválida.'); return c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_materials', { action: 'getExam', examId: uuid(c.req.param('examId')), version, includeSolutions: c.req.query('includeSolutions') === 'true' })); });
  app.get('/selections', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_materials', { action: 'listSelections' })));
  app.get('/selections/:id', async (c) => c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_materials', { action: 'getSelection', id: uuid(c.req.param('id')) })));
  app.put('/selections/:id', async (c) => { const input = validateGuideMaterialSelectionInput(await readAiBody(c.req.raw, 2 * 1024 * 1024)); if (input.id !== uuid(c.req.param('id'))) throw new AiApiError(400, 'invalid', 'El borrador no corresponde a esta selección.'); return c.json(await c.get('ai').user(c.get('sessionToken'), 'guide_materials', { action: 'saveSelection', input })); });
  return app;
}
