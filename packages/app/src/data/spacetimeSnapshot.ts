import type { DbConnection } from '../module_bindings';
import type { Snapshot } from './types';
import { enrichAcademicSnapshot } from './academicSnapshot';
import { emptyPresentationsSnapshot } from './presentationDemo';
import { readPresentationsSnapshot, PRESENTATION_VIEWS } from './presentationSnapshot';
import { emptyDelivery2, enrichDelivery2Snapshot } from './delivery2Snapshot';
import { emptyStudyRooms } from './roomTypes';
import { enrichStudyRoomsSnapshot } from './roomsSnapshot';
import { emptyNotifications } from './notificationTypes';
import { enrichNotificationsSnapshot } from './notificationSnapshot';
import { readTrashEntries } from './trashSnapshot';
import { emptyPractice } from './practiceTypes';
import { PRACTICE_VIEWS, readPracticeSnapshot } from './practiceSnapshot';
import { emptyCommunity4 } from './community4Types';
import { readCommunity4Snapshot } from './community4Snapshot';
import { emptyAgent } from './agentTypes';
import { AGENT_VIEWS, readAgentSnapshot } from './agentSnapshot';
import { emptyFeed } from './feedTypes';
import { readFeedSnapshot } from './feedSnapshot';
import type { WithdrawableKind } from './delivery2Types';

/** Solo vistas públicas del módulo; nunca tablas privadas ni SELECT * de toda la base. */
export const PUBLIC_VIEWS = [
  'typing_presence', 'my_onboarding',
  ...PRACTICE_VIEWS,
  ...AGENT_VIEWS,
  'museum_entries', 'museum_revisions', 'opportunities', 'opportunity_revisions', 'opportunity_interests', 'opportunity_feedback',
  'feed_reactions', 'feed_posts', 'feed_comments',
  'my_notifications', 'my_notification_preferences', 'my_push_installations',
  'my_trash_entries',
  'admin_content_entries', 'admin_content_results',
  'help_post_versions',
  ...PRESENTATION_VIEWS,
  'chat_channels', 'channel_messages', 'my_conversation_states', 'my_blocked_members', 'my_message_reports', 'member_profiles', 'member_profile_covers', 'member_upload_stats',
  'note_details', 'note_versions', 'note_editions', 'guide_versions', 'question_comments', 'answer_usefulness', 'question_links', 'resource_versions', 'content_statuses', 'contribution_origins',
  'my_member', 'my_auth_identity', 'members', 'invitations', 'invitation_email_statuses', 'invite_links', 'subjects', 'terms', 'calendar',
  'assignments', 'page_revisions', 'works', 'work_authors', 'work_files',
  'assignment_details', 'my_progress', 'work_details', 'work_revisions', 'work_reviews',
  'academic_comments', 'resource_files', 'activity_links', 'page_snapshots', 'evidence_details',
  'group_messages', 'my_direct_conversations', 'my_direct_messages', 'message_reactions',
  'sticker_packs', 'stickers', 'my_chat_commands', 'birthdays', 'activities', 'evidences',
  'notes', 'note_comments', 'questions', 'answers', 'my_last_seen',
  'study_guides', 'guide_sources', 'guide_reviews', 'guide_ai_source_availability', 'polls', 'poll_votes',
  'help_posts', 'my_help_contact_requests',
  'study_rooms', 'room_members', 'room_materials', 'room_entries', 'room_timers', 'room_summaries', 'my_help_room_links',
  'teaching_practices', 'my_teaching_personal', 'teaching_questions', 'my_teaching_versions',
  'spaced_collections', 'spaced_cards', 'spaced_unavailable_cards', 'my_spaced_enrollments', 'my_spaced_progress', 'my_spaced_reviews',
] as const;

export function emptySnapshot(connection: Snapshot['connection'], connectionError?: string): Snapshot {
  return {
    ...emptyNotifications(),
    trashEntries: [],
    adminContentEntries: [], adminContentResults: [],
    ...emptyPractice(),
    ...emptyCommunity4(),
    ...emptyAgent(),
    ...emptyFeed(),
    ...emptyPresentationsSnapshot(),
    ...emptyStudyRooms(),
    ...emptyDelivery2(),
    connection,
    ...(connectionError ? { connectionError } : {}),
    me: undefined,
    members: [], invitations: [], inviteLinks: [], subjects: [], terms: [], calendar: [], assignments: [],
    works: [], workFiles: [], revisions: [], groupMessages: [], directConversations: [],
    myProgress: [], workRevisions: [], workReviews: [], academicComments: [],
    resourceFiles: [], activityLinks: [], pageSnapshots: [],
    directMessages: [], reactions: [], stickerPacks: [], stickers: [], chatCommands: [],
    birthdays: [], activities: [], evidences: [], notes: [], noteComments: [], questions: [],
    answers: [], guides: [], guideSources: [], guideReviews: [], guideAiSourceAvailability: [], polls: [], pollVotes: [], helpPosts: [], helpContacts: [],
    teachingPractices: [], teachingPersonal: [], teachingQuestions: [],
    spacedCollections: [], spacedCards: [], spacedUnavailableCards: [], spacedEnrollments: [], spacedProgress: [], spacedReviews: [],
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
  // La vista propia debe enlazar explícitamente la sesión actual; una caché antigua no basta.
  const linked = [...db.myAuthIdentity?.iter() ?? []].find((row) => row.sessionIdentity.toHexString() === identity);
  identity = linked?.memberIdentity.toHexString() ?? identity;
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

  const invitationEmails = new Map([...db.invitationEmailStatuses.iter()].map((row) => [row.email, row]));
  const authors = new Map<string, string[]>();
  for (const row of db.workAuthors.iter()) {
    const id = row.workId.toString();
    const entries = authors.get(id) ?? [];
    entries.push(row.author.toHexString());
    authors.set(id, entries);
  }

  // También filtra la caché mientras se propagan una revocación o una baja de integrantes.
  const activeMembers = new Set(members.filter((member) => member.status === 'active').map((member) => member.id));
  const teachingHeads = new Map([...(db.myTeachingVersions?.iter() ?? [])].map((row) => [row.practiceId.toString(), row.version]));
  const teachingPractices = [...db.teachingPractices.iter()].filter((row) =>
    activeMembers.has(row.owner.toHexString()) &&
    (row.owner.toHexString() === identity || row.reviewer?.toHexString() === identity),
  ).map((row) => ({
    id: row.id.toString(), ownerId: row.owner.toHexString(), reviewerId: row.reviewer?.toHexString(),
    version: teachingHeads.get(row.id.toString()) ?? 1,
    subjectId: row.subjectId.toString(), topic: row.topic,
    initial: { concept: row.concept, example: row.example, limits: row.limits },
    revised: { concept: row.revisedConcept, example: row.revisedExample, limits: row.revisedLimits },
    status: enumValue(row.status, ['draft', 'practicing', 'completed']),
    createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate(),
  }));
  const visiblePractices = new Set(teachingPractices.map((practice) => practice.id));
  const ownPractices = new Set(teachingPractices.filter((practice) => practice.ownerId === identity).map((practice) => practice.id));
  const spacedCollections = [...db.spacedCollections.iter()].filter((row) => row.visibility === 'group' || row.ownerId.toHexString() === identity)
    .map((row) => ({
      id: row.id.toString(), subjectId: row.subjectId.toString(), termId: row.termId?.toString(), title: row.title,
      visibility: enumValue(row.visibility, ['personal', 'group']), ownerId: row.ownerId.toHexString(), version: row.version,
      archived: row.archived, createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate(), updatedBy: row.updatedBy.toHexString(),
    }));
  const visibleSpacedCollections = new Map(spacedCollections.map((collection) => [collection.id, collection]));
  const spacedCards = [...db.spacedCards.iter()].filter((row) => {
    const collection = visibleSpacedCollections.get(row.collectionId.toString());
    if (!collection) return false;
    // La caché también retira tarjetas durante la propagación de una fuente que se volvió privada.
    if (row.sourceKind === 'note') return [...db.notes.iter()].some((note) => note.id === row.sourceId &&
      note.subjectId.toString() === collection.subjectId && (note.visibility === 'group' ||
        (collection.visibility === 'personal' && note.author.toHexString() === collection.ownerId)));
    if (row.sourceKind === 'guide') return [...db.studyGuides.iter()].some((guide) => guide.id === row.sourceId && guide.subjectId.toString() === collection.subjectId);
    return false;
  }).map((row) => ({
    id: row.id.toString(), collectionId: row.collectionId.toString(), question: row.question, explanation: row.explanation, hint: row.hint,
    sourceKind: enumValue(row.sourceKind, ['note', 'guide']), sourceId: row.sourceId.toString(), sourceVersion: row.sourceVersion,
    version: row.version, archived: row.archived, createdBy: row.createdBy.toHexString(), updatedBy: row.updatedBy.toHexString(),
    createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate(),
  }));

  const snapshot = enrichStudyRoomsSnapshot(connection, enrichDelivery2Snapshot(connection, enrichAcademicSnapshot(connection, {
    ...emptyNotifications(),
    trashEntries: [],
    ...emptyPractice(),
    ...emptyCommunity4(),
    ...emptyAgent(),
    ...emptyFeed(),
    ...emptyStudyRooms(),
    ...emptyDelivery2(),
    myProgress: [], workRevisions: [], workReviews: [], academicComments: [],
    resourceFiles: [], activityLinks: [], pageSnapshots: [],
    ...readPresentationsSnapshot(connection, identity, members),
    connection: 'ready',
    me,
    members,
    memberUploadStats: db.memberUploadStats ? [...db.memberUploadStats.iter()]
      .filter((row) => activeMembers.has(row.memberId.toHexString()))
      .map((row) => ({ memberId: row.memberId.toHexString(), bytes: fileSize(row.bytes), fileCount: fileSize(row.fileCount) })) : undefined,
    spacedCollections,
    spacedCards,
    spacedUnavailableCards: [...db.spacedUnavailableCards.iter()].filter((row) => visibleSpacedCollections.has(row.collectionId.toString()))
      .map((row) => ({ id: row.id.toString(), collectionId: row.collectionId.toString(), version: row.version, archived: row.archived })),
    spacedEnrollments: [...db.mySpacedEnrollments.iter()].filter((row) => row.memberId.toHexString() === identity).map((row) => ({
      memberId: row.memberId.toHexString(), collectionId: row.collectionId.toString(), active: row.active, updatedAt: row.updatedAt.toDate(),
    })),
    spacedProgress: [...db.mySpacedProgress.iter()].filter((row) => row.memberId.toHexString() === identity).map((row) => ({
      memberId: row.memberId.toHexString(), cardId: row.cardId.toString(), cardVersion: row.cardVersion, step: row.step,
      revision: row.revision, dueAt: row.dueAt.toDate(), reviewedAt: row.reviewedAt.toDate(),
    })),
    spacedReviews: [...db.mySpacedReviews.iter()].filter((row) => row.memberId.toHexString() === identity).map((row) => ({
      id: row.id, requestId: row.requestId, memberId: row.memberId.toHexString(), cardId: row.cardId.toString(),
      cardVersion: row.cardVersion, rating: enumValue(row.rating, ['remembered', 'hint', 'again']), step: row.step,
      reviewedAt: row.reviewedAt.toDate(), dueAt: row.dueAt.toDate(),
    })),
    helpPosts: [...db.helpPosts.iter()]
      .filter((row) => row.author.toHexString() === identity || (row.status !== 'withdrawn' && members.some((m) => m.id === row.author.toHexString() && m.status === 'active')))
      .map((row) => ({
        id: row.id.toString(), kind: enumValue(row.kind, ['offer', 'request']), subjectId: row.subjectId.toString(),
        version: [...(db.helpPostVersions?.iter() ?? [])].find(version => version.postId === row.id)?.version ?? 1,
        title: row.title, topic: row.topic, description: row.description,
        level: enumValue(row.level, ['initial', 'basics', 'advanced']),
        modality: enumValue(row.modality, ['messages', 'video', 'in_person', 'flexible']), availability: row.availability,
        status: enumValue(row.status, ['open', 'closed', 'withdrawn']), authorId: row.author.toHexString(),
        createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate(),
        withdrawnBy: row.withdrawnBy?.toHexString(), withdrawalReason: row.withdrawalReason,
      })),
    helpContacts: [...db.myHelpContactRequests.iter()]
      .filter((row) => row.sender.toHexString() === identity || row.recipient.toHexString() === identity)
      .map((row) => ({
        id: row.id.toString(), postId: row.postId.toString(), senderId: row.sender.toHexString(), recipientId: row.recipient.toHexString(),
        subjectId: row.subjectId.toString(), postTitle: row.postTitle, postTopic: row.postTopic, postKind: enumValue(row.postKind, ['offer', 'request']),
        message: row.message, status: enumValue(row.status, ['pending', 'accepted', 'rejected', 'cancelled', 'closed']),
        conversationId: row.conversationId?.toString(), createdAt: row.createdAt.toDate(), updatedAt: row.updatedAt.toDate(),
        closedBy: row.closedBy?.toHexString(), closeReason: row.closeReason,
      })),
    teachingPractices,
    teachingPersonal: [...db.myTeachingPersonal.iter()].filter((row) => ownPractices.has(row.practiceId.toString())).map((row) => ({
      practiceId: row.practiceId.toString(), reflection: row.reflection, topicsToReview: row.topicsToReview,
      sourceKind: row.sourceKind ? enumValue(row.sourceKind, ['note', 'guide']) : undefined,
      sourceId: row.sourceId?.toString(), sourceVersion: row.sourceVersion,
      publishedNoteId: row.publishedNoteId?.toString(),
    })),
    teachingQuestions: [...db.teachingQuestions.iter()].filter((row) => visiblePractices.has(row.practiceId.toString())).map((row) => ({
      id: row.id.toString(), practiceId: row.practiceId.toString(), authorId: row.author.toHexString(),
      kind: enumValue(row.kind, ['guided', 'peer']), text: row.text, answer: row.answer,
      createdAt: row.createdAt.toDate(), answeredAt: row.answeredAt?.toDate(),
    })),
    invitations: me.isCreator ? [...db.invitations.iter()].map((row) => {
      const email = invitationEmails.get(row.email);
      return {
        email: row.email,
        isCreator: row.isCreator,
        invitedBy: row.invitedBy.toHexString(),
        createdAt: row.createdAt.toDate(),
        // Para quien administra, "en curso" incluye el envío que el worker tiene tomado.
        emailStatus: email ? enumValue(email.status === 'leased' ? 'pending' : email.status, ['pending', 'sent', 'failed']) : undefined,
        emailRequestedAt: email?.requestedAt.toDate(),
        emailSentAt: email?.sentAt?.toDate(),
      };
    }) : [],
    inviteLinks: me.isCreator ? [...db.inviteLinks.iter()].map((row) => ({
      id: row.id.toString(), createdBy: row.createdBy.toHexString(), createdAt: row.createdAt.toDate(),
      expiresAt: row.expiresAt.toDate(), maxUses: row.maxUses, uses: row.uses, revokedAt: row.revokedAt?.toDate(),
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
      id: row.id.toString(), packId: row.packId.toString(), url: row.storageKey.startsWith('native:') ? row.storageKey : '', contentType: row.contentType,
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
  }, identity), identity), identity);
  return { ...enrichNotificationsSnapshot(connection, snapshot, identity), trashEntries: readTrashEntries(connection),
    adminContentEntries: me.isCreator ? [...(db.adminContentEntries?.iter() ?? [])].map((row) => ({ ...row, kind: row.kind as WithdrawableKind, targetId: row.targetId.toString(), ownerIds: row.owners.map((owner) => owner.toHexString()) })) : [],
    adminContentResults: me.isCreator ? [...(db.adminContentResults?.iter() ?? [])].map((row) => ({ operationId: row.operationId, kind: row.kind, targetId: row.targetId.toString(), status: row.status, error: row.error })) : [],
    ...readPracticeSnapshot(connection, identity, members), ...readCommunity4Snapshot(connection, snapshot, identity), ...readAgentSnapshot(connection, snapshot, identity), ...readFeedSnapshot(connection, snapshot, identity) };
}
