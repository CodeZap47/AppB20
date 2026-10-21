import { t, table } from 'spacetimedb/server';

/** Reviewed text is private to its preparer and is never treated as an original document. */
export const guideAiTranscription = table({ name: 'guide_ai_transcription' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'), fileId: t.string(), fileHash: t.string(),
  targetKind: t.string(), targetId: t.u64(), targetVersion: t.u32(), json: t.string(), createdAt: t.timestamp(),
});
/** Private pipeline; list procedures return metadata, not this JSON or its prepared text. */
export const guideAiDraft = table({ name: 'guide_ai_draft' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'), revision: t.u32(), state: t.string(),
  json: t.string(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
/** Public only through an authorized guide/version lookup. Original draft identifiers stay private. */
export const guideAiProvenance = table({ name: 'guide_ai_provenance' }, {
  key: t.string().primaryKey(), guideId: t.u64().index('btree'), guideVersion: t.u32(), json: t.string(),
});
export const guideAiTables = { guideAiTranscription, guideAiDraft, guideAiProvenance };
