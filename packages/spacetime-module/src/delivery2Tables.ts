import { t, table } from 'spacetimedb/server';

export const chatChannel = table({ name: 'chat_channel' }, {
  id: t.u64().primaryKey().autoInc(), name: t.string(), kind: t.string(), subjectId: t.u64().optional(),
  createdBy: t.identity(), createdAt: t.timestamp(), archivedAt: t.timestamp().optional(),
});
export const channelMessage = table({ name: 'channel_message' }, {
  id: t.u64().primaryKey().autoInc(), channelId: t.u64().index('btree'), sender: t.identity(),
  text: t.string(), sentAt: t.timestamp(), replyToId: t.u64().optional(),
  editedAt: t.timestamp().optional(), deletedAt: t.timestamp().optional(), deletedBy: t.identity().optional(),
});
export const conversationState = table({ name: 'conversation_state' }, {
  key: t.string().primaryKey(), memberId: t.identity().index('btree'), scope: t.string(), conversationId: t.string(),
  readThroughId: t.u64().optional(), muted: t.bool(), updatedAt: t.timestamp(),
});
export const memberBlock = table({ name: 'member_block' }, {
  key: t.string().primaryKey(), owner: t.identity().index('btree'), memberId: t.identity(), createdAt: t.timestamp(),
});
export const messageReport = table({ name: 'message_report' }, {
  id: t.u64().primaryKey().autoInc(), reporter: t.identity(), scope: t.string(), messageId: t.u64(),
  reason: t.string(), evidenceText: t.string(), attachmentIds: t.array(t.string()),
  createdAt: t.timestamp(), status: t.string(), resolvedBy: t.identity().optional(), resolvedAt: t.timestamp().optional(),
});
export const noteDetail = table({ name: 'note_detail' }, {
  noteId: t.u64().primaryKey(), termId: t.u64().optional(), session: t.string(),
  assignmentIds: t.array(t.u64()), activityIds: t.array(t.u64()), questionIds: t.array(t.u64()),
  publishedFromId: t.u64().optional(), publishedFromVersion: t.u32().optional(),
});
export const noteVersion = table({ name: 'note_version' }, {
  id: t.u64().primaryKey().autoInc(), noteId: t.u64().index('btree'), version: t.u32(), subjectId: t.u64(),
  termId: t.u64().optional(), session: t.string(), topic: t.string(), title: t.string(), body: t.string(),
  tags: t.array(t.string()), visibility: t.string(), source: t.string(), author: t.identity(),
  assignmentIds: t.array(t.u64()), activityIds: t.array(t.u64()), questionIds: t.array(t.u64()), attachmentIds: t.array(t.string()),
  editedBy: t.identity().optional(), editedAt: t.timestamp(), restoredFromVersion: t.u32().optional(),
});
const versionSource = t.object('VersionGuideSource', {
  kind: t.string(), refId: t.u64(), sourceVersion: t.u32(), status: t.string(), reason: t.string(), topics: t.array(t.string()),
  addedBy: t.identity().optional(), addedAt: t.timestamp().optional(),
});
export const guideVersion = table({ name: 'guide_version' }, {
  id: t.u64().primaryKey().autoInc(), guideId: t.u64().index('btree'), version: t.u32(), subjectId: t.u64(),
  termId: t.u64().optional(), title: t.string(), topics: t.array(t.string()), sections: t.array(t.string()),
  sources: t.array(versionSource), attachmentIds: t.array(t.string()), editedBy: t.identity().optional(), editedAt: t.timestamp(),
  restoredFromVersion: t.u32().optional(),
});
export const questionComment = table({ name: 'question_comment' }, {
  id: t.u64().primaryKey().autoInc(), questionId: t.u64().index('btree'), answerId: t.u64().optional(),
  author: t.identity(), text: t.string(), createdAt: t.timestamp(),
});
export const answerUsefulness = table({ name: 'answer_usefulness_record' }, {
  key: t.string().primaryKey(), answerId: t.u64().index('btree'), memberId: t.identity(), createdAt: t.timestamp(),
});
export const questionLink = table({ name: 'question_link' }, {
  id: t.u64().primaryKey().autoInc(), questionId: t.u64().index('btree'), targetKind: t.string(), targetId: t.u64(),
  addedBy: t.identity(), createdAt: t.timestamp(),
});
/** Versiones de entidades cuyo esquema histórico no tenía contador. */
export const resourceVersion = table({ name: 'resource_version' }, {
  key: t.string().primaryKey(), targetKind: t.string(), targetId: t.u64(), version: t.u32(),
});
export const memberProfile = table({ name: 'member_profile' }, {
  id: t.u64().primaryKey().autoInc(), memberId: t.identity().unique(), preferredName: t.string(), bio: t.string(),
  interests: t.array(t.string()), learningGoals: t.string(), skills: t.array(t.string()), helpTopics: t.array(t.string()),
  portfolioLinks: t.array(t.string()), subjectIds: t.array(t.u64()), photoFileId: t.string().optional(),
  version: t.u32(), updatedAt: t.timestamp(),
});
/** Portada del perfil: degradado elegido y, si la hay, la imagen vigente (archivo `profile_cover`). */
export const memberProfileCover = table({ name: 'member_profile_cover' }, {
  profileId: t.u64().primaryKey(), preset: t.string(), fileId: t.string().optional(), updatedAt: t.timestamp(),
});
export const contentStatus = table({ name: 'content_status' }, {
  key: t.string().primaryKey(), kind: t.string(), targetId: t.u64(),
  withdrawnAt: t.timestamp().optional(), withdrawnBy: t.identity().optional(), reason: t.string(),
});
export const stickerBlob = table({ name: 'sticker_blob' }, {
  stickerId: t.u64().primaryKey(), requestId: t.string().unique(), name: t.string(),
  bytes: t.byteArray(), hash: t.string(),
});
export const stickerImport = table({ name: 'sticker_import' }, {
  requestId: t.string().primaryKey(), owner: t.identity(), name: t.string(), packId: t.u64(), createdAt: t.timestamp(),
});

export const delivery2Tables = { chatChannel, channelMessage, conversationState, memberBlock, messageReport,
  noteDetail, noteVersion, guideVersion, questionComment, answerUsefulness, questionLink, resourceVersion, memberProfile, memberProfileCover, contentStatus,
  stickerBlob, stickerImport };
