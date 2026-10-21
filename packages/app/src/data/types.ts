/**
 * Tipos de datos que usa la interfaz. Reflejan las vistas del módulo SpacetimeDB
 * (`packages/spacetime-module`), con identidades e ids como texto para simplificar la UI.
 */

import type {
  GuideReviewVerdict,
  GuideSourceKind,
  GuideSourceStatus,
  TeachingExplanation,
  TeachingSourceKind,
  TeachingStatus,
  TermDates,
  TermDatesInput,
  WorkKind,
  HelpPostFields,
  HelpPostStatus,
  HelpContactStatus,
  HelpKind,
  SpacedRating,
  SpacedSourceKind,
  SpacedVisibility,
  OriginContributionKind,
} from '@b20/core';

export type Id = string;
import type { Delivery2Actions, ChatChannel, ChannelMessage, ConversationState, BlockedMember, MessageReport,
  MemberProfile, NoteVersion, GuideVersion, QuestionComment, AnswerUsefulness, QuestionLink } from './delivery2Types';
export type * from './delivery2Types';
import type { StudyRoomActions, StudyRoomsSnapshot } from './roomTypes';
import type { NotificationActions, NotificationsSnapshot } from './notificationTypes';
import type { TrashActions, TrashEntry } from './trashTypes';
export type * from './trashTypes';
export type * from './notificationTypes';
export type * from './roomTypes';

export interface SpacedCollection {
  id: Id;
  subjectId: Id;
  termId?: Id;
  title: string;
  visibility: SpacedVisibility;
  ownerId: Id;
  version: number;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: Id;
}

export interface SpacedCard {
  id: Id;
  collectionId: Id;
  question: string;
  explanation: string;
  hint: string;
  sourceKind: SpacedSourceKind;
  sourceId: Id;
  sourceVersion: number;
  version: number;
  archived: boolean;
  createdBy: Id;
  updatedBy: Id;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpacedEnrollment {
  memberId: Id;
  collectionId: Id;
  active: boolean;
  updatedAt: Date;
}

/** Una fuente retirada nunca revela la pregunta, explicación ni el identificador de origen. */
export interface SpacedUnavailableCard {
  id: Id;
  collectionId: Id;
  version: number;
  archived: boolean;
}

/** Solo la persona que estudia recibe su progreso; ni administradores consultan el ajeno. */
export interface SpacedProgress {
  memberId: Id;
  cardId: Id;
  cardVersion: number;
  step: number;
  revision: number;
  dueAt: Date;
  reviewedAt: Date;
}

export interface SpacedReview {
  id: Id;
  requestId: string;
  memberId: Id;
  cardId: Id;
  cardVersion: number;
  rating: SpacedRating;
  step: number;
  reviewedAt: Date;
  dueAt: Date;
}

export interface SpacedCollectionInput {
  id?: Id;
  subjectId: Id;
  termId?: Id;
  title: string;
  visibility: SpacedVisibility;
  expectedVersion?: number;
}

export interface SpacedCardInput {
  id?: Id;
  collectionId: Id;
  question: string;
  explanation: string;
  hint: string;
  sourceKind: SpacedSourceKind;
  sourceId: Id;
  expectedVersion?: number;
}

export interface SpacedReviewInput {
  cardId: Id;
  cardVersion: number;
  expectedRevision: number;
  rating: SpacedRating;
  /** Un intento conserva su identificador al reintentar tras una desconexión. */
  requestId: string;
}

export interface TeachingPractice {
  id: Id;
  ownerId: Id;
  reviewerId?: Id;
  subjectId: Id;
  topic: string;
  initial: TeachingExplanation;
  revised: TeachingExplanation;
  status: TeachingStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Nunca se entrega al compañero invitado, ni a administradores ajenos a la práctica. */
export interface TeachingPersonal {
  practiceId: Id;
  reflection: string;
  topicsToReview: string;
  sourceKind?: TeachingSourceKind;
  sourceId?: Id;
  sourceVersion?: number;
  publishedNoteId?: Id;
}

export interface TeachingQuestion {
  id: Id;
  practiceId: Id;
  authorId: Id;
  kind: 'guided' | 'peer';
  text: string;
  answer: string;
  createdAt: Date;
  answeredAt?: Date;
}

export interface CreateTeachingPracticeInput {
  subjectId: Id;
  topic: string;
  initial: TeachingExplanation;
  source?: { kind: TeachingSourceKind; id: Id };
}

export interface SaveTeachingPracticeInput {
  initial: TeachingExplanation;
  revised: TeachingExplanation;
  reflection: string;
  topicsToReview: string;
}

export interface HelpPost extends HelpPostFields {
  id: Id;
  authorId: Id;
  status: HelpPostStatus;
  createdAt: Date;
  updatedAt: Date;
  withdrawnBy?: Id;
  withdrawalReason?: string;
}

export interface HelpContactRequest {
  id: Id;
  postId: Id;
  senderId: Id;
  recipientId: Id;
  subjectId: Id;
  postTitle: string;
  postTopic: string;
  postKind: HelpKind;
  message: string;
  status: HelpContactStatus;
  conversationId?: Id;
  createdAt: Date;
  updatedAt: Date;
  closedBy?: Id;
  closeReason?: string;
}

export interface HelpPostInput extends HelpPostFields { id?: Id; }

export interface Member {
  id: Id;
  displayName: string;
  photoUrl?: string;
  status: 'active' | 'removed';
  isCreator: boolean;
  joinedAt: Date;
}

/** Correo autorizado para unirse al grupo. Solo los creadores ven la lista. */
export interface Invitation {
  email: string;
  /** Al unirse queda como creador (administrador) de la app. */
  isCreator: boolean;
  invitedBy: Id;
  createdAt: Date;
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
  /** Tema explícito; los registros anteriores pueden no tenerlo. */
  topic?: string;
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
  withdrawnAt?: Date;
  withdrawnBy?: Id;
  id: Id;
  assignmentId: Id;
  /** Tema o título propio; vacío si basta con el de la tarea. */
  title: string;
  description: string;
  topic?: string;
  /** Revisado se deriva de una revisión válida sobre la versión actual. */
  status?: WorkStatus;
  updatedBy?: Id;
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

export type ProgressTargetKind = 'assignment' | 'activity';
export type ProgressStatus = 'pending' | 'in_progress' | 'done';
export type WorkPublicationStatus = 'draft' | 'final';
export type WorkStatus = WorkPublicationStatus | 'reviewed';
export type ResourceTargetKind = ProgressTargetKind | 'work' | 'evidence' | 'note' | 'guide' | 'question' | 'answer' | 'profile' | 'group_message' | 'direct_message' | 'channel_message';

/** Se obtiene exclusivamente a través de la vista privada del alumno. */
export interface AcademicProgress {
  targetKind: ProgressTargetKind;
  targetId: Id;
  status: ProgressStatus;
  updatedAt: Date;
}

export interface WorkVersionInput {
  title: string;
  description: string;
  topic: string;
  status: WorkPublicationStatus;
}

/** Instantánea inmutable: sus adjuntos siguen accesibles aunque se quiten de la actual. */
export interface WorkRevision extends WorkVersionInput {
  id: Id;
  workId: Id;
  version: number;
  authorIds: Id[];
  attachmentIds: Id[];
  editedBy?: Id;
  editedAt: Date;
  restoredFrom?: number;
}

export interface WorkReview {
  id: Id;
  workId: Id;
  version: number;
  workVersion: number;
  reviewerId: Id;
  comment: string;
  createdAt: Date;
}

export interface AcademicComment {
  id: Id;
  targetKind: 'work' | 'evidence';
  targetId: Id;
  authorId: Id;
  text: string;
  createdAt: Date;
}

/** Progreso de bytes confirmados; cancelar no elimina publicaciones ni otros adjuntos. */
export interface ResourceTransferOptions {
  signal?: AbortSignal;
  onProgress?: (transferredBytes: number, totalBytes: number) => void;
}

/** ID UUID para los nuevos; `legacy:<id>` conserva referencias a work_file existentes. */
export interface ResourceFile {
  id: Id;
  targetKind: ResourceTargetKind;
  targetId: Id;
  name: string;
  size: number;
  contentType: string;
  uploadedBy: Id;
  createdAt: Date;
  removedAt?: Date;
  /** Solo simulación: nunca contiene una ubicación de almacenamiento privada. */
  url?: string;
}

export interface ActivityLink {
  id: Id;
  activityId: Id;
  targetKind: 'assignment' | 'note';
  targetId: Id;
  createdBy: Id;
  createdAt: Date;
  removedAt?: Date;
}

export interface PageSnapshot {
  id: Id;
  page: ProgressTargetKind;
  pageId: Id;
  version: number;
  subjectId: Id;
  termId?: Id;
  kind?: WorkKind;
  topic: string;
  date: string;
  title: string;
  summary: string;
  body: string;
  dueDate?: string;
  attachmentIds: Id[];
  assignmentIds: Id[];
  noteIds: Id[];
  restoredFrom?: number;
  editedBy?: Id;
  editedAt: Date;
}

/** Campos comunes de un mensaje del grupo o de un 1 a 1. */
export interface MessageFields {
  version?: number;
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
export type MessageScope = 'group' | 'direct' | 'channel';

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
  withdrawnAt?: Date;
  withdrawnBy?: Id;
  id: Id;
  activityId: Id;
  authorId: Id;
  participantIds: Id[];
  content: string;
  createdAt: Date;
  version?: number;
}

export type NoteVisibility = 'personal' | 'group';
/** Diferencia apuntes del estudiante, material del docente y contenido generado con IA (3.4). */
export type NoteSource = 'student' | 'teacher' | 'ai';

export interface Note {
  withdrawnAt?: Date;
  withdrawnBy?: Id;
  termId?: Id;
  session?: string;
  assignmentIds?: Id[];
  activityIds?: Id[];
  questionIds?: Id[];
  publishedFromId?: Id;
  publishedFromVersion?: number;
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
  withdrawnAt?: Date;
  withdrawnBy?: Id;
  version?: number;
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
  withdrawnAt?: Date;
  withdrawnBy?: Id;
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
  withdrawnAt?: Date;
  withdrawnBy?: Id;
  version?: number;
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
export interface Snapshot extends StudyRoomsSnapshot, NotificationsSnapshot {
  trashEntries: TrashEntry[];
  contributionOrigins: { kind: OriginContributionKind; refId: Id; memberId: Id; creditedAt: Date; duplicateOf?: Id }[];
  chatChannels: ChatChannel[];
  channelMessages: ChannelMessage[];
  conversationStates: ConversationState[];
  blockedMembers: BlockedMember[];
  messageReports: MessageReport[];
  memberProfiles: MemberProfile[];
  noteVersions: NoteVersion[];
  guideVersions: GuideVersion[];
  questionComments: QuestionComment[];
  answerUsefulness: AnswerUsefulness[];
  questionLinks: QuestionLink[];
  spacedUnavailableCards: SpacedUnavailableCard[];
  spacedCollections: SpacedCollection[];
  spacedCards: SpacedCard[];
  spacedEnrollments: SpacedEnrollment[];
  spacedProgress: SpacedProgress[];
  spacedReviews: SpacedReview[];
  teachingPractices: TeachingPractice[];
  /** Información privada del autor; nunca se combina con la práctica compartida. */
  teachingPersonal: TeachingPersonal[];
  teachingQuestions: TeachingQuestion[];
  /**
   * `connecting` mientras llegan los datos del servidor (en la demo nunca). Sin esto, la app no
   * sabría distinguir «todavía no llega tu membresía» de «no eres miembro».
   */
  connection: 'connecting' | 'ready' | 'offline';
  /** Error de conexión sin credenciales ni contenido privado. */
  connectionError?: string;
  me: Member | undefined;
  members: Member[];
  /** Solo para creadores: correos autorizados, ya unidos o no. */
  invitations: Invitation[];
  subjects: Subject[];
  terms: Term[];
  /** Fechas de los parciales ya configurados; de aquí sale el cuatrimestre y parcial vigente. */
  calendar: TermDates[];
  assignments: Assignment[];
  works: Work[];
  myProgress: AcademicProgress[];
  workRevisions: WorkRevision[];
  workReviews: WorkReview[];
  academicComments: AcademicComment[];
  resourceFiles: ResourceFile[];
  activityLinks: ActivityLink[];
  pageSnapshots: PageSnapshot[];
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
  /** Publicaciones del grupo y las retiradas propias. */
  helpPosts: HelpPost[];
  /** Solo los contactos enviados o recibidos por quien consulta. */
  helpContacts: HelpContactRequest[];
  /** Última vez que marcaste las novedades como vistas. */
  lastSeenAt: Date | undefined;
}

export interface AssignmentInput {
  subjectId: Id;
  termId?: Id;
  kind: WorkKind;
  title: string;
  instructions: string;
  topic?: string;
  dueDate?: string;
}

export interface PublishWorkInput {
  assignmentId: Id;
  title: string;
  description: string;
  coauthorIds: Id[];
  topic?: string;
  status?: WorkPublicationStatus;
}

/**
 * Lo que devuelve una acción: el valor directo en la demo (que corre en memoria) o una promesa
 * en SpacetimeDB, donde cada acción espera la respuesta del servidor. Las pantallas siempre
 * usan `await`, así funcionan con las dos fuentes.
 */
export type MaybePromise<T> = T | Promise<T>;

/** Acciones: corresponden uno a uno con los reducers del módulo. */
export interface Actions extends Delivery2Actions, StudyRoomActions, NotificationActions, TrashActions {
  replaceSpacedCardSource(cardId: Id, expectedVersion: number, sourceKind: SpacedSourceKind, sourceId: Id): MaybePromise<void>;
  saveSpacedCollection(input: SpacedCollectionInput): MaybePromise<Id>;
  publishSpacedCollection(collectionId: Id, expectedVersion: number): MaybePromise<void>;
  archiveSpacedCollection(collectionId: Id, archived: boolean, expectedVersion: number): MaybePromise<void>;
  saveSpacedCard(input: SpacedCardInput): MaybePromise<Id>;
  archiveSpacedCard(cardId: Id, archived: boolean, expectedVersion: number): MaybePromise<void>;
  setSpacedEnrollment(collectionId: Id, active: boolean): MaybePromise<void>;
  reviewSpacedCard(input: SpacedReviewInput): MaybePromise<void>;
  createTeachingPractice(input: CreateTeachingPracticeInput): MaybePromise<Id>;
  saveTeachingPractice(practiceId: Id, input: SaveTeachingPracticeInput): MaybePromise<void>;
  startTeachingPractice(practiceId: Id): MaybePromise<void>;
  completeTeachingPractice(practiceId: Id): MaybePromise<void>;
  reopenTeachingPractice(practiceId: Id): MaybePromise<void>;
  setTeachingReviewer(practiceId: Id, reviewerId?: Id): MaybePromise<void>;
  askTeachingQuestion(practiceId: Id, text: string): MaybePromise<Id>;
  answerTeachingQuestion(questionId: Id, answer: string): MaybePromise<void>;
  publishTeachingExplanation(practiceId: Id): MaybePromise<Id>;
  saveHelpPost(input: HelpPostInput): MaybePromise<Id>;
  setHelpPostStatus(postId: Id, status: 'open' | 'closed'): MaybePromise<void>;
  withdrawHelpPost(postId: Id, reason?: string): MaybePromise<void>;
  sendHelpContact(postId: Id, message?: string): MaybePromise<Id>;
  respondHelpContact(requestId: Id, decision: 'accepted' | 'rejected'): MaybePromise<void>;
  cancelHelpContact(requestId: Id): MaybePromise<void>;
  closeHelpContact(requestId: Id): MaybePromise<void>;
  /** Primera entrada: si tu correo está invitado, te vuelves miembro con ese nombre. */
  joinGroup(displayName: string): MaybePromise<void>;
  /** Solo creadores. Invitar un correo ya invitado no hace nada. */
  inviteMember(email: string, isCreator: boolean): MaybePromise<void>;
  /** Solo creadores: retira una invitación de alguien que todavía no se une. */
  revokeInvitation(email: string): MaybePromise<void>;
  /** Solo creadores: da de baja a un miembro; su historial se conserva. */
  removeMember(memberId: Id): MaybePromise<void>;
  /** Solo creadores: carga las materias de `CURRICULUM` que falten, con sus tres parciales. */
  importCurriculum(): MaybePromise<void>;
  updateProfile(displayName: string, photoUrl?: string): MaybePromise<void>;
  /** Materia fuera del plan de estudios, dentro de un cuatrimestre (1 a 9). */
  createSubject(name: string, period: number): MaybePromise<Id>;
  createTerm(subjectId: Id, name: string): MaybePromise<Id>;
  /**
   * Solo administradores (creadores de la app): fija las fechas de los parciales de un
   * cuatrimestre, una posición por parcial; las dos fechas vacías lo dejan sin configurar.
   */
  saveCalendar(period: number, terms: TermDatesInput[]): MaybePromise<void>;
  createAssignment(input: AssignmentInput): MaybePromise<Id>;
  /** Como en un wiki: cualquier miembro activo edita y se guarda una versión a su nombre. */
  updateAssignment(assignmentId: Id, input: AssignmentInput, expectedVersion?: number): MaybePromise<void>;
  /** Sube el trabajo propio o del equipo a una página principal. */
  publishWork(input: PublishWorkInput): MaybePromise<Id>;
  /** Solo sus autores; cada edición guarda una versión nueva. */
  updateWork(workId: Id, title: string, description: string): MaybePromise<void>;
  setProgress(targetKind: ProgressTargetKind, targetId: Id, status: ProgressStatus): MaybePromise<void>;
  saveWorkVersion(workId: Id, input: WorkVersionInput, expectedVersion: number): MaybePromise<void>;
  restoreWorkVersion(workId: Id, version: number, expectedVersion: number): MaybePromise<void>;
  reviewWork(workId: Id, expectedVersion: number, comment: string): MaybePromise<void>;
  commentAcademic(targetKind: 'work' | 'evidence', targetId: Id, text: string): MaybePromise<void>;
  saveActivityLinks(activityId: Id, assignmentIds: Id[], noteIds: Id[], expectedVersion?: number): MaybePromise<void>;
  restorePageSnapshot(page: ProgressTargetKind, pageId: Id, version: number, expectedVersion: number): MaybePromise<void>;
  attachResourceFile(targetKind: ResourceTargetKind, targetId: Id, file: File, expectedVersion?: number, transfer?: ResourceTransferOptions): Promise<Id>;
  removeResourceFile(fileId: Id, expectedVersion?: number): MaybePromise<void>;
  restoreResourceFile(fileId: Id, expectedVersion: number): MaybePromise<void>;
  downloadResourceFile(fileId: Id, transfer?: ResourceTransferOptions): Promise<Blob>;
  /**
   * Sube un archivo y lo adjunta al trabajo; solo sus autores. Rechaza archivos vacíos o de
   * más de 50 MB (`MAX_FILE_BYTES`). Es la única acción asíncrona: subir toma tiempo.
   */
  attachWorkFile(workId: Id, file: File): Promise<Id>;
  removeWorkFile(fileId: Id): MaybePromise<void>;
  sendGroupMessage(text: string, replyToId?: Id): MaybePromise<Id>;
  /** Devuelve la conversación existente o la nueva. */
  openDirectConversation(otherId: Id): MaybePromise<Id>;
  sendDirectMessage(conversationId: Id, text: string, replyToId?: Id): MaybePromise<Id>;
  /** Solo quien lo envió, durante `EDIT_WINDOW_MS`. */
  editMessage(scope: MessageScope, messageId: Id, text: string): MaybePromise<void>;
  /** Para todos. Quien lo envió o, en el canal del salón, un administrador. */
  deleteMessage(scope: MessageScope, messageId: Id): MaybePromise<void>;
  /** Pone, cambia o quita (si es la misma) tu reacción. */
  toggleReaction(scope: MessageScope, messageId: Id, emoji: string): MaybePromise<void>;
  /**
   * Crea un paquete con las imágenes (WebP, PNG, GIF o JPEG de hasta 1 MB, máximo 30).
   * Asíncrona como `attachWorkFile`: sube cada imagen.
   */
  importStickers(packName: string, files: File[]): Promise<Id>;
  /** Solo su dueño. */
  setStickerPackShared(packId: Id, shared: boolean): MaybePromise<void>;
  /** Solo su dueño. Los mensajes que ya lo usan siguen mostrando el sticker. */
  removeStickerPack(packId: Id): MaybePromise<void>;
  saveChatCommand(input: SaveChatCommandInput): MaybePromise<Id>;
  removeChatCommand(commandId: Id): MaybePromise<void>;
  shareBirthday(day: number, month: number, remind: boolean): MaybePromise<void>;
  withdrawBirthday(): MaybePromise<void>;
  createActivity(input: CreateActivityInput): MaybePromise<Id>;
  /** Como en un wiki: cualquier miembro activo edita y se guarda una versión a su nombre. */
  updateActivity(activityId: Id, input: CreateActivityInput, expectedVersion?: number): MaybePromise<void>;
  addEvidence(activityId: Id, content: string, participantIds: Id[]): MaybePromise<Id>;
  saveNote(input: SaveNoteInput): MaybePromise<Id>;
  commentNote(noteId: Id, text: string): MaybePromise<void>;
  askQuestion(input: AskQuestionInput): MaybePromise<Id>;
  answerQuestion(questionId: Id, body: string): MaybePromise<Id>;
  /** Solo quien preguntó acepta una respuesta; marca la pregunta como resuelta. */
  acceptAnswer(questionId: Id, answerId: Id): MaybePromise<void>;
  reopenQuestion(questionId: Id): MaybePromise<void>;
  markSeen(): MaybePromise<void>;
  /** Crea la guía con sus fuentes iniciales, todas pendientes hasta que alguien las procese. */
  createGuide(input: GuideInput, sources: GuideSourceRef[]): MaybePromise<Id>;
  /** Como en un wiki: cualquier miembro activo edita y la versión sube. */
  updateGuide(guideId: Id, input: GuideInput, expectedVersion?: number): MaybePromise<void>;
  addGuideSources(guideId: Id, sources: GuideSourceRef[]): MaybePromise<void>;
  /** Marca una fuente como procesada o pendiente (con razón) y qué temas cubre. */
  updateGuideSource(sourceId: Id, update: GuideSourceUpdate): MaybePromise<void>;
  /** Toma la versión actual del material, por ejemplo después de revisar sus cambios. */
  refreshGuideSource(sourceId: Id): MaybePromise<void>;
  removeGuideSource(sourceId: Id): MaybePromise<void>;
  /** Un compañero revisa la versión actual; quien la guardó no puede. */
  reviewGuide(guideId: Id, verdict: GuideReviewVerdict, comment: string): MaybePromise<void>;
  createPoll(input: PollInput): MaybePromise<Id>;
  /** Solo quien la creó y mientras nadie haya votado. */
  updatePoll(pollId: Id, input: PollInput): MaybePromise<void>;
  /** Vota o, si la votación lo permite, cambia tu voto antes del cierre. */
  castVote(pollId: Id, choices: number[]): MaybePromise<void>;
  /** Solo quien la creó y antes del cierre; los votos se conservan como registro. */
  cancelPoll(pollId: Id, reason: string): MaybePromise<void>;
  /** Después del cierre, cualquier integrante registra el acuerdo; queda su nombre y fecha. */
  recordPollDecision(pollId: Id, decision: string): MaybePromise<void>;
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
  expectedVersion?: number;
  termId?: Id;
  session?: string;
  assignmentIds?: Id[];
  activityIds?: Id[];
  questionIds?: Id[];
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
