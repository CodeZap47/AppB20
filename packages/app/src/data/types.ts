/**
 * Tipos de datos que usa la interfaz. Reflejan las vistas del módulo SpacetimeDB
 * (`packages/spacetime-module`), con identidades e ids como texto para simplificar la UI.
 */

import type {
  GuideReviewVerdict,
  GuideSourceKind,
  GuideSourceStatus,
  TermDates,
  TermDatesInput,
  WorkKind,
} from '@b20/core';

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
  /** Clave oficial del plan de estudios; las materias agregadas a mano no tienen. */
  code?: string;
  /** Cuatrimestre en que se cursa, de 1 a 9. */
  period: number;
}

/** Parcial o unidad. */
export interface Term {
  id: Id;
  subjectId: Id;
  name: string;
  position: number;
}

/**
 * Página principal de una tarea, actividad, exposición o examen: lo que se pidió. Cualquier
 * integrante la edita, como un wiki; cada edición guarda una versión con su responsable.
 */
export interface Assignment {
  id: Id;
  subjectId: Id;
  termId?: Id;
  /** Tarea, actividad, exposición o examen. */
  kind: WorkKind;
  title: string;
  instructions: string;
  /** Fecha de entrega `AAAA-MM-DD`, si la hay. */
  dueDate?: string;
  version: number;
  createdBy: Id;
  createdAt: Date;
  updatedBy: Id;
  updatedAt: Date;
}

/** Trabajo que subió un alumno o un equipo para una página principal. */
export interface Work {
  id: Id;
  assignmentId: Id;
  /** Tema o título propio; vacío si basta con el de la tarea. */
  title: string;
  description: string;
  version: number;
  authorIds: Id[];
  createdAt: Date;
  updatedAt: Date;
}

/** Versión guardada de una página que todos editan: tarea principal o actividad de clase. */
export interface Revision {
  id: Id;
  page: 'assignment' | 'activity';
  pageId: Id;
  version: number;
  editedBy: Id;
  editedAt: Date;
  title: string;
  /** Solo actividades de clase: el objetivo. */
  summary: string;
  /** Las instrucciones. */
  body: string;
  /** Solo tareas: la fecha de entrega de esa versión, para avisar cuando cambia. */
  dueDate?: string;
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

/** Campos comunes de un mensaje del grupo o de un 1 a 1. */
export interface MessageFields {
  id: Id;
  senderId: Id;
  /** Texto con referencias `[[tipo:id]]` a otros módulos; vacío si se eliminó. */
  text: string;
  sentAt: Date;
  /** Mensaje al que responde, de la misma conversación. */
  replyToId?: Id;
  editedAt?: Date;
  /** Eliminado para todos: se conserva el hueco para que las respuestas no pierdan contexto. */
  deletedAt?: Date;
  deletedBy?: Id;
}

export type GroupMessage = MessageFields;

/** Dónde vive un mensaje: el canal del salón o una conversación 1 a 1. */
export type MessageScope = 'group' | 'direct';

/** Una persona, una reacción por mensaje; reaccionar con otra la cambia. */
export interface MessageReaction {
  scope: MessageScope;
  messageId: Id;
  memberId: Id;
  emoji: string;
}

/** Paquete de stickers importado (por ejemplo, de WhatsApp). Es de su dueño hasta que lo comparte. */
export interface StickerPack {
  id: Id;
  name: string;
  ownerId: Id;
  /** Compartido: todo el grupo lo ve en su selector. */
  shared: boolean;
  createdAt: Date;
}

export interface Sticker {
  id: Id;
  packId: Id;
  /** Imagen lista para mostrar: URL firmada del almacenamiento o, en prueba, data URL. */
  url: string;
  contentType: string;
  size: number;
  animated: boolean;
  createdAt: Date;
}

/** Atajo propio: escribir `/nombre` en el chat inserta su texto. Solo lo ve su dueño. */
export interface ChatCommand {
  id: Id;
  ownerId: Id;
  name: string;
  description: string;
  text: string;
  createdAt: Date;
}

export interface DirectConversation {
  id: Id;
  participantIds: [Id, Id];
}

export interface DirectMessage extends MessageFields {
  conversationId: Id;
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
  /** Parcial de la materia en que ocurrió la sesión. */
  termId?: Id;
  topic: string;
  /** Fecha de la sesión, `AAAA-MM-DD`. */
  date: string;
  title: string;
  objective: string;
  instructions: string;
  /** Cualquier integrante la edita; cada edición guarda una versión. */
  version: number;
  createdBy: Id;
  createdAt: Date;
  updatedBy: Id;
  updatedAt: Date;
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

/**
 * Guía de estudio de una materia y parcial (3.5). Es del grupo: cualquier integrante la
 * edita y cada edición sube la versión.
 */
export interface StudyGuide {
  id: Id;
  subjectId: Id;
  termId?: Id;
  title: string;
  /** Temario, un tema por elemento. */
  topics: string[];
  /** Texto de cada sección, en el orden de `GUIDE_SECTIONS`; vacío si no se ha escrito. */
  sections: string[];
  version: number;
  createdBy: Id;
  createdAt: Date;
  updatedBy: Id;
  updatedAt: Date;
}

/** Material del grupo citado en una guía, con la versión que tenía cuando se agregó. */
export interface GuideSource {
  id: Id;
  guideId: Id;
  kind: GuideSourceKind;
  refId: Id;
  sourceVersion: number;
  status: GuideSourceStatus;
  /** Por qué sigue pendiente (ilegible, formato no admitido, falta leerla…). */
  reason: string;
  /** Temas del temario que cubre. */
  topics: string[];
  addedBy: Id;
  addedAt: Date;
}

/** Revisión de un compañero sobre una versión de la guía. */
export interface GuideReview {
  id: Id;
  guideId: Id;
  guideVersion: number;
  reviewerId: Id;
  verdict: GuideReviewVerdict;
  comment: string;
  createdAt: Date;
}

export interface Answer {
  id: Id;
  questionId: Id;
  authorId: Id;
  body: string;
  createdAt: Date;
}

/**
 * Votación o encuesta nominal (3.8): todo el grupo ve quién votó y qué eligió. Las opciones no
 * cambian después del primer voto; para cambiarlas se cancela y se reinicia la consulta.
 */
export interface Poll {
  id: Id;
  title: string;
  description: string;
  options: string[];
  /** Opción única o varias. */
  multiple: boolean;
  /** Se anuncia al crearla: si se puede cambiar el voto antes del cierre. */
  allowChange: boolean;
  /** Quiénes pueden votar; se fija al crearla. */
  eligibleIds: Id[];
  closesAt: Date;
  createdBy: Id;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt?: Date;
  cancelReason: string;
  /** Consulta cancelada que esta reinicia, si la hay. */
  restartOf?: Id;
  /** Acuerdo adoptado tras el cierre; la consulta no es la decisión final. */
  decision: string;
  decidedBy?: Id;
  decidedAt?: Date;
}

/** Un voto por persona y votación; si se permite, se cambia antes del cierre. */
export interface PollVote {
  pollId: Id;
  voterId: Id;
  /** Índices de las opciones elegidas. */
  choices: number[];
  votedAt: Date;
  /** Si cambió su voto, cuándo fue la última vez. */
  changedAt?: Date;
}

/** Lo que el usuario actual puede ver, igual que las vistas del servidor. */
export interface Snapshot {
  me: Member | undefined;
  members: Member[];
  subjects: Subject[];
  terms: Term[];
  /** Fechas de los parciales ya configurados; de aquí sale el cuatrimestre y parcial vigente. */
  calendar: TermDates[];
  assignments: Assignment[];
  works: Work[];
  workFiles: WorkFile[];
  /** Historial de las páginas editables (tareas principales y actividades de clase). */
  revisions: Revision[];
  groupMessages: GroupMessage[];
  directConversations: DirectConversation[];
  directMessages: DirectMessage[];
  /** Reacciones de los mensajes que puedes leer. */
  reactions: MessageReaction[];
  /** Tus paquetes y los que el grupo compartió. */
  stickerPacks: StickerPack[];
  /** Stickers de esos paquetes y los que aparecen en mensajes que puedes leer. */
  stickers: Sticker[];
  /** Solo tus comandos propios. */
  chatCommands: ChatCommand[];
  birthdays: Birthday[];
  activities: Activity[];
  evidences: Evidence[];
  /** Notas del grupo y tus notas personales; nunca las personales de otros. */
  notes: Note[];
  noteComments: NoteComment[];
  questions: Question[];
  answers: Answer[];
  guides: StudyGuide[];
  guideSources: GuideSource[];
  guideReviews: GuideReview[];
  polls: Poll[];
  pollVotes: PollVote[];
  /** Última vez que marcaste las novedades como vistas. */
  lastSeenAt: Date | undefined;
}

export interface AssignmentInput {
  subjectId: Id;
  termId?: Id;
  kind: WorkKind;
  title: string;
  instructions: string;
  dueDate?: string;
}

export interface PublishWorkInput {
  assignmentId: Id;
  title: string;
  description: string;
  coauthorIds: Id[];
}

/** Acciones: corresponden uno a uno con los reducers del módulo. */
export interface Actions {
  updateProfile(displayName: string, photoUrl?: string): void;
  /** Materia fuera del plan de estudios, dentro de un cuatrimestre (1 a 9). */
  createSubject(name: string, period: number): Id;
  createTerm(subjectId: Id, name: string): Id;
  /**
   * Solo administradores (creadores de la app): fija las fechas de los parciales de un
   * cuatrimestre, una posición por parcial; las dos fechas vacías lo dejan sin configurar.
   */
  saveCalendar(period: number, terms: TermDatesInput[]): void;
  createAssignment(input: AssignmentInput): Id;
  /** Como en un wiki: cualquier miembro activo edita y se guarda una versión a su nombre. */
  updateAssignment(assignmentId: Id, input: AssignmentInput): void;
  /** Sube el trabajo propio o del equipo a una página principal. */
  publishWork(input: PublishWorkInput): Id;
  /** Solo sus autores; cada edición guarda una versión nueva. */
  updateWork(workId: Id, title: string, description: string): void;
  /**
   * Sube un archivo y lo adjunta al trabajo; solo sus autores. Rechaza archivos vacíos o de
   * más de 50 MB (`MAX_FILE_BYTES`). Es la única acción asíncrona: subir toma tiempo.
   */
  attachWorkFile(workId: Id, file: File): Promise<Id>;
  removeWorkFile(fileId: Id): void;
  sendGroupMessage(text: string, replyToId?: Id): Id;
  /** Devuelve la conversación existente o la nueva. */
  openDirectConversation(otherId: Id): Id;
  sendDirectMessage(conversationId: Id, text: string, replyToId?: Id): Id;
  /** Solo quien lo envió, durante `EDIT_WINDOW_MS`. */
  editMessage(scope: MessageScope, messageId: Id, text: string): void;
  /** Para todos. Quien lo envió o, en el canal del salón, un administrador. */
  deleteMessage(scope: MessageScope, messageId: Id): void;
  /** Pone, cambia o quita (si es la misma) tu reacción. */
  toggleReaction(scope: MessageScope, messageId: Id, emoji: string): void;
  /**
   * Crea un paquete con las imágenes (WebP, PNG, GIF o JPEG de hasta 1 MB, máximo 30).
   * Asíncrona como `attachWorkFile`: sube cada imagen.
   */
  importStickers(packName: string, files: File[]): Promise<Id>;
  /** Solo su dueño. */
  setStickerPackShared(packId: Id, shared: boolean): void;
  /** Solo su dueño. Los mensajes que ya lo usan siguen mostrando el sticker. */
  removeStickerPack(packId: Id): void;
  saveChatCommand(input: SaveChatCommandInput): Id;
  removeChatCommand(commandId: Id): void;
  shareBirthday(day: number, month: number, remind: boolean): void;
  withdrawBirthday(): void;
  createActivity(input: CreateActivityInput): Id;
  /** Como en un wiki: cualquier miembro activo edita y se guarda una versión a su nombre. */
  updateActivity(activityId: Id, input: CreateActivityInput): void;
  addEvidence(activityId: Id, content: string, participantIds: Id[]): Id;
  saveNote(input: SaveNoteInput): Id;
  commentNote(noteId: Id, text: string): void;
  askQuestion(input: AskQuestionInput): Id;
  answerQuestion(questionId: Id, body: string): Id;
  /** Solo quien preguntó acepta una respuesta; marca la pregunta como resuelta. */
  acceptAnswer(questionId: Id, answerId: Id): void;
  reopenQuestion(questionId: Id): void;
  markSeen(): void;
  /** Crea la guía con sus fuentes iniciales, todas pendientes hasta que alguien las procese. */
  createGuide(input: GuideInput, sources: GuideSourceRef[]): Id;
  /** Como en un wiki: cualquier miembro activo edita y la versión sube. */
  updateGuide(guideId: Id, input: GuideInput): void;
  addGuideSources(guideId: Id, sources: GuideSourceRef[]): void;
  /** Marca una fuente como procesada o pendiente (con razón) y qué temas cubre. */
  updateGuideSource(sourceId: Id, update: GuideSourceUpdate): void;
  /** Toma la versión actual del material, por ejemplo después de revisar sus cambios. */
  refreshGuideSource(sourceId: Id): void;
  removeGuideSource(sourceId: Id): void;
  /** Un compañero revisa la versión actual; quien la guardó no puede. */
  reviewGuide(guideId: Id, verdict: GuideReviewVerdict, comment: string): void;
  createPoll(input: PollInput): Id;
  /** Solo quien la creó y mientras nadie haya votado. */
  updatePoll(pollId: Id, input: PollInput): void;
  /** Vota o, si la votación lo permite, cambia tu voto antes del cierre. */
  castVote(pollId: Id, choices: number[]): void;
  /** Solo quien la creó y antes del cierre; los votos se conservan como registro. */
  cancelPoll(pollId: Id, reason: string): void;
  /** Después del cierre, cualquier integrante registra el acuerdo; queda su nombre y fecha. */
  recordPollDecision(pollId: Id, decision: string): void;
}

export interface GuideInput {
  subjectId: Id;
  termId?: Id;
  title: string;
  /** El temario como lo escribió el usuario, un tema por renglón. */
  topicsText: string;
  sections: string[];
}

export interface GuideSourceRef {
  kind: GuideSourceKind;
  refId: Id;
}

export interface GuideSourceUpdate {
  status: GuideSourceStatus;
  reason: string;
  topics: string[];
}

export interface SaveChatCommandInput {
  /** Vacío para crear uno nuevo. */
  id?: Id;
  name: string;
  description: string;
  text: string;
}

export interface PollInput {
  title: string;
  description: string;
  options: string[];
  multiple: boolean;
  allowChange: boolean;
  eligibleIds: Id[];
  closesAt: Date;
  restartOf?: Id;
}

export interface CreateActivityInput {
  subjectId: Id;
  termId?: Id;
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
