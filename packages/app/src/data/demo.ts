import {
  buildPeriodCalendar,
  canDeleteMessage,
  canEditMessage,
  canEditWork,
  commandNameError,
  detectImageType,
  isAnimatedWebp,
  isReaction,
  MAX_STICKERS_PER_PACK,
  normalizeCommandName,
  stickerFileError,
  canManageCalendar,
  canReadDirectConversation,
  CURRICULUM,
  fileSizeError,
  isValidBirthday,
  isValidPeriod,
  isWorkKind,
  termNames,
  type TermDates,
  type TermDatesInput,
} from '@b20/core';
import type {
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
  Note,
  NoteComment,
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
} from './types';
import { toDay } from '../lib/format';
import { referencesIn } from '../lib/references';

/**
 * Fuente de datos en memoria para desarrollar la interfaz antes de conectar SpacetimeDB.
 * Aplica las mismas reglas que el módulo del servidor (membresía activa, privacidad de los
 * mensajes 1 a 1, autoría) para que la UI se comporte igual.
 *
 * Todo lo que contiene son datos de prueba identificados como tales; no representa a
 * ningún compañero real.
 */

interface State {
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
  lastSeen: Record<Id, Date>;
}

const MAX_TEXT = 4000;

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
  #nextId = 1000;
  #listeners = new Set<() => void>();
  #snapshot: Snapshot | undefined;
  #now: () => Date;

  constructor(state: State, viewerId: Id, now: () => Date = () => new Date()) {
    this.#state = state;
    this.#viewerId = viewerId;
    this.#now = now;
  }

  get viewerId(): Id {
    return this.#viewerId;
  }

  /** Solo en modo de prueba: ver la app como otro miembro para revisar permisos. */
  setViewer(id: Id) {
    this.#viewerId = id;
    this.#emit();
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getSnapshot(): Snapshot {
    this.#snapshot ??= this.#buildSnapshot();
    return this.#snapshot;
  }

  #buildSnapshot(): Snapshot {
    const s = this.#state;
    const me = s.members.find((m) => m.id === this.#viewerId);
    if (me?.status !== 'active') {
      return {
        me,
        members: [],
        subjects: [],
        terms: [],
        calendar: [],
        assignments: [],
        works: [],
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
        lastSeenAt: undefined,
      };
    }
    const notes = s.notes.filter((n) => n.visibility === 'group' || n.authorId === me.id);
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
      [...s.groupMessages, ...directMessages].flatMap((m) =>
        referencesIn(m.text)
          .filter((r) => r.kind === 'sticker')
          .map((r) => r.id),
      ),
    );
    return {
      me,
      members: s.members,
      subjects: s.subjects,
      terms: s.terms,
      calendar: s.calendar,
      assignments: s.assignments,
      works: s.works,
      workFiles: s.workFiles,
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
      evidences: s.evidences,
      notes,
      noteComments: s.noteComments.filter((c) => visibleNotes.has(c.noteId)),
      questions: s.questions,
      answers: s.answers,
      lastSeenAt: s.lastSeen[me.id],
    };
  }

  #emit() {
    this.#snapshot = undefined;
    for (const listener of this.#listeners) listener();
  }

  #id(): Id {
    return String(this.#nextId++);
  }

  #activeMember(): Member {
    const me = this.#state.members.find((m) => m.id === this.#viewerId);
    if (me?.status !== 'active') throw new Error('No eres miembro activo del grupo.');
    return me;
  }

  #isActive(id: Id): boolean {
    return this.#state.members.some((m) => m.id === id && m.status === 'active');
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
  updateAssignment(assignmentId: Id, input: AssignmentInput) {
    const me = this.#activeMember();
    const current = this.#state.assignments.find((a) => a.id === assignmentId);
    if (!current) throw new Error('La tarea no existe.');
    const next: Assignment = {
      ...current,
      ...this.#checkAssignment(input),
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
    this.#emit();
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
    const now = this.#now();
    const work: Work = {
      id: this.#id(),
      assignmentId: input.assignmentId,
      title,
      description: input.description.trim(),
      version: 1,
      authorIds: [...new Set([me.id, ...input.coauthorIds])],
      createdAt: now,
      updatedAt: now,
    };
    this.#state.works = [...this.#state.works, work];
    this.#emit();
    return work.id;
  }

  updateWork(workId: Id, title: string, description: string) {
    const me = this.#activeMember();
    const work = this.#state.works.find((w) => w.id === workId);
    if (!work) throw new Error('El trabajo no existe.');
    if (!canEditWork(me.id, work.authorIds)) {
      throw new Error('Solo el autor o los coautores editan este trabajo.');
    }
    if (title.trim().length > 200) throw new Error('El título excede 200 caracteres.');
    this.#state.works = this.#state.works.map((w) =>
      w.id === workId
        ? {
            ...w,
            title: title.trim(),
            description: description.trim(),
            version: w.version + 1,
            updatedAt: this.#now(),
          }
        : w,
    );
    this.#emit();
  }

  /**
   * En modo de prueba el archivo no sale del navegador: se guarda un enlace local que dura
   * mientras la pestaña siga abierta. Las reglas (autoría y 50 MB) son las del servidor.
   */
  async attachWorkFile(workId: Id, file: File): Promise<Id> {
    const me = this.#activeMember();
    const work = this.#state.works.find((w) => w.id === workId);
    if (!work) throw new Error('El trabajo no existe.');
    if (!canEditWork(me.id, work.authorIds)) {
      throw new Error('Solo el autor o los coautores adjuntan archivos a este trabajo.');
    }
    const name = file.name.trim().slice(0, 200) || 'archivo';
    const problem = fileSizeError(name, file.size);
    if (problem) throw new Error(problem);
    const entry: WorkFile = {
      id: this.#id(),
      workId,
      name,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
      uploadedBy: me.id,
      createdAt: this.#now(),
      url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined,
    };
    this.#state.workFiles = [...this.#state.workFiles, entry];
    this.#emit();
    return entry.id;
  }

  removeWorkFile(fileId: Id) {
    const me = this.#activeMember();
    const entry = this.#state.workFiles.find((f) => f.id === fileId);
    if (!entry) throw new Error('El archivo no existe.');
    const work = this.#state.works.find((w) => w.id === entry.workId);
    if (!work || !canEditWork(me.id, work.authorIds)) {
      throw new Error('Solo el autor o los coautores quitan archivos de este trabajo.');
    }
    if (entry.url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(entry.url);
    this.#state.workFiles = this.#state.workFiles.filter((f) => f.id !== fileId);
    this.#emit();
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
    const me = this.#activeMember();
    const message: GroupMessage = {
      id: this.#id(),
      senderId: me.id,
      text: this.#messageText(text, me),
      sentAt: this.#now(),
      replyToId: this.#replyTo('group', me, replyToId),
    };
    this.#state.groupMessages = [...this.#state.groupMessages, message];
    this.#emit();
    return message.id;
  }

  openDirectConversation(otherId: Id): Id {
    const me = this.#activeMember();
    if (otherId === me.id) throw new Error('No puedes abrir una conversación contigo.');
    if (!this.#isActive(otherId)) throw new Error('Ese compañero no está activo.');
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
    const me = this.#activeMember();
    const conversation = this.#state.directConversations.find((c) => c.id === conversationId);
    if (!conversation || !canReadDirectConversation(me.id, conversation.participantIds)) {
      throw new Error('No participas en esa conversación.');
    }
    const message: DirectMessage = {
      id: this.#id(),
      conversationId,
      senderId: me.id,
      text: this.#messageText(text, me),
      sentAt: this.#now(),
      replyToId: this.#replyTo('direct', me, replyToId, conversationId),
    };
    this.#state.directMessages = [...this.#state.directMessages, message];
    this.#emit();
    return message.id;
  }

  editMessage(scope: MessageScope, messageId: Id, text: string) {
    const me = this.#activeMember();
    const message = this.#message(scope, messageId, me);
    if (message.senderId !== me.id) throw new Error('Solo puedes editar tus mensajes.');
    if (!canEditMessage(me.id, message, this.#now())) {
      throw new Error('Ya no se puede editar: pasaron más de 15 minutos o se eliminó.');
    }
    const clean = this.#messageText(text, me);
    if (clean === message.text) return;
    this.#updateMessage(scope, messageId, { text: clean, editedAt: this.#now() });
    this.#emit();
  }

  deleteMessage(scope: MessageScope, messageId: Id) {
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
  updateActivity(activityId: Id, input: CreateActivityInput) {
    const me = this.#activeMember();
    const current = this.#state.activities.find((a) => a.id === activityId);
    if (!current) throw new Error('La actividad no existe.');
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
    this.#emit();
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
    this.#state.evidences = [...this.#state.evidences, evidence];
    this.#emit();
    return evidence.id;
  }

  saveNote(input: SaveNoteInput): Id {
    const me = this.#activeMember();
    this.#requireSubject(input.subjectId);
    const now = this.#now();
    const fields = {
      subjectId: input.subjectId,
      topic: input.topic.trim(),
      title: requireText(input.title, 'El título', 200),
      body: requireText(input.body, 'El contenido', 50_000),
      tags: [...new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))],
      visibility: input.visibility,
      source: input.source,
    };
    if (input.id) {
      const note = this.#state.notes.find((n) => n.id === input.id);
      if (!note) throw new Error('La nota no existe.');
      if (note.authorId !== me.id) {
        throw new Error('Solo su autor edita esta nota; los demás pueden proponer cambios en comentarios.');
      }
      this.#state.notes = this.#state.notes.map((n) =>
        n.id === note.id ? { ...n, ...fields, version: n.version + 1, updatedAt: now } : n,
      );
      this.#emit();
      return note.id;
    }
    const note: Note = { id: this.#id(), ...fields, authorId: me.id, version: 1, createdAt: now, updatedAt: now };
    this.#state.notes = [...this.#state.notes, note];
    this.#emit();
    return note.id;
  }

  commentNote(noteId: Id, text: string) {
    const me = this.#activeMember();
    const note = this.#state.notes.find((n) => n.id === noteId);
    if (!note || (note.visibility === 'personal' && note.authorId !== me.id)) {
      throw new Error('La nota no existe.');
    }
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
    const answer: Answer = {
      id: this.#id(),
      questionId,
      authorId: me.id,
      body: requireText(body, 'La respuesta', 20_000),
      createdAt: this.#now(),
    };
    this.#state.answers = [...this.#state.answers, answer];
    this.#emit();
    return answer.id;
  }

  #ownQuestion(questionId: Id): Question {
    const me = this.#activeMember();
    const question = this.#state.questions.find((q) => q.id === questionId);
    if (!question) throw new Error('La pregunta no existe.');
    if (question.authorId !== me.id) throw new Error('Solo quien preguntó puede hacer esto.');
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
  const members: Member[] = [1, 2, 3, 4].map((n) => ({
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
    noteComments: [],
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
    ],
    lastSeen: { 'demo-1': minutesAgo(180) },
  };
}
