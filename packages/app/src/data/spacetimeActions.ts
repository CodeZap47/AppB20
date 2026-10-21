import { CURRICULUM } from '@b20/core';
import { Identity, Timestamp } from 'spacetimedb';
import type { DbConnection } from '../module_bindings';
import type { Actions, AssignmentInput, CreateActivityInput, GuideInput, GuideSourceRef, PollInput } from './types';

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

/** Los reducers confirman los permisos en el servidor; nunca se modifica la caché de forma optimista. */
export function createSpacetimeActions(getConnection: () => DbConnection, identity: () => string): Actions {
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

  return {
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
      (c) => c.reducers.createAssignment(assignment(input)),
      (row, author) => own(row.createdBy, author) && row.subjectId === id(input.subjectId) && row.title === input.title.trim()),
    updateAssignment: (assignmentId, input) => getConnection().reducers.updateAssignment({ assignmentId: id(assignmentId), ...assignment(input) }),
    publishWork: (input) => create((c) => c.db.works.iter(),
      (c) => c.reducers.publishWork({ assignmentId: id(input.assignmentId), title: input.title,
        description: input.description, coauthors: input.coauthorIds.map(member) }),
      (row, author) => own(row.createdBy, author) && row.assignmentId === id(input.assignmentId) && row.title === input.title.trim()),
    updateWork: (workId, title, description) => getConnection().reducers.updateWork({ workId: id(workId), title, description }),
    async attachWorkFile() { throw new Error('Todavía falta configurar el almacenamiento remoto de archivos. No se subió ningún archivo.'); },
    removeWorkFile: (fileId) => getConnection().reducers.removeWorkFile({ fileId: id(fileId) }),
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
    async importStickers() { throw new Error('Todavía falta configurar el almacenamiento remoto de stickers. No se importó ningún paquete.'); },
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
    updateActivity: (activityId, input) => getConnection().reducers.updateActivity({ activityId: id(activityId), ...activity(input) }),
    addEvidence: (activityId, content, participantIds) => create((c) => c.db.evidences.iter(),
      (c) => c.reducers.addEvidence({ activityId: id(activityId), content, participants: participantIds.map(member) }),
      (row, author) => own(row.author, author) && row.activityId === id(activityId) && row.content === content.trim()),
    saveNote: (input) => input.id ? getConnection().reducers.saveNote({ ...input, noteId: id(input.id), subjectId: id(input.subjectId) }).then(() => input.id!) :
      create((c) => c.db.notes.iter(), (c) => c.reducers.saveNote({ ...input, noteId: undefined, subjectId: id(input.subjectId) }),
        (row, author) => own(row.author, author) && row.subjectId === id(input.subjectId) && row.title === input.title.trim()),
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
    updateGuide: (guideId, input) => getConnection().reducers.updateGuide({ guideId: id(guideId), ...guide(input) }),
    addGuideSources: (guideId, refs) => getConnection().reducers.addGuideSources({ guideId: id(guideId), sources: sources(refs) }),
    updateGuideSource: (sourceId, update) => getConnection().reducers.updateGuideSource({ sourceId: id(sourceId), ...update }),
    refreshGuideSource: (sourceId) => getConnection().reducers.refreshGuideSource({ sourceId: id(sourceId) }),
    removeGuideSource: (sourceId) => getConnection().reducers.removeGuideSource({ sourceId: id(sourceId) }),
    reviewGuide: (guideId, verdict, comment) => getConnection().reducers.reviewGuide({ guideId: id(guideId), verdict, comment }),
    createPoll: (input) => create((c) => c.db.polls.iter(),
      (c) => c.reducers.createPoll({ ...poll(input), restartOf: optionalId(input.restartOf) }),
      (row, author) => own(row.createdBy, author) && row.title === input.title.trim()),
    updatePoll: (pollId, input) => getConnection().reducers.updatePoll({ pollId: id(pollId), ...poll(input) }),
    castVote: (pollId, choices) => getConnection().reducers.castVote({ pollId: id(pollId), choices }),
    cancelPoll: (pollId, reason) => getConnection().reducers.cancelPoll({ pollId: id(pollId), reason }),
    recordPollDecision: (pollId, decision) => getConnection().reducers.recordPollDecision({ pollId: id(pollId), decision }),
  };
}
