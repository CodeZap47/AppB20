import type { DbConnection } from '../module_bindings';
import type { Snapshot } from './types';

/** Solo vistas públicas del módulo; nunca tablas privadas ni SELECT * de toda la base. */
export const PUBLIC_VIEWS = [
  'my_member', 'members', 'invitations', 'subjects', 'terms', 'calendar',
  'assignments', 'page_revisions', 'works', 'work_authors', 'work_files',
  'group_messages', 'my_direct_conversations', 'my_direct_messages', 'message_reactions',
  'sticker_packs', 'stickers', 'my_chat_commands', 'birthdays', 'activities', 'evidences',
  'notes', 'note_comments', 'questions', 'answers', 'my_last_seen',
  'study_guides', 'guide_sources', 'guide_reviews', 'polls', 'poll_votes',
] as const;

export function emptySnapshot(connection: Snapshot['connection'], connectionError?: string): Snapshot {
  return {
    connection,
    ...(connectionError ? { connectionError } : {}),
    me: undefined,
    members: [], invitations: [], subjects: [], terms: [], calendar: [], assignments: [],
    works: [], workFiles: [], revisions: [], groupMessages: [], directConversations: [],
    directMessages: [], reactions: [], stickerPacks: [], stickers: [], chatCommands: [],
    birthdays: [], activities: [], evidences: [], notes: [], noteComments: [], questions: [],
    answers: [], guides: [], guideSources: [], guideReviews: [], polls: [], pollVotes: [],
    lastSeenAt: undefined,
  };
}

function enumValue<const T extends readonly string[]>(value: string, allowed: T): T[number] {
  if (!allowed.includes(value)) throw new Error('Los datos recibidos no coinciden con la versión de B20.');
  return value;
}

function fileSize(value: bigint): number {
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('El tamaño de un archivo no es válido.');
  return bytes;
}

/** Convierte tipos de red sin convertir identidades o IDs u64 a números de JavaScript. */
export function readSnapshot(connection: Pick<DbConnection, 'db'>, identity: string): Snapshot {
  const db = connection.db;
  const members = [...db.members.iter()].map((row) => ({
    id: row.identity.toHexString(),
    displayName: row.displayName,
    photoUrl: row.photoUrl,
    status: enumValue(row.status, ['active', 'removed']),
    isCreator: row.isCreator,
    joinedAt: row.joinedAt.toDate(),
  }));
  const memberRow = [...db.myMember.iter()].find((row) => row.identity.toHexString() === identity);
  const me = memberRow ? {
    id: memberRow.identity.toHexString(),
    displayName: memberRow.displayName,
    photoUrl: memberRow.photoUrl,
    status: enumValue(memberRow.status, ['active', 'removed']),
    isCreator: memberRow.isCreator,
    joinedAt: memberRow.joinedAt.toDate(),
  } : undefined;
  // Al darse de baja, ninguna copia local de filas anteriores se sigue mostrando.
  if (me?.status !== 'active') return { ...emptySnapshot('ready'), me };

  const authors = new Map<string, string[]>();
  for (const row of db.workAuthors.iter()) {
    const id = row.workId.toString();
    const entries = authors.get(id) ?? [];
    entries.push(row.author.toHexString());
    authors.set(id, entries);
  }

  return {
    connection: 'ready',
    me,
    members,
    invitations: me.isCreator ? [...db.invitations.iter()].map((row) => ({
      email: row.email,
      isCreator: row.isCreator,
      invitedBy: row.invitedBy.toHexString(),
      createdAt: row.createdAt.toDate(),
    })) : [],
    subjects: [...db.subjects.iter()].map((row) => ({
      id: row.id.toString(), name: row.name, code: row.code || undefined, period: row.period,
    })),
    terms: [...db.terms.iter()].map((row) => ({
      id: row.id.toString(), subjectId: row.subjectId.toString(), name: row.name, position: row.position,
    })),
    calendar: [...db.calendar.iter()].map((row) => ({
      period: row.period, term: row.term, startDate: row.startDate, endDate: row.endDate,
    })),
    assignments: [...db.assignments.iter()].map((row) => ({
      id: row.id.toString(), subjectId: row.subjectId.toString(), termId: row.termId?.toString(),
      kind: enumValue(row.kind, ['tarea', 'actividad', 'exposicion', 'examen']),
      title: row.title, instructions: row.instructions, dueDate: row.dueDate || undefined,
      version: row.version, createdBy: row.createdBy.toHexString(), createdAt: row.createdAt.toDate(),
      updatedBy: row.updatedBy.toHexString(), updatedAt: row.updatedAt.toDate(),
    })),
    works: [...db.works.iter()].map((row) => ({
      id: row.id.toString(), assignmentId: row.assignmentId.toString(), title: row.title,
      description: row.description, version: row.version, authorIds: authors.get(row.id.toString()) ?? [],
      createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate(),
    })),
    workFiles: [...db.workFiles.iter()].map((row) => ({
      id: row.id.toString(), workId: row.workId.toString(), name: row.name, size: fileSize(row.size),
      contentType: row.contentType, uploadedBy: row.uploadedBy.toHexString(), createdAt: row.createdAt.toDate(),
      // storageKey es una referencia privada del servicio, no una URL de descarga autorizada.
    })),
    revisions: [...db.pageRevisions.iter()].map((row) => ({
      id: row.id.toString(), page: enumValue(row.page, ['assignment', 'activity']),
      pageId: row.pageId.toString(), version: row.version, editedBy: row.editedBy.toHexString(),
      editedAt: row.editedAt.toDate(), title: row.title, summary: row.summary, body: row.body,
      dueDate: row.dueDate || undefined,
    })),
    groupMessages: [...db.groupMessages.iter()].map((row) => ({
      id: row.id.toString(), senderId: row.sender.toHexString(), text: row.text,
      sentAt: row.sentAt.toDate(), replyToId: row.replyToId?.toString(),
      editedAt: row.editedAt?.toDate(), deletedAt: row.deletedAt?.toDate(),
      deletedBy: row.deletedBy?.toHexString(),
    })),
    directConversations: [...db.myDirectConversations.iter()].map((row) => ({
      id: row.id.toString(), participantIds: [row.userA.toHexString(), row.userB.toHexString()],
    })),
    directMessages: [...db.myDirectMessages.iter()].map((row) => ({
      id: row.id.toString(), conversationId: row.conversationId.toString(),
      senderId: row.sender.toHexString(), text: row.text, sentAt: row.sentAt.toDate(),
      replyToId: row.replyToId?.toString(), editedAt: row.editedAt?.toDate(),
      deletedAt: row.deletedAt?.toDate(), deletedBy: row.deletedBy?.toHexString(),
    })),
    reactions: [...db.messageReactions.iter()].map((row) => ({
      scope: enumValue(row.scope, ['group', 'direct']), messageId: row.messageId.toString(),
      memberId: row.member.toHexString(), emoji: row.emoji,
    })),
    stickerPacks: [...db.stickerPacks.iter()].map((row) => ({
      id: row.id.toString(), name: row.name, ownerId: row.owner.toHexString(),
      shared: row.shared, createdAt: row.createdAt.toDate(),
    })),
    stickers: [...db.stickers.iter()].map((row) => ({
      id: row.id.toString(), packId: row.packId.toString(), url: '', contentType: row.contentType,
      size: fileSize(row.size), animated: row.animated, createdAt: row.createdAt.toDate(),
    })),
    chatCommands: [...db.myChatCommands.iter()].map((row) => ({
      id: row.id.toString(), ownerId: row.owner.toHexString(), name: row.name,
      description: row.description, text: row.text, createdAt: row.createdAt.toDate(),
    })),
    birthdays: [...db.birthdays.iter()].map((row) => ({
      memberId: row.identity.toHexString(), day: row.day, month: row.month, remind: row.remind,
    })),
    activities: [...db.activities.iter()].map((row) => ({
      id: row.id.toString(), subjectId: row.subjectId.toString(), termId: row.termId?.toString(),
      topic: row.topic, date: row.date, title: row.title, objective: row.objective, instructions: row.instructions,
      version: row.version, createdBy: row.createdBy.toHexString(), createdAt: row.createdAt.toDate(),
      updatedBy: row.updatedBy.toHexString(), updatedAt: row.updatedAt.toDate(),
    })),
    evidences: [...db.evidences.iter()].map((row) => ({
      id: row.id.toString(), activityId: row.activityId.toString(), authorId: row.author.toHexString(),
      participantIds: row.participants.map((member) => member.toHexString()), content: row.content,
      createdAt: row.createdAt.toDate(),
    })),
    notes: [...db.notes.iter()].map((row) => ({
      id: row.id.toString(), subjectId: row.subjectId.toString(), topic: row.topic, title: row.title,
      body: row.body, tags: [...row.tags], visibility: enumValue(row.visibility, ['personal', 'group']),
      source: enumValue(row.source, ['student', 'teacher', 'ai']), authorId: row.author.toHexString(),
      version: row.version, createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate(),
    })),
    noteComments: [...db.noteComments.iter()].map((row) => ({
      id: row.id.toString(), noteId: row.noteId.toString(), authorId: row.author.toHexString(),
      text: row.text, createdAt: row.createdAt.toDate(),
    })),
    questions: [...db.questions.iter()].map((row) => ({
      id: row.id.toString(), subjectId: row.subjectId.toString(), topic: row.topic, title: row.title,
      body: row.body, authorId: row.author.toHexString(), status: enumValue(row.status, ['open', 'resolved']),
      acceptedAnswerId: row.acceptedAnswerId?.toString(), resolvedAt: row.resolvedAt?.toDate(),
      createdAt: row.createdAt.toDate(),
    })),
    answers: [...db.answers.iter()].map((row) => ({
      id: row.id.toString(), questionId: row.questionId.toString(), authorId: row.author.toHexString(),
      body: row.body, createdAt: row.createdAt.toDate(),
    })),
    guides: [...db.studyGuides.iter()].map((row) => ({
      id: row.id.toString(), subjectId: row.subjectId.toString(), termId: row.termId?.toString(),
      title: row.title, topics: [...row.topics], sections: [...row.sections], version: row.version,
      createdBy: row.createdBy.toHexString(), createdAt: row.createdAt.toDate(),
      updatedBy: row.updatedBy.toHexString(), updatedAt: row.updatedAt.toDate(),
    })),
    guideSources: [...db.guideSources.iter()].map((row) => ({
      id: row.id.toString(), guideId: row.guideId.toString(),
      kind: enumValue(row.kind, ['trabajo', 'tarea', 'actividad', 'nota', 'pregunta']),
      refId: row.refId.toString(), sourceVersion: row.sourceVersion,
      status: enumValue(row.status, ['processed', 'pending']), reason: row.reason, topics: [...row.topics],
      addedBy: row.addedBy.toHexString(), addedAt: row.addedAt.toDate(),
    })),
    guideReviews: [...db.guideReviews.iter()].map((row) => ({
      id: row.id.toString(), guideId: row.guideId.toString(), guideVersion: row.guideVersion,
      reviewerId: row.reviewer.toHexString(), verdict: enumValue(row.verdict, ['approved', 'changes']),
      comment: row.comment, createdAt: row.createdAt.toDate(),
    })),
    polls: [...db.polls.iter()].map((row) => ({
      id: row.id.toString(), title: row.title, description: row.description, options: [...row.options],
      multiple: row.multiple, allowChange: row.allowChange,
      eligibleIds: row.eligible.map((member) => member.toHexString()), closesAt: row.closesAt.toDate(),
      createdBy: row.createdBy.toHexString(), createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate(),
      cancelledAt: row.cancelledAt?.toDate(), cancelReason: row.cancelReason, restartOf: row.restartOf?.toString(),
      decision: row.decision, decidedBy: row.decidedBy?.toHexString(), decidedAt: row.decidedAt?.toDate(),
    })),
    pollVotes: [...db.pollVotes.iter()].map((row) => ({
      pollId: row.pollId.toString(), voterId: row.voter.toHexString(), choices: [...row.choices],
      votedAt: row.votedAt.toDate(), changedAt: row.changedAt?.toDate(),
    })),
    lastSeenAt: [...db.myLastSeen.iter()].find((row) => row.identity.toHexString() === identity)?.at.toDate(),
  };
}
