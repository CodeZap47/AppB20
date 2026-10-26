import { Hono } from 'hono';
import { EXAM_ACTIONS } from '@b20/core';
import { readAiBody } from './body.ts';
import { AiApiError } from './database.ts';
import type { AiRouteContext } from './routes.ts';
import { revalidateDocumentOriginals } from './documentRoutes.ts';

// Editing a complete Unicode question set must fit without truncating its content.
const BODY_BYTES = 2 * 1024 * 1024;
const actions = new Set<string>(EXAM_ACTIONS);

/** Saved exams work with the student's session, independently of Gemini availability. */
export function examRoutes() {
  const app = new Hono<AiRouteContext>();
  app.post('/', async (c) => {
    const body = await readAiBody(c.req.raw, BODY_BYTES);
    if (typeof body.action !== 'string' || !actions.has(body.action) ||
      ['actor', 'ownerId', 'studentId', 'serviceToken'].some((field) => field in body)) {
      throw new AiApiError(400, 'invalid', 'La operación de Exámenes no es válida.');
    }
    // Membership, source access, phase-specific solutions and concurrency are checked
    // transactionally in SpacetimeDB. Never substitute the technical service token.
    if (['approveVersion', 'setVisibility', 'startAttempt', 'getVersion', 'getExam', 'getAttempt', 'confirmAnswer', 'saveAnswer',
      'finishAttempt', 'evaluateOpenAnswer', 'sendToSpaced', 'saveToBank', 'setBankVisibility', 'getBankQuestion', 'listBank',
      'previewVariant', 'createVariant', 'importGeneration', 'replaceQuestions'].includes(body.action)) {
      await revalidateDocumentOriginals(c.get('ai'), c.get('sessionToken'), c.env, { examRequest: body });
    }
    return c.json(await c.get('ai').user(c.get('sessionToken'), 'exam_action', body));
  });
  return app;
}
