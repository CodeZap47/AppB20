import type { Snapshot, Id } from './types';
import type { WithdrawableKind } from './delivery2Types';
import type { AdminContentEntry } from './membershipTypes';

/** Texto libre con resource:id no es una autorización; solo adjuntos de versiones guardadas. */
export function demoReferencedFileReadable(s: Snapshot, fileId: Id): boolean {
  if (s.me?.status !== 'active') return false;
  const readable = (kind: string, id: Id) => kind === 'note' ? s.notes.some((row) => row.id === id && !row.withdrawnAt && (row.visibility === 'group' || row.authorId === s.me?.id))
    : kind === 'guide' ? s.guides.some((row) => row.id === id && !row.withdrawnAt)
    : kind === 'work' ? s.works.some((row) => row.id === id && !row.withdrawnAt)
    : kind === 'assignment' ? s.assignments.some((row) => row.id === id) : kind === 'activity' && s.activities.some((row) => row.id === id);
  return s.noteVersions.some((row) => row.attachmentIds.includes(fileId) && (row.visibility === 'group' || row.authorId === s.me?.id) && readable('note', row.noteId))
    || s.guideVersions.some((row) => row.attachmentIds.includes(fileId) && readable('guide', row.guideId))
    || s.workRevisions.some((row) => row.attachmentIds.includes(fileId) && readable('work', row.workId))
    || s.pageSnapshots.some((row) => row.attachmentIds.includes(fileId) && readable(row.page, row.pageId));
}

/** Solo aportes del grupo: no se incluyen mensajes directos ni materiales personales. */
export function demoContentInventory(s: Snapshot, version: (kind: WithdrawableKind, id: Id) => number, withdrawn: (kind: WithdrawableKind, id: Id) => boolean): AdminContentEntry[] {
  if (!s.me?.isCreator || s.me.status !== 'active') return [];
  const rows: { kind: WithdrawableKind; id: Id; ownerIds: Id[]; title: string }[] = [
    ...s.notes.filter((row) => row.visibility === 'group').map((row) => ({ kind: 'note' as const, id: row.id, ownerIds: [row.authorId], title: row.title })),
    ...s.guides.map((row) => ({ kind: 'guide' as const, id: row.id, ownerIds: [row.createdBy], title: row.title })),
    ...s.questions.map((row) => ({ kind: 'question' as const, id: row.id, ownerIds: [row.authorId], title: row.title })),
    ...s.answers.map((row) => ({ kind: 'answer' as const, id: row.id, ownerIds: [row.authorId], title: row.body })),
    ...s.works.map((row) => ({ kind: 'work' as const, id: row.id, ownerIds: row.authorIds, title: row.title })),
    ...s.evidences.map((row) => ({ kind: 'evidence' as const, id: row.id, ownerIds: [row.authorId], title: row.content })),
    ...s.feedPosts.map((row) => ({ kind: 'feed_post' as const, id: row.id, ownerIds: [row.authorId], title: row.text })),
    ...s.feedComments.map((row) => ({ kind: 'feed_comment' as const, id: row.id, ownerIds: [row.authorId], title: row.text })),
    ...s.groupMessages.filter((row) => !row.deletedAt).map((row) => ({ kind: 'group_message' as const, id: row.id, ownerIds: [row.senderId], title: row.text })),
    ...s.channelMessages.filter((row) => !row.deletedAt).map((row) => ({ kind: 'channel_message' as const, id: row.id, ownerIds: [row.senderId], title: row.text })),
  ];
  return rows.map(({ kind, id: targetId, ownerIds, title }) => {
    const foreign = (person: Id) => !ownerIds.includes(person);
    let foreignDependencies = 0;
    if (kind === 'feed_post') foreignDependencies += s.feedComments.filter((row) => row.postId === targetId && foreign(row.authorId)).length;
    if (kind === 'question') foreignDependencies += s.answers.filter((row) => row.questionId === targetId && foreign(row.authorId)).length + s.questionComments.filter((row) => row.questionId === targetId && foreign(row.authorId)).length;
    if (kind === 'answer') foreignDependencies += s.questionComments.filter((row) => row.answerId === targetId && foreign(row.authorId)).length;
    if (kind === 'note') foreignDependencies += s.noteComments.filter((row) => row.noteId === targetId && foreign(row.authorId)).length;
    if (kind === 'group_message' || kind === 'channel_message') foreignDependencies += (kind === 'group_message' ? s.groupMessages : s.channelMessages).filter((row) => row.replyToId === targetId && !row.deletedAt && foreign(row.senderId)).length;
    foreignDependencies += s.academicComments.filter((row) => row.targetKind === kind && row.targetId === targetId && foreign(row.authorId)).length;
    const sourceKind = ({ note: 'nota', question: 'pregunta', work: 'trabajo', evidence: 'evidencia', guide: 'guia' } as Record<string, string>)[kind];
    foreignDependencies += s.guideSources.filter((row) => row.kind === sourceKind && row.refId === targetId && foreign(s.guides.find((guide) => guide.id === row.guideId)?.createdBy ?? '')).length;
    foreignDependencies += s.roomMaterials.filter((row) => row.kind === kind && row.sourceId === targetId).length;
    const files = s.resourceFiles.filter((file) => file.targetKind === kind && file.targetId === targetId);
    let sharedFiles = 0, reportReferences = 0;
    for (const file of files) {
      const token = `(resource:${file.id})`;
      const shared = s.notes.some((row) => (kind !== 'note' || row.id !== targetId) && row.body.includes(token))
        || s.guides.some((row) => (kind !== 'guide' || row.id !== targetId) && row.sections.some((section) => section.includes(token)))
        || s.noteVersions.some((row) => (kind !== 'note' || row.noteId !== targetId) && (row.attachmentIds.includes(file.id) || row.body.includes(token)))
        || s.guideVersions.some((row) => (kind !== 'guide' || row.guideId !== targetId) && row.attachmentIds.includes(file.id))
        || s.workRevisions.some((row) => (kind !== 'work' || row.workId !== targetId) && row.attachmentIds.includes(file.id))
        || s.pageSnapshots.some((row) => row.attachmentIds.includes(file.id));
      if (shared) sharedFiles++;
      reportReferences += s.messageReports.filter((row) => row.attachmentIds.includes(file.id)).length;
    }
    if (kind === 'group_message' || kind === 'channel_message') reportReferences += s.messageReports.filter((row) => `${row.scope}_message` === kind && row.messageId === targetId).length;
    const collaborative = ownerIds.length > 1;
    return { kind, targetId, ownerIds, title: title.trim().slice(0, 160) || 'Aporte sin título', version: version(kind, targetId), withdrawn: withdrawn(kind, targetId),
      collaborative, foreignDependencies, sharedFiles, reportReferences, safeForBulk: !collaborative && foreignDependencies === 0 && sharedFiles === 0 && reportReferences === 0 };
  });
}
