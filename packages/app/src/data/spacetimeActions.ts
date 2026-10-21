import { CURRICULUM } from '@b20/core';
import { createStudyRoomActions } from './roomsActions';
import { Identity, Timestamp } from 'spacetimedb';
import type { DbConnection } from '../module_bindings';
import type { ResourceTargetKind } from './types';
import type { GuideAiActions } from './guideAiTypes';
import type { ResourceTransport } from './resourceTransport';
import { StickerTransport } from './stickerTransport';
import type { HelpPostInput } from './types';
import type { Actions, AssignmentInput, CreateActivityInput, GuideInput, GuideSourceRef, PollInput, CreateTeachingPracticeInput, SaveTeachingPracticeInput } from './types';

const id = (value: string): bigint => BigInt(value);
const optionalId = (value?: string): bigint | undefined => value ? id(value) : undefined;
const member = (value: string): Identity => Identity.fromString(value);
const assignment = (input: AssignmentInput) => ({ ...input, subjectId: id(input.subjectId),
  termId: optionalId(input.termId), dueDate: input.dueDate ?? '' });
const activity = (input: CreateActivityInput) => ({ ...input, subjectId: id(input.subjectId), termId: optionalId(input.termId) });
const guide = (input: GuideInput) => ({ subjectId: id(input.subjectId), termId: optionalId(input.termId),
  title: input.title, topics: input.topicsText.split(/\r?\n/), sections: input.sections });
const sources = (refs: GuideSourceRef[]) => refs.map((ref) => ({ ...ref, refId: id(ref.refId) }));
const poll = (input: PollInput) => ({ title: input.title, description: input.description, options: input.options,
  multiple: input.multiple, allowChange: input.allowChange, eligible: input.eligibleIds.map(member),
  closesAt: Timestamp.fromDate(input.closesAt) });
const teaching = (input: CreateTeachingPracticeInput) => ({ subjectId: id(input.subjectId), topic: input.topic,
  concept: input.initial.concept, example: input.initial.example, limits: input.initial.limits,
  sourceKind: input.source?.kind, sourceId: optionalId(input.source?.id) });
const teachingUpdate = (input: SaveTeachingPracticeInput) => ({
  concept: input.initial.concept, example: input.initial.example, limits: input.initial.limits,
  revisedConcept: input.revised.concept, revisedExample: input.revised.example, revisedLimits: input.revised.limits,
  reflection: input.reflection, topicsToReview: input.topicsToReview,
});

/** Los reducers confirman los permisos en el servidor; nunca se modifica la caché de forma optimista. */
export function createSpacetimeActions(getConnection: () => DbConnection, identity: () => string, files?: ResourceTransport): Omit<Actions, keyof GuideAiActions> {
  const stickers = new StickerTransport(getConnection, identity);
  let queue = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const pending = queue.then(task);
    queue = pending.then(() => {}, () => {});
    return pending;
  }
  function create<T extends { id: bigint }>(
    rows: (connection: DbConnection) => Iterable<T>,
    reduce: (connection: DbConnection) => Promise<unknown>,
    matches: (row: T, author: string) => boolean,
  ): Promise<string> {
    return serial(async () => {
      const connection = getConnection();
      const author = identity();
      const before = new Set([...rows(connection)].map((row) => row.id));
      await reduce(connection);
      const added = [...rows(connection)].filter((row) => !before.has(row.id) && matches(row, author));
      // Evita navegar al contenido de otra persona ante altas concurrentes o una suscripción interrumpida.
      if (added.length !== 1) throw new Error('Se guardó el cambio, pero no pudimos identificar su página. Actualiza la lista antes de volver a enviarlo.');
      return added[0]!.id.toString();
    });
  }
  const own = (value: Identity, author: string) => value.toHexString() === author;
  const versionFor = (kind: ResourceTargetKind, targetId: string): number => {
    const db = getConnection().db;
    const target = id(targetId);
    if (kind === 'evidence') return [...db.evidenceDetails.iter()].find((row) => row.evidenceId === target)?.version ?? 1;
    if (kind === 'note' || kind === 'guide' || kind === 'profile') {
      const row = kind === 'note' ? [...db.notes.iter()].find((r) => r.id === target)
        : kind === 'guide' ? [...db.studyGuides.iter()].find((r) => r.id === target) : [...db.memberProfiles.iter()].find((r) => r.id === target);
      if (!row) throw new Error('Actualiza la página para comprobar la versión del recurso.');
      return row.version;
    }
    if (['question', 'answer', 'group_message', 'direct_message', 'channel_message'].includes(kind)) {
      return [...db.resourceVersions.iter()].find((r) => r.targetKind === kind && r.targetId === target)?.version ?? 1;
    }
    const rows = kind === 'work' ? db.works.iter() : kind === 'assignment' ? db.assignments.iter() : db.activities.iter();
    const row = [...rows].find((entry) => entry.id === target);
    if (!row || !Number.isInteger(row.version) || row.version < 1) {
      throw new Error('No se pudo comprobar la versión de esta publicación. Actualiza la página antes de guardar.');
    }
    return row.version;
  };
  const resource = (fileId: string) => {
    const db = getConnection().db;
    const row = [...db.resourceFiles.iter()].find((entry) => entry.id === fileId);
    if (row) return { kind: row.targetKind as ResourceTargetKind, targetId: row.targetId.toString() };
    if (fileId.startsWith('legacy:')) {
      const legacyId = id(fileId.slice(7));
      const legacy = [...db.workFiles.iter()].find((entry) => entry.id === legacyId);
      if (legacy) return { kind: 'work' as const, targetId: legacy.workId.toString() };
    }
    throw new Error('El archivo no existe.');
  };
  const transfer = () => {
    getConnection();
    if (!files) throw new Error('Todavía falta configurar el almacenamiento remoto de archivos.');
    return files;
  };
  const attachResourceFile: Actions['attachResourceFile'] = async (kind, targetId, file, expectedVersion, options) =>
    transfer().upload(kind, targetId, file, expectedVersion ?? versionFor(kind, targetId), options);
  const removeResourceFile: Actions['removeResourceFile'] = (fileId, expectedVersion) => {
    const target = resource(fileId);
    return getConnection().reducers.removeResourceFile({ fileId, expectedVersion: expectedVersion ?? versionFor(target.kind, target.targetId) });
  };

  return {
    ...createStudyRoomActions(getConnection, identity),
    createChatChannel: (input) => create((c) => c.db.chatChannels.iter(),
      (c) => c.reducers.createChatChannel({ ...input, subjectId: optionalId(input.subjectId) }),
      (row, author) => own(row.createdBy, author) && row.kind === input.kind && row.name === input.name.trim()),
    setChatChannelArchived: (channelId, archived) => getConnection().reducers.setChatChannelArchived({ channelId: id(channelId), archived }),
    sendChannelMessage: (channelId, text, replyToId) => create((c) => c.db.channelMessages.iter(),
      (c) => c.reducers.sendChannelMessage({ channelId: id(channelId), text, replyToId: optionalId(replyToId) }),
      (row, author) => own(row.sender, author) && row.channelId === id(channelId) && row.text === text.trim()),
    markConversationRead: (scope, conversationId, messageId) => getConnection().reducers.markConversationRead({ scope, conversationId, messageId: id(messageId) }),
    setConversationMuted: (scope, conversationId, muted) => getConnection().reducers.setConversationMuted({ scope, conversationId, muted }),
    setMemberBlocked: (memberId, blocked) => getConnection().reducers.setMemberBlocked({ memberId: member(memberId), blocked }),
    reportMessage: (input) => create((c) => c.db.myMessageReports.iter(),
      (c) => c.reducers.reportMessage({ ...input, messageId: id(input.messageId) }),
      (row, author) => own(row.reporter, author) && row.scope === input.scope && row.messageId === id(input.messageId)),
    resolveMessageReport: (reportId) => getConnection().reducers.resolveMessageReport({ reportId: id(reportId) }),
    saveMemberProfile: (input) => serial(async () => {
      const c = getConnection(); const actor = identity();
      await c.reducers.saveMemberProfile({ ...input, subjectIds: input.subjectIds.map(id) });
      const row = [...c.db.memberProfiles.iter()].find((p) => own(p.memberId, actor));
      if (!row) throw new Error('Se guardó el perfil. Reconecta para consultar su versión.');
      return row.id.toString();
    }),
    publishNoteVersion: (noteId, expectedVersion) => serial(async () => {
      const c = getConnection(); await c.reducers.publishNoteVersion({ noteId: id(noteId), expectedVersion });
      const result = [...c.db.noteDetails.iter()].find((d) => d.publishedFromId === id(noteId) && d.publishedFromVersion === expectedVersion);
      if (!result) throw new Error('Se publicó la nota. Actualiza la lista antes de volver a intentarlo.');
      return result.noteId.toString();
    }),
    restoreNoteVersion: (noteId, version, expectedVersion) => getConnection().reducers.restoreNoteVersion({ noteId: id(noteId), version, expectedVersion }),
    restoreGuideVersion: (guideId, version, expectedVersion) => getConnection().reducers.restoreGuideVersion({ guideId: id(guideId), version, expectedVersion }),
    commentQuestion: (questionId, text, answerId) => getConnection().reducers.commentQuestion({ questionId: id(questionId), text, answerId: optionalId(answerId) }),
    toggleAnswerUsefulness: (answerId) => getConnection().reducers.toggleAnswerUsefulness({ answerId: id(answerId) }),
    saveQuestionLinks: (questionId, noteIds, guideIds) => getConnection().reducers.saveQuestionLinks({ questionId: id(questionId), noteIds: noteIds.map(id), guideIds: guideIds.map(id) }),
    withdrawContent: (kind, targetId, withdrawn, expectedVersion, reason = '') => getConnection().reducers.withdrawContent({ kind, targetId: id(targetId), withdrawn, expectedVersion, reason }),
    saveSpacedCollection: (input) => {
      const fields = { collectionId: optionalId(input.id), subjectId: id(input.subjectId), termId: optionalId(input.termId),
        title: input.title, visibility: input.visibility, expectedVersion: input.expectedVersion };
      return input.id !== undefined ? getConnection().reducers.saveSpacedCollection(fields).then(() => input.id!)
        : create((c) => c.db.spacedCollections.iter(), (c) => c.reducers.saveSpacedCollection(fields),
          (row, author) => own(row.ownerId, author) && row.subjectId === id(input.subjectId) && row.title === input.title.trim());
    },
    publishSpacedCollection: (collectionId, expectedVersion) => getConnection().reducers.publishSpacedCollection({ collectionId: id(collectionId), expectedVersion }),
    archiveSpacedCollection: (collectionId, archived, expectedVersion) => getConnection().reducers.archiveSpacedCollection({ collectionId: id(collectionId), archived, expectedVersion }),
    saveSpacedCard: (input) => {
      const fields = { cardId: optionalId(input.id), collectionId: id(input.collectionId), question: input.question,
        explanation: input.explanation, hint: input.hint, sourceKind: input.sourceKind, sourceId: id(input.sourceId), expectedVersion: input.expectedVersion };
      return input.id !== undefined ? getConnection().reducers.saveSpacedCard(fields).then(() => input.id!)
        : create((c) => c.db.spacedCards.iter(), (c) => c.reducers.saveSpacedCard(fields),
          (row, author) => own(row.createdBy, author) && row.collectionId === id(input.collectionId) &&
            row.question === input.question.trim() && row.sourceKind === input.sourceKind && row.sourceId === id(input.sourceId));
    },
    archiveSpacedCard: (cardId, archived, expectedVersion) => getConnection().reducers.archiveSpacedCard({ cardId: id(cardId), archived, expectedVersion }),
    replaceSpacedCardSource: (cardId, expectedVersion, sourceKind, sourceId) => getConnection().reducers.replaceSpacedCardSource({ cardId: id(cardId), expectedVersion, sourceKind, sourceId: id(sourceId) }),
    setSpacedEnrollment: (collectionId, active) => getConnection().reducers.setSpacedEnrollment({ collectionId: id(collectionId), active }),
    reviewSpacedCard: (input) => getConnection().reducers.reviewSpacedCard({ ...input, cardId: id(input.cardId) }),
    saveHelpPost: (input: HelpPostInput) => {
      const fields = { ...input, id: optionalId(input.id), subjectId: id(input.subjectId) };
      return input.id !== undefined ? getConnection().reducers.saveHelpPost(fields).then(() => input.id!)
        : create((c) => c.db.helpPosts.iter(), (c) => c.reducers.saveHelpPost(fields),
          (row, author) => own(row.author, author) && row.subjectId === id(input.subjectId) && row.kind === input.kind && row.title === input.title.trim());
    },
    setHelpPostStatus: (postId, status) => getConnection().reducers.setHelpPostStatus({ postId: id(postId), status }),
    withdrawHelpPost: (postId, reason = '') => getConnection().reducers.withdrawHelpPost({ postId: id(postId), reason }),
    sendHelpContact: (postId, message = '') => create((c) => c.db.myHelpContactRequests.iter(),
      (c) => c.reducers.sendHelpContact({ postId: id(postId), message }),
      (row, author) => own(row.sender, author) && row.postId === id(postId)),
    respondHelpContact: (requestId, decision) => getConnection().reducers.respondHelpContact({ requestId: id(requestId), decision }),
    cancelHelpContact: (requestId) => getConnection().reducers.cancelHelpContact({ requestId: id(requestId) }),
    closeHelpContact: (requestId) => getConnection().reducers.closeHelpContact({ requestId: id(requestId) }),
    createTeachingPractice: (input) => create((c) => c.db.teachingPractices.iter(),
      (c) => c.reducers.createTeachingPractice(teaching(input)),
      (row, author) => own(row.owner, author) && row.subjectId === id(input.subjectId) && row.topic === input.topic.trim()),
    saveTeachingPractice: (practiceId, input) => getConnection().reducers.saveTeachingPractice({ practiceId: id(practiceId), ...teachingUpdate(input) }),
    startTeachingPractice: (practiceId) => getConnection().reducers.startTeachingPractice({ practiceId: id(practiceId) }),
    completeTeachingPractice: (practiceId) => getConnection().reducers.completeTeachingPractice({ practiceId: id(practiceId) }),
    reopenTeachingPractice: (practiceId) => getConnection().reducers.reopenTeachingPractice({ practiceId: id(practiceId) }),
    setTeachingReviewer: (practiceId, reviewerId) => getConnection().reducers.setTeachingReviewer({ practiceId: id(practiceId), reviewer: reviewerId ? member(reviewerId) : undefined }),
    askTeachingQuestion: (practiceId, text) => create((c) => c.db.teachingQuestions.iter(),
      (c) => c.reducers.askTeachingQuestion({ practiceId: id(practiceId), text }),
      (row, author) => own(row.author, author) && row.practiceId === id(practiceId) && row.kind === 'peer' && row.text === text.trim()),
    answerTeachingQuestion: (questionId, answer) => getConnection().reducers.answerTeachingQuestion({ questionId: id(questionId), answer }),
    publishTeachingExplanation: (practiceId) => serial(async () => {
      const connection = getConnection();
      // El reducer comprueba autoría incluso si esta práctica ya se había publicado.
      await connection.reducers.publishTeachingExplanation({ practiceId: id(practiceId) });
      const personal = [...connection.db.myTeachingPersonal.iter()].find((row) => row.practiceId === id(practiceId));
      if (personal?.publishedNoteId === undefined) throw new Error('Se guardó la publicación, pero no pudimos recuperar la nota. Actualiza la práctica.');
      return personal.publishedNoteId.toString();
    }),
    joinGroup: (displayName) => getConnection().reducers.joinGroup({ displayName }),
    inviteMember: (email, isCreator) => getConnection().reducers.inviteMember({ email, isCreator }),
    revokeInvitation: (email) => getConnection().reducers.revokeInvitation({ email }),
    removeMember: (memberId) => getConnection().reducers.removeMember({ identity: member(memberId) }),
    importCurriculum: () => getConnection().reducers.importCurriculum({ codes: CURRICULUM.map((s) => s.code),
      names: CURRICULUM.map((s) => s.name), periods: CURRICULUM.map((s) => s.period) }),
    updateProfile: (displayName, photoUrl) => getConnection().reducers.updateProfile({ displayName, photoUrl }),
    createSubject: (name, period) => create((c) => c.db.subjects.iter(),
      (c) => c.reducers.createSubject({ name, period }),
      (row, author) => own(row.createdBy, author) && row.name === name.trim() && row.period === period),
    createTerm: (subjectId, name) => serial(async () => {
      const connection = getConnection();
      const subject = id(subjectId);
      const before = new Set([...connection.db.terms.iter()].map((row) => row.id));
      const position = Math.max(0, ...[...connection.db.terms.iter()].filter((row) => row.subjectId === subject).map((row) => row.position)) + 1;
      await connection.reducers.createTerm({ subjectId: subject, name, position });
      const added = [...connection.db.terms.iter()].filter((row) => !before.has(row.id) && row.subjectId === subject && row.name === name.trim() && row.position === position);
      if (added.length !== 1) throw new Error('Se guardó el parcial. Actualiza la lista para encontrarlo.');
      return added[0]!.id.toString();
    }),
    saveCalendar: (period, terms) => getConnection().reducers.saveCalendar({ period,
      startDates: terms.map((term) => term.startDate), endDates: terms.map((term) => term.endDate) }),
    createAssignment: (input) => create((c) => c.db.assignments.iter(),
      (c) => input.topic === undefined ? c.reducers.createAssignment(assignment(input))
        : c.reducers.createAssignmentV2({ ...assignment(input), topic: input.topic }),
      (row, author) => own(row.createdBy, author) && row.subjectId === id(input.subjectId) && row.title === input.title.trim()),
    updateAssignment: (assignmentId, input, expectedVersion) => getConnection().reducers.updateAssignmentV2({
      assignmentId: id(assignmentId), ...assignment(input),
      topic: input.topic ?? [...getConnection().db.assignmentDetails.iter()].find((row) => row.assignmentId === id(assignmentId))?.topic ?? '',
      expectedVersion: expectedVersion ?? versionFor('assignment', assignmentId) }),
    publishWork: (input) => create((c) => c.db.works.iter(),
      (c) => input.topic !== undefined || input.status !== undefined
        ? c.reducers.publishWorkV2({ assignmentId: id(input.assignmentId), title: input.title,
          description: input.description, coauthors: input.coauthorIds.map(member), topic: input.topic ?? '', status: input.status ?? 'draft' })
        : c.reducers.publishWork({ assignmentId: id(input.assignmentId), title: input.title,
          description: input.description, coauthors: input.coauthorIds.map(member) }),
      (row, author) => own(row.createdBy, author) && row.assignmentId === id(input.assignmentId) && row.title === input.title.trim()),
    updateWork: (workId, title, description) => getConnection().reducers.updateWork({ workId: id(workId), title, description }),
    setProgress: (targetKind, targetId, status) => getConnection().reducers.setProgress({ targetKind, targetId: id(targetId), status }),
    saveWorkVersion: (workId, input, expectedVersion) => getConnection().reducers.saveWorkVersion({ workId: id(workId), ...input, expectedVersion }),
    restoreWorkVersion: (workId, version, expectedVersion) => getConnection().reducers.restoreWorkVersion({ workId: id(workId), version, expectedVersion }),
    reviewWork: (workId, expectedVersion, comment) => getConnection().reducers.reviewWork({ workId: id(workId), expectedVersion, comment }),
    commentAcademic: (targetKind, targetId, text) => getConnection().reducers.commentAcademic({ targetKind, targetId: id(targetId), text }),
    saveActivityLinks: (activityId, assignmentIds, noteIds, expectedVersion) => getConnection().reducers.saveActivityLinks({
      activityId: id(activityId), assignmentIds: assignmentIds.map(id), noteIds: noteIds.map(id),
      expectedVersion: expectedVersion ?? versionFor('activity', activityId),
    }),
    restorePageSnapshot: (page, pageId, version, expectedVersion) => getConnection().reducers.restorePageSnapshot({ page, pageId: id(pageId), version, expectedVersion }),
    attachResourceFile, removeResourceFile,
    restoreResourceFile: (fileId, expectedVersion) => getConnection().reducers.restoreResourceFile({ fileId, expectedVersion }),
    downloadResourceFile: async (fileId, options) => transfer().download(fileId, options),
    attachWorkFile: (workId, file) => attachResourceFile('work', workId, file),
    removeWorkFile: (fileId) => {
      const legacy = [...getConnection().db.workFiles.iter()].some((row) => row.id.toString() === fileId);
      return removeResourceFile(legacy ? `legacy:${fileId}` : fileId);
    },
    sendGroupMessage: (text, replyToId) => create((c) => c.db.groupMessages.iter(),
      (c) => c.reducers.sendGroupMessage({ text, replyToId: optionalId(replyToId) }),
      (row, author) => own(row.sender, author) && row.text === text.trim()),
    openDirectConversation: (otherId) => serial(async () => {
      const connection = getConnection();
      const self = identity();
      await connection.reducers.openDirectConversation({ other: member(otherId) });
      const row = [...connection.db.myDirectConversations.iter()].find((conversation) =>
        (own(conversation.userA, self) && own(conversation.userB, otherId)) ||
        (own(conversation.userB, self) && own(conversation.userA, otherId)));
      if (!row) throw new Error('No se pudo recuperar la conversación. Actualiza la lista.');
      return row.id.toString();
    }),
    sendDirectMessage: (conversationId, text, replyToId) => create((c) => c.db.myDirectMessages.iter(),
      (c) => c.reducers.sendDirectMessage({ conversationId: id(conversationId), text, replyToId: optionalId(replyToId) }),
      (row, author) => own(row.sender, author) && row.conversationId === id(conversationId) && row.text === text.trim()),
    editMessage: (scope, messageId, text) => getConnection().reducers.editMessage({ scope, messageId: id(messageId), text }),
    deleteMessage: (scope, messageId) => getConnection().reducers.deleteMessage({ scope, messageId: id(messageId) }),
    toggleReaction: (scope, messageId, emoji) => getConnection().reducers.toggleReaction({ scope, messageId: id(messageId), emoji }),
    importStickers: (name, files) => stickers.import(name, files),
    downloadSticker: (stickerId) => stickers.download(stickerId),
    setStickerPackShared: (packId, shared) => getConnection().reducers.setStickerPackShared({ packId: id(packId), shared }),
    removeStickerPack: (packId) => getConnection().reducers.removeStickerPack({ packId: id(packId) }),
    saveChatCommand: (input) => input.id ? getConnection().reducers.saveChatCommand({ ...input, id: id(input.id) }).then(() => input.id!) :
      create((c) => c.db.myChatCommands.iter(), (c) => c.reducers.saveChatCommand({ ...input, id: undefined }),
        (row, author) => own(row.owner, author) && row.name === input.name.toLowerCase().trim().replace(/^\/+/, '')),
    removeChatCommand: (commandId) => getConnection().reducers.removeChatCommand({ commandId: id(commandId) }),
    shareBirthday: (day, month, remind) => getConnection().reducers.shareBirthday({ day, month, remind }),
    withdrawBirthday: () => getConnection().reducers.withdrawBirthday({}),
    createActivity: (input) => create((c) => c.db.activities.iter(), (c) => c.reducers.createActivity(activity(input)),
      (row, author) => own(row.createdBy, author) && row.subjectId === id(input.subjectId) && row.title === input.title.trim()),
    updateActivity: (activityId, input, expectedVersion) => getConnection().reducers.updateActivityV2({
      activityId: id(activityId), ...activity(input), expectedVersion: expectedVersion ?? versionFor('activity', activityId) }),
    addEvidence: (activityId, content, participantIds) => create((c) => c.db.evidences.iter(),
      (c) => c.reducers.addEvidence({ activityId: id(activityId), content, participants: participantIds.map(member) }),
      (row, author) => own(row.author, author) && row.activityId === id(activityId) && row.content === content.trim()),
    saveNote: (input) => {
      const fields = { noteId: optionalId(input.id), subjectId: id(input.subjectId), termId: optionalId(input.termId), session: input.session ?? '',
        topic: input.topic, title: input.title, body: input.body, tags: input.tags, visibility: input.visibility, source: input.source,
        assignmentIds: (input.assignmentIds ?? []).map(id), activityIds: (input.activityIds ?? []).map(id), questionIds: (input.questionIds ?? []).map(id),
        expectedVersion: input.id ? input.expectedVersion ?? versionFor('note', input.id) : undefined };
      return input.id ? getConnection().reducers.saveNoteV2(fields).then(() => input.id!)
        : create((c) => c.db.notes.iter(), (c) => c.reducers.saveNoteV2(fields),
          (row, author) => own(row.author, author) && row.subjectId === id(input.subjectId) && row.title === input.title.trim());
    },
    commentNote: (noteId, text) => getConnection().reducers.commentNote({ noteId: id(noteId), text }),
    askQuestion: (input) => create((c) => c.db.questions.iter(), (c) => c.reducers.askQuestion({ ...input, subjectId: id(input.subjectId) }),
      (row, author) => own(row.author, author) && row.subjectId === id(input.subjectId) && row.title === input.title.trim()),
    answerQuestion: (questionId, body) => create((c) => c.db.answers.iter(),
      (c) => c.reducers.answerQuestion({ questionId: id(questionId), body }),
      (row, author) => own(row.author, author) && row.questionId === id(questionId) && row.body === body.trim()),
    acceptAnswer: (questionId, answerId) => getConnection().reducers.acceptAnswer({ questionId: id(questionId), answerId: id(answerId) }),
    reopenQuestion: (questionId) => getConnection().reducers.reopenQuestion({ questionId: id(questionId) }),
    markSeen: () => getConnection().reducers.markSeen({}),
    createGuide: (input, refs) => create((c) => c.db.studyGuides.iter(),
      (c) => c.reducers.createGuide({ ...guide(input), sources: sources(refs) }),
      (row, author) => own(row.createdBy, author) && row.subjectId === id(input.subjectId) && row.title === input.title.trim()),
    updateGuide: (guideId, input, expectedVersion) => getConnection().reducers.updateGuideV2({ guideId: id(guideId), ...guide(input), expectedVersion: expectedVersion ?? versionFor('guide', guideId) }),
    addGuideSources: (guideId, refs, expectedVersion) => getConnection().reducers.addGuideSourcesV3({ guideId: id(guideId), sources: sources(refs), expectedVersion: expectedVersion ?? versionFor('guide', guideId) }),
    updateGuideSource: (sourceId, update, expectedVersion) => { const source = [...getConnection().db.guideSources.iter()].find((row) => row.id === id(sourceId)); if (!source) throw new Error('La fuente ya no está disponible.'); return getConnection().reducers.updateGuideSourceV3({ sourceId: id(sourceId), ...update, expectedVersion: expectedVersion ?? versionFor('guide', source.guideId.toString()) }); },
    refreshGuideSource: (sourceId, expectedVersion) => { const source = [...getConnection().db.guideSources.iter()].find((row) => row.id === id(sourceId)); if (!source) throw new Error('La fuente ya no está disponible.'); return getConnection().reducers.refreshGuideSourceV3({ sourceId: id(sourceId), expectedVersion: expectedVersion ?? versionFor('guide', source.guideId.toString()) }); },
    removeGuideSource: (sourceId, expectedVersion) => { const source = [...getConnection().db.guideSources.iter()].find((row) => row.id === id(sourceId)); if (!source) throw new Error('La fuente ya no está disponible.'); return getConnection().reducers.removeGuideSourceV3({ sourceId: id(sourceId), expectedVersion: expectedVersion ?? versionFor('guide', source.guideId.toString()) }); },
    reviewGuide: (guideId, verdict, comment, expectedVersion) => getConnection().reducers.reviewGuideV3({ guideId: id(guideId), verdict, comment, expectedVersion: expectedVersion ?? versionFor('guide', guideId) }),
    createPoll: (input) => create((c) => c.db.polls.iter(),
      (c) => c.reducers.createPoll({ ...poll(input), restartOf: optionalId(input.restartOf) }),
      (row, author) => own(row.createdBy, author) && row.title === input.title.trim()),
    updatePoll: (pollId, input) => getConnection().reducers.updatePoll({ pollId: id(pollId), ...poll(input) }),
    castVote: (pollId, choices) => getConnection().reducers.castVote({ pollId: id(pollId), choices }),
    cancelPoll: (pollId, reason) => getConnection().reducers.cancelPoll({ pollId: id(pollId), reason }),
    recordPollDecision: (pollId, decision) => getConnection().reducers.recordPollDecision({ pollId: id(pollId), decision }),
  };
}
