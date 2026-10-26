import { t, table } from 'spacetimedb/server';

/** All exam tables are private. Catalog and attempt DTOs are projected by exam_action. */
export const studyExam = table({ name: 'exam' }, {
  id: t.string().primaryKey(), owner: t.identity().index('btree'), title: t.string(), subjectId: t.u64(), termId: t.u64().optional(),
  visibility: t.string(), archived: t.bool(), revision: t.u32(), readyVersion: t.u32().optional(), draftVersion: t.u32().optional(),
  createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
export const examVersion = table({ name: 'exam_version' }, {
  key: t.string().primaryKey(), examId: t.string().index('btree'), version: t.u32(), state: t.string(), json: t.string(), createdAt: t.timestamp(),
});
export const examAttempt = table({ name: 'exam_attempt' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'), examId: t.string().index('btree'), version: t.u32(),
  revision: t.u32(), state: t.string(), json: t.string(), startedAt: t.timestamp(),
});
export const examOperation = table({ name: 'exam_operation' }, {
  key: t.string().primaryKey(), actor: t.identity(), action: t.string(), requestHash: t.string(), examId: t.string(), attemptId: t.string(), createdAt: t.timestamp(),
});
export const examGenerationImport = table({ name: 'exam_generation_import' }, {
  generationId: t.string().primaryKey(), actor: t.identity(), examId: t.string(), version: t.u32(),
});
export const examBankQuestion = table({ name: 'exam_bank_question' }, {
  id: t.string().primaryKey(), owner: t.identity().index('btree'), subjectId: t.u64(), termId: t.u64().optional(), visibility: t.string(), version: t.u32(), updatedAt: t.timestamp(),
});
export const examBankVersion = table({ name: 'exam_bank_version' }, { key: t.string().primaryKey(), bankId: t.string().index('btree'), version: t.u32(), json: t.string(), createdAt: t.timestamp() });
export const examTables = { examBankQuestion, examBankVersion,  studyExam, examVersion, examAttempt, examOperation, examGenerationImport };
