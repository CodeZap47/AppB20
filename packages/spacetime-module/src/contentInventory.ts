import { contentOwner, withdrawn } from './delivery2Handlers';
import { retentionBlocksRead } from './trashHandlers';
import { isActive, type Ctx, type ViewDb } from './moduleContext';

export const MANAGED_CONTENT_KINDS = ['note', 'question', 'answer', 'guide', 'work', 'evidence', 'feed_post', 'feed_comment', 'group_message', 'channel_message'];
export function contentAuthors(db: ViewDb, kind: string, id: bigint) {
  if (kind === 'work') {
    const authors = [...db.workAuthor.workId.filter(id)].map((row) => row.author);
    if (authors.length) return authors;
  }
  const owner = contentOwner(db, kind, id);
  return owner ? [owner] : [];
}
export function contentVersion(db: ViewDb, kind: string, id: bigint) {
  if (kind === 'note') return db.note.id.find(id)?.version ?? 0;
  if (kind === 'guide') return db.studyGuide.id.find(id)?.version ?? 0;
  if (kind === 'work') return db.work.id.find(id)?.version ?? 0;
  if (kind === 'evidence') return db.evidenceDetail.evidenceId.find(id)?.version ?? 1;
  return db.resourceVersion.key.find(`${kind}:${id}`)?.version ?? 1;
}
export function contentImpact(db: ViewDb, kind: string, id: bigint) {
  const authors = contentAuthors(db, kind, id);
  const foreign = (person: Ctx['sender']) => !authors.some((author) => author.isEqual(person));
  let foreignDependencies = 0;
  if (kind === 'feed_post') foreignDependencies += [...db.feedComment.postId.filter(id)].filter((row) => !row.deletedAt && foreign(row.author)).length;
  if (kind === 'question') {
    foreignDependencies += [...db.answer.questionId.filter(id)].filter((row) => foreign(row.author)).length;
    foreignDependencies += [...db.questionComment.questionId.filter(id)].filter((row) => foreign(row.author)).length;
  }
  if (kind === 'answer') foreignDependencies += [...db.questionComment.iter()].filter((row) => row.answerId === id && foreign(row.author)).length;
  if (kind === 'note') foreignDependencies += [...db.noteComment.iter()].filter((row) => row.noteId === id && foreign(row.author)).length;
  if (kind === 'group_message' || kind === 'channel_message') {
    const rows = kind === 'group_message' ? db.groupMessage.iter() : db.channelMessage.iter();
    foreignDependencies += [...rows].filter((row) => row.replyToId === id && !row.deletedAt && foreign(row.sender)).length;
  }
  foreignDependencies += [...db.academicComment.iter()].filter((row) => row.targetKind === kind && row.targetId === id && foreign(row.author)).length;
  const sourceKind = ({ note: 'nota', question: 'pregunta', work: 'trabajo', evidence: 'evidencia', guide: 'guia' } as Record<string, string>)[kind];
  foreignDependencies += [...db.guideSource.iter()].filter((row) => row.kind === sourceKind && row.refId === id && !!db.studyGuide.id.find(row.guideId) && foreign(db.studyGuide.id.find(row.guideId)!.createdBy)).length;
  foreignDependencies += [...db.roomMaterial.iter()].filter((row) => row.kind === kind && row.sourceId === id).length;
  const ids = new Set([...db.resourceFile.iter()].filter((file) => file.targetKind === kind && file.targetId === id).map((file) => file.id));
  let sharedFiles = 0, reportReferences = 0;
  for (const fileId of ids) {
    const token = `(resource:${fileId})`;
    const storageKey = db.resourceFile.id.find(fileId)?.storageKey;
    const referenced = storageKey !== undefined && [...db.resourceFile.iter()].some((row) => row.id !== fileId && row.storageKey === storageKey && (row.targetKind !== kind || row.targetId !== id))
      || [...db.workRevision.iter()].some((row) => (row.workId !== id || kind !== 'work') && row.attachmentIds.includes(fileId))
      || [...db.noteVersion.iter()].some((row) => (kind !== 'note' || row.noteId !== id) && (row.attachmentIds.includes(fileId) || row.body.includes(token)))
      || [...db.guideVersion.iter()].some((row) => (kind !== 'guide' || row.guideId !== id) && (row.attachmentIds.includes(fileId) || row.sections.some((body) => body.includes(token))))
      || [...db.pageSnapshot.iter()].some((row) => row.attachmentIds.includes(fileId))
      || [...db.note.iter()].some((row) => (kind !== 'note' || row.id !== id) && row.body.includes(token))
      || [...db.studyGuide.iter()].some((row) => (kind !== 'guide' || row.id !== id) && row.sections.some((body) => body.includes(token)));
    if (referenced) sharedFiles++;
    reportReferences += [...db.messageReport.iter()].filter((row) => row.attachmentIds.includes(fileId)).length;
  }
  if (kind === 'group_message' || kind === 'channel_message') reportReferences += [...db.messageReport.iter()].filter((row) => `${row.scope}_message` === kind && row.messageId === id).length;
  const collaborative = authors.length > 1;
  return { collaborative, foreignDependencies, sharedFiles, reportReferences, safeForBulk: !collaborative && foreignDependencies === 0 && sharedFiles === 0 && reportReferences === 0 };
}
function titleOf(db: ViewDb, kind: string, id: bigint) {
  const value = kind === 'note' ? db.note.id.find(id)?.title : kind === 'guide' ? db.studyGuide.id.find(id)?.title
    : kind === 'question' ? db.question.id.find(id)?.title : kind === 'answer' ? db.answer.id.find(id)?.body
    : kind === 'work' ? db.work.id.find(id)?.title : kind === 'evidence' ? db.evidence.id.find(id)?.content
    : kind === 'feed_post' ? db.feedPost.id.find(id)?.text : kind === 'feed_comment' ? db.feedComment.id.find(id)?.text
    : kind === 'group_message' ? db.groupMessage.id.find(id)?.text : db.channelMessage.id.find(id)?.text;
  return (value ?? '').trim().slice(0, 160) || 'Aporte sin título';
}
export function readAdminContentEntries(db: ViewDb, sender: Ctx['sender']) {
  if (!isActive(db, sender) || !db.member.identity.find(sender)?.isCreator) return [];
  const targets: [string, bigint][] = [
    ...[...db.note.iter()].filter((row) => row.visibility === 'group').map((row): [string, bigint] => ['note', row.id]),
    ...[...db.question.iter()].map((row): [string, bigint] => ['question', row.id]),
    ...[...db.answer.iter()].map((row): [string, bigint] => ['answer', row.id]),
    ...[...db.studyGuide.iter()].map((row): [string, bigint] => ['guide', row.id]),
    ...[...db.work.iter()].map((row): [string, bigint] => ['work', row.id]),
    ...[...db.evidence.iter()].map((row): [string, bigint] => ['evidence', row.id]),
    ...[...db.feedPost.iter()].filter((row) => !row.deletedAt).map((row): [string, bigint] => ['feed_post', row.id]),
    ...[...db.feedComment.iter()].filter((row) => !row.deletedAt && !db.feedPost.id.find(row.postId)?.deletedAt).map((row): [string, bigint] => ['feed_comment', row.id]),
    ...[...db.groupMessage.iter()].filter((row) => !row.deletedAt).map((row): [string, bigint] => ['group_message', row.id]),
    ...[...db.channelMessage.iter()].filter((row) => !row.deletedAt).map((row): [string, bigint] => ['channel_message', row.id]),
  ];
  return targets.filter(([kind, id]) => !retentionBlocksRead(db, kind, id)).map(([kind, targetId]) => ({
    kind, targetId, owners: contentAuthors(db, kind, targetId), title: titleOf(db, kind, targetId), version: contentVersion(db, kind, targetId),
    withdrawn: withdrawn(db, kind, targetId), ...contentImpact(db, kind, targetId),
  }));
}
