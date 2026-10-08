/**
 * Tipos de datos que usa la interfaz. Reflejan las vistas del módulo SpacetimeDB
 * (`packages/spacetime-module`), con identidades e ids como texto para simplificar la UI.
 */

export type Id = string;

export interface Member {
  id: Id;
  displayName: string;
  photoUrl?: string;
  status: 'active' | 'removed';
  isCreator: boolean;
  joinedAt: Date;
}

export interface Subject {
  id: Id;
  name: string;
}

/** Parcial o unidad. */
export interface Term {
  id: Id;
  subjectId: Id;
  name: string;
  position: number;
}

export interface Work {
  id: Id;
  subjectId: Id;
  termId?: Id;
  title: string;
  assignment: string;
  description: string;
  version: number;
  authorIds: Id[];
  createdAt: Date;
  updatedAt: Date;
}

/** Archivo adjunto a un trabajo. El contenido vive en el almacenamiento; aquí van sus datos. */
export interface WorkFile {
  id: Id;
  workId: Id;
  name: string;
  /** Tamaño en bytes; nunca mayor que `MAX_FILE_BYTES` de `@b20/core` (50 MB). */
  size: number;
  contentType: string;
  uploadedBy: Id;
  createdAt: Date;
  /** Enlace de descarga, cuando la fuente de datos puede dar uno. */
  url?: string;
}

export interface GroupMessage {
  id: Id;
  senderId: Id;
  text: string;
  sentAt: Date;
}

export interface DirectConversation {
  id: Id;
  participantIds: [Id, Id];
}

export interface DirectMessage {
  id: Id;
  conversationId: Id;
  senderId: Id;
  text: string;
  sentAt: Date;
}

export interface Birthday {
  memberId: Id;
  day: number;
  month: number;
  remind: boolean;
}

/** Actividad de clase (3.3): registra una experiencia de clase, no un trabajo por entregar. */
export interface Activity {
  id: Id;
  subjectId: Id;
  topic: string;
  /** Fecha de la sesión, `AAAA-MM-DD`. */
  date: string;
  title: string;
  objective: string;
  instructions: string;
  createdBy: Id;
  createdAt: Date;
}

/** Evidencia de un equipo o persona; cada una es independiente y no sobrescribe a otra. */
export interface Evidence {
  id: Id;
  activityId: Id;
  authorId: Id;
  participantIds: Id[];
  content: string;
  createdAt: Date;
}

export type NoteVisibility = 'personal' | 'group';
/** Diferencia apuntes del estudiante, material del docente y contenido generado con IA (3.4). */
export type NoteSource = 'student' | 'teacher' | 'ai';

export interface Note {
  id: Id;
  subjectId: Id;
  topic: string;
  title: string;
  body: string;
  tags: string[];
  visibility: NoteVisibility;
  source: NoteSource;
  authorId: Id;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Comentario o propuesta de corrección: no modifica la nota del autor. */
export interface NoteComment {
  id: Id;
  noteId: Id;
  authorId: Id;
  text: string;
  createdAt: Date;
}

export interface Question {
  id: Id;
  subjectId: Id;
  topic: string;
  title: string;
  body: string;
  authorId: Id;
  status: 'open' | 'resolved';
  acceptedAnswerId?: Id;
  resolvedAt?: Date;
  createdAt: Date;
}

export interface Answer {
  id: Id;
  questionId: Id;
  authorId: Id;
  body: string;
  createdAt: Date;
}

/** Lo que el usuario actual puede ver, igual que las vistas del servidor. */
export interface Snapshot {
  me: Member | undefined;
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
  /** Notas del grupo y tus notas personales; nunca las personales de otros. */
  notes: Note[];
  noteComments: NoteComment[];
  questions: Question[];
  answers: Answer[];
  /** Última vez que marcaste las novedades como vistas. */
  lastSeenAt: Date | undefined;
}

export interface PublishWorkInput {
  subjectId: Id;
  termId?: Id;
  title: string;
  assignment: string;
  description: string;
  coauthorIds: Id[];
}

/** Acciones: corresponden uno a uno con los reducers del módulo. */
export interface Actions {
  updateProfile(displayName: string, photoUrl?: string): void;
  createSubject(name: string): Id;
  createTerm(subjectId: Id, name: string): Id;
  publishWork(input: PublishWorkInput): Id;
  /** Solo sus autores; cada edición guarda una versión nueva. */
  updateWork(workId: Id, title: string, description: string): void;
  /**
   * Sube un archivo y lo adjunta al trabajo; solo sus autores. Rechaza archivos vacíos o de
   * más de 50 MB (`MAX_FILE_BYTES`). Es la única acción asíncrona: subir toma tiempo.
   */
  attachWorkFile(workId: Id, file: File): Promise<Id>;
  removeWorkFile(fileId: Id): void;
  sendGroupMessage(text: string): void;
  /** Devuelve la conversación existente o la nueva. */
  openDirectConversation(otherId: Id): Id;
  sendDirectMessage(conversationId: Id, text: string): void;
  shareBirthday(day: number, month: number, remind: boolean): void;
  withdrawBirthday(): void;
  createActivity(input: CreateActivityInput): Id;
  addEvidence(activityId: Id, content: string, participantIds: Id[]): Id;
  saveNote(input: SaveNoteInput): Id;
  commentNote(noteId: Id, text: string): void;
  askQuestion(input: AskQuestionInput): Id;
  answerQuestion(questionId: Id, body: string): Id;
  /** Solo quien preguntó acepta una respuesta; marca la pregunta como resuelta. */
  acceptAnswer(questionId: Id, answerId: Id): void;
  reopenQuestion(questionId: Id): void;
  markSeen(): void;
}

export interface CreateActivityInput {
  subjectId: Id;
  topic: string;
  date: string;
  title: string;
  objective: string;
  instructions: string;
}

export interface SaveNoteInput {
  /** Sin id se crea una nota nueva; con id se edita (solo su autor). */
  id?: Id;
  subjectId: Id;
  topic: string;
  title: string;
  body: string;
  tags: string[];
  visibility: NoteVisibility;
  source: NoteSource;
}

export interface AskQuestionInput {
  subjectId: Id;
  topic: string;
  title: string;
  body: string;
}

export interface DataSource extends Actions {
  /** Nombre visible de la fuente, por ejemplo «Datos de prueba». */
  readonly label: string;
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
}
