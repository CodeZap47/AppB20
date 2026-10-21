import {
  presentationGuidingQuestions,
  cleanHelpPost,
  helpText,
  HELP_LIMITS,
  buildPeriodCalendar,
  canDeleteMessage,
  canEditMessage,
  commandNameError,
  detectImageType,
  isAnimatedWebp,
  isReaction,
  MAX_STICKERS_PER_PACK,
  normalizeCommandName,
  stickerFileError,
  canManageCalendar,
  canReadDirectConversation,
  canReviewGuide,
  CURRICULUM,
  GUIDE_SECTIONS,
  isGuideReviewVerdict,
  isGuideSourceKind,
  MAX_GUIDE_SECTION_LENGTH,
  MAX_REVIEW_COMMENT_LENGTH,
  parseTopics,
  sourceStatusError,
  type GuideReviewVerdict,
  cleanPollOptions,
  closingError,
  MAX_POLL_DESCRIPTION_LENGTH,
  MAX_POLL_NOTE_LENGTH,
  MAX_POLL_TITLE_LENGTH,
  pollStatus,
  voteError,
  isValidBirthday,
  isValidPeriod,
  isWorkKind,
  termNames,
  type TermDates,
  type TermDatesInput,
  EMPTY_TEACHING_EXPLANATION,
  TEACHING_PROMPTS,
  MAX_TEACHING_TOPIC_LENGTH,
  MAX_TEACHING_TEXT_LENGTH,
  MAX_TEACHING_QUESTION_LENGTH,
  normalizeTeachingExplanation,
  teachingExplanationError,
  teachingCompletionError,
  teachingNoteBody,
  nextSpacedSchedule,
  MAX_SPACED_TITLE_LENGTH,
  MAX_SPACED_QUESTION_LENGTH,
  MAX_SPACED_EXPLANATION_LENGTH,
  MAX_SPACED_HINT_LENGTH,
} from '@b20/core';
import type {
  HelpPost,
  HelpContactRequest,
  HelpPostInput,
  Invitation,
  Activity,
  Assignment,
  AssignmentInput,
  Revision,
  Answer,
  AskQuestionInput,
  Birthday,
  ChatCommand,
  MessageFields,
  MessageReaction,
  MessageScope,
  SaveChatCommandInput,
  Sticker,
  StickerPack,
  CreateActivityInput,
  Evidence,
  GuideInput,
  GuideReview,
  GuideSource,
  GuideSourceRef,
  GuideSourceUpdate,
  StudyGuide,
  Note,
  NoteComment,
  Poll,
  PollInput,
  PollVote,
  Question,
  SaveNoteInput,
  DataSource,
  DirectConversation,
  DirectMessage,
  GroupMessage,
  Id,
  Member,
  PublishWorkInput,
  Snapshot,
  Subject,
  Term,
  Work,
  WorkFile,
  TeachingPractice,
  TeachingPersonal,
  TeachingQuestion,
  CreateTeachingPracticeInput,
  SaveTeachingPracticeInput,
  ProgressTargetKind,
  ProgressStatus,
  ResourceTargetKind,
  ResourceTransferOptions,
  WorkVersionInput,
  SpacedCollection,
  SpacedCard,
  SpacedEnrollment,
  SpacedProgress,
  SpacedReview,
  SpacedCollectionInput,
  SpacedCardInput,
  SpacedReviewInput,
  MemberProfile,
  MemberProfileInput,
  CreateChatChannelInput,
  ReportMessageInput,
  WithdrawableKind,
} from './types';
import { toDay } from '../lib/format';
import { referencesIn } from '../lib/references';
import { DemoAcademicStore } from './demoAcademic';
import { DemoPresentationStore, emptyPresentationsSnapshot, type PresentationDemoState } from './presentationDemo';
import type { PresentationPracticeInput, PresentationAttemptInput, PresentationFeedbackInput } from './presentationTypes';
import { DemoChatStore } from './demoChat';
import { DemoKnowledgeStore } from './demoKnowledge';
import { saveDemoMemberProfile } from './communityDemo';
import { emptyDelivery2 } from './delivery2Snapshot';
import { DemoTrashStore } from './demoTrash';
import { DemoNotificationsStore } from './demoNotifications';
import { emptyNotifications, type NotificationActions, type NotificationKind } from './notificationTypes';
import { DemoRoomsStore, demoRoomExamples } from './demoRooms';
import { emptyStudyRooms, type StudyRoomActions, type StudyRoomsSnapshot } from './roomTypes';

/**
 * Fuente de datos en memoria para desarrollar la interfaz antes de conectar SpacetimeDB.
 * Aplica las mismas reglas que el módulo del servidor (membresía activa, privacidad de los
 * mensajes 1 a 1, autoría) para que la UI se comporte igual.
 *
 * Todo lo que contiene son datos de prueba identificados como tales; no representa a
 * ningún compañero real.
 */

interface State extends PresentationDemoState, StudyRoomsSnapshot {
  invitations: Invitation[];
  members: Member[];
  subjects: Subject[];
  terms: Term[];
  calendar: TermDates[];
  assignments: Assignment[];
  works: Work[];
  workFiles: WorkFile[];
  revisions: Revision[];
  groupMessages: GroupMessage[];
  directConversations: DirectConversation[];
  directMessages: DirectMessage[];
  reactions: MessageReaction[];
  stickerPacks: StickerPack[];
  stickers: Sticker[];
  chatCommands: ChatCommand[];
  birthdays: Birthday[];
  activities: Activity[];
  evidences: Evidence[];
  notes: Note[];
  noteComments: NoteComment[];
  questions: Question[];
  answers: Answer[];
  guides: StudyGuide[];
  guideSources: GuideSource[];
  guideReviews: GuideReview[];
  polls: Poll[];
  pollVotes: PollVote[];
  helpPosts: HelpPost[];
  helpContacts: HelpContactRequest[];
  teachingPractices: TeachingPractice[];
  teachingPersonal: TeachingPersonal[];
  teachingQuestions: TeachingQuestion[];
  spacedCollections: SpacedCollection[];
  spacedCards: SpacedCard[];
  spacedEnrollments: SpacedEnrollment[];
  spacedProgress: SpacedProgress[];
  spacedReviews: (SpacedReview & { expectedRevision: number })[];
  lastSeen: Record<Id, Date>;
}

const sharedDemoListeners = new WeakMap<State, Set<() => void>>();
const sharedDemoIds = new WeakMap<State, number>();
type DemoWithdrawal = { withdrawnAt?: Date; withdrawnBy?: Id; reason: string };
const sharedDemoWithdrawals = new WeakMap<State, Map<string, DemoWithdrawal>>();

function emptyState(): State {
  return {
    ...emptyPresentationsSnapshot(), presentationRequests: [],
    ...emptyStudyRooms(),
    invitations: [], members: [], subjects: [], terms: [], calendar: [], assignments: [],
    works: [], workFiles: [], revisions: [], groupMessages: [], directConversations: [],
    directMessages: [], reactions: [], stickerPacks: [], stickers: [], chatCommands: [],
    birthdays: [], activities: [], evidences: [], notes: [], noteComments: [], questions: [],
    answers: [], guides: [], guideSources: [], guideReviews: [], polls: [], pollVotes: [], helpPosts: [], helpContacts: [],
    teachingPractices: [], teachingPersonal: [], teachingQuestions: [],
    spacedCollections: [], spacedCards: [], spacedEnrollments: [], spacedProgress: [], spacedReviews: [], lastSeen: {},
  };
}

const MAX_TEXT = 4000;
const textTopic = (value?: string) => {
  const topic = value?.trim() ?? '';
  if (topic.length > 120) throw new Error('El tema excede 120 caracteres.');
  return topic;
};

/** Altas, bajas e invitaciones: solo creadores activos (`canManageMembership` en `@b20/core`). */
function isCreator(m: Member | undefined): boolean {
  return m?.status === 'active' && m.isCreator;
}

function requireText(value: string, field: string, max = MAX_TEXT): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} no puede estar vacío.`);
  if (trimmed.length > max) throw new Error(`${field} excede ${max} caracteres.`);
  return trimmed;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export class DemoDataSource implements DataSource {
  readonly label = 'Datos de prueba';
  #state: State;
  #viewerId: Id;
  #listeners = new Set<() => void>();
  #snapshot: Snapshot | undefined;
  #now: () => Date;
  #disposed = false;
  #objectUrls = new Set<string>();
  #academic: DemoAcademicStore;
  #presentations: DemoPresentationStore;
  #chat: DemoChatStore;
  #knowledge: DemoKnowledgeStore;
  #rooms: DemoRoomsStore;
  #trash: DemoTrashStore;
  #notifications: DemoNotificationsStore;
  #batchDepth = 0;
  #batchChanged = false;
  #profiles: MemberProfile[] = [];
  #withdrawals: Map<string, DemoWithdrawal>;
  #invalidate = () => { this.#snapshot = undefined; for (const listener of this.#listeners) listener(); };

  constructor(state: State, viewerId: Id, now: () => Date = () => new Date()) {
    this.#state = state;
    const observers = sharedDemoListeners.get(state) ?? new Set<() => void>();
    observers.add(this.#invalidate); sharedDemoListeners.set(state, observers);
    this.#withdrawals = sharedDemoWithdrawals.get(state) ?? new Map<string, DemoWithdrawal>();
    sharedDemoWithdrawals.set(state, this.#withdrawals);
    this.#viewerId = viewerId;
    this.#now = now;
    this.#presentations = new DemoPresentationStore({ state: () => this.#state, active: () => this.#activeMember(),
      id: () => this.#id(), now: () => this.#now(), emit: () => this.#emit(),
      sourceAvailable: (kind, sourceId) => !this.#withdrawals.get(`${kind}:${sourceId}`)?.withdrawnAt });
    this.#academic = new DemoAcademicStore({ state: () => this.#state, active: () => this.#activeMember(),
      id: () => this.#id(), now: () => this.#now(), emit: () => this.#emit(),
      updateAssignment: (id, input, expected) => this.updateAssignment(id, input, expected),
      updateActivity: (id, input, expected) => this.updateActivity(id, input, expected),
      extraTarget: (kind, id, editable) => this.#extraTarget(kind, id, editable),
      captureExtra: (kind, id) => this.#captureExtra(kind, id),
      changedExtra: (kind, id) => this.#changedExtra(kind, id) });
    this.#chat = new DemoChatStore({ state: () => this.#state, active: () => this.#activeMember(), id: () => this.#id(), now: () => this.#now(), emit: () => this.#emit(), validateText: (text, me) => this.#messageText(text, me) });
    this.#knowledge = new DemoKnowledgeStore({ state: () => this.#state, active: () => this.#activeMember(), id: () => this.#id(), now: () => this.#now(), emit: () => this.#emit(),
      files: () => this.#academic.resources(), restoreFiles: (kind, id, ids) => this.#academic.restoreFiles(kind, id, ids), copyFiles: (from, to) => this.#academic.copyFiles(from, to) });
    this.#trash = new DemoTrashStore({ state: () => this.#state, active: () => this.#activeMember(), now: () => this.#now(), emit: () => this.#emit(), resources: () => this.#academic.resources(),
      purgePrivate: (targets) => { const references = this.#knowledge.purgeTargets(targets); this.#academic.purgeTargets(targets, references); } });
    this.#notifications = new DemoNotificationsStore({ state: () => this.#state, active: () => this.#activeMember(), current: () => this.getSnapshot(), now: () => this.#now(), id: () => this.#id(), emit: () => this.#emit() });
    this.#rooms = new DemoRoomsStore({ state: () => this.#state, active: () => this.#activeMember(), id: () => this.#id(), now: () => this.#now(), emit: () => this.#emit(),
      sourceAvailable: (kind, sourceId) => !this.#withdrawals.get(`${kind}:${sourceId}`)?.withdrawnAt });
  }

  get viewerId(): Id {
    return this.#viewerId;
  }

  saveNotificationPreferences = (...args: Parameters<NotificationActions['saveNotificationPreferences']>) => this.#notifications.saveNotificationPreferences(...args);
  markNotificationRead = (...args: Parameters<NotificationActions['markNotificationRead']>) => this.#notifications.markNotificationRead(...args);
  markAllNotificationsRead = () => this.#notifications.markAllNotificationsRead();
  registerPushInstallation = (...args: Parameters<NotificationActions['registerPushInstallation']>) => this.#notifications.registerPushInstallation(...args);
  removePushInstallation = (...args: Parameters<NotificationActions['removePushInstallation']>) => this.#notifications.removePushInstallation(...args);
  requestNotificationTest = () => this.#notifications.requestNotificationTest();
  async getTrashClock(): Promise<Date> {
    this.#activeMember();
    if (this.#trash.purgeDue()) { for (const key of this.#trash.purgedKeys()) this.#withdrawals.delete(key); this.#emit(); }
    return this.#now();
  }

  createStudyRoom = (...args: Parameters<StudyRoomActions['createStudyRoom']>) => this.#rooms.createStudyRoom(...args);
  updateStudyRoom = (...args: Parameters<StudyRoomActions['updateStudyRoom']>) => this.#rooms.updateStudyRoom(...args);
  joinStudyRoom = (...args: Parameters<StudyRoomActions['joinStudyRoom']>) => this.#rooms.joinStudyRoom(...args);
  leaveStudyRoom = (...args: Parameters<StudyRoomActions['leaveStudyRoom']>) => this.#rooms.leaveStudyRoom(...args);
  inviteStudyRoomMember = (...args: Parameters<StudyRoomActions['inviteStudyRoomMember']>) => this.#rooms.inviteStudyRoomMember(...args);
  respondStudyRoomInvitation = (...args: Parameters<StudyRoomActions['respondStudyRoomInvitation']>) => this.#rooms.respondStudyRoomInvitation(...args);
  removeStudyRoomMember = (...args: Parameters<StudyRoomActions['removeStudyRoomMember']>) => this.#rooms.removeStudyRoomMember(...args);
  setStudyRoomStatus = (...args: Parameters<StudyRoomActions['setStudyRoomStatus']>) => this.#rooms.setStudyRoomStatus(...args);
  setStudyRoomMaterial = (...args: Parameters<StudyRoomActions['setStudyRoomMaterial']>) => this.#rooms.setStudyRoomMaterial(...args);
  sendStudyRoomEntry = (...args: Parameters<StudyRoomActions['sendStudyRoomEntry']>) => this.#rooms.sendStudyRoomEntry(...args);
  controlStudyRoomTimer = (...args: Parameters<StudyRoomActions['controlStudyRoomTimer']>) => this.#rooms.controlStudyRoomTimer(...args);
  saveStudyRoomSummary = (...args: Parameters<StudyRoomActions['saveStudyRoomSummary']>) => this.#rooms.saveStudyRoomSummary(...args);
  publishStudyRoomSummary = (...args: Parameters<StudyRoomActions['publishStudyRoomSummary']>) => this.#rooms.publishStudyRoomSummary(...args);
  getStudyRoomClock = (...args: Parameters<StudyRoomActions['getStudyRoomClock']>) => this.#rooms.getStudyRoomClock(...args);

  /** Solo en modo de prueba: ver la app como otro miembro para revisar permisos. */
  setViewer(id: Id) {
    this.#assertAlive();
    this.#viewerId = id;
    this.#emit();
  }

  subscribe(listener: () => void) {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getSnapshot(): Snapshot {
    if (!this.#disposed && this.#trash.purgeDue()) {
      for (const key of this.#trash.purgedKeys()) this.#withdrawals.delete(key);
      this.#snapshot = undefined;
      queueMicrotask(() => { if (!this.#disposed) this.#emit(); });
    }
    this.#snapshot ??= this.#buildSnapshot();
    return this.#snapshot;
  }

  /** La sesión propietaria descarta la simulación y todos sus recursos locales al salir. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const url of this.#objectUrls) {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    }
    this.#objectUrls.clear();
    this.#academic.dispose();
    this.#chat.dispose();
    this.#notifications.dispose();
    this.#profiles = [];
    sharedDemoListeners.get(this.#state)?.delete(this.#invalidate);
    this.#listeners.clear();
    this.#state = emptyState();
    this.#viewerId = '';
    this.#snapshot = undefined;
  }

  #assertAlive(): void {
    if (this.#disposed) throw new Error('La sesión de prueba ya terminó.');
  }

  #buildSnapshot(): Snapshot {
    const s = this.#state;
    const me = s.members.find((m) => m.id === this.#viewerId);
    if (me?.status !== 'active') {
      return {
        ...emptyNotifications(),
        trashEntries: [],
        ...emptyPresentationsSnapshot(),
        ...emptyStudyRooms(),
        ...emptyDelivery2(),
        connection: this.#disposed ? 'offline' : 'ready',
        connectionError: this.#disposed ? 'La sesión de prueba ya terminó.' : undefined,
        me,
        members: [],
        invitations: [],
        subjects: [],
        terms: [],
        calendar: [],
        assignments: [],
        works: [],
        myProgress: [], workRevisions: [], workReviews: [], academicComments: [],
        resourceFiles: [], activityLinks: [], pageSnapshots: [],
        workFiles: [],
        revisions: [],
        groupMessages: [],
        directConversations: [],
        directMessages: [],
        reactions: [],
        stickerPacks: [],
        stickers: [],
        chatCommands: [],
        birthdays: [],
        activities: [],
        evidences: [],
        notes: [],
        noteComments: [],
        questions: [],
        answers: [],
        guides: [],
        guideSources: [],
        guideReviews: [],
        polls: [],
        pollVotes: [],
        helpPosts: [],
        helpContacts: [],
        teachingPractices: [],
        teachingPersonal: [],
        teachingQuestions: [],
        spacedCollections: [], spacedCards: [], spacedUnavailableCards: [], spacedEnrollments: [], spacedProgress: [], spacedReviews: [],
        lastSeenAt: undefined,
      };
    }
    const notes = s.notes.filter((n) => n.visibility === 'group' || n.authorId === me.id);
    const spacedCollections = s.spacedCollections.filter((collection) => collection.visibility === 'group' || collection.ownerId === me.id);
    const visibleSpacedCollections = new Map(spacedCollections.map((collection) => [collection.id, collection]));
    const teachingPractices = s.teachingPractices.filter((practice) =>
      this.#isActive(practice.ownerId) &&
      (practice.ownerId === me.id || practice.reviewerId === me.id),
    );
    const visiblePractices = new Set(teachingPractices.map((practice) => practice.id));
    const ownPractices = new Set(teachingPractices.filter((practice) => practice.ownerId === me.id).map((practice) => practice.id));
    const visibleNotes = new Set(notes.map((n) => n.id));
    const directConversations = s.directConversations.filter((c) =>
      canReadDirectConversation(me.id, c.participantIds),
    );
    const visible = new Set(directConversations.map((c) => c.id));
    const directMessages = s.directMessages.filter((m) => visible.has(m.conversationId));
    const readable = new Set([
      ...s.groupMessages.map((m) => `group:${m.id}`),
      ...directMessages.map((m) => `direct:${m.id}`),
    ]);
    const stickerPacks = s.stickerPacks.filter((p) => p.shared || p.ownerId === me.id);
    const packIds = new Set(stickerPacks.map((p) => p.id));
    // Los stickers que ya se enviaron se siguen viendo aunque su paquete se quite o deje de compartirse.
    const sent = new Set(
      [...s.groupMessages, ...directMessages, ...this.#chat.channelMessages()].flatMap((m) =>
        referencesIn(m.text)
          .filter((r) => r.kind === 'sticker')
          .map((r) => r.id),
      ),
    );
    const base: Snapshot = {
      ...emptyNotifications(),
      trashEntries: [],
      ...emptyStudyRooms(),
      ...emptyDelivery2(),
      ...this.#presentations.snapshot(me.id),
      connection: 'ready',
      me,
      members: s.members,
      invitations: isCreator(me) ? s.invitations : [],
      subjects: s.subjects,
      terms: s.terms,
      calendar: s.calendar,
      assignments: s.assignments.map((row) => ({ ...row, topic: row.topic ?? '' })),
      ...this.#academic.snapshot(me.id),
      revisions: s.revisions,
      groupMessages: s.groupMessages,
      directConversations,
      directMessages,
      reactions: s.reactions.filter((r) => readable.has(`${r.scope}:${r.messageId}`)),
      stickerPacks,
      stickers: s.stickers.filter((x) => packIds.has(x.packId) || sent.has(x.id)),
      chatCommands: s.chatCommands.filter((c) => c.ownerId === me.id),
      birthdays: s.birthdays,
      activities: s.activities,
      evidences: s.evidences.map((row) => ({ ...row, version: row.version ?? 1 })),
      notes,
      noteComments: s.noteComments.filter((c) => visibleNotes.has(c.noteId)),
      questions: s.questions,
      answers: s.answers,
      guides: s.guides,
      guideSources: s.guideSources,
      guideReviews: s.guideReviews,
      polls: s.polls,
      pollVotes: s.pollVotes,
      helpPosts: s.helpPosts.filter((p) => p.authorId === me.id || (p.status !== 'withdrawn' && this.#isActive(p.authorId))),
      helpContacts: s.helpContacts.filter((r) => r.senderId === me.id || r.recipientId === me.id),
      teachingPractices,
      teachingPersonal: s.teachingPersonal.filter((personal) => ownPractices.has(personal.practiceId)),
      teachingQuestions: s.teachingQuestions.filter((question) => visiblePractices.has(question.practiceId)),
      spacedCollections,
      spacedCards: s.spacedCards.filter((card) => {
        const collection = visibleSpacedCollections.get(card.collectionId);
        return collection && this.#readableSpacedSource(card.sourceKind, card.sourceId, collection) !== undefined;
      }),
      spacedUnavailableCards: s.spacedCards.filter((card) => {
        const collection = visibleSpacedCollections.get(card.collectionId);
        return collection && this.#readableSpacedSource(card.sourceKind, card.sourceId, collection) === undefined;
      }).map(({ id, collectionId, version, archived }) => ({ id, collectionId, version, archived })),
      spacedEnrollments: s.spacedEnrollments.filter((row) => row.memberId === me.id),
      spacedProgress: s.spacedProgress.filter((row) => row.memberId === me.id),
      spacedReviews: s.spacedReviews.filter((row) => row.memberId === me.id).map(({ expectedRevision: _expected, ...row }) => row),
      lastSeenAt: s.lastSeen[me.id],
    };
    const combined = this.#chat.snapshot({ ...base, ...this.#knowledge.snapshot(me.id), memberProfiles: this.#profiles.filter((profile) => this.#isActive(profile.memberId)) });
    const shown = <T extends { id: Id; withdrawnAt?: Date }>(rows: T[], kind: WithdrawableKind) => rows.filter((row) => this.#canReadResource(kind, row.id)).map((row) => ({ ...row, ...this.#withdrawals.get(`${kind}:${row.id}`) }));
    combined.notes = shown(combined.notes, 'note').map((note) => note.authorId === me.id ? note : { ...note, publishedFromId: undefined, publishedFromVersion: undefined }); combined.guides = shown(combined.guides, 'guide');
    combined.questions = shown(combined.questions, 'question'); combined.answers = shown(combined.answers, 'answer');
    combined.works = shown(combined.works, 'work'); combined.evidences = shown(combined.evidences, 'evidence');
    const noteIds = new Set(combined.notes.map((note) => note.id)); const guideIds = new Set(combined.guides.map((guide) => guide.id)); const questionIds = new Set(combined.questions.map((question) => question.id)); const answerIds = new Set(combined.answers.map((answer) => answer.id)); const workIds = new Set(combined.works.map((work) => work.id));
    combined.noteVersions = combined.noteVersions.filter((row) => noteIds.has(row.noteId)); combined.noteComments = combined.noteComments.filter((row) => noteIds.has(row.noteId));
    combined.guideVersions = combined.guideVersions.filter((row) => guideIds.has(row.guideId)); combined.guideSources = combined.guideSources.filter((row) => guideIds.has(row.guideId)); combined.guideReviews = combined.guideReviews.filter((row) => guideIds.has(row.guideId));
    combined.questionComments = combined.questionComments.filter((row) => questionIds.has(row.questionId) && (!row.answerId || answerIds.has(row.answerId))); combined.answerUsefulness = combined.answerUsefulness.filter((row) => answerIds.has(row.answerId));
    combined.questionLinks = combined.questionLinks.filter((row) => questionIds.has(row.questionId) && (row.targetKind === 'note' ? noteIds.has(row.targetId) : guideIds.has(row.targetId)));
    combined.workRevisions = combined.workRevisions.filter((row) => workIds.has(row.workId)); combined.workReviews = combined.workReviews.filter((row) => workIds.has(row.workId)); combined.workFiles = combined.workFiles.filter((row) => workIds.has(row.workId));
    const evidenceIds = new Set(combined.evidences.map((row) => row.id));
    combined.academicComments = combined.academicComments.filter((row) => row.targetKind === 'work' ? workIds.has(row.targetId) : evidenceIds.has(row.targetId));
    combined.resourceFiles = combined.resourceFiles.filter((file) => {
      if (this.#chat.handles(file.targetKind)) return true;
      if (!this.#canReadResource(file.targetKind, file.targetId)) return false;
      if (file.targetKind === 'profile') {
        const profile = this.#profiles.find((row) => row.id === file.targetId);
        return profile?.memberId === me.id || profile?.photoFileId === file.id;
      }
      return true;
    });
    combined.contributionOrigins = this.#trash.contributionOrigins(this.#academic.resources(), combined);
    combined.trashEntries = this.#trash.snapshot(me.id);
    const result = { ...combined, ...this.#rooms.snapshot(me.id) };
    return { ...result, ...this.#notifications.snapshot(result) };
  }

  #emit() {
    if (this.#batchDepth) { this.#batchChanged = true; this.#snapshot = undefined; return; }
    for (const invalidate of sharedDemoListeners.get(this.#state) ?? []) invalidate();
  }

  #batch<T>(task: () => T): T {
    this.#batchDepth++;
    try { return task(); }
    finally { if (--this.#batchDepth === 0 && this.#batchChanged) { this.#batchChanged = false; this.#emit(); } }
  }

  #announce(kind: NotificationKind, sourceKind: string, sourceId: Id, route: string, recipientIds?: Id[], suffix = '1') {
    this.#batch(() => {
      this.#notifications.emit({ eventKey: `${kind}:${sourceKind}:${sourceId}:${suffix}`, kind, sourceKind, sourceId, route,
        recipientIds: recipientIds ?? this.#state.members.filter((member) => member.status === 'active').map((member) => member.id), actorId: this.#viewerId });
      this.#emit();
    });
  }

  #id(): Id {
    const next = sharedDemoIds.get(this.#state) ?? 1000;
    sharedDemoIds.set(this.#state, next + 1);
    return String(next);
  }

  #activeMember(): Member {
    this.#assertAlive();
    const me = this.#state.members.find((m) => m.id === this.#viewerId);
    if (me?.status !== 'active') throw new Error('No eres miembro activo del grupo.');
    return me;
  }

  #isActive(id: Id): boolean {
    return this.#state.members.some((m) => m.id === id && m.status === 'active');
  }

  #contentRow(kind: string, id: Id) {
    return kind === 'note' ? this.#state.notes.find((row) => row.id === id)
      : kind === 'guide' ? this.#state.guides.find((row) => row.id === id)
        : kind === 'question' ? this.#state.questions.find((row) => row.id === id)
          : kind === 'answer' ? this.#state.answers.find((row) => row.id === id)
            : kind === 'work' ? this.#state.works.find((row) => row.id === id)
              : kind === 'evidence' ? this.#state.evidences.find((row) => row.id === id)
                : kind === 'profile' ? this.#profiles.find((row) => row.id === id) : undefined;
  }
  #contentAuthors(kind: string, id: Id): Id[] {
    const row = this.#contentRow(kind, id);
    if (!row) return [];
    if (kind === 'work') return [...(row as Work).authorIds];
    return ['authorId' in row ? row.authorId : 'createdBy' in row ? row.createdBy : 'memberId' in row ? row.memberId : ''];
  }
  #canReadResource(kind: string, id: Id): boolean {
    const me = this.#state.members.find((member) => member.id === this.#viewerId);
    if (me?.status !== 'active') return false;
    if (this.#trash.blocksRead(kind, id)) return false;
    if (kind === 'assignment') return this.#state.assignments.some((row) => row.id === id);
    if (kind === 'activity') return this.#state.activities.some((row) => row.id === id);
    const row = this.#contentRow(kind, id); if (!row) return false;
    if (kind === 'note' && (row as Note).visibility === 'personal' && (row as Note).authorId !== me.id) return false;
    if (kind === 'profile' && !this.#isActive((row as MemberProfile).memberId)) return false;
    if (kind === 'answer' && !this.#canReadResource('question', (row as Answer).questionId)) return false;
    const withdrawn = this.#withdrawals.get(`${kind}:${id}`)?.withdrawnAt ?? ('withdrawnAt' in row ? row.withdrawnAt : undefined);
    return !withdrawn || this.#contentAuthors(kind, id).includes(me.id) || me.isCreator;
  }
  #extraTarget(kind: ResourceTargetKind, id: Id, editable = false) {
    const me = this.#activeMember(); const row = this.#contentRow(kind, id);
    if (!row || !this.#canReadResource(kind, id)) throw new Error('El recurso no existe o no tienes acceso.');
    if (editable && ((this.#withdrawals.get(`${kind}:${id}`)?.withdrawnAt ?? ('withdrawnAt' in row ? row.withdrawnAt : undefined)) || (kind !== 'guide' && !this.#contentAuthors(kind, id).includes(me.id)))) throw new Error('Solo su autor modifica un recurso activo.');
    return { ...row, version: row.version ?? 1 };
  }
  #captureExtra(kind: ResourceTargetKind, id: Id) {
    if (kind === 'note') this.#knowledge.captureNote(id);
    else if (kind === 'guide') this.#knowledge.captureGuide(id);
  }
  #changedExtra(kind: ResourceTargetKind, id: Id) {
    const me = this.#activeMember(); const now = this.#now();
    if (kind === 'note') this.#state.notes = this.#state.notes.map((row) => row.id === id ? { ...row, version: row.version + 1, updatedAt: now } : row);
    else if (kind === 'guide') this.#state.guides = this.#state.guides.map((row) => row.id === id ? { ...row, version: row.version + 1, updatedBy: me.id, updatedAt: now } : row);
    else if (kind === 'question') this.#state.questions = this.#state.questions.map((row) => row.id === id ? { ...row, version: (row.version ?? 1) + 1 } : row);
    else if (kind === 'answer') this.#state.answers = this.#state.answers.map((row) => row.id === id ? { ...row, version: (row.version ?? 1) + 1 } : row);
    else if (kind === 'profile') {
      const latest = this.#academic.resources().filter((file) => file.targetKind === 'profile' && file.targetId === id && !file.removedAt).at(-1);
      this.#profiles = this.#profiles.map((row) => row.id === id ? { ...row, photoFileId: latest?.id, version: row.version + 1, updatedAt: now } : row);
    }
    if (kind === 'note') this.#knowledge.captureNote(id, me.id);
    else if (kind === 'guide') this.#knowledge.captureGuide(id, me.id);
    this.#emit();
  }

  saveMemberProfile(input: MemberProfileInput): Id {
    const me = this.#activeMember();
    const next = saveDemoMemberProfile(input, { memberId: me.id, profiles: this.#profiles, subjects: this.#state.subjects, resourceFiles: this.#academic.resources(), createId: () => this.#id(), now: this.#now() });
    this.#profiles = [...this.#profiles.filter((profile) => profile.memberId !== me.id), next]; this.#emit(); return next.id;
  }
  withdrawContent(kind: WithdrawableKind, targetId: Id, withdrawn: boolean, expectedVersion: number, reason = '') {
    if (!withdrawn) this.#trash.assertRestorable(kind, targetId);
    const me = this.#activeMember(); const row = this.#contentRow(kind, targetId);
    const authors = this.#contentAuthors(kind, targetId); const own = authors.includes(me.id);
    if (!row || !authors.length || !this.#canReadResource(kind, targetId) || (!own && !me.isCreator)) throw new Error('Solo sus autores o un administrador pueden retirar este contenido.');
    if (kind === 'note' && (row as Note).visibility === 'personal' && !own) throw new Error('Solo su autor puede retirar o restaurar un apunte personal.');
    if ((row.version ?? 1) !== expectedVersion) throw new Error('El contenido cambió. Actualiza antes de guardar.');
    const previous = this.#withdrawals.get(`${kind}:${targetId}`);
    if (Boolean(previous?.withdrawnAt) === withdrawn) return;
    const cleaned = reason.trim(); if (cleaned.length > 1000 || (withdrawn && !own && !cleaned)) throw new Error('Indica el motivo de la retirada por moderación (hasta 1000 caracteres).');
    if (!withdrawn && previous?.withdrawnBy) {
      const moderation = !authors.includes(previous.withdrawnBy);
      if (moderation && !me.isCreator) throw new Error('Un administrador debe revisar esta retirada antes de restaurarla.');
      if (!moderation && !own) throw new Error('Solo sus autores pueden restaurar este aporte.');
    }
    if (kind === 'work') this.#academic.captureWork(targetId);
    else if (kind === 'evidence') this.#academic.capturePage('activity', (row as Evidence).activityId);
    else this.#captureExtra(kind, targetId);
    this.#withdrawals.set(`${kind}:${targetId}`, { withdrawnAt: withdrawn ? this.#now() : undefined, withdrawnBy: withdrawn ? me.id : undefined, reason: withdrawn ? cleaned : '' });
    this.#trash.record(kind, targetId, withdrawn);
    if (kind === 'work') { this.#state.works = this.#state.works.map((work) => work.id === targetId ? { ...work, version: work.version + 1, updatedAt: this.#now() } : work); this.#academic.captureWork(targetId); this.#emit(); }
    else if (kind === 'evidence') { this.#state.evidences = this.#state.evidences.map((evidence) => evidence.id === targetId ? { ...evidence, version: (evidence.version ?? 1) + 1 } : evidence); this.#academic.evidenceChanged((row as Evidence).activityId); }
    else this.#changedExtra(kind, targetId);
  }

  #helpPost(postId: Id): HelpPost {
    this.#activeMember();
    const post = this.#state.helpPosts.find((p) => p.id === postId);
    if (!post) throw new Error('La publicación no está disponible.');
    return post;
  }

  #ownHelpPost(postId: Id): HelpPost {
    const me = this.#activeMember();
    const post = this.#helpPost(postId);
    if (post.authorId !== me.id) throw new Error('Solo su autor puede modificar esta publicación.');
    if (post.status === 'withdrawn') throw new Error('La publicación fue retirada.');
    return post;
  }

  #helpContact(requestId: Id): HelpContactRequest {
    const me = this.#activeMember();
    const contact = this.#state.helpContacts.find((r) => r.id === requestId && (r.senderId === me.id || r.recipientId === me.id));
    if (!contact) throw new Error('La solicitud de contacto no está disponible.');
    return contact;
  }

  #updateHelpContact(contact: HelpContactRequest, fields: Partial<HelpContactRequest>) {
    this.#state.helpContacts = this.#state.helpContacts.map((r) => r.id === contact.id ? { ...r, ...fields, updatedAt: this.#now() } : r);
  }

  #closePendingHelpContacts(postId: Id, closeReason: string) {
    this.#state.helpContacts = this.#state.helpContacts.map((r) => r.postId === postId && r.status === 'pending'
      ? { ...r, status: 'closed', updatedAt: this.#now(), closedBy: this.#viewerId, closeReason } : r);
  }

  saveHelpPost(input: HelpPostInput): Id {
    const me = this.#activeMember();
    const existing = input.id === undefined ? undefined : this.#ownHelpPost(input.id);
    if (existing && existing.kind !== input.kind) throw new Error('El tipo de publicación no se puede cambiar.');
    this.#requireSubject(input.subjectId);
    const fields = cleanHelpPost(input);
    const post: HelpPost = existing ? { ...existing, ...fields, updatedAt: this.#now() }
      : { ...fields, id: this.#id(), authorId: me.id, status: 'open', createdAt: this.#now(), updatedAt: this.#now() };
    this.#state.helpPosts = existing ? this.#state.helpPosts.map((p) => p.id === existing.id ? post : p) : [...this.#state.helpPosts, post];
    this.#emit();
    return post.id;
  }

  setHelpPostStatus(postId: Id, status: 'open' | 'closed') {
    const post = this.#ownHelpPost(postId);
    if (status !== 'open' && status !== 'closed') throw new Error('El estado de la publicación no es válido.');
    this.#state.helpPosts = this.#state.helpPosts.map((p) => p.id === post.id ? { ...p, status, updatedAt: this.#now() } : p);
    if (status === 'closed') this.#closePendingHelpContacts(postId, 'post_closed');
    this.#emit();
  }

  withdrawHelpPost(postId: Id, reason = '') {
    const me = this.#activeMember();
    const post = this.#helpPost(postId);
    if (post.status === 'withdrawn') throw new Error('La publicación no está disponible.');
    if (post.authorId !== me.id && !me.isCreator) throw new Error('Solo el autor o un administrador pueden retirar esta publicación.');
    const withdrawalReason = helpText(reason, 'El motivo', HELP_LIMITS.reason, post.authorId === me.id);
    this.#state.helpPosts = this.#state.helpPosts.map((p) => p.id === postId
      ? { ...p, status: 'withdrawn', withdrawnBy: me.id, withdrawalReason, updatedAt: this.#now() } : p);
    this.#closePendingHelpContacts(postId, 'post_withdrawn');
    this.#emit();
  }

  sendHelpContact(postId: Id, message = ''): Id {
    const me = this.#activeMember();
    const post = this.#helpPost(postId);
    if (post.status !== 'open' || !this.#isActive(post.authorId)) throw new Error('La publicación no está abierta.');
    if (post.authorId === me.id) throw new Error('No puedes enviarte una solicitud de contacto.');
    if (this.#state.helpContacts.some((r) => r.postId === postId && r.senderId === me.id)) throw new Error('Ya enviaste una solicitud para esta publicación.');
    const cleanMessage = helpText(message, 'El mensaje', HELP_LIMITS.message, true);
    const contact: HelpContactRequest = { id: this.#id(), postId, senderId: me.id, recipientId: post.authorId,
      subjectId: post.subjectId, postTitle: post.title, postTopic: post.topic, postKind: post.kind,
      message: cleanMessage, status: 'pending', createdAt: this.#now(), updatedAt: this.#now() };
    this.#state.helpContacts = [...this.#state.helpContacts, contact];
    this.#emit();
    return contact.id;
  }

  respondHelpContact(requestId: Id, decision: 'accepted' | 'rejected') {
    const me = this.#activeMember();
    const contact = this.#helpContact(requestId);
    if (decision !== 'accepted' && decision !== 'rejected') throw new Error('La respuesta no es válida.');
    if (contact.recipientId !== me.id || contact.status !== 'pending') throw new Error('Solo el destinatario puede responder una solicitud pendiente.');
    let conversationId: Id | undefined;
    if (decision === 'accepted') {
      const post = this.#helpPost(contact.postId);
      if (post.status !== 'open' || !this.#isActive(contact.senderId) || !this.#isActive(contact.recipientId)) throw new Error('La publicación o el compañero ya no están disponibles.');
      const existing = this.#state.directConversations.find((c) => c.participantIds.includes(me.id) && c.participantIds.includes(contact.senderId));
      conversationId = existing?.id ?? this.#id();
      if (!existing) this.#state.directConversations = [...this.#state.directConversations, { id: conversationId, participantIds: [me.id, contact.senderId] }];
    }
    this.#updateHelpContact(contact, { status: decision, conversationId });
    this.#emit();
  }

  cancelHelpContact(requestId: Id) {
    const me = this.#activeMember();
    const contact = this.#helpContact(requestId);
    if (contact.senderId !== me.id || contact.status !== 'pending') throw new Error('Solo quien envió una solicitud pendiente puede cancelarla.');
    this.#updateHelpContact(contact, { status: 'cancelled' });
    this.#emit();
  }

  closeHelpContact(requestId: Id) {
    const me = this.#activeMember();
    const contact = this.#helpContact(requestId);
    if (contact.status !== 'accepted') throw new Error('Solo se puede cerrar un contacto aceptado.');
    this.#updateHelpContact(contact, { status: 'closed', closedBy: me.id, closeReason: 'participant' });
    this.#emit();
  }

  joinGroup(displayName: string) {
    this.#assertAlive();
    const me = this.#state.members.find((m) => m.id === this.#viewerId);
    if (me?.status === 'removed') throw new Error('Tu acceso fue dado de baja.');
    if (me) return;
    requireText(displayName, 'El nombre', 80);
    // La demo no tiene correos: quien no es miembro nunca está en la lista.
    throw new Error('Tu correo no está en la lista autorizada del grupo.');
  }

  inviteMember(email: string, isCreator: boolean) {
    this.#requireCreator();
    const normalized = requireText(email, 'El correo', 320).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error('Ese correo no es válido.');
    if (this.#state.invitations.some((i) => i.email === normalized)) return;
    this.#state.invitations = [
      ...this.#state.invitations,
      { email: normalized, isCreator, invitedBy: this.#viewerId, createdAt: this.#now() },
    ];
    this.#emit();
  }

  revokeInvitation(email: string) {
    this.#requireCreator();
    this.#state.invitations = this.#state.invitations.filter((i) => i.email !== email);
    this.#emit();
  }

  removeMember(memberId: Id) {
    const me = this.#requireCreator();
    if (memberId === me.id) throw new Error('No puedes darte de baja a ti mismo.');
    if (!this.#state.members.some((m) => m.id === memberId)) throw new Error('Ese miembro no existe.');
    this.#state.members = this.#state.members.map((m) =>
      m.id === memberId ? { ...m, status: 'removed' as const } : m,
    );
    this.#rooms.memberRemoved(memberId);
    this.#emit();
  }

  importCurriculum() {
    this.#requireCreator();
    const codes = new Set(this.#state.subjects.map((x) => x.code));
    const missing = CURRICULUM.filter((c) => !codes.has(c.code));
    if (!missing.length) return;
    for (const c of missing) {
      const subject = { id: this.#id(), ...c };
      const terms = termNames().map((name, i) => ({
        id: this.#id(),
        subjectId: subject.id,
        name,
        position: i + 1,
      }));
      this.#state.subjects = [...this.#state.subjects, subject];
      this.#state.terms = [...this.#state.terms, ...terms];
    }
    this.#emit();
  }

  #requireCreator(): Member {
    const me = this.#activeMember();
    if (!isCreator(me)) throw new Error('Solo los creadores de la app pueden hacer esto.');
    return me;
  }

  updateProfile(displayName: string, photoUrl?: string) {
    const me = this.#activeMember();
    const name = requireText(displayName, 'El nombre', 80);
    this.#state.members = this.#state.members.map((m) =>
      m.id === me.id ? { ...m, displayName: name, photoUrl } : m,
    );
    this.#emit();
  }

  createSubject(name: string, period: number): Id {
    this.#activeMember();
    if (!isValidPeriod(period)) throw new Error('El cuatrimestre no existe.');
    const subject = { id: this.#id(), name: requireText(name, 'El nombre de la materia', 120), period };
    this.#state.subjects = [...this.#state.subjects, subject];
    this.#emit();
    return subject.id;
  }

  createTerm(subjectId: Id, name: string): Id {
    this.#activeMember();
    if (!this.#state.subjects.some((s) => s.id === subjectId)) throw new Error('La materia no existe.');
    const position = this.#state.terms.filter((t) => t.subjectId === subjectId).length + 1;
    const term = { id: this.#id(), subjectId, name: requireText(name, 'El parcial', 120), position };
    this.#state.terms = [...this.#state.terms, term];
    this.#emit();
    return term.id;
  }

  saveCalendar(period: number, terms: TermDatesInput[]) {
    const me = this.#activeMember();
    if (!canManageCalendar(me)) throw new Error('Solo los administradores cambian las fechas de los parciales.');
    const others = this.#state.calendar.filter((entry) => entry.period !== period);
    const result = buildPeriodCalendar(period, terms, others);
    if ('problem' in result) throw new Error(result.problem);
    this.#state.calendar = [...others, ...result.entries];
    this.#emit();
  }

  #checkAssignment(input: AssignmentInput) {
    this.#requireSubject(input.subjectId);
    if (input.termId) {
      const term = this.#state.terms.find((t) => t.id === input.termId);
      if (term?.subjectId !== input.subjectId) throw new Error('El parcial no pertenece a esa materia.');
    }
    if (!isWorkKind(input.kind)) throw new Error('El tipo de trabajo no existe.');
    if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
      throw new Error('Fecha de entrega inválida.');
    }
    return {
      subjectId: input.subjectId,
      termId: input.termId,
      kind: input.kind,
      title: requireText(input.title, 'El título', 200),
      instructions: input.instructions.trim(),
      topic: textTopic(input.topic),
      dueDate: input.dueDate || undefined,
    };
  }

  /** Guarda en el historial cómo quedó una página editable después de crearla o editarla. */
  #saveRevision(
    page: Revision['page'],
    pageId: Id,
    version: number,
    content: Pick<Revision, 'title' | 'summary' | 'body' | 'dueDate'>,
  ) {
    const revision: Revision = {
      id: this.#id(),
      page,
      pageId,
      version,
      editedBy: this.#viewerId,
      editedAt: this.#now(),
      ...content,
    };
    this.#state.revisions = [...this.#state.revisions, revision];
    this.#academic.capturePage(page, pageId);
  }

  createAssignment(input: AssignmentInput): Id {
    const me = this.#activeMember();
    const now = this.#now();
    const assignment: Assignment = {
      id: this.#id(),
      ...this.#checkAssignment(input),
      version: 1,
      createdBy: me.id,
      createdAt: now,
      updatedBy: me.id,
      updatedAt: now,
    };
    this.#state.assignments = [...this.#state.assignments, assignment];
    this.#saveRevision('assignment', assignment.id, 1, {
      title: assignment.title,
      summary: '',
      body: assignment.instructions,
      dueDate: assignment.dueDate,
    });
    this.#emit();
    return assignment.id;
  }

  /** Sin restricción de autoría: es la página del grupo. La responsabilidad queda en el historial. */
  updateAssignment(assignmentId: Id, input: AssignmentInput, expectedVersion?: number) {
    const me = this.#activeMember();
    const current = this.#state.assignments.find((a) => a.id === assignmentId);
    if (!current) throw new Error('La tarea no existe.');
    if (expectedVersion !== undefined && current.version !== expectedVersion) throw new Error('Esta publicación cambió. Revisa la versión actual antes de guardar.');
    this.#checkAssignment(input);
    this.#academic.capturePage('assignment', assignmentId);
    const next: Assignment = {
      ...current,
      ...this.#checkAssignment(input),
      topic: input.topic === undefined ? current.topic ?? '' : textTopic(input.topic),
      version: current.version + 1,
      updatedBy: me.id,
      updatedAt: this.#now(),
    };
    this.#state.assignments = this.#state.assignments.map((a) => (a.id === assignmentId ? next : a));
    this.#saveRevision('assignment', assignmentId, next.version, {
      title: next.title,
      summary: '',
      body: next.instructions,
      dueDate: next.dueDate,
    });
    if (current.dueDate !== next.dueDate) this.#announce('due_change', 'assignment', assignmentId, `/m/tareas/${assignmentId}`, undefined, String(next.version)); else this.#emit();
  }

  publishWork(input: PublishWorkInput): Id {
    const me = this.#activeMember();
    if (!this.#state.assignments.some((a) => a.id === input.assignmentId)) {
      throw new Error('La tarea no existe.');
    }
    for (const id of input.coauthorIds) {
      if (!this.#isActive(id)) throw new Error('Un coautor no es miembro activo.');
    }
    const title = input.title.trim();
    if (title.length > 200) throw new Error('El título excede 200 caracteres.');
    if (input.status && input.status !== 'draft' && input.status !== 'final') throw new Error('El estado del trabajo no existe.');
    if (input.description.trim().length > 50_000) throw new Error('La descripción excede 50000 caracteres.');
    const now = this.#now();
    const work: Work = {
      id: this.#id(),
      assignmentId: input.assignmentId,
      title,
      description: input.description.trim(),
      topic: textTopic(input.topic),
      status: input.status ?? 'draft',
      updatedBy: me.id,
      version: 1,
      authorIds: [...new Set([me.id, ...input.coauthorIds])],
      createdAt: now,
      updatedAt: now,
    };
    this.#state.works = [...this.#state.works, work];
    this.#academic.captureWork(work.id);
    if (work.status === 'final') this.#announce('work', 'work', work.id, `/m/tareas/${work.assignmentId}?trabajo=${work.id}`); else this.#emit();
    return work.id;
  }

  updateWork(workId: Id, title: string, description: string) {
    this.#activeMember();
    const work = this.#state.works.find((w) => w.id === workId);
    if (!work) throw new Error('El trabajo no existe.');
    this.saveWorkVersion(workId, { title, description, topic: work.topic ?? '', status: 'draft' }, work.version);
  }

  setProgress(kind: ProgressTargetKind, id: Id, status: ProgressStatus) { return this.#academic.setProgress(kind, id, status); }
  saveWorkVersion(id: Id, input: WorkVersionInput, expectedVersion: number) { return this.#batch(() => {
    const work = this.#state.works.find((row) => row.id === id); const wasDraft = work?.status === 'draft';
    this.#academic.saveWorkVersion(id, input, expectedVersion);
    if (work && wasDraft && input.status === 'final') this.#announce('work', 'work', id, `/m/tareas/${work.assignmentId}?trabajo=${id}`);
  }); }
  restoreWorkVersion(id: Id, version: number, expectedVersion: number) { return this.#academic.restoreWorkVersion(id, version, expectedVersion); }
  reviewWork(id: Id, expectedVersion: number, comment: string) { return this.#academic.reviewWork(id, expectedVersion, comment); }
  commentAcademic(kind: 'work' | 'evidence', id: Id, value: string) { return this.#academic.commentAcademic(kind, id, value); }
  saveActivityLinks(id: Id, assignments: Id[], notes: Id[], expectedVersion?: number) { return this.#academic.saveActivityLinks(id, assignments, notes, expectedVersion); }
  restorePageSnapshot(page: ProgressTargetKind, id: Id, version: number, expectedVersion: number) { return this.#academic.restorePageSnapshot(page, id, version, expectedVersion); }
  attachResourceFile(kind: ResourceTargetKind, id: Id, file: File, expectedVersion?: number, transfer?: ResourceTransferOptions) {
    this.#activeMember();
    if (this.#chat.handles(kind)) return this.#chat.attachResourceFile(kind, id, file, expectedVersion, transfer);
    if (!this.#canReadResource(kind, id) || this.#withdrawals.get(`${kind}:${id}`)?.withdrawnAt) return Promise.reject(new Error('El recurso no está disponible.'));
    if (kind === 'profile' && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024)) return Promise.reject(new Error('La foto debe ser PNG, JPEG o WebP de hasta 5 MB.'));
    return this.#academic.attachResourceFile(kind, id, file, expectedVersion, transfer);
  }
  #resourceFile(id: Id) {
    this.#activeMember();
    const file = this.getSnapshot().resourceFiles.find((row) => row.id === id);
    if (!file) throw new Error('El archivo no existe o no tienes acceso.'); return file;
  }
  removeResourceFile(id: Id, expectedVersion?: number) { const file = this.#resourceFile(id); return this.#chat.handles(file.targetKind) ? this.#chat.removeResourceFile(id, expectedVersion) : this.#academic.removeResourceFile(id, expectedVersion); }
  restoreResourceFile(id: Id, expectedVersion: number) { const file = this.#resourceFile(id); return this.#chat.handles(file.targetKind) ? this.#chat.restoreResourceFile(id, expectedVersion) : this.#academic.restoreResourceFile(id, expectedVersion); }
  async downloadResourceFile(id: Id, transfer?: ResourceTransferOptions) { const file = this.#resourceFile(id); return this.#chat.handles(file.targetKind) ? this.#chat.downloadResourceFile(id, transfer) : this.#academic.downloadResourceFile(id, transfer); }

  createChatChannel(input: CreateChatChannelInput) { return this.#chat.createChatChannel(input); }
  setChatChannelArchived(id: Id, archived: boolean) { return this.#chat.setChatChannelArchived(id, archived); }
  sendChannelMessage(id: Id, text: string, replyToId?: Id) { return this.#batch(() => { const messageId = this.#chat.sendChannelMessage(id, text, replyToId); this.#notifications.notifyMessage('channel', messageId); return messageId; }); }
  markConversationRead(scope: MessageScope, conversationId: Id, messageId: Id) { return this.#batch(() => { this.#chat.markConversationRead(scope, conversationId, messageId); this.#notifications.suppressConversationNotifications(scope, conversationId); }); }
  setConversationMuted(scope: MessageScope, conversationId: Id, muted: boolean) { return this.#chat.setConversationMuted(scope, conversationId, muted); }
  setMemberBlocked(memberId: Id, blocked: boolean) { return this.#chat.setMemberBlocked(memberId, blocked); }
  reportMessage(input: ReportMessageInput) { return this.#chat.reportMessage(input); }
  resolveMessageReport(id: Id) { return this.#chat.resolveMessageReport(id); }

  /**
   * En modo de prueba el archivo no sale del navegador: se guarda un enlace local que dura
   * mientras la pestaña siga abierta. Las reglas (autoría y 50 MB) son las del servidor.
   */
  async attachWorkFile(workId: Id, file: File): Promise<Id> {
    return this.attachResourceFile('work', workId, file);
  }

  removeWorkFile(fileId: Id) {
    const ref = this.#state.workFiles.some((file) => file.id === fileId) ? `legacy:${fileId}` : fileId;
    return this.removeResourceFile(ref);
  }

  /** Texto de un mensaje nuevo o editado: no vacío y solo con stickers que puedes usar. */
  #messageText(text: string, me: Member): string {
    const clean = requireText(text, 'El mensaje');
    for (const ref of referencesIn(clean)) {
      if (ref.kind !== 'sticker') continue;
      const sticker = this.#state.stickers.find((x) => x.id === ref.id);
      const pack = this.#state.stickerPacks.find((p) => p.id === sticker?.packId);
      if (!pack || (!pack.shared && pack.ownerId !== me.id)) throw new Error('Ese sticker no está disponible.');
    }
    return clean;
  }

  /** Mensajes de una conversación que el usuario actual puede leer. */
  #thread(scope: MessageScope, me: Member, conversationId?: Id): MessageFields[] {
    if (scope === 'group') return this.#state.groupMessages;
    if (scope === 'channel') return this.#chat.channelMessages().filter((row) => !conversationId || row.channelId === conversationId);
    return this.#state.directMessages.filter((m) => {
      if (conversationId && m.conversationId !== conversationId) return false;
      const c = this.#state.directConversations.find((x) => x.id === m.conversationId);
      return Boolean(c && canReadDirectConversation(me.id, c.participantIds));
    });
  }

  #message(scope: MessageScope, messageId: Id, me: Member): MessageFields {
    const message = this.#thread(scope, me).find((m) => m.id === messageId);
    if (!message) throw new Error('El mensaje no existe o no participas en esa conversación.');
    return message;
  }

  #replyTo(scope: MessageScope, me: Member, replyToId: Id | undefined, conversationId?: Id): Id | undefined {
    if (!replyToId) return undefined;
    const target = this.#thread(scope, me, conversationId).find((m) => m.id === replyToId);
    if (!target || target.deletedAt) throw new Error('El mensaje al que respondes ya no está.');
    return replyToId;
  }

  #updateMessage(scope: MessageScope, messageId: Id, change: Partial<MessageFields>) {
    if (scope === 'group') {
      this.#state.groupMessages = this.#state.groupMessages.map((m) => (m.id === messageId ? { ...m, ...change } : m));
    } else {
      this.#state.directMessages = this.#state.directMessages.map((m) => (m.id === messageId ? { ...m, ...change } : m));
    }
  }

  sendGroupMessage(text: string, replyToId?: Id): Id {
    return this.#batch(() => {
    const me = this.#activeMember();
    const message: GroupMessage = {
      id: this.#id(),
      senderId: me.id,
      text: this.#chat.validateMentions(this.#messageText(text, me)),
      sentAt: this.#now(),
      replyToId: this.#replyTo('group', me, replyToId),
    };
    this.#state.groupMessages = [...this.#state.groupMessages, message];
    this.#emit();
    this.#notifications.notifyMessage('group', message.id);
    return message.id;
      });
  }

  openDirectConversation(otherId: Id): Id {
    const me = this.#activeMember();
    if (otherId === me.id) throw new Error('No puedes abrir una conversación contigo.');
    if (!this.#isActive(otherId)) throw new Error('Ese compañero no está activo.');
    this.#chat.assertDirectAllowed(otherId);
    const existing = this.#state.directConversations.find(
      (c) => c.participantIds.includes(me.id) && c.participantIds.includes(otherId),
    );
    if (existing) return existing.id;
    const conversation: DirectConversation = { id: this.#id(), participantIds: [me.id, otherId] };
    this.#state.directConversations = [...this.#state.directConversations, conversation];
    this.#emit();
    return conversation.id;
  }

  sendDirectMessage(conversationId: Id, text: string, replyToId?: Id): Id {
    return this.#batch(() => {
    const me = this.#activeMember();
    const conversation = this.#state.directConversations.find((c) => c.id === conversationId);
    if (!conversation || !canReadDirectConversation(me.id, conversation.participantIds)) {
      throw new Error('No participas en esa conversación.');
    }
    this.#chat.assertDirectAllowed(conversation.participantIds.find((id) => id !== me.id)!);
    const message: DirectMessage = {
      id: this.#id(),
      conversationId,
      senderId: me.id,
      text: this.#chat.validateMentions(this.#messageText(text, me), conversation.participantIds),
      sentAt: this.#now(),
      replyToId: this.#replyTo('direct', me, replyToId, conversationId),
    };
    this.#state.directMessages = [...this.#state.directMessages, message];
    this.#emit();
    this.#notifications.notifyMessage('direct', message.id);
    return message.id;
      });
  }

  editMessage(scope: MessageScope, messageId: Id, text: string) {
    if (scope === 'channel') return this.#chat.editMessage(scope, messageId, text);
    const me = this.#activeMember();
    const message = this.#message(scope, messageId, me);
    if (message.senderId !== me.id) throw new Error('Solo puedes editar tus mensajes.');
    if (!canEditMessage(me.id, message, this.#now())) {
      throw new Error('Ya no se puede editar: pasaron más de 15 minutos o se eliminó.');
    }
    const participants = scope === 'direct' ? this.#state.directConversations.find((conversation) => conversation.id === (message as DirectMessage).conversationId)?.participantIds : undefined;
    const clean = this.#chat.validateMentions(this.#messageText(text, me), participants);
    if (clean === message.text) return;
    this.#updateMessage(scope, messageId, { text: clean, editedAt: this.#now() });
    this.#emit();
  }

  deleteMessage(scope: MessageScope, messageId: Id) {
    if (scope === 'channel') return this.#chat.deleteMessage(scope, messageId);
    const me = this.#activeMember();
    const message = this.#message(scope, messageId, me);
    if (!canDeleteMessage(me.id, message, scope, me.isCreator)) {
      throw new Error(
        message.deletedAt
          ? 'Ese mensaje ya se eliminó.'
          : 'Solo quien lo envió puede eliminarlo (en el canal, también un administrador).',
      );
    }
    this.#updateMessage(scope, messageId, { text: '', deletedAt: this.#now(), deletedBy: me.id });
    this.#state.reactions = this.#state.reactions.filter((r) => !(r.scope === scope && r.messageId === messageId));
    this.#emit();
  }

  toggleReaction(scope: MessageScope, messageId: Id, emoji: string) {
    if (scope === 'channel') return this.#chat.toggleReaction(scope, messageId, emoji);
    const me = this.#activeMember();
    if (!isReaction(emoji)) throw new Error('Esa reacción no está disponible.');
    const message = this.#message(scope, messageId, me);
    if (message.deletedAt) throw new Error('No se puede reaccionar a un mensaje eliminado.');
    const mine = (r: MessageReaction) => r.scope === scope && r.messageId === messageId && r.memberId === me.id;
    const current = this.#state.reactions.find(mine);
    const rest = this.#state.reactions.filter((r) => !mine(r));
    this.#state.reactions =
      current?.emoji === emoji ? rest : [...rest, { scope, messageId, memberId: me.id, emoji }];
    this.#emit();
  }

  async importStickers(packName: string, files: File[]): Promise<Id> {
    const me = this.#activeMember();
    const name = requireText(packName, 'El nombre del paquete', 60);
    if (!files.length) throw new Error('Elige al menos un sticker.');
    if (files.length > MAX_STICKERS_PER_PACK) {
      throw new Error(`Un paquete tiene como máximo ${MAX_STICKERS_PER_PACK} stickers.`);
    }
    const now = this.#now();
    const pack: StickerPack = { id: this.#id(), name, ownerId: me.id, shared: false, createdAt: now };
    const stickers: Sticker[] = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Leer un archivo puede terminar después de que el usuario cerró o cambió su sesión.
      this.#assertAlive();
      if (this.#activeMember().id !== me.id) throw new Error('La sesión cambió durante la importación.');
      const type = detectImageType(bytes);
      const problem = stickerFileError(file.name, file.size, type);
      if (problem || !type) throw new Error(problem);
      stickers.push({
        id: this.#id(),
        packId: pack.id,
        url: `data:${type};base64,${toBase64(bytes)}`,
        contentType: type,
        size: file.size,
        animated: type === 'image/gif' || (type === 'image/webp' && isAnimatedWebp(bytes)),
        createdAt: now,
      });
    }
    this.#state.stickerPacks = [...this.#state.stickerPacks, pack];
    this.#state.stickers = [...this.#state.stickers, ...stickers];
    this.#emit();
    return pack.id;
  }

  async downloadSticker(stickerId: Id): Promise<Blob> {
    const me = this.#activeMember(); const sticker = this.getSnapshot().stickers.find((row) => row.id === stickerId);
    if (!sticker || !/^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/.test(sticker.url)) throw new Error('El sticker no está disponible.');
    const response = await fetch(sticker.url); const blob = await response.blob();
    if (this.#activeMember().id !== me.id || !this.getSnapshot().stickers.some((row) => row.id === stickerId)) throw new Error('La sesión o los permisos del sticker cambiaron.');
    return blob;
  }

  #ownPack(packId: Id, me: Member): StickerPack {
    const pack = this.#state.stickerPacks.find((p) => p.id === packId);
    if (!pack) throw new Error('El paquete no existe.');
    if (pack.ownerId !== me.id) throw new Error('Solo quien importó el paquete puede cambiarlo.');
    return pack;
  }

  setStickerPackShared(packId: Id, shared: boolean) {
    const me = this.#activeMember();
    this.#ownPack(packId, me);
    this.#state.stickerPacks = this.#state.stickerPacks.map((p) => (p.id === packId ? { ...p, shared } : p));
    this.#emit();
  }

  removeStickerPack(packId: Id) {
    const me = this.#activeMember();
    this.#ownPack(packId, me);
    this.#state.stickerPacks = this.#state.stickerPacks.filter((p) => p.id !== packId);
    this.#emit();
  }

  saveChatCommand(input: SaveChatCommandInput): Id {
    const me = this.#activeMember();
    const name = normalizeCommandName(input.name);
    const own = this.#state.chatCommands.filter((c) => c.ownerId === me.id && c.id !== input.id);
    const problem = commandNameError(name, own.map((c) => c.name));
    if (problem) throw new Error(problem);
    const text = requireText(input.text, 'El texto del comando', 2000);
    const description = input.description.trim().slice(0, 80);
    if (input.id) {
      const existing = this.#state.chatCommands.find((c) => c.id === input.id && c.ownerId === me.id);
      if (!existing) throw new Error('El comando no existe.');
      this.#state.chatCommands = this.#state.chatCommands.map((c) =>
        c.id === input.id ? { ...c, name, description, text } : c,
      );
      this.#emit();
      return existing.id;
    }
    const command: ChatCommand = { id: this.#id(), ownerId: me.id, name, description, text, createdAt: this.#now() };
    this.#state.chatCommands = [...this.#state.chatCommands, command];
    this.#emit();
    return command.id;
  }

  removeChatCommand(commandId: Id) {
    const me = this.#activeMember();
    if (!this.#state.chatCommands.some((c) => c.id === commandId && c.ownerId === me.id)) {
      throw new Error('El comando no existe.');
    }
    this.#state.chatCommands = this.#state.chatCommands.filter((c) => c.id !== commandId);
    this.#emit();
  }

  shareBirthday(day: number, month: number, remind: boolean) {
    const me = this.#activeMember();
    if (!isValidBirthday({ day, month })) throw new Error('Fecha inválida.');
    const birthday = { memberId: me.id, day, month, remind };
    this.#state.birthdays = [...this.#state.birthdays.filter((b) => b.memberId !== me.id), birthday];
    this.#emit();
  }

  withdrawBirthday() {
    this.#assertAlive();
    this.#state.birthdays = this.#state.birthdays.filter((b) => b.memberId !== this.#viewerId);
    this.#emit();
  }

  #requireSubject(subjectId: Id) {
    if (!this.#state.subjects.some((s) => s.id === subjectId)) throw new Error('La materia no existe.');
  }

  #checkActivity(input: CreateActivityInput) {
    this.#requireSubject(input.subjectId);
    if (input.termId) {
      const term = this.#state.terms.find((t) => t.id === input.termId);
      if (term?.subjectId !== input.subjectId) throw new Error('El parcial no pertenece a esa materia.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Fecha inválida.');
    return {
      subjectId: input.subjectId,
      termId: input.termId || undefined,
      topic: input.topic.trim(),
      date: input.date,
      title: requireText(input.title, 'El título', 200),
      objective: input.objective.trim(),
      instructions: input.instructions.trim(),
    };
  }

  createActivity(input: CreateActivityInput): Id {
    const me = this.#activeMember();
    const now = this.#now();
    const activity: Activity = {
      id: this.#id(),
      ...this.#checkActivity(input),
      version: 1,
      createdBy: me.id,
      createdAt: now,
      updatedBy: me.id,
      updatedAt: now,
    };
    this.#state.activities = [...this.#state.activities, activity];
    this.#saveRevision('activity', activity.id, 1, {
      title: activity.title,
      summary: activity.objective,
      body: activity.instructions,
    });
    this.#emit();
    return activity.id;
  }

  /** Sin restricción de autoría: es la página del grupo. La responsabilidad queda en el historial. */
  updateActivity(activityId: Id, input: CreateActivityInput, expectedVersion?: number) {
    const me = this.#activeMember();
    const current = this.#state.activities.find((a) => a.id === activityId);
    if (!current) throw new Error('La actividad no existe.');
    if (expectedVersion !== undefined && current.version !== expectedVersion) throw new Error('Esta publicación cambió. Revisa la versión actual antes de guardar.');
    this.#checkActivity(input);
    this.#academic.capturePage('activity', activityId);
    const next: Activity = {
      ...current,
      ...this.#checkActivity(input),
      version: current.version + 1,
      updatedBy: me.id,
      updatedAt: this.#now(),
    };
    this.#state.activities = this.#state.activities.map((a) => (a.id === activityId ? next : a));
    this.#saveRevision('activity', activityId, next.version, {
      title: next.title,
      summary: next.objective,
      body: next.instructions,
    });
    if (current.date !== next.date) this.#announce('due_change', 'activity', activityId, `/m/actividades/${activityId}`, undefined, String(next.version)); else this.#emit();
  }

  addEvidence(activityId: Id, content: string, participantIds: Id[]): Id {
    const me = this.#activeMember();
    if (!this.#state.activities.some((a) => a.id === activityId)) throw new Error('La actividad no existe.');
    for (const id of participantIds) {
      if (!this.#isActive(id)) throw new Error('Un participante no es miembro activo.');
    }
    const evidence: Evidence = {
      id: this.#id(),
      activityId,
      authorId: me.id,
      participantIds: [...new Set([me.id, ...participantIds])],
      content: requireText(content, 'La evidencia', 20_000),
      createdAt: this.#now(),
    };
    this.#academic.capturePage('activity', activityId);
    this.#state.evidences = [...this.#state.evidences, evidence];
    this.#academic.evidenceChanged(activityId);
    return evidence.id;
  }

  saveNote(input: SaveNoteInput): Id {
    if (input.id) this.#extraTarget('note', input.id, true);
    return this.#knowledge.saveNote(input);
  }
  publishNoteVersion(noteId: Id, expectedVersion: number) { this.#extraTarget('note', noteId, true); return this.#knowledge.publishNoteVersion(noteId, expectedVersion); }
  restoreNoteVersion(noteId: Id, version: number, expectedVersion: number) { this.#extraTarget('note', noteId, true); return this.#knowledge.restoreNoteVersion(noteId, version, expectedVersion); }
  restoreGuideVersion(guideId: Id, version: number, expectedVersion: number) { this.#extraTarget('guide', guideId, true); return this.#knowledge.restoreGuideVersion(guideId, version, expectedVersion); }
  commentQuestion(questionId: Id, text: string, answerId?: Id) { this.#extraTarget('question', questionId); if (this.#withdrawals.get(`question:${questionId}`)?.withdrawnAt || (answerId && this.#withdrawals.get(`answer:${answerId}`)?.withdrawnAt)) throw new Error('El contenido fue retirado.'); return this.#knowledge.commentQuestion(questionId, text, answerId); }
  toggleAnswerUsefulness(answerId: Id) { this.#extraTarget('answer', answerId); if (this.#withdrawals.get(`answer:${answerId}`)?.withdrawnAt) throw new Error('La respuesta fue retirada.'); return this.#knowledge.toggleAnswerUsefulness(answerId); }
  saveQuestionLinks(questionId: Id, noteIds: Id[], guideIds: Id[]) { this.#extraTarget('question', questionId); if (this.#withdrawals.get(`question:${questionId}`)?.withdrawnAt || noteIds.some((id) => !!this.#withdrawals.get(`note:${id}`)?.withdrawnAt) || guideIds.some((id) => !!this.#withdrawals.get(`guide:${id}`)?.withdrawnAt)) throw new Error('El material fue retirado.'); return this.#knowledge.saveQuestionLinks(questionId, noteIds, guideIds); }

  commentNote(noteId: Id, text: string) {
    const me = this.#activeMember();
    const note = this.#state.notes.find((n) => n.id === noteId);
    if (!note || (note.visibility === 'personal' && note.authorId !== me.id)) {
      throw new Error('La nota no existe.');
    }
    if (this.#withdrawals.get(`note:${noteId}`)?.withdrawnAt) throw new Error('La nota fue retirada.');
    const comment: NoteComment = {
      id: this.#id(),
      noteId,
      authorId: me.id,
      text: requireText(text, 'El comentario'),
      createdAt: this.#now(),
    };
    this.#state.noteComments = [...this.#state.noteComments, comment];
    this.#emit();
  }

  askQuestion(input: AskQuestionInput): Id {
    const me = this.#activeMember();
    this.#requireSubject(input.subjectId);
    const question: Question = {
      id: this.#id(),
      subjectId: input.subjectId,
      topic: input.topic.trim(),
      title: requireText(input.title, 'La pregunta', 200),
      body: input.body.trim(),
      authorId: me.id,
      status: 'open',
      createdAt: this.#now(),
    };
    this.#state.questions = [...this.#state.questions, question];
    this.#emit();
    return question.id;
  }

  answerQuestion(questionId: Id, body: string): Id {
    const me = this.#activeMember();
    if (!this.#state.questions.some((q) => q.id === questionId)) throw new Error('La pregunta no existe.');
    if (this.#withdrawals.get(`question:${questionId}`)?.withdrawnAt) throw new Error('La pregunta fue retirada.');
    const answer: Answer = {
      id: this.#id(),
      questionId,
      authorId: me.id,
      body: requireText(body, 'La respuesta', 20_000),
      createdAt: this.#now(),
    };
    this.#state.answers = [...this.#state.answers, answer];
    this.#announce('answer', 'answer', answer.id, `/m/preguntas/${questionId}`, [this.#state.questions.find((question) => question.id === questionId)!.authorId]);
    return answer.id;
  }

  #ownQuestion(questionId: Id): Question {
    const me = this.#activeMember();
    const question = this.#state.questions.find((q) => q.id === questionId);
    if (!question) throw new Error('La pregunta no existe.');
    if (question.authorId !== me.id) throw new Error('Solo quien preguntó puede hacer esto.');
    if (this.#withdrawals.get(`question:${questionId}`)?.withdrawnAt) throw new Error('La pregunta fue retirada.');
    return question;
  }

  acceptAnswer(questionId: Id, answerId: Id) {
    this.#ownQuestion(questionId);
    if (!this.#state.answers.some((a) => a.id === answerId && a.questionId === questionId)) {
      throw new Error('La respuesta no es de esta pregunta.');
    }
    this.#state.questions = this.#state.questions.map((q) =>
      q.id === questionId ? { ...q, status: 'resolved', acceptedAnswerId: answerId, resolvedAt: this.#now() } : q,
    );
    this.#emit();
  }

  reopenQuestion(questionId: Id) {
    this.#ownQuestion(questionId);
    this.#state.questions = this.#state.questions.map((q) =>
      q.id === questionId ? { ...q, status: 'open', acceptedAnswerId: undefined, resolvedAt: undefined } : q,
    );
    this.#emit();
  }

  markSeen() {
    const me = this.#activeMember();
    this.#state.lastSeen = { ...this.#state.lastSeen, [me.id]: this.#now() };
    this.#emit();
  }

  #checkGuide(input: GuideInput) {
    this.#requireSubject(input.subjectId);
    if (input.termId) {
      const term = this.#state.terms.find((t) => t.id === input.termId);
      if (term?.subjectId !== input.subjectId) throw new Error('El parcial no pertenece a esa materia.');
    }
    const parsed = parseTopics(input.topicsText);
    if ('problem' in parsed) throw new Error(parsed.problem);
    if (input.sections.length > GUIDE_SECTIONS.length) throw new Error('La guía tiene secciones de más.');
    const sections = GUIDE_SECTIONS.map((_, i) => (input.sections[i] ?? '').trim());
    if (sections.some((text) => text.length > MAX_GUIDE_SECTION_LENGTH)) {
      throw new Error(`Cada sección admite hasta ${MAX_GUIDE_SECTION_LENGTH} caracteres.`);
    }
    return {
      subjectId: input.subjectId,
      termId: input.termId,
      title: requireText(input.title, 'El título', 200),
      topics: parsed.topics,
      sections,
    };
  }

  #guide(guideId: Id): StudyGuide {
    this.#activeMember();
    const guide = this.#state.guides.find((g) => g.id === guideId);
    if (!guide || this.#withdrawals.get(`guide:${guideId}`)?.withdrawnAt) throw new Error('La guía no existe o fue retirada.');
    return guide;
  }

  /** Versión actual del material citado; también comprueba que exista y sea de la materia. */
  #sourceVersion(ref: GuideSourceRef, subjectId: Id): number {
    if (!isGuideSourceKind(ref.kind)) throw new Error('Tipo de fuente inválido.');
    const kind = { nota: 'note', trabajo: 'work', tarea: 'assignment', actividad: 'activity', pregunta: 'question' }[ref.kind];
    if (this.#withdrawals.get(`${kind}:${ref.refId}`)?.withdrawnAt) throw new Error('La fuente fue retirada.');
    const s = this.#state;
    const found = (() => {
      switch (ref.kind) {
        case 'trabajo': {
          const work = s.works.find((w) => w.id === ref.refId);
          const assignment = work && s.assignments.find((a) => a.id === work.assignmentId);
          return work && assignment && { subjectId: assignment.subjectId, version: work.version };
        }
        case 'tarea':
          return s.assignments.find((a) => a.id === ref.refId);
        case 'actividad':
          return s.activities.find((a) => a.id === ref.refId);
        case 'nota': {
          // Las notas personales no se comparten, así que tampoco sirven de fuente.
          const note = s.notes.find((n) => n.id === ref.refId);
          return note?.visibility === 'group' ? note : undefined;
        }
        case 'pregunta': {
          const question = s.questions.find((q) => q.id === ref.refId);
          return question && { subjectId: question.subjectId, version: question.version ?? 1 };
        }
      }
    })();
    if (!found) throw new Error('Una de las fuentes ya no existe o no es del grupo.');
    if (found.subjectId !== subjectId) throw new Error('Las fuentes deben ser de la misma materia.');
    return found.version;
  }

  #addSources(guide: StudyGuide, refs: GuideSourceRef[], addedBy: Id) {
    const now = this.#now();
    const existing = this.#state.guideSources.filter((src) => src.guideId === guide.id);
    const added: GuideSource[] = [];
    for (const ref of refs) {
      const version = this.#sourceVersion(ref, guide.subjectId);
      const duplicate = [...existing, ...added].some((src) => src.kind === ref.kind && src.refId === ref.refId);
      if (duplicate) continue;
      added.push({
        id: this.#id(),
        guideId: guide.id,
        kind: ref.kind,
        refId: ref.refId,
        sourceVersion: version,
        status: 'pending',
        reason: 'Falta revisarla.',
        topics: [],
        addedBy,
        addedAt: now,
      });
    }
    this.#state.guideSources = [...this.#state.guideSources, ...added];
  }

  createGuide(input: GuideInput, sources: GuideSourceRef[]): Id {
    const me = this.#activeMember();
    const now = this.#now();
    const guide: StudyGuide = {
      id: this.#id(),
      ...this.#checkGuide(input),
      version: 1,
      createdBy: me.id,
      createdAt: now,
      updatedBy: me.id,
      updatedAt: now,
    };
    this.#state.guides = [...this.#state.guides, guide];
    this.#addSources(guide, sources, me.id);
    this.#knowledge.captureGuide(guide.id, me.id);
    this.#announce('guide', 'guide', guide.id, `/m/guias/${guide.id}`);
    return guide.id;
  }

  updateGuide(guideId: Id, input: GuideInput, expectedVersion?: number) {
    const me = this.#activeMember();
    const current = this.#guide(guideId);
    if (expectedVersion !== undefined && current.version !== expectedVersion) throw new Error('La guía cambió. Actualiza antes de guardar.');
    const checked = this.#checkGuide(input);
    if (checked.subjectId !== current.subjectId) throw new Error('La materia de una guía no cambia.');
    this.#knowledge.captureGuide(guideId);
    const next: StudyGuide = {
      ...current,
      ...checked,
      version: current.version + 1,
      updatedBy: me.id,
      updatedAt: this.#now(),
    };
    this.#state.guides = this.#state.guides.map((g) => (g.id === guideId ? next : g));
    // Un tema que se quitó del temario deja de contar en las fuentes.
    this.#state.guideSources = this.#state.guideSources.map((src) =>
      src.guideId === guideId ? { ...src, topics: src.topics.filter((t) => next.topics.includes(t)) } : src,
    );
    this.#knowledge.captureGuide(guideId, me.id);
    this.#emit();
  }

  savePresentationPractice(input: PresentationPracticeInput) { return this.#presentations.savePresentationPractice(input); }
  setPresentationReviewer(practiceId: Id, reviewerId: Id | undefined, expectedVersion: number) { return this.#presentations.setPresentationReviewer(practiceId, reviewerId, expectedVersion); }
  archivePresentationPractice(practiceId: Id, archived: boolean, expectedVersion: number) { return this.#presentations.archivePresentationPractice(practiceId, archived, expectedVersion); }
  createPresentationAttempt(practiceId: Id, requestId: string, expectedVersion: number) { return this.#presentations.createPresentationAttempt(practiceId, requestId, expectedVersion); }
  savePresentationAttempt(attemptId: Id, input: PresentationAttemptInput, expectedVersion: number) { return this.#presentations.savePresentationAttempt(attemptId, input, expectedVersion); }
  completePresentationAttempt(attemptId: Id, expectedVersion: number) { return this.#presentations.completePresentationAttempt(attemptId, expectedVersion); }
  askPresentationQuestion(attemptId: Id, text: string, requestId: string) { return this.#presentations.askPresentationQuestion(attemptId, text, requestId); }
  answerPresentationQuestion(questionId: Id, answer: string, expectedVersion: number) { return this.#presentations.answerPresentationQuestion(questionId, answer, expectedVersion); }
  savePresentationFeedback(attemptId: Id, input: PresentationFeedbackInput, expectedVersion?: number) { return this.#presentations.savePresentationFeedback(attemptId, input, expectedVersion); }

  #spacedCollection(collectionId: Id): SpacedCollection {
    const me = this.#activeMember();
    const collection = this.#state.spacedCollections.find((item) => item.id === collectionId &&
      (item.visibility === 'group' || item.ownerId === me.id));
    if (!collection) throw new Error('La colección no existe o no tienes acceso.');
    return collection;
  }

  #spacedVersion(version: number, expectedVersion?: number) {
    if (version !== expectedVersion) throw new Error('El contenido cambió. Actualiza antes de guardar.');
  }

  #readableSpacedSource(kind: SpacedCard['sourceKind'], sourceId: Id, collection: SpacedCollection) {
    if (this.#withdrawals.get(`${kind}:${sourceId}`)?.withdrawnAt) return undefined;
    const source = kind === 'note'
      ? this.#state.notes.find((note) => note.id === sourceId &&
        (note.visibility === 'group' || (collection.visibility === 'personal' && note.authorId === collection.ownerId)))
      : kind === 'guide' ? this.#state.guides.find((guide) => guide.id === sourceId) : undefined;
    return source?.subjectId === collection.subjectId ? source : undefined;
  }

  saveSpacedCollection(input: SpacedCollectionInput): Id {
    const me = this.#activeMember();
    this.#requireSubject(input.subjectId);
    if (input.termId && !this.#state.terms.some((term) => term.id === input.termId && term.subjectId === input.subjectId)) {
      throw new Error('El parcial no pertenece a esta materia.');
    }
    if (input.visibility !== 'personal' && input.visibility !== 'group') throw new Error('La visibilidad no es válida.');
    const title = requireText(input.title, 'El título', MAX_SPACED_TITLE_LENGTH);
    const current = input.id ? this.#spacedCollection(input.id) : undefined;
    if (current) {
      this.#spacedVersion(current.version, input.expectedVersion);
      if (current.archived) throw new Error('Restaura la colección antes de editarla.');
      if (current.visibility !== input.visibility) throw new Error('Usa Publicar para compartir una colección personal; una compartida permanece en el grupo.');
      if (current.subjectId !== input.subjectId && this.#state.spacedCards.some((card) => card.collectionId === current.id)) {
        throw new Error('La materia de una colección con tarjetas no cambia.');
      }
      if (current.title === title && current.subjectId === input.subjectId && current.termId === input.termId) return current.id;
    }
    const now = this.#now();
    const collection: SpacedCollection = current
      ? { ...current, subjectId: input.subjectId, termId: input.termId, title, version: current.version + 1, updatedBy: me.id, updatedAt: now }
      : { id: this.#id(), subjectId: input.subjectId, termId: input.termId, title, visibility: input.visibility,
        ownerId: me.id, version: 1, archived: false, createdAt: now, updatedAt: now, updatedBy: me.id };
    this.#state.spacedCollections = current
      ? this.#state.spacedCollections.map((item) => item.id === current.id ? collection : item)
      : [...this.#state.spacedCollections, collection];
    this.#emit();
    return collection.id;
  }

  publishSpacedCollection(collectionId: Id, expectedVersion: number) {
    const me = this.#activeMember();
    const collection = this.#spacedCollection(collectionId);
    if (collection.ownerId !== me.id) throw new Error('Solo su propietario puede publicar la colección.');
    this.#spacedVersion(collection.version, expectedVersion);
    if (collection.archived) throw new Error('Restaura la colección antes de publicarla.');
    const shared = { ...collection, visibility: 'group' as const };
    if (this.#state.spacedCards.some((card) => card.collectionId === collectionId &&
      !this.#readableSpacedSource(card.sourceKind, card.sourceId, shared))) {
      throw new Error('Todas las fuentes, incluso las archivadas, deben ser accesibles al grupo; las notas personales no se pueden compartir.');
    }
    if (collection.visibility === 'group') return;
    this.#state.spacedCollections = this.#state.spacedCollections.map((item) => item.id === collectionId
      ? { ...shared, version: collection.version + 1, updatedBy: me.id, updatedAt: this.#now() } : item);
    this.#emit();
  }

  archiveSpacedCollection(collectionId: Id, archived: boolean, expectedVersion: number) {
    const me = this.#activeMember();
    const collection = this.#spacedCollection(collectionId);
    if (collection.ownerId !== me.id) throw new Error('Solo su propietario puede archivar la colección.');
    this.#spacedVersion(collection.version, expectedVersion);
    if (collection.archived === archived) return;
    this.#state.spacedCollections = this.#state.spacedCollections.map((item) => item.id === collectionId
      ? { ...item, archived, version: item.version + 1, updatedBy: me.id, updatedAt: this.#now() } : item);
    this.#emit();
  }

  #preserveSpacedProgress(card: SpacedCard, version: number) {
    this.#state.spacedProgress = this.#state.spacedProgress.map((progress) => progress.cardId === card.id && progress.cardVersion === card.version
      ? { ...progress, cardVersion: version, revision: progress.revision + 1 } : progress);
  }

  saveSpacedCard(input: SpacedCardInput): Id {
    const me = this.#activeMember();
    const collection = this.#spacedCollection(input.collectionId);
    if (collection.archived) throw new Error('Restaura la colección antes de editar sus tarjetas.');
    const source = this.#readableSpacedSource(input.sourceKind, input.sourceId, collection);
    if (!source) throw new Error('La fuente no existe, no es accesible o no pertenece a esta materia. Las notas personales solo se usan en colecciones personales.');
    const question = requireText(input.question, 'La pregunta', MAX_SPACED_QUESTION_LENGTH);
    const explanation = requireText(input.explanation, 'La explicación', MAX_SPACED_EXPLANATION_LENGTH);
    const hint = input.hint.trim();
    if (hint.length > MAX_SPACED_HINT_LENGTH) throw new Error(`La pista excede ${MAX_SPACED_HINT_LENGTH} caracteres.`);
    const current = input.id ? this.#state.spacedCards.find((card) => card.id === input.id && card.collectionId === collection.id) : undefined;
    if (input.id && !current) throw new Error('La tarjeta no existe o no pertenece a esta colección.');
    if (current) {
      this.#spacedVersion(current.version, input.expectedVersion);
    }
    const now = this.#now();
    const changed = current && (current.question !== question || current.explanation !== explanation || current.hint !== hint ||
      current.sourceKind !== input.sourceKind || current.sourceId !== input.sourceId || current.sourceVersion !== source.version);
    if (current && !changed) return current.id;
    const card: SpacedCard = current
      ? { ...current, question, explanation, hint, sourceKind: input.sourceKind, sourceId: input.sourceId,
        sourceVersion: source.version, version: current.version + 1, updatedBy: me.id, updatedAt: now }
      : { id: this.#id(), collectionId: collection.id, question, explanation, hint, sourceKind: input.sourceKind,
        sourceId: input.sourceId, sourceVersion: source.version, version: 1, archived: false,
        createdBy: me.id, updatedBy: me.id, createdAt: now, updatedAt: now };
    if (current && current.question === question && current.explanation === explanation && current.hint === hint) {
      this.#preserveSpacedProgress(current, card.version);
    }
    this.#state.spacedCards = current
      ? this.#state.spacedCards.map((item) => item.id === current.id ? card : item)
      : [...this.#state.spacedCards, card];
    this.#emit();
    return card.id;
  }

  archiveSpacedCard(cardId: Id, archived: boolean, expectedVersion: number) {
    const me = this.#activeMember();
    const card = this.#state.spacedCards.find((item) => item.id === cardId);
    if (!card) throw new Error('La tarjeta no existe o no tienes acceso.');
    const collection = this.#spacedCollection(card.collectionId);
    if (collection.archived) throw new Error('Restaura la colección antes de editar sus tarjetas.');
    this.#spacedVersion(card.version, expectedVersion);
    if (card.archived === archived) return;
    this.#preserveSpacedProgress(card, card.version + 1);
    this.#state.spacedCards = this.#state.spacedCards.map((item) => item.id === cardId
      ? { ...item, archived, version: item.version + 1, updatedBy: me.id, updatedAt: this.#now() } : item);
    this.#emit();
  }

  replaceSpacedCardSource(cardId: Id, expectedVersion: number, sourceKind: SpacedCard['sourceKind'], sourceId: Id) {
    const me = this.#activeMember();
    const card = this.#state.spacedCards.find((item) => item.id === cardId);
    if (!card) throw new Error('La tarjeta no existe o no tienes acceso.');
    const collection = this.#spacedCollection(card.collectionId);
    if (collection.archived) throw new Error('Restaura la colección antes de editar sus tarjetas.');
    this.#spacedVersion(card.version, expectedVersion);
    const source = this.#readableSpacedSource(sourceKind, sourceId, collection);
    if (!source) throw new Error('La fuente no existe, no es accesible o no pertenece a esta materia.');
    if (card.sourceKind === sourceKind && card.sourceId === sourceId && card.sourceVersion === source.version) return;
    this.#preserveSpacedProgress(card, card.version + 1);
    this.#state.spacedCards = this.#state.spacedCards.map((item) => item.id === cardId
      ? { ...item, sourceKind, sourceId, sourceVersion: source.version, version: item.version + 1, updatedBy: me.id, updatedAt: this.#now() } : item);
    this.#emit();
  }

  setSpacedEnrollment(collectionId: Id, active: boolean) {
    const me = this.#activeMember();
    const collection = this.#spacedCollection(collectionId);
    if (active && collection.archived) throw new Error('La colección está archivada.');
    const enrollment = { memberId: me.id, collectionId, active, updatedAt: this.#now() };
    this.#state.spacedEnrollments = [...this.#state.spacedEnrollments.filter((row) => row.memberId !== me.id || row.collectionId !== collectionId), enrollment];
    this.#emit();
  }

  reviewSpacedCard(input: SpacedReviewInput) {
    const me = this.#activeMember();
    const requestId = input.requestId;
    if (!requestId.trim() || requestId.length > 200) throw new Error('La identificación del repaso no es válida.');
    if (input.rating !== 'remembered' && input.rating !== 'hint' && input.rating !== 'again') throw new Error('El resultado del repaso no es válido.');
    const existing = this.#state.spacedReviews.find((row) => row.memberId === me.id && row.requestId === requestId);
    if (existing) {
      if (existing.cardId !== input.cardId || existing.cardVersion !== input.cardVersion || existing.rating !== input.rating ||
        existing.expectedRevision !== input.expectedRevision) throw new Error('Esta identificación ya se usó para otro repaso.');
      return;
    }
    const card = this.#state.spacedCards.find((item) => item.id === input.cardId);
    if (!card) throw new Error('La tarjeta no existe o no tienes acceso.');
    const collection = this.#spacedCollection(card.collectionId);
    if (collection.archived || card.archived || !this.#readableSpacedSource(card.sourceKind, card.sourceId, collection)) {
      throw new Error('La tarjeta o su fuente ya no están disponibles.');
    }
    if (!this.#state.spacedEnrollments.some((row) => row.memberId === me.id && row.collectionId === collection.id && row.active)) {
      throw new Error('Añade esta colección a tu repaso antes de estudiar.');
    }
    this.#spacedVersion(card.version, input.cardVersion);
    const progress = this.#state.spacedProgress.find((row) => row.memberId === me.id && row.cardId === card.id);
    if ((progress?.revision ?? 0) !== input.expectedRevision) throw new Error('El progreso cambió en otra sesión. Actualiza antes de guardar.');
    const now = this.#now();
    const current = progress?.cardVersion === card.version ? progress : undefined;
    if (current && current.dueAt.getTime() > now.getTime()) throw new Error('Todavía no vence el próximo repaso de esta tarjeta.');
    const schedule = nextSpacedSchedule(current?.step ?? 0, input.rating, now.getTime());
    const next: SpacedProgress = { memberId: me.id, cardId: card.id, cardVersion: card.version,
      step: schedule.step, revision: (progress?.revision ?? 0) + 1, reviewedAt: now, dueAt: new Date(schedule.dueAt) };
    this.#state.spacedProgress = [...this.#state.spacedProgress.filter((row) => row.memberId !== me.id || row.cardId !== card.id), next];
    this.#state.spacedReviews = [...this.#state.spacedReviews, { id: `${me.id}:${requestId}`, requestId, memberId: me.id,
      cardId: card.id, cardVersion: card.version, rating: input.rating, step: schedule.step,
      reviewedAt: now, dueAt: next.dueAt, expectedRevision: input.expectedRevision }];
    this.#emit();
  }

  #ownTeachingPractice(practiceId: Id): TeachingPractice {
    const me = this.#activeMember();
    const practice = this.#state.teachingPractices.find((item) => item.id === practiceId);
    if (!practice || practice.ownerId !== me.id) throw new Error('La práctica no existe o no tienes acceso.');
    return practice;
  }

  #teachingPersonal(practiceId: Id): TeachingPersonal {
    const personal = this.#state.teachingPersonal.find((item) => item.practiceId === practiceId);
    if (!personal) throw new Error('No se encontró la información personal de la práctica.');
    return personal;
  }

  createTeachingPractice(input: CreateTeachingPracticeInput): Id {
    const me = this.#activeMember();
    this.#requireSubject(input.subjectId);
    const topic = requireText(input.topic, 'El tema', MAX_TEACHING_TOPIC_LENGTH);
    const problem = teachingExplanationError(input.initial);
    if (problem) throw new Error(problem);
    let sourceVersion: number | undefined;
    if (input.source) {
      const source = input.source.kind === 'note'
        ? this.#state.notes.find((note) => note.id === input.source!.id &&
          (note.visibility === 'group' || note.authorId === me.id))
        : input.source.kind === 'guide'
          ? this.#state.guides.find((guide) => guide.id === input.source!.id)
          : undefined;
      if (!source || source.subjectId !== input.subjectId || source.withdrawnAt ||
        this.#withdrawals.get(`${input.source.kind}:${input.source.id}`)?.withdrawnAt ||
        !this.#canReadResource(input.source.kind, input.source.id)) {
        throw new Error('La fuente no existe, no es accesible o no pertenece a esta materia.');
      }
      sourceVersion = source.version;
    }
    const now = this.#now();
    const practice: TeachingPractice = {
      id: this.#id(), ownerId: me.id, subjectId: input.subjectId, topic,
      initial: normalizeTeachingExplanation(input.initial), revised: { ...EMPTY_TEACHING_EXPLANATION },
      status: 'draft', createdAt: now, updatedAt: now,
    };
    this.#state.teachingPractices = [...this.#state.teachingPractices, practice];
    this.#state.teachingPersonal = [...this.#state.teachingPersonal, {
      practiceId: practice.id, reflection: '', topicsToReview: '',
      sourceKind: input.source?.kind, sourceId: input.source?.id, sourceVersion,
    }];
    this.#emit();
    return practice.id;
  }

  saveTeachingPractice(practiceId: Id, input: SaveTeachingPracticeInput) {
    const practice = this.#ownTeachingPractice(practiceId);
    if (practice.status === 'completed') throw new Error('Reabre la práctica para seguir trabajando.');
    for (const explanation of [input.initial, input.revised]) {
      const problem = teachingExplanationError(explanation);
      if (problem) throw new Error(problem);
    }
    const initial = normalizeTeachingExplanation(input.initial);
    const revised = normalizeTeachingExplanation(input.revised);
    if (practice.status !== 'draft' &&
      (initial.concept !== practice.initial.concept || initial.example !== practice.initial.example || initial.limits !== practice.initial.limits)) {
      throw new Error('La explicación inicial se conserva al comenzar la práctica.');
    }
    const reflection = input.reflection.trim();
    const topicsToReview = input.topicsToReview.trim();
    if (reflection.length > MAX_TEACHING_TEXT_LENGTH) throw new Error(`La reflexión excede ${MAX_TEACHING_TEXT_LENGTH} caracteres.`);
    if (topicsToReview.length > MAX_TEACHING_QUESTION_LENGTH) throw new Error(`Los temas para repasar exceden ${MAX_TEACHING_QUESTION_LENGTH} caracteres.`);
    this.#state.teachingPractices = this.#state.teachingPractices.map((item) => item.id === practiceId
      ? { ...item, initial, revised, updatedAt: this.#now() } : item);
    this.#state.teachingPersonal = this.#state.teachingPersonal.map((item) => item.practiceId === practiceId
      ? { ...item, reflection, topicsToReview } : item);
    this.#emit();
  }

  startTeachingPractice(practiceId: Id) {
    const practice = this.#ownTeachingPractice(practiceId);
    if (practice.status === 'practicing') return;
    if (practice.status !== 'draft') throw new Error('La práctica ya comenzó.');
    const problem = teachingExplanationError(practice.initial, true);
    if (problem) throw new Error(problem);
    const now = this.#now();
    this.#state.teachingPractices = this.#state.teachingPractices.map((item) => item.id === practiceId
      ? { ...item, status: 'practicing', updatedAt: now } : item);
    this.#state.teachingQuestions = [...this.#state.teachingQuestions, ...TEACHING_PROMPTS.map((text): TeachingQuestion => ({
      id: this.#id(), practiceId, authorId: practice.ownerId, kind: 'guided', text, answer: '', createdAt: now,
    }))];
    this.#emit();
  }

  completeTeachingPractice(practiceId: Id) {
    const practice = this.#ownTeachingPractice(practiceId);
    if (practice.status === 'completed') return;
    if (practice.status !== 'practicing') throw new Error('La práctica debe estar en curso para completarla.');
    const personal = this.#teachingPersonal(practiceId);
    const answered = this.#state.teachingQuestions.filter((question) => question.practiceId === practiceId && question.answer.trim()).length;
    const problem = teachingCompletionError(practice.revised, personal.reflection, answered);
    if (problem) throw new Error(problem);
    this.#state.teachingPractices = this.#state.teachingPractices.map((item) => item.id === practiceId
      ? { ...item, status: 'completed', updatedAt: this.#now() } : item);
    this.#emit();
  }

  reopenTeachingPractice(practiceId: Id) {
    const practice = this.#ownTeachingPractice(practiceId);
    if (practice.status !== 'completed') throw new Error('Solo se reabre una práctica completada.');
    this.#state.teachingPractices = this.#state.teachingPractices.map((item) => item.id === practiceId
      ? { ...item, status: 'practicing', updatedAt: this.#now() } : item);
    this.#emit();
  }

  setTeachingReviewer(practiceId: Id, reviewerId?: Id) {
    const practice = this.#ownTeachingPractice(practiceId);
    if (reviewerId) {
      if (practice.status !== 'practicing') throw new Error('Invita a un compañero cuando la práctica esté en curso.');
      if (reviewerId === practice.ownerId || !this.#isActive(reviewerId)) throw new Error('Elige a otro integrante activo.');
    }
    this.#state.teachingPractices = this.#state.teachingPractices.map((item) => item.id === practiceId
      ? { ...item, reviewerId: reviewerId || undefined, updatedAt: this.#now() } : item);
    this.#emit();
  }

  askTeachingQuestion(practiceId: Id, text: string): Id {
    const me = this.#activeMember();
    const practice = this.#state.teachingPractices.find((item) => item.id === practiceId);
    if (!practice || !this.#isActive(practice.ownerId) || practice.reviewerId !== me.id) {
      throw new Error('La práctica no existe o no tienes acceso.');
    }
    if (practice.status !== 'practicing') throw new Error('Solo puedes preguntar mientras la práctica está en curso.');
    const question: TeachingQuestion = {
      id: this.#id(), practiceId, authorId: me.id, kind: 'peer',
      text: requireText(text, 'La pregunta', MAX_TEACHING_QUESTION_LENGTH), answer: '', createdAt: this.#now(),
    };
    this.#state.teachingQuestions = [...this.#state.teachingQuestions, question];
    this.#state.teachingPractices = this.#state.teachingPractices.map((item) => item.id === practiceId
      ? { ...item, updatedAt: question.createdAt } : item);
    this.#emit();
    return question.id;
  }

  answerTeachingQuestion(questionId: Id, answer: string) {
    this.#activeMember();
    const question = this.#state.teachingQuestions.find((item) => item.id === questionId);
    if (!question) throw new Error('La pregunta no existe.');
    const practice = this.#ownTeachingPractice(question.practiceId);
    if (practice.status !== 'practicing') throw new Error('Solo puedes responder mientras la práctica está en curso.');
    const text = requireText(answer, 'La respuesta', MAX_TEACHING_QUESTION_LENGTH);
    const now = this.#now();
    this.#state.teachingQuestions = this.#state.teachingQuestions.map((item) => item.id === questionId
      ? { ...item, answer: text, answeredAt: now } : item);
    this.#state.teachingPractices = this.#state.teachingPractices.map((item) => item.id === practice.id
      ? { ...item, updatedAt: now } : item);
    this.#emit();
  }

  publishTeachingExplanation(practiceId: Id): Id {
    const practice = this.#ownTeachingPractice(practiceId);
    const personal = this.#teachingPersonal(practiceId);
    if (personal.publishedNoteId) return personal.publishedNoteId;
    if (practice.status !== 'completed') throw new Error('Completa la práctica antes de publicar.');
    const now = this.#now();
    const note: Note = {
      id: this.#id(), subjectId: practice.subjectId, topic: practice.topic, title: practice.topic,
      body: teachingNoteBody(practice.revised), tags: ['aprende-ensenando'], visibility: 'group', source: 'student',
      authorId: practice.ownerId, version: 1, createdAt: now, updatedAt: now,
    };
    // Ambas escrituras se terminan antes de emitir: un doble envío recupera la misma nota.
    this.#state.notes = [...this.#state.notes, note];
    this.#state.teachingPersonal = this.#state.teachingPersonal.map((item) => item.practiceId === practiceId
      ? { ...item, publishedNoteId: note.id } : item);
    this.#emit();
    return note.id;
  }

  /** Valida lo que se captura al crear o editar una votación. */
  #pollContent(input: PollInput) {
    const options = cleanPollOptions(input.options);
    if ('problem' in options) throw new Error(options.problem);
    const problem = closingError(input.closesAt, this.#now());
    if (problem) throw new Error(problem);
    const eligibleIds = [...new Set(input.eligibleIds)].filter((id) => this.#isActive(id));
    if (!eligibleIds.length) throw new Error('Elige al menos a un participante.');
    return {
      title: requireText(input.title, 'La pregunta', MAX_POLL_TITLE_LENGTH),
      description: input.description.trim().slice(0, MAX_POLL_DESCRIPTION_LENGTH),
      options: options.options,
      multiple: input.multiple,
      allowChange: input.allowChange,
      eligibleIds,
      closesAt: input.closesAt,
    };
  }

  #poll(pollId: Id): Poll {
    this.#activeMember();
    const poll = this.#state.polls.find((p) => p.id === pollId);
    if (!poll) throw new Error('La votación no existe.');
    return poll;
  }

  createPoll(input: PollInput): Id {
    const me = this.#activeMember();
    const content = this.#pollContent(input);
    if (input.restartOf) {
      const previous = this.#poll(input.restartOf);
      if (pollStatus(previous, this.#now()) !== 'cancelled') {
        throw new Error('Solo se reinicia una votación cancelada.');
      }
    }
    const now = this.#now();
    const poll: Poll = {
      id: this.#id(),
      ...content,
      createdBy: me.id,
      createdAt: now,
      updatedAt: now,
      cancelReason: '',
      restartOf: input.restartOf,
      decision: '',
    };
    this.#state.polls = [...this.#state.polls, poll];
    this.#emit();
    return poll.id;
  }

  updatePoll(pollId: Id, input: PollInput) {
    const me = this.#activeMember();
    const poll = this.#poll(pollId);
    if (poll.createdBy !== me.id) throw new Error('Solo quien creó la votación puede editarla.');
    if (pollStatus(poll, this.#now()) !== 'open') throw new Error('La votación ya no está abierta.');
    if (this.#state.pollVotes.some((v) => v.pollId === pollId)) {
      throw new Error('Ya tiene votos: para cambiarla, cancélala y reiníciala.');
    }
    const content = this.#pollContent(input);
    this.#state.polls = this.#state.polls.map((p) =>
      p.id === pollId ? { ...p, ...content, updatedAt: this.#now() } : p,
    );
    this.#emit();
  }

  addGuideSources(guideId: Id, sources: GuideSourceRef[]) {
    const me = this.#activeMember();
    this.#knowledge.captureGuide(guideId);
    this.#addSources(this.#guide(guideId), sources, me.id);
    this.#changedExtra('guide', guideId);
  }

  #guideSource(sourceId: Id): GuideSource {
    const source = this.#state.guideSources.find((src) => src.id === sourceId);
    if (!source) throw new Error('La fuente no existe.');
    return source;
  }

  updateGuideSource(sourceId: Id, update: GuideSourceUpdate) {
    this.#activeMember();
    const source = this.#guideSource(sourceId);
    const guide = this.#guide(source.guideId);
    const problem = sourceStatusError(update.status, update.reason);
    if (problem) throw new Error(problem);
    if (update.topics.some((t) => !guide.topics.includes(t))) {
      throw new Error('Un tema no está en el temario de la guía.');
    }
    const next: GuideSource = {
      ...source,
      status: update.status,
      reason: update.status === 'pending' ? update.reason.trim() : '',
      topics: guide.topics.filter((t) => update.topics.includes(t)),
    };
    this.#knowledge.captureGuide(guide.id);
    this.#state.guideSources = this.#state.guideSources.map((src) => (src.id === sourceId ? next : src));
    this.#changedExtra('guide', guide.id);
  }

  refreshGuideSource(sourceId: Id) {
    this.#activeMember();
    const source = this.#guideSource(sourceId);
    const guide = this.#guide(source.guideId);
    const version = this.#sourceVersion(source, guide.subjectId);
    this.#knowledge.captureGuide(guide.id);
    this.#state.guideSources = this.#state.guideSources.map((src) =>
      src.id === sourceId ? { ...src, sourceVersion: version } : src,
    );
    this.#changedExtra('guide', guide.id);
  }

  castVote(pollId: Id, choices: number[]) {
    const me = this.#activeMember();
    const poll = this.#poll(pollId);
    const previous = this.#state.pollVotes.find((v) => v.pollId === pollId && v.voterId === me.id);
    const now = this.#now();
    const problem = voteError(
      {
        status: pollStatus(poll, now),
        multiple: poll.multiple,
        allowChange: poll.allowChange,
        optionCount: poll.options.length,
        eligible: poll.eligibleIds.includes(me.id),
        alreadyVoted: Boolean(previous),
      },
      choices,
    );
    if (problem) throw new Error(problem);
    const sorted = [...choices].sort((a, b) => a - b);
    this.#state.pollVotes = previous
      ? this.#state.pollVotes.map((v) => (v === previous ? { ...v, choices: sorted, changedAt: now } : v))
      : [...this.#state.pollVotes, { pollId, voterId: me.id, choices: sorted, votedAt: now }];
    this.#emit();
  }

  cancelPoll(pollId: Id, reason: string) {
    const me = this.#activeMember();
    const poll = this.#poll(pollId);
    if (poll.createdBy !== me.id) throw new Error('Solo quien creó la votación puede cancelarla.');
    if (pollStatus(poll, this.#now()) !== 'open') throw new Error('La votación ya no está abierta.');
    const cancelReason = requireText(reason, 'La razón', MAX_POLL_NOTE_LENGTH);
    this.#state.polls = this.#state.polls.map((p) =>
      p.id === pollId ? { ...p, cancelledAt: this.#now(), cancelReason } : p,
    );
    this.#emit();
  }

  recordPollDecision(pollId: Id, decision: string) {
    const me = this.#activeMember();
    const poll = this.#poll(pollId);
    if (pollStatus(poll, this.#now()) !== 'closed') {
      throw new Error('El acuerdo se registra cuando la votación cierra.');
    }
    const text = requireText(decision, 'El acuerdo', MAX_POLL_NOTE_LENGTH);
    this.#state.polls = this.#state.polls.map((p) =>
      p.id === pollId ? { ...p, decision: text, decidedBy: me.id, decidedAt: this.#now() } : p,
    );
    this.#emit();
  }

  removeGuideSource(sourceId: Id) {
    this.#activeMember();
    const source = this.#guideSource(sourceId); this.#guide(source.guideId); this.#knowledge.captureGuide(source.guideId);
    this.#state.guideSources = this.#state.guideSources.filter((src) => src.id !== sourceId);
    this.#changedExtra('guide', source.guideId);
  }

  reviewGuide(guideId: Id, verdict: GuideReviewVerdict, comment: string) {
    const me = this.#activeMember();
    const guide = this.#guide(guideId);
    if (!canReviewGuide(me.id, guide.updatedBy)) {
      throw new Error('Guardaste esta versión; la revisa otro compañero.');
    }
    if (!isGuideReviewVerdict(verdict)) throw new Error('Resultado de revisión inválido.');
    const text = comment.trim();
    if (text.length > MAX_REVIEW_COMMENT_LENGTH) {
      throw new Error(`El comentario excede ${MAX_REVIEW_COMMENT_LENGTH} caracteres.`);
    }
    if (verdict === 'changes' && !text) throw new Error('Di qué cambios propones.');
    const review: GuideReview = {
      id: this.#id(),
      guideId,
      guideVersion: guide.version,
      reviewerId: me.id,
      verdict,
      comment: text,
      createdAt: this.#now(),
    };
    // Una revisión por persona y versión: volver a revisar reemplaza la anterior.
    this.#state.guideReviews = [
      ...this.#state.guideReviews.filter(
        (r) => !(r.guideId === guideId && r.guideVersion === guide.version && r.reviewerId === me.id),
      ),
      review,
    ];
    this.#emit();
  }
}

/** Stickers de prueba dibujados aquí mismo: solo texto sobre un fondo de color. */
const DEMO_STICKERS: [Id, string, number][] = [
  ['s1', '¡Listo!', 145],
  ['s2', 'Gracias', 210],
  ['s3', '¿Ya?', 35],
  ['s4', 'Ánimo', 290],
];

function demoSticker(label: string, hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">` +
    `<rect x="8" y="8" width="144" height="144" rx="40" fill="hsl(${hue} 70% 55%)" stroke="#fff" stroke-width="8"/>` +
    `<text x="80" y="92" font-family="system-ui,sans-serif" font-size="30" font-weight="800" fill="#fff" text-anchor="middle">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Estado inicial con datos de prueba claramente marcados. */
export function createDemoState(now = new Date()): State {
  const LOGICA = 'IDSE-05010103';
  const FUNDAMENTOS = 'IDSE-05010104';
  const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);
  const dayMonthIn = (n: number) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
    return { day: date.getDate(), month: date.getMonth() + 1 };
  };
  const daysAgo = (n: number) => toDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
  const members: Member[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    id: `demo-${n}`,
    displayName: `Alumno de prueba ${n}`,
    status: 'active',
    isCreator: n === 1,
    joinedAt: minutesAgo(10_000),
  }));
  // Materias reales del plan de estudios, cada una con sus tres parciales. Todo lo demás
  // (alumnos, trabajos, mensajes) sigue siendo de prueba.
  const subjects: Subject[] = CURRICULUM.map((s) => ({ id: s.code, ...s }));
  const terms: Term[] = subjects.flatMap((subject) =>
    termNames().map((name, i) => ({
      id: `${subject.id}-p${i + 1}`,
      subjectId: subject.id,
      name,
      position: i + 1,
    })),
  );
  // Fechas del primer cuatrimestre, relativas a hoy para que el parcial 2 sea siempre el vigente.
  const calendar: TermDates[] = [
    { period: 1, term: 1, startDate: daysAgo(40), endDate: daysAgo(8) },
    { period: 1, term: 2, startDate: daysAgo(7), endDate: daysAgo(-25) },
    { period: 1, term: 3, startDate: daysAgo(-26), endDate: daysAgo(-60) },
  ];
  // Páginas principales: lo que se pidió. La primera ya fue editada por tres personas.
  const assignments: Assignment[] = [
    {
      id: 't1',
      subjectId: LOGICA,
      termId: `${LOGICA}-p1`,
      kind: 'tarea',
      title: 'Tarea de prueba 1',
      instructions:
        'Instrucciones de ejemplo, ya corregidas entre varios:\n1. Resolver el ejercicio.\n2. Explicar la solución.\n' +
        '3. Subir el trabajo en esta página.',
      dueDate: daysAgo(-5),
      version: 3,
      createdBy: 'demo-2',
      createdAt: minutesAgo(3100),
      // La última edición movió la entrega dos días; aparece como cambio de fecha en «¿Qué me perdí?».
      updatedBy: 'demo-3',
      updatedAt: minutesAgo(95),
    },
    {
      id: 't2',
      subjectId: FUNDAMENTOS,
      termId: `${FUNDAMENTOS}-p1`,
      kind: 'actividad',
      title: 'Actividad de prueba',
      instructions: 'Instrucciones de ejemplo de una actividad.',
      version: 1,
      createdBy: 'demo-3',
      createdAt: minutesAgo(1600),
      updatedBy: 'demo-3',
      updatedAt: minutesAgo(1600),
    },
    {
      id: 't3',
      subjectId: LOGICA,
      termId: `${LOGICA}-p1`,
      kind: 'exposicion',
      title: 'Exposición de prueba en equipos',
      instructions: 'Instrucciones de ejemplo: cada equipo expone un tema distinto y sube su material.',
      dueDate: daysAgo(-12),
      version: 1,
      createdBy: 'demo-2',
      createdAt: minutesAgo(2300),
      updatedBy: 'demo-2',
      updatedAt: minutesAgo(2300),
    },
    {
      id: 't4',
      subjectId: LOGICA,
      termId: `${LOGICA}-p2`,
      kind: 'tarea',
      title: 'Tarea de prueba 2',
      instructions: 'Instrucciones de ejemplo del segundo parcial.',
      version: 1,
      createdBy: 'demo-4',
      createdAt: minutesAgo(950),
      updatedBy: 'demo-4',
      updatedAt: minutesAgo(950),
    },
    {
      id: 't5',
      subjectId: FUNDAMENTOS,
      kind: 'examen',
      title: 'Examen de prueba (sin parcial)',
      instructions: '',
      version: 1,
      createdBy: 'demo-1',
      createdAt: minutesAgo(650),
      updatedBy: 'demo-1',
      updatedAt: minutesAgo(650),
    },
  ];
  // Sesiones en fechas distintas: con una evidencia, con varios equipos y sin ninguna.
  const activities: Activity[] = [
    {
      id: 'a1',
      subjectId: LOGICA,
      termId: `${LOGICA}-p2`,
      topic: 'Tema de prueba',
      date: daysAgo(2),
      title: 'Actividad de prueba en clase',
      objective: 'Objetivo de ejemplo.',
      instructions: 'Instrucciones de ejemplo.',
      createdBy: 'demo-2',
      createdAt: minutesAgo(2900),
    },
    {
      id: 'a2',
      subjectId: FUNDAMENTOS,
      termId: `${FUNDAMENTOS}-p2`,
      topic: 'Ciclos',
      date: daysAgo(1),
      title: 'Práctica de prueba en equipos',
      objective: 'Objetivo de ejemplo: resolver el mismo ejercicio de dos maneras y compararlas.',
      instructions: 'Instrucciones de ejemplo:\n1. Formen equipos.\n2. Resuelvan el ejercicio.\n3. Suban su evidencia.',
      createdBy: 'demo-3',
      createdAt: minutesAgo(1400),
    },
    {
      id: 'a3',
      subjectId: LOGICA,
      termId: `${LOGICA}-p1`,
      topic: '',
      date: daysAgo(9),
      title: 'Dinámica de prueba sin evidencias',
      objective: '',
      instructions: '',
      createdBy: 'demo-1',
      createdAt: minutesAgo(12_900),
    },
    {
      id: 'a4',
      subjectId: FUNDAMENTOS,
      termId: `${FUNDAMENTOS}-p1`,
      topic: 'Tema de prueba',
      date: daysAgo(36),
      title: 'Laboratorio de prueba del mes pasado',
      objective: 'Objetivo de ejemplo.',
      instructions: 'Instrucciones de ejemplo.',
      createdBy: 'demo-4',
      createdAt: minutesAgo(51_800),
    },
  ].map((a) => ({ ...a, version: 1, updatedBy: a.createdBy, updatedAt: a.createdAt }));

  // Historial: versiones anteriores de la primera tarea y la versión vigente de todo lo demás.
  const revisions: Revision[] = [
    {
      id: 'r1',
      page: 'assignment',
      pageId: 't1',
      version: 1,
      editedBy: 'demo-2',
      editedAt: minutesAgo(3100),
      title: 'Tarea de prueba 1',
      summary: '',
      body: 'Primera versión de las instrucciones de ejemplo.',
      dueDate: daysAgo(-3),
    },
    {
      id: 'r2',
      page: 'assignment',
      pageId: 't1',
      version: 2,
      editedBy: 'demo-4',
      editedAt: minutesAgo(2000),
      title: 'Tarea de prueba 1',
      summary: '',
      body: 'Segunda versión de ejemplo:\n1. Resolver el ejercicio.\n2. Explicar la solución.',
      dueDate: daysAgo(-3),
    },
    ...assignments.map((a): Revision => ({
      id: `r-${a.id}`,
      page: 'assignment',
      pageId: a.id,
      version: a.version,
      editedBy: a.updatedBy,
      editedAt: a.updatedAt,
      title: a.title,
      summary: '',
      body: a.instructions,
      dueDate: a.dueDate,
    })),
    ...activities.map((a): Revision => ({
      id: `r-${a.id}`,
      page: 'activity',
      pageId: a.id,
      version: a.version,
      editedBy: a.updatedBy,
      editedAt: a.updatedAt,
      title: a.title,
      summary: a.objective,
      body: a.instructions,
    })),
  ];
  return {
    ...emptyState(),
    ...demoRoomExamples(now, LOGICA),
    invitations: [
      {
        email: 'pendiente@ejemplo.mx',
        isCreator: false,
        invitedBy: 'demo-1',
        createdAt: minutesAgo(600),
      },
    ],
    members,
    subjects,
    terms,
    calendar,
    assignments,
    // Lo que subió cada quien: en equipo, con código, con versiones y más de uno por tarea.
    works: [
      {
        id: 'w1',
        assignmentId: 't1',
        title: '',
        description: 'Descripción de ejemplo del trabajo de un equipo.',
        version: 1,
        authorIds: ['demo-1', 'demo-2'],
        createdAt: minutesAgo(3000),
        updatedAt: minutesAgo(3000),
      },
      {
        id: 'w6',
        assignmentId: 't1',
        title: 'Otra solución de prueba',
        description: 'Ejemplo de un segundo trabajo en la misma tarea. No reemplaza al primero.',
        version: 1,
        authorIds: ['demo-3'],
        createdAt: minutesAgo(2600),
        updatedAt: minutesAgo(2600),
      },
      {
        id: 'w2',
        assignmentId: 't2',
        title: '',
        description: 'Descripción de ejemplo.',
        version: 1,
        authorIds: ['demo-3'],
        createdAt: minutesAgo(1500),
        updatedAt: minutesAgo(1500),
      },
      {
        id: 'w3',
        assignmentId: 't3',
        title: 'Tema de prueba del equipo',
        description:
          'Descripción de ejemplo con un fragmento de código:\n```js\nconst suma = (a, b) => a + b;\n```\n' +
          'El texto de después conserva su formato.',
        version: 1,
        authorIds: ['demo-2', 'demo-3', 'demo-4'],
        createdAt: minutesAgo(2200),
        updatedAt: minutesAgo(2200),
      },
      {
        id: 'w4',
        assignmentId: 't4',
        title: '',
        description: 'Descripción de ejemplo, ya corregida una vez.',
        version: 2,
        authorIds: ['demo-4'],
        createdAt: minutesAgo(900),
        updatedAt: minutesAgo(240),
      },
      {
        id: 'w7',
        assignmentId: 't4',
        title: 'Solución de prueba en pareja',
        description: 'Ejemplo de un trabajo de otra pareja en la misma tarea.',
        version: 1,
        authorIds: ['demo-6', 'demo-8'],
        createdAt: minutesAgo(800),
        updatedAt: minutesAgo(800),
      },
      {
        id: 'w5',
        assignmentId: 't5',
        title: '',
        description: 'Ejemplo de un trabajo subido a un examen sin parcial.',
        version: 1,
        authorIds: ['demo-1'],
        createdAt: minutesAgo(600),
        updatedAt: minutesAgo(600),
      },
    ],
    revisions,
    // Solo los datos del archivo: en modo de prueba no hay contenido que descargar.
    workFiles: [
      {
        id: 'f1',
        workId: 'w3',
        name: 'presentacion-de-prueba.pdf',
        size: 2_480_000,
        contentType: 'application/pdf',
        uploadedBy: 'demo-2',
        createdAt: minutesAgo(2200),
      },
      {
        id: 'f2',
        workId: 'w3',
        name: 'codigo-de-prueba.zip',
        size: 18_300_000,
        contentType: 'application/zip',
        uploadedBy: 'demo-4',
        createdAt: minutesAgo(2100),
      },
    ],
    // Varios días, autores y formatos para poder revisar cómo se ve el chat.
    groupMessages: [
      {
        id: 'g2',
        senderId: 'demo-3',
        text: 'Hola a todos. Este es un mensaje de prueba para ver cómo se ve el canal del salón.',
        sentAt: minutesAgo(2900),
      },
      { id: 'g3', senderId: 'demo-4', text: 'Así se ve la respuesta de otro compañero.', sentAt: minutesAgo(2895) },
      {
        id: 'g4',
        senderId: 'demo-4',
        text: 'Y un segundo mensaje seguido se agrupa con el anterior.',
        sentAt: minutesAgo(2894),
      },
      { id: 'g5', senderId: 'demo-1', text: 'Mensaje de prueba del creador de la app.', sentAt: minutesAgo(2880) },
      {
        id: 'g6',
        senderId: 'demo-2',
        text:
          'Ejemplo de mensaje largo: sirve para revisar que el texto se acomode en varias líneas ' +
          'sin salirse de la burbuja, tanto en la computadora como en el celular y en el panel ' +
          'lateral de la extensión.',
        sentAt: minutesAgo(1500),
      },
      {
        id: 'g7',
        senderId: 'demo-3',
        text:
          'Ejemplo con código:\n```js\nfunction saludar(nombre) {\n  return `Hola, ${nombre}`;\n}\n```\n' +
          'Los bloques conservan sus espacios.',
        sentAt: minutesAgo(1490),
      },
      {
        id: 'g8',
        senderId: 'demo-1',
        text: 'También se reconocen enlaces como https://example.com/apuntes y código en línea como `npm run dev`.',
        sentAt: minutesAgo(1480),
      },
      { id: 'g9', senderId: 'demo-4', text: '¿Alguien tiene la tarea de prueba a la mano?', sentAt: minutesAgo(95) },
      {
        id: 'g10',
        senderId: 'demo-3',
        text: 'Aquí está, con la página donde cada quien sube lo suyo.\n[[tarea:t1]]',
        sentAt: minutesAgo(80),
        replyToId: 'g9',
      },
      { id: 'g11', senderId: 'demo-4', text: '[[sticker:s2]]', sentAt: minutesAgo(78) },
      { id: 'g12', senderId: 'demo-4', text: '', sentAt: minutesAgo(60), deletedAt: minutesAgo(59), deletedBy: 'demo-4' },
      {
        id: 'g1',
        senderId: 'demo-2',
        text: 'Mensaje de prueba en el canal del grupo (corregido).',
        sentAt: minutesAgo(30),
        editedAt: minutesAgo(28),
      },
    ],
    directConversations: [
      { id: 'c1', participantIds: ['demo-2', 'demo-3'] },
      { id: 'c2', participantIds: ['demo-3', 'demo-4'] },
    ],
    directMessages: [
      { id: 'd1', conversationId: 'c1', senderId: 'demo-2', text: 'Mensaje privado de prueba.', sentAt: minutesAgo(20) },
      { id: 'd2', conversationId: 'c2', senderId: 'demo-4', text: 'Otro mensaje privado de prueba.', sentAt: minutesAgo(1600) },
      { id: 'd3', conversationId: 'c2', senderId: 'demo-3', text: 'Respuesta privada de prueba.', sentAt: minutesAgo(1590) },
    ],
    reactions: [
      { scope: 'group', messageId: 'g10', memberId: 'demo-4', emoji: '🙏' },
      { scope: 'group', messageId: 'g10', memberId: 'demo-2', emoji: '👍' },
      { scope: 'group', messageId: 'g7', memberId: 'demo-4', emoji: '😂' },
    ],
    stickerPacks: [
      { id: 'p1', name: 'Stickers de prueba', ownerId: 'demo-2', shared: true, createdAt: minutesAgo(5000) },
    ],
    stickers: DEMO_STICKERS.map(([id, label, hue]) => ({
      id,
      packId: 'p1',
      url: demoSticker(label, hue),
      contentType: 'image/svg+xml',
      size: 0,
      animated: false,
      createdAt: minutesAgo(5000),
    })),
    chatCommands: [
      {
        id: 'k1',
        ownerId: 'demo-1',
        name: 'repo',
        description: 'Enlace al repositorio de prueba',
        text: 'Repositorio de prueba del equipo: https://example.com/repo',
        createdAt: minutesAgo(3000),
      },
    ],
    // Relativos a hoy, para que el calendario del mes en curso siempre tenga algo que mostrar.
    birthdays: [
      { memberId: 'demo-4', ...dayMonthIn(0), remind: true },
      { memberId: 'demo-2', ...dayMonthIn(12), remind: false },
      { memberId: 'demo-3', day: 15, month: 11, remind: true },
    ],
    activities,
    evidences: [
      {
        id: 'e1',
        activityId: 'a1',
        authorId: 'demo-2',
        participantIds: ['demo-2', 'demo-3'],
        content: 'Evidencia de ejemplo del equipo.',
        createdAt: minutesAgo(2800),
      },
      {
        id: 'e2',
        activityId: 'a2',
        authorId: 'demo-1',
        participantIds: ['demo-1', 'demo-4'],
        content:
          'Evidencia de ejemplo con código:\n```js\nfor (let i = 1; i <= 3; i++) {\n  console.log(i);\n}\n```\n' +
          'Observación de ejemplo: funcionó a la primera.',
        createdAt: minutesAgo(1300),
      },
      {
        id: 'e3',
        activityId: 'a2',
        authorId: 'demo-3',
        participantIds: ['demo-3'],
        content: 'Otra evidencia de ejemplo, de un equipo distinto. No reemplaza a la anterior.',
        createdAt: minutesAgo(1250),
      },
      {
        id: 'e5',
        activityId: 'a1',
        authorId: 'demo-8',
        participantIds: ['demo-8', 'demo-7'],
        content: 'Evidencia de ejemplo de otro equipo.',
        createdAt: minutesAgo(2700),
      },
      {
        id: 'e4',
        activityId: 'a4',
        authorId: 'demo-4',
        participantIds: ['demo-4', 'demo-2'],
        content: 'Evidencia de ejemplo del mes pasado.',
        createdAt: minutesAgo(51_700),
      },
    ],
    notes: [
      {
        id: 'n1',
        subjectId: LOGICA,
        topic: 'Tema de prueba',
        title: 'Apunte de prueba del grupo',
        body: 'Contenido de ejemplo.\n\n```\nconsole.log("hola");\n```',
        tags: ['ejemplo'],
        visibility: 'group',
        source: 'student',
        authorId: 'demo-2',
        version: 1,
        createdAt: minutesAgo(120),
        updatedAt: minutesAgo(120),
      },
      {
        id: 'n3',
        subjectId: FUNDAMENTOS,
        topic: 'Ciclos',
        title: 'Resumen de prueba de ciclos',
        body: 'Contenido de ejemplo de otro compañero.',
        tags: ['ejemplo'],
        visibility: 'group',
        source: 'student',
        authorId: 'demo-6',
        version: 1,
        createdAt: minutesAgo(1700),
        updatedAt: minutesAgo(1700),
      },
      {
        id: 'n4',
        subjectId: LOGICA,
        topic: 'Tema de prueba',
        title: 'Material de prueba del docente',
        body: 'Ejemplo de material que compartió el docente.',
        tags: [],
        visibility: 'group',
        source: 'teacher',
        authorId: 'demo-7',
        version: 1,
        createdAt: minutesAgo(4300),
        updatedAt: minutesAgo(4300),
      },
      {
        id: 'n2',
        subjectId: FUNDAMENTOS,
        topic: '',
        title: 'Apunte personal de prueba',
        body: 'Solo lo ve su autor.',
        tags: [],
        visibility: 'personal',
        source: 'student',
        authorId: 'demo-3',
        version: 1,
        createdAt: minutesAgo(90),
        updatedAt: minutesAgo(90),
      },
    ],
    // Propuestas de corrección: suman a quien comenta en el apunte de alguien más.
    noteComments: [
      {
        id: 'nc1',
        noteId: 'n3',
        authorId: 'demo-5',
        text: 'Comentario de prueba: falta un ejemplo con while.',
        createdAt: minutesAgo(1650),
      },
      {
        id: 'nc2',
        noteId: 'n4',
        authorId: 'demo-5',
        text: 'Comentario de prueba: el segundo ejercicio tiene un error de dedo.',
        createdAt: minutesAgo(4200),
      },
    ],
    questions: [
      {
        id: 'q1',
        subjectId: LOGICA,
        topic: 'Tema de prueba',
        title: '¿Pregunta de prueba?',
        body: 'Descripción de ejemplo.',
        authorId: 'demo-3',
        status: 'open',
        createdAt: minutesAgo(60),
      },
      {
        id: 'q2',
        subjectId: FUNDAMENTOS,
        topic: 'Ciclos',
        title: 'Ejemplo: ¿por qué mi ciclo while no termina?',
        body: 'Pregunta de prueba con código.\n\n```\nlet i = 0;\nwhile (i < 5) {\n  console.log(i);\n}\n```',
        authorId: 'demo-1',
        status: 'resolved',
        acceptedAnswerId: 'r2',
        resolvedAt: minutesAgo(1_300),
        createdAt: minutesAgo(1_500),
      },
      {
        id: 'q3',
        subjectId: LOGICA,
        topic: 'Tema de prueba',
        title: '¿Otra pregunta de prueba, todavía sin respuesta?',
        body: '',
        authorId: 'demo-4',
        status: 'open',
        createdAt: minutesAgo(15),
      },
    ],
    answers: [
      { id: 'r1', questionId: 'q1', authorId: 'demo-2', body: 'Respuesta de ejemplo.', createdAt: minutesAgo(40) },
      {
        id: 'r2',
        questionId: 'q2',
        authorId: 'demo-4',
        body: 'Respuesta de prueba: i nunca cambia, así que i < 5 siempre es verdadero. Falta i++ dentro del ciclo.',
        createdAt: minutesAgo(1_400),
      },
      {
        id: 'r3',
        questionId: 'q2',
        authorId: 'demo-3',
        body: 'Otra respuesta de prueba: con un for el incremento queda a la vista.',
        createdAt: minutesAgo(1_350),
      },
      { id: 'an2', questionId: 'q2', authorId: 'demo-5', body: 'Respuesta de ejemplo, aceptada.', createdAt: minutesAgo(2500) },
      { id: 'an3', questionId: 'q2', authorId: 'demo-6', body: 'Otra respuesta de ejemplo.', createdAt: minutesAgo(2450) },
      // Segunda respuesta de la misma persona en la misma pregunta: se ve, pero no suma otra vez.
      { id: 'an5', questionId: 'q2', authorId: 'demo-6', body: 'Complemento de ejemplo a mi respuesta.', createdAt: minutesAgo(2400) },
      { id: 'an4', questionId: 'q3', authorId: 'demo-5', body: 'Respuesta de ejemplo, aceptada.', createdAt: minutesAgo(5100) },
    ],
    // Guía de prueba de Lógica, parcial 1: fuentes procesadas y pendientes, un tema sin
    // cobertura, una fuente que cambió después de agregarla y revisiones de compañeros.
    guides: [
      {
        id: 'gd1',
        subjectId: LOGICA,
        termId: `${LOGICA}-p1`,
        title: 'Guía de prueba del parcial 1',
        topics: ['Tema de prueba 1', 'Tema de prueba 2', 'Tema de prueba 3'],
        sections: [
          'Objetivo de ejemplo: resolver los ejercicios de los temas de prueba.',
          'Concepto de prueba: definición de ejemplo escrita por el grupo.',
          'Explicación de prueba, paso a paso.',
          'Ejemplo resuelto tomado de la tarea de prueba 1.',
          '```\n// Código de prueba comentado\nconsole.log("hola");\n```',
          '',
          'Ejercicio de prueba: repite el ejemplo con otros datos.',
          '¿Pregunta de práctica de prueba?\nRespuesta razonada de ejemplo.',
        ],
        version: 2,
        createdBy: 'demo-2',
        createdAt: minutesAgo(2500),
        updatedBy: 'demo-2',
        updatedAt: minutesAgo(1300),
      },
    ],
    guideSources: [
      { id: 'gs1', refId: 't1', kind: 'tarea', sourceVersion: 2, status: 'processed', reason: '', topics: ['Tema de prueba 1'] },
      { id: 'gs2', refId: 'w1', kind: 'trabajo', sourceVersion: 1, status: 'processed', reason: '', topics: ['Tema de prueba 1', 'Tema de prueba 2'] },
      { id: 'gs3', refId: 'n1', kind: 'nota', sourceVersion: 1, status: 'processed', reason: '', topics: ['Tema de prueba 2'] },
      { id: 'gs4', refId: 'a3', kind: 'actividad', sourceVersion: 1, status: 'pending', reason: 'Todavía no tiene evidencias.', topics: ['Tema de prueba 3'] },
      { id: 'gs5', refId: 'q1', kind: 'pregunta', sourceVersion: 1, status: 'pending', reason: 'Falta revisarla.', topics: [] },
    ].map((src) => ({ ...src, guideId: 'gd1', addedBy: 'demo-2', addedAt: minutesAgo(2500) }) as GuideSource),
    guideReviews: [
      {
        id: 'gr1',
        guideId: 'gd1',
        guideVersion: 1,
        reviewerId: 'demo-4',
        verdict: 'changes',
        comment: 'Comentario de prueba: falta un ejemplo del tema 1.',
        createdAt: minutesAgo(2000),
      },
      {
        id: 'gr2',
        guideId: 'gd1',
        guideVersion: 2,
        reviewerId: 'demo-3',
        verdict: 'approved',
        comment: '',
        createdAt: minutesAgo(1200),
      },
    ],
    // Votaciones de prueba: abierta sin tu voto, múltiple, cerrada con y sin acuerdo, y una
    // cancelada que se reinició con otra opción.
    polls: [
      {
        id: 'p1',
        title: '¿Qué día hacemos la sesión de repaso de prueba?',
        description: 'Votación de ejemplo. Se puede cambiar el voto hasta el cierre.',
        options: ['Martes', 'Miércoles', 'Jueves'],
        multiple: false,
        allowChange: true,
        eligibleIds: ['demo-1', 'demo-2', 'demo-3', 'demo-4'],
        closesAt: minutesAgo(-2 * 24 * 60),
        createdBy: 'demo-2',
        createdAt: minutesAgo(400),
        updatedAt: minutesAgo(400),
        cancelReason: '',
        restartOf: 'p4',
        decision: '',
      },
      {
        id: 'p2',
        title: '¿Qué temas repasamos antes del examen de prueba?',
        description: 'Elige todos los que quieras.',
        options: ['Tema de prueba 1', 'Tema de prueba 2', 'Tema de prueba 3', 'Tema de prueba 4'],
        multiple: true,
        allowChange: false,
        eligibleIds: ['demo-1', 'demo-2', 'demo-3', 'demo-4'],
        closesAt: minutesAgo(-300),
        createdBy: 'demo-1',
        createdAt: minutesAgo(200),
        updatedAt: minutesAgo(200),
        cancelReason: '',
        decision: '',
      },
      {
        id: 'p3',
        title: '¿Cómo presentamos la exposición de prueba?',
        description: 'Solo votan quienes forman parte del equipo de prueba.',
        options: ['Diapositivas', 'Demostración en vivo'],
        multiple: false,
        allowChange: false,
        eligibleIds: ['demo-1', 'demo-2', 'demo-3'],
        closesAt: minutesAgo(1500),
        createdBy: 'demo-3',
        createdAt: minutesAgo(4000),
        updatedAt: minutesAgo(4000),
        cancelReason: '',
        decision: 'Acuerdo de prueba: diapositivas con una demostración corta al final.',
        decidedBy: 'demo-2',
        decidedAt: minutesAgo(1400),
      },
      {
        id: 'p4',
        title: '¿Qué día hacemos la sesión de repaso de prueba?',
        description: 'Votación de ejemplo.',
        options: ['Martes', 'Jueves'],
        multiple: false,
        allowChange: true,
        eligibleIds: ['demo-1', 'demo-2', 'demo-3', 'demo-4'],
        closesAt: minutesAgo(-1000),
        createdBy: 'demo-2',
        createdAt: minutesAgo(600),
        updatedAt: minutesAgo(600),
        cancelledAt: minutesAgo(420),
        cancelReason: 'Faltaba el miércoles como opción; se reinició con las tres.',
        decision: '',
      },
      {
        id: 'p5',
        title: '¿Pedimos prórroga para la tarea de prueba 2?',
        description: '',
        options: ['Sí', 'No'],
        multiple: false,
        allowChange: false,
        eligibleIds: ['demo-1', 'demo-2', 'demo-3', 'demo-4'],
        closesAt: minutesAgo(90),
        createdBy: 'demo-4',
        createdAt: minutesAgo(2000),
        updatedAt: minutesAgo(2000),
        cancelReason: '',
        decision: '',
      },
    ],
    pollVotes: [
      { pollId: 'p1', voterId: 'demo-2', choices: [1], votedAt: minutesAgo(390) },
      { pollId: 'p1', voterId: 'demo-3', choices: [1], votedAt: minutesAgo(350), changedAt: minutesAgo(150) },
      { pollId: 'p1', voterId: 'demo-4', choices: [0], votedAt: minutesAgo(300) },
      { pollId: 'p2', voterId: 'demo-3', choices: [0, 2], votedAt: minutesAgo(120) },
      { pollId: 'p3', voterId: 'demo-1', choices: [0], votedAt: minutesAgo(3500) },
      { pollId: 'p3', voterId: 'demo-2', choices: [0], votedAt: minutesAgo(3000) },
      { pollId: 'p3', voterId: 'demo-3', choices: [1], votedAt: minutesAgo(2000) },
      { pollId: 'p4', voterId: 'demo-4', choices: [1], votedAt: minutesAgo(500) },
      { pollId: 'p5', voterId: 'demo-2', choices: [0], votedAt: minutesAgo(1800) },
      { pollId: 'p5', voterId: 'demo-4', choices: [0], votedAt: minutesAgo(1700) },
      { pollId: 'p5', voterId: 'demo-1', choices: [1], votedAt: minutesAgo(1000) },
    ],
    presentationPractices: [
      { id: 'px1', ownerId: 'demo-1', reviewerId: 'demo-2', subjectId: LOGICA, termId: `${LOGICA}-p2`,
        title: 'Condicionales de prueba', topic: 'Condicionales', audience: 'Compañeros del primer cuatrimestre', targetMinutes: 3,
        keyPoints: ['Condiciones', 'Ejemplo cotidiano', 'Límites'], sourceKind: 'note', sourceId: 'n1', sourceVersion: 1,
        archived: false, version: 2, createdAt: minutesAgo(120), updatedAt: minutesAgo(90) },
      { id: 'px2', ownerId: 'demo-3', reviewerId: 'demo-1', subjectId: FUNDAMENTOS,
        title: 'Ciclos de prueba', topic: 'Ciclos', audience: 'Compañeros que empiezan a programar', targetMinutes: 4,
        keyPoints: ['Repetición', 'Condición de salida'], sourceKind: 'note', sourceId: 'n2', sourceVersion: 1,
        archived: false, version: 2, createdAt: minutesAgo(100), updatedAt: minutesAgo(70) },
      { id: 'px3', ownerId: 'demo-1', subjectId: LOGICA,
        title: 'Variables de prueba', topic: 'Variables', audience: 'Compañeros', targetMinutes: 2,
        keyPoints: ['Valores y nombres'], archived: false, version: 1, createdAt: minutesAgo(30), updatedAt: minutesAgo(30) },
    ],
    presentationAttempts: [
      { id: 'pxa1', practiceId: 'px1', subjectId: LOGICA, termId: `${LOGICA}-p2`, number: 1, status: 'completed', title: 'Condicionales de prueba', topic: 'Condicionales',
        audience: 'Compañeros del primer cuatrimestre', targetMinutes: 3, keyPoints: ['Condiciones', 'Ejemplo cotidiano', 'Límites'],
        body: 'Una condición decide si se ejecuta una instrucción. Por ejemplo, si llueve, llevamos paraguas. Elegimos este ejemplo porque conecta una decisión cotidiana con el código. El ejemplo supone dos resultados y no representa situaciones ambiguas.',
        sourceKind: 'note', sourceId: 'n1', sourceVersion: 1, version: 3, createdAt: minutesAgo(110), updatedAt: minutesAgo(90), completedAt: minutesAgo(90) },
      { id: 'pxa2', practiceId: 'px2', subjectId: FUNDAMENTOS, number: 1, status: 'completed', title: 'Ciclos de prueba', topic: 'Ciclos',
        audience: 'Compañeros que empiezan a programar', targetMinutes: 4, keyPoints: ['Repetición', 'Condición de salida'],
        body: 'Un ciclo permite repetir instrucciones. Para saludar a cada persona de una lista, recorremos sus nombres uno por uno. Este enfoque evita copiar la misma instrucción. Debemos definir cuándo terminar; de lo contrario, el ciclo podría repetirse sin fin.',
        sourceKind: 'note', sourceId: 'n2', sourceVersion: 1, version: 3, createdAt: minutesAgo(95), updatedAt: minutesAgo(70), completedAt: minutesAgo(70) },
    ],
    presentationPersonal: [
      { attemptId: 'pxa1', clarity: 'Me falta ordenar la conclusión.', examples: 'El paraguas ayuda a explicar la decisión.', decisions: '', limitations: 'Distinguir supuestos.', nextSteps: 'Practicar una conclusión de dos frases.' },
      { attemptId: 'pxa2', clarity: 'Observación privada de otro alumno.', examples: '', decisions: '', limitations: '', nextSteps: 'Repasar la condición de salida en privado.' },
    ],
    presentationQuestions: [
      ...['pxa1', 'pxa2'].flatMap((attemptId) => presentationGuidingQuestions(attemptId === 'pxa1'
        ? { title: 'Condicionales de prueba', topic: 'Condicionales', audience: 'Compañeros del primer cuatrimestre', targetMinutes: 3, keyPoints: ['Condiciones', 'Ejemplo cotidiano', 'Límites'] }
        : { title: 'Ciclos de prueba', topic: 'Ciclos', audience: 'Compañeros que empiezan a programar', targetMinutes: 4, keyPoints: ['Repetición', 'Condición de salida'] }
      ).map((text, index) => ({ id: `pxq-${attemptId}-${index}`, attemptId, authorId: attemptId === 'pxa1' ? 'demo-1' : 'demo-3',
        kind: 'guided' as const, text, answer: index === 0 ? 'Respuesta de ejemplo conservada con este intento.' : '', version: index === 0 ? 2 : 1, createdAt: minutesAgo(70) }))),
    ],
    presentationFeedback: [
      { id: 'pxf1', attemptId: 'pxa1', authorId: 'demo-2', clarity: 'La idea principal se entiende.', examples: 'El ejemplo es concreto.', decisions: '', limitations: 'Explica qué ocurre cuando no llueve.', comment: 'Retroalimentación de prueba.', version: 1, createdAt: minutesAgo(60), updatedAt: minutesAgo(60) },
    ],
    presentationRequests: [],
    spacedCollections: [
      { id: 'sd1', subjectId: LOGICA, termId: `${LOGICA}-p1`, title: 'Decisiones y lógica · colección de prueba',
        visibility: 'group', ownerId: 'demo-1', version: 1, archived: false,
        createdAt: minutesAgo(4500), updatedAt: minutesAgo(120), updatedBy: 'demo-2' },
      { id: 'sd2', subjectId: FUNDAMENTOS, title: 'Mis ciclos · colección personal de prueba',
        visibility: 'personal', ownerId: 'demo-3', version: 1, archived: false,
        createdAt: minutesAgo(75), updatedAt: minutesAgo(75), updatedBy: 'demo-3' },
    ],
    spacedCards: [
      { id: 'sc1', collectionId: 'sd1', question: '¿Para qué sirve una condición en un algoritmo?',
        explanation: 'Permite elegir qué instrucciones ejecutar según el resultado verdadero o falso de una expresión.',
        hint: 'Piensa en una decisión con dos caminos.', sourceKind: 'guide', sourceId: 'gd1', sourceVersion: 2,
        version: 1, archived: false, createdBy: 'demo-1', updatedBy: 'demo-1', createdAt: minutesAgo(4500), updatedAt: minutesAgo(4500) },
      { id: 'sc2', collectionId: 'sd1', question: '¿Qué debe incluir un ejemplo para explicar una decisión?',
        explanation: 'La condición evaluada y lo que ocurre tanto cuando se cumple como cuando no se cumple.',
        hint: '', sourceKind: 'note', sourceId: 'n1', sourceVersion: 1, version: 1, archived: false,
        createdBy: 'demo-2', updatedBy: 'demo-2', createdAt: minutesAgo(120), updatedAt: minutesAgo(120) },
      { id: 'sc3', collectionId: 'sd1', question: '¿Cómo compruebas que una explicación es suficiente?',
        explanation: 'Prueba el mismo razonamiento con datos distintos y explica por qué el resultado cambia o se mantiene.',
        hint: 'Usa un caso diferente al del ejemplo.', sourceKind: 'guide', sourceId: 'gd1', sourceVersion: 2,
        version: 1, archived: false, createdBy: 'demo-2', updatedBy: 'demo-2', createdAt: minutesAgo(2200), updatedAt: minutesAgo(2200) },
      { id: 'sc4', collectionId: 'sd1', question: '¿Por qué hay que revisar la fuente antes de estudiar?',
        explanation: 'El material del grupo puede cambiar. Esta tarjeta conserva la explicación de su versión de origen para que revises si sigue vigente.',
        hint: '', sourceKind: 'guide', sourceId: 'gd1', sourceVersion: 1, version: 1, archived: false,
        createdBy: 'demo-1', updatedBy: 'demo-1', createdAt: minutesAgo(3000), updatedAt: minutesAgo(3000) },
      { id: 'sc5', collectionId: 'sd2', question: '¿Qué necesito recordar sobre la salida de un ciclo?',
        explanation: 'Debo identificar la condición que deja de cumplirse y qué cambia en cada repetición para poder alcanzarla.',
        hint: 'Busca qué dato se actualiza.', sourceKind: 'note', sourceId: 'n2', sourceVersion: 1,
        version: 1, archived: false, createdBy: 'demo-3', updatedBy: 'demo-3', createdAt: minutesAgo(75), updatedAt: minutesAgo(75) },
    ],
    spacedEnrollments: [
      { memberId: 'demo-1', collectionId: 'sd1', active: true, updatedAt: minutesAgo(4500) },
      { memberId: 'demo-2', collectionId: 'sd1', active: true, updatedAt: minutesAgo(3500) },
      { memberId: 'demo-3', collectionId: 'sd2', active: true, updatedAt: minutesAgo(75) },
    ],
    spacedProgress: [
      { memberId: 'demo-1', cardId: 'sc1', cardVersion: 1, step: 1, revision: 1, reviewedAt: minutesAgo(1500), dueAt: minutesAgo(60) },
      { memberId: 'demo-1', cardId: 'sc3', cardVersion: 1, step: 2, revision: 2, reviewedAt: minutesAgo(1200), dueAt: minutesAgo(-3120) },
      { memberId: 'demo-2', cardId: 'sc1', cardVersion: 1, step: 3, revision: 3, reviewedAt: minutesAgo(2000), dueAt: minutesAgo(-8080) },
    ],
    spacedReviews: [
      { id: 'demo-1:fixture1', requestId: 'fixture1', memberId: 'demo-1', cardId: 'sc1', cardVersion: 1,
        rating: 'remembered', step: 1, expectedRevision: 0, reviewedAt: minutesAgo(1500), dueAt: minutesAgo(60) },
      { id: 'demo-2:fixture2', requestId: 'fixture2', memberId: 'demo-2', cardId: 'sc1', cardVersion: 1,
        rating: 'remembered', step: 3, expectedRevision: 2, reviewedAt: minutesAgo(2000), dueAt: minutesAgo(-8080) },
    ],
    teachingPractices: [
      {
        id: 'tp1', ownerId: 'demo-1', reviewerId: 'demo-2', subjectId: LOGICA,
        topic: 'Condiciones y decisiones de prueba',
        initial: { concept: 'Una condición permite decidir qué instrucciones ejecutar.',
          example: 'Si la temperatura supera 30 grados, encendemos el ventilador.',
          limits: 'Se necesita una expresión que tenga un resultado verdadero o falso.' },
        revised: { ...EMPTY_TEACHING_EXPLANATION }, status: 'practicing',
        createdAt: minutesAgo(150), updatedAt: minutesAgo(120),
      },
      {
        id: 'tp2', ownerId: 'demo-3', reviewerId: 'demo-1', subjectId: FUNDAMENTOS,
        topic: 'Ciclos de prueba',
        initial: { concept: 'Un ciclo repite un conjunto de instrucciones.',
          example: 'Recorrer los nombres de una lista y saludar a cada persona.',
          limits: 'Debe tener una condición de salida cuando el proceso no sea infinito.' },
        revised: { ...EMPTY_TEACHING_EXPLANATION }, status: 'practicing',
        createdAt: minutesAgo(100), updatedAt: minutesAgo(75),
      },
      {
        id: 'tp3', ownerId: 'demo-1', subjectId: LOGICA, topic: 'Variables de prueba',
        initial: { concept: 'Una variable guarda un valor.', example: '', limits: '' },
        revised: { ...EMPTY_TEACHING_EXPLANATION }, status: 'draft',
        createdAt: minutesAgo(30), updatedAt: minutesAgo(30),
      },
    ],
    teachingPersonal: [
      { practiceId: 'tp1', reflection: 'Reflexión de prueba, visible solo para mí.',
        topicsToReview: 'Operadores de comparación', sourceKind: 'note', sourceId: 'n1', sourceVersion: 1 },
      { practiceId: 'tp2', reflection: 'Reflexión privada del autor de la práctica de prueba.',
        topicsToReview: 'Condición de salida', sourceKind: 'note', sourceId: 'n2', sourceVersion: 1 },
      { practiceId: 'tp3', reflection: '', topicsToReview: '' },
    ],
    teachingQuestions: [
      ...['tp1', 'tp2'].flatMap((practiceId) => TEACHING_PROMPTS.map((text, index): TeachingQuestion => ({
        id: `tq-${practiceId}-${index}`, practiceId, authorId: practiceId === 'tp1' ? 'demo-1' : 'demo-3',
        kind: 'guided', text, answer: '', createdAt: minutesAgo(70),
      }))),
      { id: 'tq-peer', practiceId: 'tp1', authorId: 'demo-2', kind: 'peer',
        text: '¿Qué pasa exactamente cuando la temperatura es de 30 grados?', answer: '', createdAt: minutesAgo(45) },
    ],
    helpPosts: [
      { id: 'hp1', kind: 'offer', subjectId: FUNDAMENTOS, title: 'Puedo explicar condicionales (ejemplo)',
        topic: 'Condicionales', description: 'Oferta de prueba: podemos revisar un ejemplo de if y else y practicar juntos.',
        level: 'initial', modality: 'messages', availability: 'Ejemplo de disponibilidad voluntaria: por la tarde.',
        status: 'open', authorId: 'demo-2', createdAt: minutesAgo(240), updatedAt: minutesAgo(240) },
      { id: 'hp2', kind: 'request', subjectId: LOGICA, title: 'Necesito practicar conversiones (ejemplo)',
        topic: 'Sistemas numéricos', description: 'Petición de prueba: quiero entender los pasos para convertir entre binario y decimal.',
        level: 'initial', modality: 'flexible', availability: '', status: 'open', authorId: 'demo-3',
        createdAt: minutesAgo(180), updatedAt: minutesAgo(180) },
      { id: 'hp3', kind: 'request', subjectId: FUNDAMENTOS, title: 'Repasar ciclos con ejemplos (prueba)',
        topic: 'Ciclos', description: 'Petición de ejemplo para practicar la coordinación de ayuda entre compañeros.',
        level: 'basics', modality: 'video', availability: '', status: 'open', authorId: 'demo-1',
        createdAt: minutesAgo(120), updatedAt: minutesAgo(120) },
      { id: 'hp4', kind: 'offer', subjectId: LOGICA, title: 'Repaso de tablas de verdad (ejemplo cerrado)',
        topic: 'Tablas de verdad', description: 'Oferta de prueba cerrada por su autor; ya no recibe nuevos contactos.',
        level: 'basics', modality: 'in_person', availability: '', status: 'closed', authorId: 'demo-4',
        createdAt: minutesAgo(400), updatedAt: minutesAgo(100) },
    ],
    helpContacts: [
      { id: 'hc1', postId: 'hp1', senderId: 'demo-1', recipientId: 'demo-2', subjectId: FUNDAMENTOS,
        postTitle: 'Puedo explicar condicionales (ejemplo)', postTopic: 'Condicionales', postKind: 'offer',
        message: 'Solicitud privada de ejemplo: me gustaría practicar con un ejercicio.', status: 'pending',
        createdAt: minutesAgo(60), updatedAt: minutesAgo(60) },
      { id: 'hc2', postId: 'hp3', senderId: 'demo-4', recipientId: 'demo-1', subjectId: FUNDAMENTOS,
        postTitle: 'Repasar ciclos con ejemplos (prueba)', postTopic: 'Ciclos', postKind: 'request',
        message: 'Contacto de prueba: puedo ayudar con un ejemplo de ciclos.', status: 'pending',
        createdAt: minutesAgo(45), updatedAt: minutesAgo(45) },
      { id: 'hc3', postId: 'hp2', senderId: 'demo-2', recipientId: 'demo-3', subjectId: LOGICA,
        postTitle: 'Necesito practicar conversiones (ejemplo)', postTopic: 'Sistemas numéricos', postKind: 'request',
        message: 'Ejemplo de ayuda acordada por privado.', status: 'accepted', conversationId: 'c1',
        createdAt: minutesAgo(100), updatedAt: minutesAgo(30) },
    ],
    lastSeen: { 'demo-1': minutesAgo(180) },
  };
}
