import {
  canEditWork,
  canReadDirectConversation,
  CURRICULUM,
  fileSizeError,
  isValidBirthday,
  isValidPeriod,
  isWorkKind,
  termNames,
  type WorkKind,
} from '@b20/core';
import type {
  Activity,
  Answer,
  AskQuestionInput,
  Birthday,
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
  works: Work[];
  workFiles: WorkFile[];
  groupMessages: GroupMessage[];
  directConversations: DirectConversation[];
  directMessages: DirectMessage[];
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
        works: [],
        workFiles: [],
        groupMessages: [],
        directConversations: [],
        directMessages: [],
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
    return {
      me,
      members: s.members,
      subjects: s.subjects,
      terms: s.terms,
      works: s.works,
      workFiles: s.workFiles,
      groupMessages: s.groupMessages,
      directConversations,
      directMessages: s.directMessages.filter((m) => visible.has(m.conversationId)),
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

  publishWork(input: PublishWorkInput): Id {
    const me = this.#activeMember();
    if (!this.#state.subjects.some((s) => s.id === input.subjectId)) {
      throw new Error('La materia no existe.');
    }
    if (input.termId) {
      const term = this.#state.terms.find((t) => t.id === input.termId);
      if (term?.subjectId !== input.subjectId) throw new Error('El parcial no pertenece a esa materia.');
    }
    if (!isWorkKind(input.kind)) throw new Error('El tipo de trabajo no existe.');
    for (const id of input.coauthorIds) {
      if (!this.#isActive(id)) throw new Error('Un coautor no es miembro activo.');
    }
    const now = this.#now();
    const work: Work = {
      id: this.#id(),
      subjectId: input.subjectId,
      termId: input.termId,
      kind: input.kind,
      title: requireText(input.title, 'El título', 200),
      assignment: input.assignment.trim(),
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

  updateWork(workId: Id, title: string, description: string, kind: WorkKind) {
    const me = this.#activeMember();
    const work = this.#state.works.find((w) => w.id === workId);
    if (!work) throw new Error('El trabajo no existe.');
    if (!canEditWork(me.id, work.authorIds)) {
      throw new Error('Solo el autor o los coautores editan este trabajo.');
    }
    if (!isWorkKind(kind)) throw new Error('El tipo de trabajo no existe.');
    this.#state.works = this.#state.works.map((w) =>
      w.id === workId
        ? {
            ...w,
            title: requireText(title, 'El título', 200),
            description: description.trim(),
            kind,
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

  sendGroupMessage(text: string) {
    const me = this.#activeMember();
    const message = { id: this.#id(), senderId: me.id, text: requireText(text, 'El mensaje'), sentAt: this.#now() };
    this.#state.groupMessages = [...this.#state.groupMessages, message];
    this.#emit();
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

  sendDirectMessage(conversationId: Id, text: string) {
    const me = this.#activeMember();
    const conversation = this.#state.directConversations.find((c) => c.id === conversationId);
    if (!conversation || !canReadDirectConversation(me.id, conversation.participantIds)) {
      throw new Error('No participas en esa conversación.');
    }
    const message: DirectMessage = {
      id: this.#id(),
      conversationId,
      senderId: me.id,
      text: requireText(text, 'El mensaje'),
      sentAt: this.#now(),
    };
    this.#state.directMessages = [...this.#state.directMessages, message];
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

  createActivity(input: CreateActivityInput): Id {
    const me = this.#activeMember();
    this.#requireSubject(input.subjectId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Fecha inválida.');
    const activity: Activity = {
      id: this.#id(),
      subjectId: input.subjectId,
      topic: input.topic.trim(),
      date: input.date,
      title: requireText(input.title, 'El título', 200),
      objective: input.objective.trim(),
      instructions: input.instructions.trim(),
      createdBy: me.id,
      createdAt: this.#now(),
    };
    this.#state.activities = [...this.#state.activities, activity];
    this.#emit();
    return activity.id;
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

/** Estado inicial con datos de prueba claramente marcados. */
export function createDemoState(now = new Date()): State {
  const LOGICA = 'IDSE-05010103';
  const FUNDAMENTOS = 'IDSE-05010104';
  const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);
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
  return {
    members,
    subjects,
    terms,
    works: [
      {
        id: 'w1',
        subjectId: LOGICA,
        termId: `${LOGICA}-p1`,
        kind: 'tarea',
        title: 'Tarea de prueba 1',
        assignment: 'Consigna de ejemplo.',
        description: 'Descripción de ejemplo.',
        version: 1,
        authorIds: ['demo-1', 'demo-2'],
        createdAt: minutesAgo(3000),
        updatedAt: minutesAgo(3000),
      },
      {
        id: 'w2',
        subjectId: FUNDAMENTOS,
        termId: `${FUNDAMENTOS}-p1`,
        kind: 'actividad',
        title: 'Actividad de prueba',
        assignment: 'Otra consigna de ejemplo.',
        description: '',
        version: 1,
        authorIds: ['demo-3'],
        createdAt: minutesAgo(1500),
        updatedAt: minutesAgo(1500),
      },
      // Más ejemplos para revisar el archivo: equipo de tres, código, versiones y sin parcial.
      {
        id: 'w3',
        subjectId: LOGICA,
        termId: `${LOGICA}-p1`,
        kind: 'exposicion',
        title: 'Exposición de prueba (en equipo, con código)',
        assignment: 'Consigna de ejemplo: resolver un ejercicio en equipo y explicar la solución.',
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
        subjectId: LOGICA,
        termId: `${LOGICA}-p2`,
        kind: 'tarea',
        title: 'Tarea de prueba 2 (con una versión nueva)',
        assignment: 'Consigna de ejemplo del segundo parcial.',
        description: 'Descripción de ejemplo, ya corregida una vez.',
        version: 2,
        authorIds: ['demo-4'],
        createdAt: minutesAgo(900),
        updatedAt: minutesAgo(240),
      },
      {
        id: 'w5',
        subjectId: FUNDAMENTOS,
        kind: 'examen',
        title: 'Examen de prueba (sin parcial)',
        assignment: '',
        description: 'Ejemplo de un trabajo que no se clasificó en ningún parcial ni registró su consigna.',
        version: 1,
        authorIds: ['demo-1'],
        createdAt: minutesAgo(600),
        updatedAt: minutesAgo(600),
      },
    ],
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
      { id: 'g9', senderId: 'demo-4', text: 'Mensaje de prueba de hoy.', sentAt: minutesAgo(95) },
      { id: 'g1', senderId: 'demo-2', text: 'Mensaje de prueba en el canal del grupo.', sentAt: minutesAgo(30) },
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
    birthdays: [{ memberId: 'demo-3', day: 15, month: 11, remind: true }],
    // Sesiones en fechas distintas: con una evidencia, con varios equipos y sin ninguna.
    activities: [
      {
        id: 'a1',
        subjectId: LOGICA,
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
        topic: 'Tema de prueba',
        date: daysAgo(36),
        title: 'Laboratorio de prueba del mes pasado',
        objective: 'Objetivo de ejemplo.',
        instructions: 'Instrucciones de ejemplo.',
        createdBy: 'demo-4',
        createdAt: minutesAgo(51_800),
      },
    ],
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
    ],
    answers: [
      { id: 'r1', questionId: 'q1', authorId: 'demo-2', body: 'Respuesta de ejemplo.', createdAt: minutesAgo(40) },
    ],
    lastSeen: { 'demo-1': minutesAgo(180) },
  };
}
