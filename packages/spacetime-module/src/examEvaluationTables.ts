import { table, t } from 'spacetimedb/server';
/** Suggestions, student answers and rubric judgments are never public subscriptions. */
export const examEvaluationDraft = table({ name: 'exam_evaluation_draft' }, { id: t.string().primaryKey(), actor: t.identity().index('btree'), attemptId: t.string(), questionId: t.string(), json: t.string(), createdAt: t.timestamp() });
export const examEvaluationTables = { examEvaluationDraft };
