import type { DbConnection } from '../module_bindings';
import type { Snapshot, MessageScope, GuideVersionSource, WithdrawableKind } from './types';

export const emptyDelivery2 = () => ({ typingPresence: [], onboardingCompleted: false, chatChannels: [], channelMessages: [], conversationStates: [], blockedMembers: [], messageReports: [],
  memberProfiles: [], noteVersions: [], guideVersions: [], questionComments: [], answerUsefulness: [], questionLinks: [], contributionOrigins: [] });
const messageOrder = (a: { id: string }, b: { id: string }) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0;

function value<T extends string>(input: string, allowed: readonly T[]): T {
  if (!allowed.includes(input as T)) throw new Error('Actualiza la aplicación para consultar estos datos.');
  return input as T;
}
export function enrichDelivery2Snapshot(connection: Pick<DbConnection, 'db'>, snapshot: Snapshot, identity: string): Snapshot {
  const db = connection.db;
  const versions = new Map([...(db.resourceVersions?.iter() ?? [])].map((row) => [`${row.targetKind}:${row.targetId}`, row.version]));
  const covers = new Map([...(db.memberProfileCovers?.iter() ?? [])].map((row) => [row.profileId.toString(), { preset: row.preset, fileId: row.fileId }]));
  const statuses = new Map([...(db.contentStatuses?.iter() ?? [])].map((row) => [`${row.kind}:${row.targetId}`, row]));
  const status = (kind: WithdrawableKind, id: string) => {
    const row = statuses.get(`${kind}:${id}`);
    return { withdrawnAt: row?.withdrawnAt?.toDate(), withdrawnBy: row?.withdrawnBy?.toHexString() };
  };
  const noteDetails = new Map([...(db.noteDetails?.iter() ?? [])].map((row) => [row.noteId.toString(), row]));
  const notes = snapshot.notes.filter((r) => r.visibility === 'group' || r.authorId === identity).map((row) => { const d = noteDetails.get(row.id); return { ...row, ...status('note', row.id),
    termId: d?.termId?.toString(), session: d?.session || undefined, assignmentIds: d?.assignmentIds.map(String) ?? [],
    activityIds: d?.activityIds.map(String) ?? [], questionIds: d?.questionIds.map(String) ?? [],
    publishedFromId: d?.publishedFromId?.toString(), publishedFromVersion: d?.publishedFromVersion }; });
  const visibleNotes = new Set(notes.filter((n) => n.visibility === 'group' || n.authorId === identity).map((n) => n.id));
  const visibleGuides = new Set(snapshot.guides.map((g) => g.id));
  const scope = (v: string) => value<MessageScope>(v, ['group', 'direct', 'channel']);
  const source = (row: { kind: string; refId: bigint; sourceVersion: number; status: string; reason: string; topics: string[]; addedBy?: { toHexString(): string }; addedAt?: { toDate(): Date } }): GuideVersionSource => ({
    ...row, refId: row.refId.toString(), kind: value(row.kind, ['trabajo', 'tarea', 'actividad', 'nota', 'pregunta']), status: value(row.status, ['processed', 'pending']),
    addedBy: row.addedBy?.toHexString(), addedAt: row.addedAt?.toDate(),
  });
  const enriched: Snapshot = { ...snapshot,
    onboardingCompleted: [...(db.myOnboarding?.iter() ?? [])].some((row) => row.memberId.toHexString() === identity && row.version >= 1),
    typingPresence: [...(db.typingPresence?.iter() ?? [])].map((row) => ({ memberId: row.memberId.toHexString(), scope: scope(row.scope), conversationId: row.conversationId, expiresAt: row.expiresAt.toDate() })),
    guideAiSourceAvailability: [...(db.guideAiSourceAvailability?.iter() ?? [])]
      .filter((row) => snapshot.guides.some((guide) => guide.id === row.guideId.toString() && guide.version === row.guideVersion && !guide.withdrawnAt)
        && snapshot.guideSources.some((source) => source.id === row.sourceId.toString() && source.guideId === row.guideId.toString()))
      .map((row) => ({ sourceId: row.sourceId.toString(), guideId: row.guideId.toString(), guideVersion: row.guideVersion,
        available: row.available, outdated: row.outdated, reason: row.reason })),
    contributionOrigins: [...(db.contributionOrigins?.iter() ?? [])].map((r) => ({
      kind: value(r.kind, ['trabajo', 'apunte', 'evidencia', 'guia', 'respuesta']), refId: r.refId.toString(),
      memberId: r.memberId.toHexString(), creditedAt: r.creditedAt.toDate(), duplicateOf: r.duplicateOf?.toString(),
    })),
    chatChannels: [...(db.chatChannels?.iter() ?? [])].map((r) => ({ id: r.id.toString(), name: r.name, kind: value(r.kind, ['subject', 'topic', 'project']),
      subjectId: r.subjectId?.toString(), createdBy: r.createdBy.toHexString(), createdAt: r.createdAt.toDate(), archivedAt: r.archivedAt?.toDate() })),
    channelMessages: [...(db.channelMessages?.iter() ?? [])].map((r) => ({ id: r.id.toString(), channelId: r.channelId.toString(), senderId: r.sender.toHexString(),
      text: r.text, sentAt: r.sentAt.toDate(), replyToId: r.replyToId?.toString(), editedAt: r.editedAt?.toDate(), deletedAt: r.deletedAt?.toDate(), deletedBy: r.deletedBy?.toHexString(), version: versions.get(`channel_message:${r.id}`) ?? 1 })).sort(messageOrder),
    conversationStates: [...(db.myConversationStates?.iter() ?? [])].filter((r) => r.memberId.toHexString() === identity).map((r) => ({ scope: scope(r.scope), conversationId: r.conversationId, readThroughId: r.readThroughId?.toString(), muted: r.muted })),
    blockedMembers: [...(db.myBlockedMembers?.iter() ?? [])].filter((r) => r.owner.toHexString() === identity).map((r) => ({ memberId: r.memberId.toHexString() })),
    messageReports: [...(db.myMessageReports?.iter() ?? [])].filter((r) => r.reporter.toHexString() === identity || snapshot.me?.isCreator).map((r) => ({
      id: r.id.toString(), scope: scope(r.scope), messageId: r.messageId.toString(), reporterId: r.reporter.toHexString(), reason: r.reason,
      evidenceText: r.evidenceText, attachmentIds: [...r.attachmentIds], createdAt: r.createdAt.toDate(), status: value(r.status, ['open', 'resolved']) })),
    memberProfiles: [...(db.memberProfiles?.iter() ?? [])].filter((r) => snapshot.members.some((m) => m.id === r.memberId.toHexString() && m.status === 'active')).map((r) => ({ ...r,
      id: r.id.toString(), memberId: r.memberId.toHexString(), subjectIds: r.subjectIds.map(String), updatedAt: r.updatedAt.toDate(),
      cover: covers.get(r.id.toString()) })),
    noteVersions: [...(db.noteVersions?.iter() ?? [])].filter((r) => visibleNotes.has(r.noteId.toString()) && (r.visibility === 'group' || r.author.toHexString() === identity)).map((r) => ({ ...r,
      id: r.id.toString(), noteId: r.noteId.toString(), subjectId: r.subjectId.toString(), termId: r.termId?.toString(), session: r.session || undefined,
      visibility: value(r.visibility, ['group', 'personal']), source: value(r.source, ['student', 'teacher', 'ai']), authorId: r.author.toHexString(),
      assignmentIds: r.assignmentIds.map(String), activityIds: r.activityIds.map(String), questionIds: r.questionIds.map(String),
      editedBy: r.editedBy?.toHexString(), editedAt: r.editedAt.toDate() })),
    guideVersions: [...(db.guideVersions?.iter() ?? [])].filter((r) => visibleGuides.has(r.guideId.toString())).map((r) => ({ ...r,
      id: r.id.toString(), guideId: r.guideId.toString(), subjectId: r.subjectId.toString(), termId: r.termId?.toString(), sources: r.sources.map(source), editedBy: r.editedBy?.toHexString(), editedAt: r.editedAt.toDate() })),
    questionComments: [...(db.questionComments?.iter() ?? [])].map((r) => ({ id: r.id.toString(), questionId: r.questionId.toString(), answerId: r.answerId?.toString(), authorId: r.author.toHexString(), text: r.text, createdAt: r.createdAt.toDate() })),
    answerUsefulness: [...(db.answerUsefulness?.iter() ?? [])].map((r) => ({ answerId: r.answerId.toString(), memberId: r.memberId.toHexString(), createdAt: r.createdAt.toDate() })),
    questionLinks: [...(db.questionLinks?.iter() ?? [])].filter((r) => r.targetKind !== 'note' || notes.some((n) => n.id === r.targetId.toString() && n.visibility === 'group' && !n.withdrawnAt)).map((r) => ({ id: r.id.toString(), questionId: r.questionId.toString(), targetKind: value(r.targetKind, ['note', 'guide']), targetId: r.targetId.toString(), addedBy: r.addedBy.toHexString(), createdAt: r.createdAt.toDate() })),
    notes, guides: snapshot.guides.map((r) => ({ ...r, ...status('guide', r.id) })), works: snapshot.works.map((r) => ({ ...r, ...status('work', r.id) })),
    evidences: snapshot.evidences.map((r) => ({ ...r, ...status('evidence', r.id) })),
    questions: snapshot.questions.map((r) => ({ ...r, ...status('question', r.id), version: versions.get(`question:${r.id}`) ?? 1 })),
    answers: snapshot.answers.map((r) => ({ ...r, ...status('answer', r.id), version: versions.get(`answer:${r.id}`) ?? 1 })),
    groupMessages: snapshot.groupMessages.map((r) => ({ ...r, version: versions.get(`group_message:${r.id}`) ?? 1 })).sort(messageOrder),
    directMessages: snapshot.directMessages.map((r) => ({ ...r, version: versions.get(`direct_message:${r.id}`) ?? 1 })).sort(messageOrder),
  };
  const current = (kind: string, id: string) => kind === 'note' ? visibleNotes.has(id) : kind === 'guide' ? visibleGuides.has(id)
    : kind === 'direct_message' ? enriched.directMessages.some((m) => m.id === id && !m.deletedAt)
      : kind === 'group_message' ? enriched.groupMessages.some((m) => m.id === id && !m.deletedAt)
        : kind === 'channel_message' ? enriched.channelMessages.some((m) => m.id === id && !m.deletedAt)
          : kind === 'profile' || kind === 'profile_cover' ? enriched.memberProfiles.some((p) => p.id === id) : true;
  enriched.resourceFiles = enriched.resourceFiles.filter((f) => current(f.targetKind, f.targetId) || enriched.messageReports.some((r) => r.attachmentIds.includes(f.id)));
  return enriched;
}
