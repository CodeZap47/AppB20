import { t, table } from 'spacetimedb/server';

/** A server-computed SHA-256 bound to the original storage identity; never client-authored. */
export const documentFileVerification = table({ name: 'document_file_verification' }, {
  fileId: t.string().primaryKey(), stamp: t.string(), sha256: t.string(), objectEtag: t.string(), verifiedAt: t.timestamp(),
});
export const documentTranscription = table({ name: 'document_transcription' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'), fileId: t.string(), json: t.string(), createdAt: t.timestamp(),
});
export const documentOcrDraft = table({ name: 'document_ocr_draft' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'), revision: t.u32(), json: t.string(), createdAt: t.timestamp(),
});
export const documentTables = { documentFileVerification, documentTranscription, documentOcrDraft };
