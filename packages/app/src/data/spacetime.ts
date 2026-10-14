/**
 * Fuente de datos sobre SpacetimeDB. Lee las vistas del módulo (nunca las tablas, que son
 * privadas) y cada acción llama a su reducer. Las identidades y los `u64` se vuelven texto y
 * las marcas de tiempo `Date`, como espera la interfaz.
 *
 * Trabaja sobre `SpacetimeConnection`, la parte de `DbConnection` (bindings generados con
 * `npm run spacetime:generate`) que usa, para poder probarse con una conexión falsa.
 */

import { CURRICULUM, GUIDE_SECTIONS, parseTopics } from '@b20/core';
import { Identity, Timestamp } from 'spacetimedb';
import type {
  Activity,
  Answer,
  Assignment,
  Birthday,
  ChatCommand,
  DataSource,
  DirectConversation,
  DirectMessage,
  Evidence,
  GroupMessage,
  GuideReview,
  GuideSource,
  Id,
  Invitation,
  Member,
  MessageReaction,
  Note,
  NoteComment,
  Poll,
  PollVote,
  Question,
  Revision,
  Snapshot,
  Sticker,
  StickerPack,
  StudyGuide,
  Subject,
  Term,
  Work,
  WorkFile,
  AssignmentInput,
  CreateActivityInput,
  GuideInput,
  GuideSourceRef,
  GuideSourceUpdate,
  PollInput,
  PublishWorkInput,
  SaveChatCommandInput,
  SaveNoteInput,
  AskQuestionInput,
  MessageScope,
} from './types';
import type { GuideReviewVerdict, TermDates, TermDatesInput } from '@b20/core';

/* ------------------------------------------------------------------------------------------ */
/* Conexión                                                                                    */
/* ------------------------------------------------------------------------------------------ */

type Row = Record<string, any>;

/** Una vista del cliente: filas en caché y avisos de cambios. */
export interface ClientView {
  iter(): Iterable<Row>;
  onInsert(cb: (ctx: unknown, row: Row) => void): void;
  onDelete(cb: (ctx: unknown, row: Row) => void): void;
  onUpdate?(cb: (ctx: unknown, oldRow: Row, newRow: Row) => void): void;
}

export interface SpacetimeConnection {
  db: Record<string, ClientView | undefined>;
  reducers: Record<string, ((args: Row) => Promise<void>) | undefined>;
  subscriptionBuilder(): {
    onApplied(cb: (ctx: unknown) => void): {
      onError(cb: (ctx: unknown, error?: unknown) => void): {
        subscribe(queries: string[]): unknown;
      };
    };
  };
  disconnect(): void;
}

/** Vistas a las que se suscribe la app, con su nombre SQL. */
export const VIEWS = [
  'my_member',
  'invitations',
  'members',
  'subjects',
  'terms',
  'calendar',
  'assignments',
  'page_revisions',
  'works',
  'work_authors',
  'work_files',
  'group_messages',
  'birthdays',
  'my_direct_conversations',
  'my_direct_messages',
  'message_reactions',
  'sticker_packs',
  'stickers',
  'my_chat_commands',
  'activities',
  'evidences',
  'notes',
  'note_comments',
  'questions',
  'answers',
  'my_last_seen',
  'study_guides',
  'guide_sources',
  'guide_reviews',
  'polls',
  'poll_votes',
] as const;

type ViewName = (typeof VIEWS)[number];

const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/* ------------------------------------------------------------------------------------------ */
/* Conversión de filas                                                                         */
/* ------------------------------------------------------------------------------------------ */

const idOf = (value: bigint | number): Id => String(value);
const optId = (value: bigint | number | undefined | null): Id | undefined =>
  value === undefined || value === null ? undefined : String(value);
const who = (identity: { toHexString(): string }): Id => identity.toHexString();
const optWho = (identity: { toHexString(): string } | undefined | null): Id | undefined =>
  identity ? identity.toHexString() : undefined;
const date = (ts: { toDate(): Date }): Date => ts.toDate();
const optDate = (ts: { toDate(): Date } | undefined | null): Date | undefined =>
  ts ? ts.toDate() : undefined;
const big = (id: Id): bigint => BigInt(id);
const optBig = (id: Id | undefined): bigint | undefined => (id ? BigInt(id) : undefined);
const identity = (id: Id) => Identity.fromString(id);

function toMember(r: Row): Member {
  return {
    id: who(r.identity),
    displayName: r.displayName,
    photoUrl: r.photoUrl ?? undefined,
    status: r.status === 'removed' ? 'removed' : 'active',
    isCreator: r.isCreator,
    joinedAt: date(r.joinedAt),
  };
}

function toMessage(r: Row): GroupMessage {
  return {
    id: idOf(r.id),
    senderId: who(r.sender),
    text: r.text,
    sentAt: date(r.sentAt),
    replyToId: optId(r.replyToId),
    editedAt: optDate(r.editedAt),
    deletedAt: optDate(r.deletedAt),
    deletedBy: optWho(r.deletedBy),
  };
}

/** Arma el `Snapshot` a partir de las filas de cada vista. Es pura para poder probarse. */
export function buildSnapshot(
  rows: (view: ViewName) => Row[],
  connection: Snapshot['connection'],
  fileUrl: (storageKey: string) => string | undefined = () => undefined,
): Snapshot {
  const me = rows('my_member').map(toMember)[0];
  const authors = new Map<Id, Id[]>();
  for (const a of rows('work_authors')) {
    const list = authors.get(idOf(a.workId)) ?? [];
    list.push(who(a.author));
    authors.set(idOf(a.workId), list);
  }
  const lastSeen = rows('my_last_seen')[0];

  return {
    connection,
    me,
    members: rows('members').map(toMember),
    invitations: rows('invitations').map((r): Invitation => ({
      email: r.email,
      isCreator: r.isCreator,
      invitedBy: who(r.invitedBy),
      createdAt: date(r.createdAt),
    })),
    subjects: rows('subjects').map((r): Subject => ({
      id: idOf(r.id),
      name: r.name,
      code: r.code || undefined,
      period: r.period,
    })),
    terms: rows('terms').map((r): Term => ({
      id: idOf(r.id),
      subjectId: idOf(r.subjectId),
      name: r.name,
      position: r.position,
    })),
    calendar: rows('calendar').map((r): TermDates => ({
      period: r.period,
      term: r.term,
      startDate: r.startDate,
      endDate: r.endDate,
    })),
    assignments: rows('assignments').map((r): Assignment => ({
      id: idOf(r.id),
      subjectId: idOf(r.subjectId),
      termId: optId(r.termId),
      kind: r.kind,
      title: r.title,
      instructions: r.instructions,
      dueDate: r.dueDate || undefined,
      version: r.version,
      createdBy: who(r.createdBy),
      createdAt: date(r.createdAt),
      updatedBy: who(r.updatedBy),
      updatedAt: date(r.updatedAt),
    })),
    works: rows('works').map((r): Work => ({
      id: idOf(r.id),
      assignmentId: idOf(r.assignmentId),
      title: r.title,
      description: r.description,
      version: r.version,
      authorIds: authors.get(idOf(r.id)) ?? [who(r.createdBy)],
      createdAt: date(r.createdAt),
      updatedAt: date(r.updatedAt),
    })),
    workFiles: rows('work_files').map((r): WorkFile => ({
      id: idOf(r.id),
      workId: idOf(r.workId),
      name: r.name,
      size: Number(r.size),
      contentType: r.contentType,
      uploadedBy: who(r.uploadedBy),
      createdAt: date(r.createdAt),
      url: fileUrl(r.storageKey),
    })),
    revisions: rows('page_revisions').map((r): Revision => ({
      id: idOf(r.id),
      page: r.page === 'activity' ? 'activity' : 'assignment',
      pageId: idOf(r.pageId),
      version: r.version,
      editedBy: who(r.editedBy),
      editedAt: date(r.editedAt),
      title: r.title,
      summary: r.summary,
      body: r.body,
      dueDate: r.dueDate ?? undefined,
    })),
    groupMessages: rows('group_messages').map(toMessage),
    directConversations: rows('my_direct_conversations').map((r): DirectConversation => ({
      id: idOf(r.id),
      participantIds: [who(r.userA), who(r.userB)],
    })),
    directMessages: rows('my_direct_messages').map((r): DirectMessage => ({
      ...toMessage(r),
      conversationId: idOf(r.conversationId),
    })),
    reactions: rows('message_reactions').map((r): MessageReaction => ({
      scope: r.scope === 'direct' ? 'direct' : 'group',
      messageId: idOf(r.messageId),
      memberId: who(r.member),
      emoji: r.emoji,
    })),
    stickerPacks: rows('sticker_packs').map((r): StickerPack => ({
      id: idOf(r.id),
      name: r.name,
      ownerId: who(r.owner),
      shared: r.shared,
      createdAt: date(r.createdAt),
    })),
    stickers: rows('stickers').map((r): Sticker => ({
      id: idOf(r.id),
      packId: idOf(r.packId),
      url: fileUrl(r.storageKey) ?? '',
      contentType: r.contentType,
      size: Number(r.size),
      animated: r.animated,
      createdAt: date(r.createdAt),
    })),
    chatCommands: rows('my_chat_commands').map((r): ChatCommand => ({
      id: idOf(r.id),
      ownerId: who(r.owner),
      name: r.name,
      description: r.description,
      text: r.text,
      createdAt: date(r.createdAt),
    })),
    birthdays: rows('birthdays').map((r): Birthday => ({
      memberId: who(r.identity),
      day: r.day,
      month: r.month,
      remind: r.remind,
    })),
    activities: rows('activities').map((r): Activity => ({
      id: idOf(r.id),
      subjectId: idOf(r.subjectId),
      termId: optId(r.termId),
      topic: r.topic,
      date: r.date,
      title: r.title,
      objective: r.objective,
      instructions: r.instructions,
      version: r.version,
      createdBy: who(r.createdBy),
      createdAt: date(r.createdAt),
      updatedBy: who(r.updatedBy),
      updatedAt: date(r.updatedAt),
    })),
    evidences: rows('evidences').map((r): Evidence => ({
      id: idOf(r.id),
      activityId: idOf(r.activityId),
      authorId: who(r.author),
      participantIds: (r.participants as Row[]).map((p) => who(p as never)),
      content: r.content,
      createdAt: date(r.createdAt),
    })),
    notes: rows('notes').map((r): Note => ({
      id: idOf(r.id),
      subjectId: idOf(r.subjectId),
      topic: r.topic,
      title: r.title,
      body: r.body,
      tags: r.tags,
      visibility: r.visibility === 'group' ? 'group' : 'personal',
      source: r.source,
      authorId: who(r.author),
      version: r.version,
      createdAt: date(r.createdAt),
      updatedAt: date(r.updatedAt),
    })),
    noteComments: rows('note_comments').map((r): NoteComment => ({
      id: idOf(r.id),
      noteId: idOf(r.noteId),
      authorId: who(r.author),
      text: r.text,
      createdAt: date(r.createdAt),
    })),
    questions: rows('questions').map((r): Question => ({
      id: idOf(r.id),
      subjectId: idOf(r.subjectId),
      topic: r.topic,
      title: r.title,
      body: r.body,
      authorId: who(r.author),
      status: r.status === 'resolved' ? 'resolved' : 'open',
      acceptedAnswerId: optId(r.acceptedAnswerId),
      resolvedAt: optDate(r.resolvedAt),
      createdAt: date(r.createdAt),
    })),
    answers: rows('answers').map((r): Answer => ({
      id: idOf(r.id),
      questionId: idOf(r.questionId),
      authorId: who(r.author),
      body: r.body,
      createdAt: date(r.createdAt),
    })),
    guides: rows('study_guides').map((r): StudyGuide => ({
      id: idOf(r.id),
      subjectId: idOf(r.subjectId),
      termId: optId(r.termId),
      title: r.title,
      topics: r.topics,
      sections: r.sections,
      version: r.version,
      createdBy: who(r.createdBy),
      createdAt: date(r.createdAt),
      updatedBy: who(r.updatedBy),
      updatedAt: date(r.updatedAt),
    })),
    guideSources: rows('guide_sources').map((r): GuideSource => ({
      id: idOf(r.id),
      guideId: idOf(r.guideId),
      kind: r.kind,
      refId: idOf(r.refId),
      sourceVersion: r.sourceVersion,
      status: r.status,
      reason: r.reason,
      topics: r.topics,
      addedBy: who(r.addedBy),
      addedAt: date(r.addedAt),
    })),
    guideReviews: rows('guide_reviews').map((r): GuideReview => ({
      id: idOf(r.id),
      guideId: idOf(r.guideId),
      guideVersion: r.guideVersion,
      reviewerId: who(r.reviewer),
      verdict: r.verdict as GuideReviewVerdict,
      comment: r.comment,
      createdAt: date(r.createdAt),
    })),
    polls: rows('polls').map((r): Poll => ({
      id: idOf(r.id),
      title: r.title,
      description: r.description,
      options: r.options,
      multiple: r.multiple,
      allowChange: r.allowChange,
      eligibleIds: (r.eligible as Row[]).map((p) => who(p as never)),
      closesAt: date(r.closesAt),
      createdBy: who(r.createdBy),
      createdAt: date(r.createdAt),
      updatedAt: date(r.updatedAt),
      cancelledAt: optDate(r.cancelledAt),
      cancelReason: r.cancelReason,
      restartOf: optId(r.restartOf),
      decision: r.decision,
      decidedBy: optWho(r.decidedBy),
      decidedAt: optDate(r.decidedAt),
    })),
    pollVotes: rows('poll_votes').map((r): PollVote => ({
      pollId: idOf(r.pollId),
      voterId: who(r.voter),
      choices: r.choices,
      votedAt: date(r.votedAt),
      changedAt: optDate(r.changedAt),
    })),
    lastSeenAt: lastSeen ? date(lastSeen.at) : undefined,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Fuente de datos                                                                             */
/* ------------------------------------------------------------------------------------------ */

/** Tiempo máximo para ver aparecer la fila que acaba de crear un reducer. */
const CREATED_ROW_TIMEOUT_MS = 10_000;

export class SpacetimeDataSource implements DataSource {
  readonly label = 'SpacetimeDB';
  readonly #conn: SpacetimeConnection;
  readonly #listeners = new Set<() => void>();
  readonly #rowListeners = new Set<() => void>();
  #connection: Snapshot['connection'] = 'connecting';
  #snapshot: Snapshot | undefined;
  #emitScheduled = false;

  /**
   * `conn` ya debe estar conectada (o conectándose) con el token de Google de la sesión. La
   * fuente se suscribe a las vistas y avisa a la interfaz en cada cambio.
   */
  constructor(conn: SpacetimeConnection) {
    this.#conn = conn;
    for (const name of VIEWS) {
      const view = this.#view(name);
      const changed = () => this.#changed();
      view.onInsert(changed);
      view.onDelete(changed);
      view.onUpdate?.(changed);
    }
    conn
      .subscriptionBuilder()
      .onApplied(() => this.setConnection('ready'))
      .onError(() => this.setConnection('offline'))
      .subscribe(VIEWS.map((name) => `SELECT * FROM ${name}`));
  }

  /** La app lo llama al perder o recuperar la conexión. */
  setConnection(state: Snapshot['connection']) {
    if (this.#connection === state) return;
    this.#connection = state;
    this.#changed();
  }

  disconnect() {
    this.#conn.disconnect();
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getSnapshot(): Snapshot {
    this.#snapshot ??= buildSnapshot((name) => [...this.#view(name).iter()], this.#connection);
    return this.#snapshot;
  }

  #view(name: ViewName): ClientView {
    const view = this.#conn.db[camel(name)] ?? this.#conn.db[name];
    if (!view) throw new Error(`Faltan los bindings de la vista ${name}.`);
    return view;
  }

  #changed() {
    this.#snapshot = undefined;
    for (const listener of this.#rowListeners) listener();
    // Una transacción trae muchas filas: se avisa una vez cuando termina de aplicarse.
    if (this.#emitScheduled) return;
    this.#emitScheduled = true;
    queueMicrotask(() => {
      this.#emitScheduled = false;
      for (const listener of this.#listeners) listener();
    });
  }

  async #call(reducer: string, args: Row = {}): Promise<void> {
    const fn = this.#conn.reducers[camel(reducer)] ?? this.#conn.reducers[reducer];
    if (!fn) throw new Error(`Faltan los bindings del reducer ${reducer}.`);
    await fn(args);
  }

  #myId(): Id {
    const me = this.getSnapshot().me;
    if (!me) throw new Error('No eres miembro activo del grupo.');
    return me.id;
  }

  /**
   * Los reducers no devuelven el id de lo que crean (lo asigna el servidor). Se busca en la
   * vista la fila nueva que cumpla `isMine`: primero al terminar el reducer y, si todavía no
   * llegó, cuando llegue.
   */
  async #create(
    reducer: string,
    args: Row,
    view: ViewName,
    isMine: (row: Row) => boolean,
  ): Promise<Id> {
    const before = new Set([...this.#view(view).iter()].map((r) => idOf(r.id)));
    const find = () => {
      let found: Row | undefined;
      for (const r of this.#view(view).iter()) {
        if (before.has(idOf(r.id)) || !isMine(r)) continue;
        if (!found || r.id > found.id) found = r;
      }
      return found ? idOf(found.id) : undefined;
    };
    await this.#call(reducer, args);
    const now = find();
    if (now) return now;
    return new Promise<Id>((resolve, reject) => {
      const check = () => {
        const id = find();
        if (!id) return;
        cleanup();
        resolve(id);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Se guardó, pero no llegó la confirmación. Recarga para verlo.'));
      }, CREATED_ROW_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timer);
        this.#rowListeners.delete(check);
      };
      this.#rowListeners.add(check);
    });
  }

  #mine(field: string) {
    const me = this.#myId();
    return (row: Row) => who(row[field]) === me;
  }

  /* ---------------------------------- Membresía ---------------------------------- */

  joinGroup(displayName: string) {
    return this.#call('join_group', { displayName });
  }

  inviteMember(email: string, isCreator: boolean) {
    return this.#call('invite_member', { email, isCreator });
  }

  revokeInvitation(email: string) {
    return this.#call('revoke_invitation', { email });
  }

  removeMember(memberId: Id) {
    return this.#call('remove_member', { identity: identity(memberId) });
  }

  importCurriculum() {
    return this.#call('import_curriculum', {
      codes: CURRICULUM.map((c) => c.code),
      names: CURRICULUM.map((c) => c.name),
      periods: CURRICULUM.map((c) => c.period),
    });
  }

  updateProfile(displayName: string, photoUrl?: string) {
    return this.#call('update_profile', { displayName, photoUrl });
  }

  /* ---------------------------- Materias y calendario ---------------------------- */

  createSubject(name: string, period: number) {
    const trimmed = name.trim();
    return this.#create(
      'create_subject',
      { name, period },
      'subjects',
      (r) => r.name === trimmed && who(r.createdBy) === this.#myId(),
    );
  }

  createTerm(subjectId: Id, name: string) {
    const position = this.getSnapshot().terms.filter((t) => t.subjectId === subjectId).length + 1;
    return this.#create(
      'create_term',
      { subjectId: big(subjectId), name, position },
      'terms',
      (r) => idOf(r.subjectId) === subjectId && r.position === position,
    );
  }

  saveCalendar(period: number, terms: TermDatesInput[]) {
    return this.#call('save_calendar', {
      period,
      startDates: terms.map((t) => t.startDate),
      endDates: terms.map((t) => t.endDate),
    });
  }

  /* ------------------------------ Tareas y trabajos ------------------------------ */

  #assignmentArgs(input: AssignmentInput) {
    return {
      subjectId: big(input.subjectId),
      termId: optBig(input.termId),
      kind: input.kind,
      title: input.title,
      instructions: input.instructions,
      dueDate: input.dueDate ?? '',
    };
  }

  createAssignment(input: AssignmentInput) {
    return this.#create(
      'create_assignment',
      this.#assignmentArgs(input),
      'assignments',
      this.#mine('createdBy'),
    );
  }

  updateAssignment(assignmentId: Id, input: AssignmentInput) {
    return this.#call('update_assignment', {
      assignmentId: big(assignmentId),
      ...this.#assignmentArgs(input),
    });
  }

  publishWork(input: PublishWorkInput) {
    return this.#create(
      'publish_work',
      {
        assignmentId: big(input.assignmentId),
        title: input.title,
        description: input.description,
        coauthors: input.coauthorIds.map(identity),
      },
      'works',
      this.#mine('createdBy'),
    );
  }

  updateWork(workId: Id, title: string, description: string) {
    return this.#call('update_work', { workId: big(workId), title, description });
  }

  async attachWorkFile(): Promise<Id> {
    throw new Error('Subir archivos estará disponible pronto.');
  }

  removeWorkFile(fileId: Id) {
    return this.#call('remove_work_file', { fileId: big(fileId) });
  }

  /* ---------------------------------- Mensajes ---------------------------------- */

  sendGroupMessage(text: string, replyToId?: Id) {
    return this.#create(
      'send_group_message',
      { text, replyToId: optBig(replyToId) },
      'group_messages',
      this.#mine('sender'),
    );
  }

  async openDirectConversation(otherId: Id): Promise<Id> {
    const me = this.#myId();
    const existing = () =>
      this.getSnapshot().directConversations.find(
        (c) => c.participantIds.includes(me) && c.participantIds.includes(otherId),
      )?.id;
    const found = existing();
    if (found) return found;
    return this.#create(
      'open_direct_conversation',
      { other: identity(otherId) },
      'my_direct_conversations',
      (r) => [who(r.userA), who(r.userB)].includes(otherId),
    );
  }

  sendDirectMessage(conversationId: Id, text: string, replyToId?: Id) {
    return this.#create(
      'send_direct_message',
      { conversationId: big(conversationId), text, replyToId: optBig(replyToId) },
      'my_direct_messages',
      this.#mine('sender'),
    );
  }

  editMessage(scope: MessageScope, messageId: Id, text: string) {
    return this.#call('edit_message', { scope, messageId: big(messageId), text });
  }

  deleteMessage(scope: MessageScope, messageId: Id) {
    return this.#call('delete_message', { scope, messageId: big(messageId) });
  }

  toggleReaction(scope: MessageScope, messageId: Id, emoji: string) {
    return this.#call('toggle_reaction', { scope, messageId: big(messageId), emoji });
  }

  async importStickers(): Promise<Id> {
    throw new Error('Importar stickers estará disponible pronto.');
  }

  setStickerPackShared(packId: Id, shared: boolean) {
    return this.#call('set_sticker_pack_shared', { packId: big(packId), shared });
  }

  removeStickerPack(packId: Id) {
    return this.#call('remove_sticker_pack', { packId: big(packId) });
  }

  async saveChatCommand(input: SaveChatCommandInput): Promise<Id> {
    const args = {
      id: optBig(input.id),
      name: input.name,
      description: input.description,
      text: input.text,
    };
    if (input.id) {
      await this.#call('save_chat_command', args);
      return input.id;
    }
    return this.#create('save_chat_command', args, 'my_chat_commands', () => true);
  }

  removeChatCommand(commandId: Id) {
    return this.#call('remove_chat_command', { commandId: big(commandId) });
  }

  /* ------------------------------ Cumpleaños y novedades ------------------------------ */

  shareBirthday(day: number, month: number, remind: boolean) {
    return this.#call('share_birthday', { day, month, remind });
  }

  withdrawBirthday() {
    return this.#call('withdraw_birthday');
  }

  markSeen() {
    return this.#call('mark_seen');
  }

  /* ---------------------------------- Actividades ---------------------------------- */

  #activityArgs(input: CreateActivityInput) {
    return {
      subjectId: big(input.subjectId),
      termId: optBig(input.termId),
      topic: input.topic,
      date: input.date,
      title: input.title,
      objective: input.objective,
      instructions: input.instructions,
    };
  }

  createActivity(input: CreateActivityInput) {
    return this.#create(
      'create_activity',
      this.#activityArgs(input),
      'activities',
      this.#mine('createdBy'),
    );
  }

  updateActivity(activityId: Id, input: CreateActivityInput) {
    return this.#call('update_activity', {
      activityId: big(activityId),
      ...this.#activityArgs(input),
    });
  }

  addEvidence(activityId: Id, content: string, participantIds: Id[]) {
    return this.#create(
      'add_evidence',
      { activityId: big(activityId), content, participants: participantIds.map(identity) },
      'evidences',
      this.#mine('author'),
    );
  }

  /* ------------------------------ Notas y preguntas ------------------------------ */

  async saveNote(input: SaveNoteInput): Promise<Id> {
    const args = {
      noteId: optBig(input.id),
      subjectId: big(input.subjectId),
      topic: input.topic,
      title: input.title,
      body: input.body,
      tags: input.tags,
      visibility: input.visibility,
      source: input.source,
    };
    if (input.id) {
      await this.#call('save_note', args);
      return input.id;
    }
    return this.#create('save_note', args, 'notes', this.#mine('author'));
  }

  commentNote(noteId: Id, text: string) {
    return this.#call('comment_note', { noteId: big(noteId), text });
  }

  askQuestion(input: AskQuestionInput) {
    return this.#create(
      'ask_question',
      {
        subjectId: big(input.subjectId),
        topic: input.topic,
        title: input.title,
        body: input.body,
      },
      'questions',
      this.#mine('author'),
    );
  }

  answerQuestion(questionId: Id, body: string) {
    return this.#create(
      'answer_question',
      { questionId: big(questionId), body },
      'answers',
      this.#mine('author'),
    );
  }

  acceptAnswer(questionId: Id, answerId: Id) {
    return this.#call('accept_answer', { questionId: big(questionId), answerId: big(answerId) });
  }

  reopenQuestion(questionId: Id) {
    return this.#call('reopen_question', { questionId: big(questionId) });
  }

  /* ------------------------------------ Guías ------------------------------------ */

  #guideArgs(input: GuideInput) {
    const parsed = parseTopics(input.topicsText);
    if ('problem' in parsed) throw new Error(parsed.problem);
    return {
      subjectId: big(input.subjectId),
      termId: optBig(input.termId),
      title: input.title,
      topics: parsed.topics,
      sections: GUIDE_SECTIONS.map((_, i) => (input.sections[i] ?? '').trim()),
    };
  }

  #sourceRefs(sources: GuideSourceRef[]) {
    return sources.map((s) => ({ kind: s.kind, refId: big(s.refId) }));
  }

  createGuide(input: GuideInput, sources: GuideSourceRef[]) {
    return this.#create(
      'create_guide',
      { ...this.#guideArgs(input), sources: this.#sourceRefs(sources) },
      'study_guides',
      this.#mine('createdBy'),
    );
  }

  updateGuide(guideId: Id, input: GuideInput) {
    return this.#call('update_guide', { guideId: big(guideId), ...this.#guideArgs(input) });
  }

  addGuideSources(guideId: Id, sources: GuideSourceRef[]) {
    return this.#call('add_guide_sources', {
      guideId: big(guideId),
      sources: this.#sourceRefs(sources),
    });
  }

  updateGuideSource(sourceId: Id, update: GuideSourceUpdate) {
    return this.#call('update_guide_source', { sourceId: big(sourceId), ...update });
  }

  refreshGuideSource(sourceId: Id) {
    return this.#call('refresh_guide_source', { sourceId: big(sourceId) });
  }

  removeGuideSource(sourceId: Id) {
    return this.#call('remove_guide_source', { sourceId: big(sourceId) });
  }

  reviewGuide(guideId: Id, verdict: GuideReviewVerdict, comment: string) {
    return this.#call('review_guide', { guideId: big(guideId), verdict, comment });
  }

  /* ---------------------------------- Votaciones ---------------------------------- */

  #pollArgs(input: PollInput) {
    return {
      title: input.title,
      description: input.description,
      options: input.options,
      multiple: input.multiple,
      allowChange: input.allowChange,
      eligible: input.eligibleIds.map(identity),
      closesAt: Timestamp.fromDate(input.closesAt),
    };
  }

  createPoll(input: PollInput) {
    return this.#create(
      'create_poll',
      { ...this.#pollArgs(input), restartOf: optBig(input.restartOf) },
      'polls',
      this.#mine('createdBy'),
    );
  }

  updatePoll(pollId: Id, input: PollInput) {
    return this.#call('update_poll', { pollId: big(pollId), ...this.#pollArgs(input) });
  }

  castVote(pollId: Id, choices: number[]) {
    return this.#call('cast_vote', { pollId: big(pollId), choices });
  }

  cancelPoll(pollId: Id, reason: string) {
    return this.#call('cancel_poll', { pollId: big(pollId), reason });
  }

  recordPollDecision(pollId: Id, decision: string) {
    return this.#call('record_poll_decision', { pollId: big(pollId), decision });
  }
}
