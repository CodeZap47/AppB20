import { t, table } from 'spacetimedb/server';
/** Private, accessed only through authenticated owner/reviewer procedures. */
export const presentationAudioUpload = table({ name: 'presentation_audio_upload' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'), attemptId: t.u64().index('btree'),
  name: t.string(), mime: t.string(), bytes: t.u64(), sha256: t.string(), chunkCount: t.u32(), state: t.string(),
  durationSeconds: t.f64().optional(), createdAt: t.timestamp(), expiresAt: t.timestamp(),
});
export const presentationAudioChunk = table({ name: 'presentation_audio_chunk' }, {
  key: t.string().primaryKey(), uploadId: t.string().index('btree'), index: t.u32(), bytes: t.byteArray(), sha256: t.string(),
});
export const presentationAudioGrant = table({ name: 'presentation_audio_grant' }, {
  uploadId: t.string().primaryKey(), reviewer: t.identity(), grantedAt: t.timestamp(),
});
export const presentationAiDraft = table({ name: 'presentation_ai_draft' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'), attemptId: t.u64().index('btree'), json: t.string(),
});
export const presentationFeatureTables = { presentationAudioUpload, presentationAudioChunk, presentationAudioGrant, presentationAiDraft };
