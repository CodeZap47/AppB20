/**
 * Módulo SpacetimeDB de App B20, alcance de la Etapa 0 / MVP:
 * membresía por invitación, perfiles, materias por cuatrimestre con sus parciales, páginas
 * principales de tareas, actividades, exposiciones y exámenes que todos editan como wiki (con
 * historial), los trabajos que sube cada alumno o equipo con sus coautores y
 * archivos adjuntos (máximo 50 MB cada uno),
 * canal del grupo, mensajes 1 a 1 y cumpleaños voluntarios.
 *
 * Reglas (sección 2 y 5 de la definición):
 * - Todas las tablas son privadas. Los clientes leen mediante vistas que comprueban
 *   que quien consulta es miembro activo; un cliente conectado sin membresía no ve nada.
 * - Los mensajes 1 a 1 solo son visibles para sus dos participantes, también para creadores.
 * - Los cambios importantes quedan en `change_log` con responsable y fecha.
 */
import { schema, SenderError, t, table, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';
import { sha256 } from '@noble/hashes/sha2.js';
import { nextSpacedSchedule, type SpacedRating } from '../../core/src/spaced';
import { normalizePresentationConfiguration, normalizePresentationBody, normalizePresentationObservations,
  normalizePresentationNextSteps, normalizePresentationQuestion, normalizePresentationAnswer,
  normalizePresentationFeedback, presentationGuidingQuestions } from '../../core/src/presentations';
import { delivery2Tables, chatChannel, channelMessage, conversationState, memberBlock, messageReport,
  noteDetail, noteVersion, guideVersion, questionComment, answerUsefulness, questionLink, resourceVersion, memberProfile, contentStatus } from './delivery2Tables';
import * as delivery2 from './delivery2Handlers';
import { saveMemberProfile, withdrawContent } from './communityHandlers';
import * as knowledge from './knowledgeHandlers';
import { configureModuleHelpers } from './moduleContext';
import { readContributionOrigins } from './contributionOrigins';
import { roomsTables, studyRoom, roomMember, roomMaterial, roomEntry, roomTimer, roomSummary, helpRoomLink } from './roomsTables';
import * as rooms from './roomsHandlers';
import * as nativeStickers from './nativeStickersHandlers';

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------

/** Una sola fila: identidad de quien publicó el módulo (creador inicial). */
const appConfig = table(
  { name: 'app_config' },
  {
    id: t.u32().primaryKey(),
    owner: t.identity(),
  },
);

/** Credenciales públicas OIDC aceptadas; se configuran por el propietario tras publicar. */
const authConfig = table(
  { name: 'auth_config' },
  {
    id: t.u32().primaryKey(),
    issuer: t.string(),
    audiences: t.array(t.string()),
  },
);

/** Lista autorizada del grupo: solo correos invitados pueden unirse. */
const invitation = table(
  { name: 'invitation' },
  {
    email: t.string().primaryKey(),
    isCreator: t.bool(),
    invitedBy: t.identity(),
    createdAt: t.timestamp(),
  },
);

const member = table(
  { name: 'member' },
  {
    identity: t.identity().primaryKey(),
    displayName: t.string(),
    photoUrl: t.string().optional(),
    /** 'active' | 'removed' */
    status: t.string(),
    isCreator: t.bool(),
    joinedAt: t.timestamp(),
  },
);

const subject = table(
  { name: 'subject' },
  {
    id: t.u64().primaryKey().autoInc(),
    /** Clave del plan de estudios; vacía en las materias agregadas a mano. */
    code: t.string(),
    name: t.string(),
    /** Cuatrimestre en que se cursa, de 1 a 9. */
    period: t.u32(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
  },
);

/** Parcial o unidad de una materia. */
const term = table(
  { name: 'term' },
  {
    id: t.u64().primaryKey().autoInc(),
    subjectId: t.u64().index('btree'),
    name: t.string(),
    position: t.u32(),
  },
);

/**
 * Calendario escolar: fechas de cada parcial de cada cuatrimestre. Solo los creadores las
 * cambian; con ellas los clientes saben en qué cuatrimestre y parcial va el grupo.
 */
const termDates = table(
  { name: 'term_dates' },
  {
    id: t.u64().primaryKey().autoInc(),
    period: t.u32().index('btree'),
    /** Número de parcial dentro del cuatrimestre, de 1 a 3. */
    term: t.u32(),
    /** Primer y último día, `AAAA-MM-DD`. */
    startDate: t.string(),
    endDate: t.string(),
    updatedBy: t.identity(),
    updatedAt: t.timestamp(),
  },
);

/**
 * Página principal de una tarea, actividad, exposición o examen: lo que se pidió. Cualquier
 * miembro activo la edita, como un wiki; cada versión queda en `page_revision`.
 */
const assignment = table(
  { name: 'assignment' },
  {
    id: t.u64().primaryKey().autoInc(),
    subjectId: t.u64().index('btree'),
    termId: t.u64().optional(),
    /** `tarea`, `actividad`, `exposicion` o `examen`. */
    kind: t.string(),
    title: t.string(),
    instructions: t.string(),
    /** Fecha de entrega `AAAA-MM-DD`; vacía si no tiene. */
    dueDate: t.string(),
    version: t.u32(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
    updatedBy: t.identity(),
    updatedAt: t.timestamp(),
  },
);

/** Versión guardada de una página que todos editan (`assignment` o `activity`). */
const pageRevision = table(
  { name: 'page_revision' },
  {
    id: t.u64().primaryKey().autoInc(),
    /** `assignment` o `activity`. */
    page: t.string(),
    pageId: t.u64().index('btree'),
    version: t.u32(),
    editedBy: t.identity(),
    editedAt: t.timestamp(),
    title: t.string(),
    /** Solo actividades de clase: el objetivo. */
    summary: t.string(),
    body: t.string(),
    /** Solo tareas: la fecha de entrega de esa versión, para avisar cuando cambia. */
    dueDate: t.string().optional(),
  },
);

/** Trabajo que subió un alumno o un equipo para una página principal (sección 3.2 y 9). */
const work = table(
  { name: 'work' },
  {
    id: t.u64().primaryKey().autoInc(),
    assignmentId: t.u64().index('btree'),
    /** Tema o título propio; vacío si basta con el de la tarea. */
    title: t.string(),
    description: t.string(),
    version: t.u32(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

const workAuthor = table(
  { name: 'work_author' },
  {
    id: t.u64().primaryKey().autoInc(),
    workId: t.u64().index('btree'),
    author: t.identity().index('btree'),
  },
);

/**
 * Datos de un archivo adjunto a un trabajo. El contenido vive en el almacenamiento de
 * archivos y `storageKey` es su ubicación ahí. La clave no da acceso por sí sola: cada
 * descarga pasa por el backend, que comprueba membresía y firma un enlace temporal.
 */
const workFile = table(
  { name: 'work_file' },
  {
    id: t.u64().primaryKey().autoInc(),
    workId: t.u64().index('btree'),
    name: t.string(),
    size: t.u64(),
    contentType: t.string(),
    storageKey: t.string(),
    uploadedBy: t.identity(),
    createdAt: t.timestamp(),
  },
);

/**
 * Mensaje del canal. `text` puede llevar referencias `[[tipo:id]]` a otros módulos o ser solo
 * un sticker; al eliminarlo queda vacío con `deletedAt` para conservar el hilo.
 */
const groupMessage = table(
  { name: 'group_message' },
  {
    id: t.u64().primaryKey().autoInc(),
    sender: t.identity(),
    text: t.string(),
    sentAt: t.timestamp(),
    replyToId: t.u64().optional(),
    editedAt: t.timestamp().optional(),
    deletedAt: t.timestamp().optional(),
    deletedBy: t.identity().optional(),
  },
);

/** Conversación 1 a 1. `userA` es siempre la identidad menor en hexadecimal. */
const directConversation = table(
  { name: 'direct_conversation' },
  {
    id: t.u64().primaryKey().autoInc(),
    userA: t.identity().index('btree'),
    userB: t.identity().index('btree'),
    createdAt: t.timestamp(),
  },
);

const directMessage = table(
  { name: 'direct_message' },
  {
    id: t.u64().primaryKey().autoInc(),
    conversationId: t.u64().index('btree'),
    sender: t.identity(),
    text: t.string(),
    sentAt: t.timestamp(),
    replyToId: t.u64().optional(),
    editedAt: t.timestamp().optional(),
    deletedAt: t.timestamp().optional(),
    deletedBy: t.identity().optional(),
  },
);

/** Reacción de una persona a un mensaje; `scope` es 'group' o 'direct'. Una por persona y mensaje. */
const messageReaction = table(
  { name: 'message_reaction' },
  {
    id: t.u64().primaryKey().autoInc(),
    scope: t.string(),
    messageId: t.u64().index('btree'),
    member: t.identity(),
    emoji: t.string(),
  },
);

/** Paquete de stickers importado; privado de su dueño hasta que lo comparte. */
const stickerPack = table(
  { name: 'sticker_pack' },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity().index('btree'),
    name: t.string(),
    shared: t.bool(),
    createdAt: t.timestamp(),
  },
);

/**
 * Imagen de un sticker en el almacenamiento (igual que `work_file`). `used` se marca al enviarlo:
 * desde entonces se sigue viendo aunque el paquete se quite o deje de compartirse.
 */
const sticker = table(
  { name: 'sticker' },
  {
    id: t.u64().primaryKey().autoInc(),
    packId: t.u64(),
    storageKey: t.string(),
    contentType: t.string(),
    size: t.u64(),
    animated: t.bool(),
    used: t.bool(),
    createdAt: t.timestamp(),
  },
);

/** Atajo propio para el chat: `/nombre` inserta `text`. Solo lo ve su dueño. */
const chatCommand = table(
  { name: 'chat_command' },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity().index('btree'),
    name: t.string(),
    description: t.string(),
    text: t.string(),
    createdAt: t.timestamp(),
  },
);

/** Cumpleaños compartido voluntariamente: solo día y mes. */
const birthday = table(
  { name: 'birthday' },
  {
    identity: t.identity().primaryKey(),
    day: t.u8(),
    month: t.u8(),
    remind: t.bool(),
    sharedAt: t.timestamp(),
  },
);

/** Historial de cambios importantes: responsable, fecha y entidad. */
const changeLog = table(
  { name: 'change_log' },
  {
    id: t.u64().primaryKey().autoInc(),
    actor: t.identity(),
    action: t.string(),
    entity: t.string(),
    entityId: t.string(),
    at: t.timestamp(),
  },
);

/** Actividad de clase (3.3). `date` es `AAAA-MM-DD`. */
const activity = table(
  { name: 'activity' },
  {
    id: t.u64().primaryKey().autoInc(),
    subjectId: t.u64().index('btree'),
    /** Parcial de la materia en que ocurrió la sesión. */
    termId: t.u64().optional(),
    topic: t.string(),
    date: t.string(),
    title: t.string(),
    objective: t.string(),
    instructions: t.string(),
    /** Cualquier miembro activo la edita; cada versión queda en `page_revision`. */
    version: t.u32(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
    updatedBy: t.identity(),
    updatedAt: t.timestamp(),
  },
);

/** Evidencia de un equipo; cada una es una fila nueva y nunca sobrescribe a otra. */
const evidence = table(
  { name: 'evidence' },
  {
    id: t.u64().primaryKey().autoInc(),
    activityId: t.u64().index('btree'),
    author: t.identity(),
    participants: t.array(t.identity()),
    content: t.string(),
    createdAt: t.timestamp(),
  },
);

/** Nota de clase (3.4). visibility: 'personal' | 'group'; source: 'student' | 'teacher' | 'ai'. */
const note = table(
  { name: 'note' },
  {
    id: t.u64().primaryKey().autoInc(),
    subjectId: t.u64().index('btree'),
    topic: t.string(),
    title: t.string(),
    body: t.string(),
    tags: t.array(t.string()),
    visibility: t.string(),
    source: t.string(),
    author: t.identity().index('btree'),
    version: t.u32(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

/** Comentario o propuesta de corrección: no modifica la nota. */
const noteComment = table(
  { name: 'note_comment' },
  {
    id: t.u64().primaryKey().autoInc(),
    noteId: t.u64().index('btree'),
    author: t.identity(),
    text: t.string(),
    createdAt: t.timestamp(),
  },
);

/** Pregunta (3.7). status: 'open' | 'resolved'. */
const question = table(
  { name: 'question' },
  {
    id: t.u64().primaryKey().autoInc(),
    subjectId: t.u64().index('btree'),
    topic: t.string(),
    title: t.string(),
    body: t.string(),
    author: t.identity(),
    status: t.string(),
    acceptedAnswerId: t.u64().optional(),
    resolvedAt: t.timestamp().optional(),
    createdAt: t.timestamp(),
  },
);

const answer = table(
  { name: 'answer' },
  {
    id: t.u64().primaryKey().autoInc(),
    questionId: t.u64().index('btree'),
    author: t.identity(),
    body: t.string(),
    createdAt: t.timestamp(),
  },
);

/**
 * Votación o encuesta nominal (3.8): quién votó y qué eligió es visible para el grupo.
 * Las opciones no cambian después del primer voto; para eso se cancela y se reinicia.
 */
const poll = table(
  { name: 'poll' },
  {
    id: t.u64().primaryKey().autoInc(),
    title: t.string(),
    description: t.string(),
    options: t.array(t.string()),
    multiple: t.bool(),
    /** Se anuncia al crearla: si se puede cambiar el voto antes del cierre. */
    allowChange: t.bool(),
    /** Participantes elegibles, fijados al crearla. */
    eligible: t.array(t.identity()),
    closesAt: t.timestamp(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    cancelledAt: t.timestamp().optional(),
    cancelReason: t.string(),
    /** Consulta cancelada que esta reinicia. */
    restartOf: t.u64().optional(),
    /** Acuerdo adoptado tras el cierre, distinto del resultado de la consulta. */
    decision: t.string(),
    decidedBy: t.identity().optional(),
    decidedAt: t.timestamp().optional(),
  },
);

/** Un voto por persona y votación (la llave lo impide dos veces). */
const pollVote = table(
  { name: 'poll_vote' },
  {
    /** `${pollId}:${identidad}`: evita votos duplicados. */
    key: t.string().primaryKey(),
    pollId: t.u64().index('btree'),
    voter: t.identity(),
    choices: t.array(t.u32()),
    votedAt: t.timestamp(),
    changedAt: t.timestamp().optional(),
  },
);

/** Última vez que cada miembro marcó las novedades como vistas (7.1). */
const lastSeen = table(
  { name: 'last_seen' },
  {
    identity: t.identity().primaryKey(),
    at: t.timestamp(),
  },
);

/**
 * Guía de estudio de una materia y parcial (3.5). Es del grupo: cualquier miembro activo la
 * edita y la versión sube; quién guardó cada versión queda en `change_log`.
 */
const studyGuide = table(
  { name: 'study_guide' },
  {
    id: t.u64().primaryKey().autoInc(),
    subjectId: t.u64().index('btree'),
    termId: t.u64().optional(),
    title: t.string(),
    /** Temario, un tema por elemento. */
    topics: t.array(t.string()),
    /** Una entrada por sección, en el orden de `GUIDE_SECTIONS` de `@b20/core`. */
    sections: t.array(t.string()),
    version: t.u32(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
    updatedBy: t.identity(),
    updatedAt: t.timestamp(),
  },
);

/**
 * Material del grupo citado en una guía. `status`: 'processed' | 'pending'; una pendiente
 * siempre lleva la razón. `sourceVersion` es la versión del material cuando se procesó.
 */
const guideSource = table(
  { name: 'guide_source' },
  {
    id: t.u64().primaryKey().autoInc(),
    guideId: t.u64().index('btree'),
    /** 'trabajo' | 'tarea' | 'actividad' | 'nota' | 'pregunta'. */
    kind: t.string(),
    refId: t.u64(),
    sourceVersion: t.u32(),
    status: t.string(),
    reason: t.string(),
    topics: t.array(t.string()),
    addedBy: t.identity(),
    addedAt: t.timestamp(),
  },
);

/** Revisión de un compañero sobre una versión. `verdict`: 'approved' | 'changes'. */
const guideReview = table(
  { name: 'guide_review' },
  {
    id: t.u64().primaryKey().autoInc(),
    guideId: t.u64().index('btree'),
    guideVersion: t.u32(),
    reviewer: t.identity(),
    verdict: t.string(),
    comment: t.string(),
    createdAt: t.timestamp(),
  },
);

/** Práctica privada: solo su autor y el compañero actualmente invitado pueden leerla. */
const teachingPractice = table(
  { name: 'teaching_practice' },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity().index('btree'),
    reviewer: t.identity().optional(),
    subjectId: t.u64(),
    topic: t.string(),
    concept: t.string(),
    example: t.string(),
    limits: t.string(),
    revisedConcept: t.string(),
    revisedExample: t.string(),
    revisedLimits: t.string(),
    /** 'draft' | 'practicing' | 'completed'. */
    status: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

/** Nunca se comparte con el compañero: reflexión, referencia privada y publicación. */
const teachingPersonal = table(
  { name: 'teaching_personal' },
  {
    practiceId: t.u64().primaryKey(),
    reflection: t.string(),
    topicsToReview: t.string(),
    sourceKind: t.string().optional(),
    sourceId: t.u64().optional(),
    sourceVersion: t.u32().optional(),
    publishedNoteId: t.u64().optional(),
  },
);

/** Preguntas orientadoras y del compañero; respuestas escritas solo por el autor. */
const teachingQuestion = table(
  { name: 'teaching_question' },
  {
    id: t.u64().primaryKey().autoInc(),
    practiceId: t.u64().index('btree'),
    author: t.identity(),
    /** 'guided' | 'peer'. */
    kind: t.string(),
    text: t.string(),
    answer: t.string(),
    createdAt: t.timestamp(),
    answeredAt: t.timestamp().optional(),
  },
);

/** Oferta o petición de ayuda; las retiradas solo se devuelven a su autor. */
const helpPost = table(
  { name: 'help_post' },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: t.string(),
    subjectId: t.u64().index('btree'),
    title: t.string(),
    topic: t.string(),
    description: t.string(),
    level: t.string(),
    modality: t.string(),
    availability: t.string(),
    status: t.string(),
    author: t.identity().index('btree'),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    withdrawnBy: t.identity().optional(),
    withdrawalReason: t.string().optional(),
  },
);

/** Historial privado entre quien solicita contacto y el autor de la publicación. */
const helpContactRequest = table(
  { name: 'help_contact_request' },
  {
    id: t.u64().primaryKey().autoInc(),
    postId: t.u64().index('btree'),
    sender: t.identity().index('btree'),
    recipient: t.identity().index('btree'),
    subjectId: t.u64(),
    postTitle: t.string(),
    postTopic: t.string(),
    postKind: t.string(),
    message: t.string(),
    status: t.string(),
    conversationId: t.u64().optional(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    closedBy: t.identity().optional(),
    closeReason: t.string().optional(),
  },
);

/** Tablas complementarias: una actualización conserva filas y firmas del módulo anterior. */
const assignmentDetail = table({ name: 'assignment_detail' }, {
  assignmentId: t.u64().primaryKey(), topic: t.string(),
});
const personalProgress = table({ name: 'personal_progress' }, {
  key: t.string().primaryKey(), owner: t.identity().index('btree'),
  targetKind: t.string(), targetId: t.u64(), status: t.string(), updatedAt: t.timestamp(),
});
const workDetail = table({ name: 'work_detail' }, {
  workId: t.u64().primaryKey(), topic: t.string(), status: t.string(), updatedBy: t.identity(),
});
const workRevision = table({ name: 'work_revision' }, {
  id: t.u64().primaryKey().autoInc(), workId: t.u64().index('btree'), version: t.u32(),
  title: t.string(), description: t.string(), topic: t.string(), status: t.string(),
  authors: t.array(t.identity()), attachmentIds: t.array(t.string()),
  editedBy: t.identity(), editedAt: t.timestamp(), restoredFrom: t.u32().optional(),
});
const workReview = table({ name: 'work_review' }, {
  id: t.u64().primaryKey().autoInc(), workId: t.u64().index('btree'), version: t.u32(),
  reviewer: t.identity(), comment: t.string(), createdAt: t.timestamp(),
});
const academicComment = table({ name: 'academic_comment' }, {
  id: t.u64().primaryKey().autoInc(), targetKind: t.string(), targetId: t.u64().index('btree'),
  author: t.identity(), text: t.string(), createdAt: t.timestamp(),
});
const evidenceDetail = table({ name: 'evidence_detail' }, {
  evidenceId: t.u64().primaryKey(), version: t.u32(), updatedBy: t.identity(), updatedAt: t.timestamp(),
});
const activityLink = table({ name: 'activity_link' }, {
  id: t.u64().primaryKey().autoInc(), activityId: t.u64().index('btree'),
  targetKind: t.string(), targetId: t.u64(), createdBy: t.identity(), createdAt: t.timestamp(),
  removedAt: t.timestamp().optional(),
});
const pageSnapshot = table({ name: 'page_snapshot' }, {
  id: t.u64().primaryKey().autoInc(), page: t.string(), pageId: t.u64().index('btree'),
  version: t.u32(), subjectId: t.u64(), termId: t.u64().optional(), kind: t.string(),
  topic: t.string(), date: t.string(), title: t.string(), summary: t.string(), body: t.string(),
  dueDate: t.string(), attachmentIds: t.array(t.string()), assignmentIds: t.array(t.u64()),
  noteIds: t.array(t.u64()), editedBy: t.identity(), editedAt: t.timestamp(),
  restoredFrom: t.u32().optional(),
});
/** El objeto es inmutable; quitarlo de la versión actual no borra su copia histórica. */
const resourceFile = table({ name: 'resource_file' }, {
  id: t.string().primaryKey(), targetKind: t.string(), targetId: t.u64().index('btree'),
  name: t.string(), size: t.u64(), contentType: t.string(), storageKey: t.string(), etag: t.string(),
  uploadedBy: t.identity(), createdAt: t.timestamp(), removedAt: t.timestamp().optional(),
});
const fileUploadIntent = table({ name: 'file_upload_intent' }, {
  id: t.string().primaryKey(), actor: t.identity(), targetKind: t.string(), targetId: t.u64(),
  expectedVersion: t.u32(), createdAt: t.timestamp(), expiresAt: t.timestamp(),
});
const fileServiceConfig = table({ name: 'file_service_config' }, {
  id: t.u32().primaryKey(), identity: t.identity(),
});
const academicMigration = table({ name: 'academic_migration' }, {
  id: t.u32().primaryKey(), completedAt: t.timestamp(),
});

/** Contenido personal o del grupo; el progreso de aprendizaje nunca se comparte. */
const spacedCollection = table({ name: 'spaced_collection' }, {
  id: t.u64().primaryKey().autoInc(), subjectId: t.u64().index('btree'), termId: t.u64().optional(),
  title: t.string(), visibility: t.string(), ownerId: t.identity(), version: t.u32(), archived: t.bool(),
  createdAt: t.timestamp(), updatedAt: t.timestamp(), updatedBy: t.identity(),
});
const spacedCard = table({ name: 'spaced_card' }, {
  id: t.u64().primaryKey().autoInc(), collectionId: t.u64().index('btree'),
  question: t.string(), explanation: t.string(), hint: t.string(), sourceKind: t.string(),
  sourceId: t.u64(), sourceVersion: t.u32(), version: t.u32(), archived: t.bool(),
  createdBy: t.identity(), updatedBy: t.identity(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
const spacedEnrollment = table({ name: 'spaced_enrollment' }, {
  key: t.string().primaryKey(), memberId: t.identity().index('btree'),
  collectionId: t.u64(), active: t.bool(), updatedAt: t.timestamp(),
});
const spacedProgress = table({ name: 'spaced_progress' }, {
  key: t.string().primaryKey(), memberId: t.identity().index('btree'), cardId: t.u64().index('btree'),
  cardVersion: t.u32(), step: t.u32(), revision: t.u32(), dueAt: t.timestamp(), reviewedAt: t.timestamp(),
});
/** La clave incluye al alumno: un reintento exacto nunca duplica la programación. */
const spacedReview = table({ name: 'spaced_review' }, {
  id: t.string().primaryKey(), requestId: t.string(), memberId: t.identity().index('btree'),
  cardId: t.u64(), cardVersion: t.u32(), expectedRevision: t.u32(), rating: t.string(), step: t.u32(),
  reviewedAt: t.timestamp(), dueAt: t.timestamp(),
});

/** Exposiciones: los borradores y las autoobservaciones permanecen siempre privados. */
const presentationConfiguration = {
  title: t.string(), topic: t.string(), audience: t.string(), targetMinutes: t.u32(), keyPoints: t.array(t.string()),
};
const presentationSource = {
  sourceKind: t.string().optional(), sourceId: t.u64().optional(), sourceVersion: t.u32().optional(),
};
const presentationPractice = table({ name: 'presentation_practice' }, {
  id: t.u64().primaryKey().autoInc(), ownerId: t.identity().index('btree'), subjectId: t.u64(),
  termId: t.u64().optional(), reviewerId: t.identity().optional(), ...presentationConfiguration, ...presentationSource,
  archived: t.bool(), version: t.u32(), requestId: t.string(), creationHash: t.string(),
  createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
const presentationAttempt = table({ name: 'presentation_attempt' }, {
  id: t.u64().primaryKey().autoInc(), practiceId: t.u64().index('btree'), number: t.u32(),
  subjectId: t.u64(), termId: t.u64().optional(), ...presentationConfiguration, ...presentationSource,
  status: t.string(), body: t.string(), version: t.u32(), requestId: t.string(), creationVersion: t.u32(),
  createdAt: t.timestamp(), updatedAt: t.timestamp(), completedAt: t.timestamp().optional(),
});
const presentationPersonal = table({ name: 'presentation_personal' }, {
  attemptId: t.u64().primaryKey(), clarity: t.string(), examples: t.string(), decisions: t.string(), limitations: t.string(), nextSteps: t.string(),
});
const presentationQuestion = table({ name: 'presentation_question' }, {
  id: t.u64().primaryKey().autoInc(), attemptId: t.u64().index('btree'), authorId: t.identity(),
  kind: t.string(), text: t.string(), answer: t.string(), version: t.u32(), requestId: t.string(),
  createdAt: t.timestamp(), answeredAt: t.timestamp().optional(),
});
const presentationFeedback = table({ name: 'presentation_feedback_entry' }, {
  id: t.u64().primaryKey().autoInc(), attemptId: t.u64().index('btree'), authorId: t.identity(),
  clarity: t.string(), examples: t.string(), decisions: t.string(), limitations: t.string(), comment: t.string(),
  version: t.u32(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});

/** Binarios privados: nunca forman parte de una vista o suscripción del cliente. */
const resourceUpload = table({ name: 'resource_upload' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'),
  targetKind: t.string(), targetId: t.u64(), expectedVersion: t.u32(),
  name: t.string(), mime: t.string(), bytes: t.u64(), sha256: t.string(),
  chunkCount: t.u32(), state: t.string(), createdAt: t.timestamp(), expiresAt: t.timestamp(),
});
const resourceChunk = table({ name: 'resource_chunk' }, {
  id: t.string().primaryKey(), uploadId: t.string().index('btree'),
  index: t.u32(), bytes: t.byteArray(), sha256: t.string(),
});
const resourceCapacity = table({ name: 'resource_capacity' }, {
  id: t.u32().primaryKey(), limitBytes: t.u64(), reservedBytes: t.u64(),
});
const resourceExpiry = table({ name: 'resource_expiry' }, {
  id: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), uploadId: t.string(),
});

const spacetimedb = schema({
  presentationPractice, presentationAttempt, presentationPersonal, presentationQuestion, presentationFeedback,
  ...delivery2Tables,
  ...roomsTables,
  resourceUpload, resourceChunk, resourceCapacity, resourceExpiry,
  spacedCollection, spacedCard, spacedEnrollment, spacedProgress, spacedReview,
  assignmentDetail, personalProgress, workDetail, workRevision, workReview, academicComment,
  evidenceDetail, activityLink, pageSnapshot, resourceFile, fileUploadIntent, fileServiceConfig,
  academicMigration,
  appConfig,
  authConfig,
  invitation,
  member,
  subject,
  term,
  termDates,
  assignment,
  pageRevision,
  work,
  workAuthor,
  workFile,
  groupMessage,
  directConversation,
  directMessage,
  messageReaction,
  stickerPack,
  sticker,
  chatCommand,
  birthday,
  changeLog,
  activity,
  evidence,
  note,
  noteComment,
  question,
  answer,
  poll,
  pollVote,
  lastSeen,
  studyGuide,
  guideSource,
  guideReview,
  teachingPractice,
  teachingPersonal,
  teachingQuestion,
  helpPost,
  helpContactRequest,
}, {
  // Solo quien puede publicar el módulo controla este valor. Permite adoptar una DB vacía
  // existente, cuyo init anterior no creó app_config, sin entregar el control al primer cliente.
  env: {
    B20_BOOTSTRAP_OWNER_IDENTITY: t.string().optional(),
    B20_FILE_SERVICE_IDENTITY: t.string().optional(),
  },
});
export default spacetimedb;

export type Ctx = ReducerCtx<typeof spacetimedb.schemaType>;
configureModuleHelpers({ activeMember, attachmentIds, expectVersion, isActive, log, messageText, readableMessage, requireGuide, requireSubject, requireText, restoreAttachments, sourceVersion, targetVersion, saveTargetBaseline, bumpMaterial });

// ---------------------------------------------------------------------------
// Utilidades de permisos
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 4000;
/** 50 MB por archivo. Debe coincidir con `MAX_FILE_BYTES` de `@b20/core`. */
const MAX_FILE_BYTES = 50n * 1024n * 1024n;
/** Deben coincidir con `WORK_KINDS`, `PERIOD_COUNT` y `TERMS_PER_PERIOD` de `@b20/core`. */
const WORK_KINDS = ['tarea', 'actividad', 'exposicion', 'examen'];
const PERIOD_COUNT = 9;
const TERMS_PER_PERIOD = 3;

function requireWorkKind(kind: string): string {
  if (!WORK_KINDS.includes(kind)) throw new SenderError('El tipo de trabajo no existe.');
  return kind;
}

function requirePeriod(period: number): number {
  if (!Number.isInteger(period) || period < 1 || period > PERIOD_COUNT) {
    throw new SenderError('El cuatrimestre no existe.');
  }
  return period;
}
/** SpacetimeDB comprueba la firma; el módulo restringe además emisor y clientes de B20. */
function trustedSession(ctx: Ctx) {
  const jwt = ctx.senderAuth.jwt;
  if (!jwt) throw new SenderError('Inicia sesión con SpacetimeAuth para acceder al grupo.');
  const config = ctx.db.authConfig.id.find(0);
  if (!config || !config.audiences.length) {
    throw new SenderError('El acceso con SpacetimeAuth todavía no está configurado.');
  }
  if (jwt.issuer !== config.issuer) throw new SenderError('Emisor de sesión no permitido.');
  if (!jwt.audience.some((aud) => config.audiences.includes(aud))) {
    throw new SenderError('Sesión emitida para otra aplicación.');
  }
  return jwt;
}

function activeMember(ctx: Ctx) {
  // Cada operación vuelve a validar sesión y membresía; conectar no concede acceso a datos.
  verifiedEmail(ctx);
  const row = ctx.db.member.identity.find(ctx.sender);
  if (!row || row.status !== 'active') throw new SenderError('No eres miembro activo del grupo.');
  return row;
}

function isOwner(ctx: Ctx): boolean {
  const config = ctx.db.appConfig.id.find(0);
  if (config) return config.owner.isEqual(ctx.sender);
  const configuredOwner = ctx.env.B20_BOOTSTRAP_OWNER_IDENTITY?.trim().replace(/^0x/i, '').toLowerCase();
  if (!configuredOwner || !/^[0-9a-f]{64}$/.test(configuredOwner)) return false;
  return ctx.sender.toHexString().replace(/^0x/i, '').toLowerCase() === configuredOwner;
}

function requireCreator(ctx: Ctx) {
  if (isOwner(ctx)) return;
  const row = activeMember(ctx);
  if (!row.isCreator) throw new SenderError('Solo los creadores de la app pueden hacer esto.');
}

function requireText(value: string, field: string, max = MAX_MESSAGE_LENGTH): string {
  const trimmed = value.trim();
  if (!trimmed) throw new SenderError(`${field} no puede estar vacío.`);
  if (trimmed.length > max) throw new SenderError(`${field} excede ${max} caracteres.`);
  return trimmed;
}

function log(ctx: Ctx, action: string, entity: string, entityId: string | bigint) {
  ctx.db.changeLog.insert({
    id: 0n,
    actor: ctx.sender,
    action,
    entity,
    entityId: entityId.toString(),
    at: ctx.timestamp,
  });
}

/** Correo verificado del ID token OIDC de SpacetimeAuth, nunca del formulario del cliente. */
function verifiedEmail(ctx: Ctx): string {
  const jwt = trustedSession(ctx);
  const { email, email_verified: emailVerified } = jwt.fullPayload;
  if (typeof email !== 'string' || !email.trim() || emailVerified !== true) {
    throw new SenderError('Tu cuenta no tiene un correo verificado.');
  }
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

/** Al publicar por primera vez, quien publica queda como creador inicial. */
export const init = spacetimedb.init((ctx) => {
  ctx.db.appConfig.insert({ id: 0, owner: ctx.sender });
});

/**
 * El propietario puede configurar/invitar desde la CLI. Los demás necesitan un ID token
 * emitido para un cliente autorizado; una sesión todavía no concede la membresía.
 */
export const on_connect = spacetimedb.clientConnected((ctx) => {
  // HTTP /call también ejecuta el ciclo de conexión. La identidad técnica solo llega a los
  // handlers que la aceptan expresamente; no adquiere membresía ni puede leer vistas del grupo.
  if (isOwner(ctx) || isFileService(ctx)) return;
  verifiedEmail(ctx);
});

/** Los client IDs no son secretos. Una tabla nueva conserva app_config y datos existentes. */
export const set_auth_config = spacetimedb.reducer(
  { issuer: t.string(), audiences: t.array(t.string()) },
  (ctx, { issuer, audiences }) => {
    requireCreator(ctx);
    const normalizedIssuer = issuer.trim();
    // El módulo usa SpacetimeAuth; no permite configurar accidentalmente Google directo.
    if (normalizedIssuer !== 'https://auth.spacetimedb.com/oidc') {
      throw new SenderError('Usa el emisor de SpacetimeAuth: https://auth.spacetimedb.com/oidc');
    }
    const normalizedAudiences = [...new Set(audiences.map((value) => value.trim()))];
    if (!normalizedAudiences.length || normalizedAudiences.length > 10 ||
        normalizedAudiences.some((value) => !value || /\s/.test(value) || value.length > 200)) {
      throw new SenderError('Configura de 1 a 10 client IDs válidos de SpacetimeAuth.');
    }
    // En una actualización init no vuelve a correr. Solo la identidad fijada por el deployer
    // puede completar esta fila; una fila existente nunca se sustituye por el entorno.
    if (!ctx.db.appConfig.id.find(0) && isOwner(ctx)) {
      ctx.db.appConfig.insert({ id: 0, owner: ctx.sender });
    }
    const config = { id: 0, issuer: normalizedIssuer, audiences: normalizedAudiences };
    if (ctx.db.authConfig.id.find(0)) ctx.db.authConfig.id.update(config);
    else ctx.db.authConfig.insert(config);
    log(ctx, 'update', 'auth_config', '0');
  },
);

/** La API llama este reducer con el token del usuario, sin exponer tablas privadas. */
export const assert_active_member = spacetimedb.reducer((ctx) => {
  activeMember(ctx);
});

// ---------------------------------------------------------------------------
// Membresía
// ---------------------------------------------------------------------------

export const invite_member = spacetimedb.reducer(
  { email: t.string(), isCreator: t.bool() },
  (ctx, { email, isCreator }) => {
    requireCreator(ctx);
    const normalized = requireText(email, 'El correo', 320).toLowerCase();
    if (ctx.db.invitation.email.find(normalized)) return;
    ctx.db.invitation.insert({
      email: normalized,
      isCreator,
      invitedBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
    log(ctx, 'invite', 'invitation', normalized);
  },
);

export const join_group = spacetimedb.reducer(
  { displayName: t.string() },
  (ctx, { displayName }) => {
    const email = verifiedEmail(ctx);
    const invite = ctx.db.invitation.email.find(email);
    if (!invite) throw new SenderError('Tu correo no está en la lista autorizada del grupo.');
    const existing = ctx.db.member.identity.find(ctx.sender);
    if (existing?.status === 'removed') throw new SenderError('Tu acceso fue dado de baja.');
    if (existing) return;
    ctx.db.member.insert({
      identity: ctx.sender,
      displayName: requireText(displayName, 'El nombre', 80),
      photoUrl: undefined,
      status: 'active',
      isCreator: invite.isCreator,
      joinedAt: ctx.timestamp,
    });
    log(ctx, 'join', 'member', ctx.sender.toHexString());
  },
);

/** Retira la invitación de alguien que todavía no se une; quien ya es miembro se da de baja aparte. */
export const revoke_invitation = spacetimedb.reducer({ email: t.string() }, (ctx, { email }) => {
  requireCreator(ctx);
  const normalized = email.trim().toLowerCase();
  if (!ctx.db.invitation.email.find(normalized)) return;
  ctx.db.invitation.email.delete(normalized);
  log(ctx, 'revoke', 'invitation', normalized);
});

export const remove_member = spacetimedb.reducer(
  { identity: t.identity() },
  (ctx, { identity }) => {
    requireCreator(ctx);
    if (identity.isEqual(ctx.sender)) throw new SenderError('No puedes darte de baja a ti mismo.');
    const row = ctx.db.member.identity.find(identity);
    if (!row) throw new SenderError('Ese miembro no existe.');
    ctx.db.member.identity.update({ ...row, status: 'removed' });
    rooms.removeGroupMember(ctx, identity);
    log(ctx, 'remove', 'member', identity.toHexString());
  },
);

export const update_profile = spacetimedb.reducer(
  { displayName: t.string(), photoUrl: t.string().optional() },
  (ctx, { displayName, photoUrl }) => {
    const row = activeMember(ctx);
    ctx.db.member.identity.update({
      ...row,
      displayName: requireText(displayName, 'El nombre', 80),
      photoUrl,
    });
  },
);

// ---------------------------------------------------------------------------
// Materias, parciales y trabajos
// ---------------------------------------------------------------------------

export const create_subject = spacetimedb.reducer(
  { name: t.string(), period: t.u32() },
  (ctx, { name, period }) => {
    activeMember(ctx);
    const row = ctx.db.subject.insert({
      id: 0n,
      code: '',
      name: requireText(name, 'El nombre de la materia', 120),
      period: requirePeriod(period),
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
    log(ctx, 'create', 'subject', row.id);
  },
);

/**
 * Carga el plan de estudios (`CURRICULUM` de `@b20/core`): las tres listas van en paralelo,
 * una posición por materia. Cada materia nueva recibe sus tres parciales; las que ya existen
 * (misma clave) se dejan como están, así que se puede ejecutar más de una vez.
 */
export const import_curriculum = spacetimedb.reducer(
  { codes: t.array(t.string()), names: t.array(t.string()), periods: t.array(t.u32()) },
  (ctx, { codes, names, periods }) => {
    requireCreator(ctx);
    if (codes.length !== names.length || codes.length !== periods.length) {
      throw new SenderError('Las listas del plan de estudios no coinciden.');
    }
    const existing = new Set([...ctx.db.subject.iter()].map((s) => s.code));
    codes.forEach((rawCode, i) => {
      const code = requireText(rawCode, 'La clave de la materia', 40);
      if (existing.has(code)) return;
      existing.add(code);
      const row = ctx.db.subject.insert({
        id: 0n,
        code,
        name: requireText(names[i], 'El nombre de la materia', 120),
        period: requirePeriod(periods[i]),
        createdBy: ctx.sender,
        createdAt: ctx.timestamp,
      });
      for (let position = 1; position <= TERMS_PER_PERIOD; position++) {
        ctx.db.term.insert({ id: 0n, subjectId: row.id, name: `Parcial ${position}`, position });
      }
      log(ctx, 'create', 'subject', row.id);
    });
  },
);

export const create_term = spacetimedb.reducer(
  { subjectId: t.u64(), name: t.string(), position: t.u32() },
  (ctx, { subjectId, name, position }) => {
    activeMember(ctx);
    if (!ctx.db.subject.id.find(subjectId)) throw new SenderError('La materia no existe.');
    const row = ctx.db.term.insert({
      id: 0n,
      subjectId,
      name: requireText(name, 'El nombre del parcial', 120),
      position,
    });
    log(ctx, 'create', 'term', row.id);
  },
);

function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [year, month, date] = day.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  return parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === date;
}

/**
 * Fija las fechas de los parciales de un cuatrimestre: una posición por parcial, con las dos
 * fechas vacías para dejarlo sin configurar. Reemplaza lo que ese cuatrimestre tuviera. Aplica
 * las mismas reglas que `buildPeriodCalendar` de `@b20/core`: fechas reales y en orden, sin
 * encimarse entre parciales ni con otro cuatrimestre.
 */
export const save_calendar = spacetimedb.reducer(
  { period: t.u32(), startDates: t.array(t.string()), endDates: t.array(t.string()) },
  (ctx, { period, startDates, endDates }) => {
    requireCreator(ctx);
    requirePeriod(period);
    if (startDates.length !== TERMS_PER_PERIOD || endDates.length !== TERMS_PER_PERIOD) {
      throw new SenderError(`Cada cuatrimestre tiene ${TERMS_PER_PERIOD} parciales.`);
    }
    const others = [...ctx.db.termDates.iter()].filter((row) => row.period !== period);
    const entries: { term: number; startDate: string; endDate: string }[] = [];
    for (let index = 0; index < TERMS_PER_PERIOD; index++) {
      const term = index + 1;
      const startDate = startDates[index];
      const endDate = endDates[index];
      if (!startDate && !endDate) continue;
      if (!isRealDay(startDate) || !isRealDay(endDate)) {
        throw new SenderError(`Al parcial ${term} le falta la fecha de inicio o la de fin.`);
      }
      if (startDate > endDate) {
        throw new SenderError(`El parcial ${term} no puede terminar antes de empezar.`);
      }
      const previous = entries[entries.length - 1];
      if (previous && previous.endDate >= startDate) {
        throw new SenderError(
          `El parcial ${term} debe empezar después de que termine el parcial ${previous.term}.`,
        );
      }
      const clash = others.find((row) => startDate <= row.endDate && row.startDate <= endDate);
      if (clash) {
        throw new SenderError(
          `El parcial ${term} se encima con el parcial ${clash.term} del cuatrimestre ${clash.period}.`,
        );
      }
      entries.push({ term, startDate, endDate });
    }
    for (const row of [...ctx.db.termDates.period.filter(period)]) ctx.db.termDates.id.delete(row.id);
    for (const entry of entries) {
      ctx.db.termDates.insert({ id: 0n, period, ...entry, updatedBy: ctx.sender, updatedAt: ctx.timestamp });
    }
    log(ctx, 'update', 'calendar', BigInt(period));
  },
);

function saveRevision(
  ctx: Ctx,
  page: 'assignment' | 'activity',
  pageId: bigint,
  version: number,
  content: { title: string; summary: string; body: string; dueDate?: string },
  actor: Ctx['sender'] = ctx.sender,
) {
  ctx.db.pageRevision.insert({
    id: 0n,
    page,
    pageId,
    version,
    editedBy: actor,
    editedAt: ctx.timestamp,
    ...content,
    dueDate: content.dueDate,
  });
  savePageSnapshot(ctx, page, pageId, actor);
}

const ASSIGNMENT_ARGS = {
  subjectId: t.u64(),
  termId: t.u64().optional(),
  kind: t.string(),
  title: t.string(),
  instructions: t.string(),
  dueDate: t.string(),
};

function checkAssignment(
  ctx: Ctx,
  input: { subjectId: bigint; termId?: bigint; kind: string; title: string; instructions: string; dueDate: string },
) {
  if (!ctx.db.subject.id.find(input.subjectId)) throw new SenderError('La materia no existe.');
  if (input.termId !== undefined) {
    const termRow = ctx.db.term.id.find(input.termId);
    if (!termRow || termRow.subjectId !== input.subjectId) {
      throw new SenderError('El parcial no pertenece a esa materia.');
    }
  }
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    throw new SenderError('Fecha de entrega inválida.');
  }
  return {
    subjectId: input.subjectId,
    termId: input.termId,
    kind: requireWorkKind(input.kind),
    title: requireText(input.title, 'El título', 200),
    instructions: input.instructions.trim(),
    dueDate: input.dueDate,
  };
}

export const create_assignment = spacetimedb.reducer(ASSIGNMENT_ARGS, (ctx, input) => {
  activeMember(ctx);
  const row = ctx.db.assignment.insert({
    id: 0n,
    ...checkAssignment(ctx, input),
    version: 1,
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
    updatedBy: ctx.sender,
    updatedAt: ctx.timestamp,
  });
  saveRevision(ctx, 'assignment', row.id, 1, {
    title: row.title,
    summary: '',
    body: row.instructions,
    dueDate: row.dueDate,
  });
  log(ctx, 'create', 'assignment', row.id);
});

/** Edición wiki con permiso y versión comprobados por la operación v2. */
function updateAssignmentContent(ctx: Ctx, assignmentId: bigint, input: Parameters<typeof checkAssignment>[1]) {
  activeMember(ctx);
  const row = ctx.db.assignment.id.find(assignmentId);
  if (!row) throw new SenderError('La tarea no existe.');
  savePageSnapshot(ctx, 'assignment', assignmentId);
  const next = {
    ...row,
    ...checkAssignment(ctx, input),
    version: row.version + 1,
    updatedBy: ctx.sender,
    updatedAt: ctx.timestamp,
  };
  ctx.db.assignment.id.update(next);
  saveRevision(ctx, 'assignment', assignmentId, next.version, {
    title: next.title,
    summary: '',
    body: next.instructions,
    dueDate: next.dueDate,
  });
  log(ctx, 'update', 'assignment', assignmentId);
}

/** Conserva la firma para clientes anteriores, sin permitir una escritura sin versión. */
export const update_assignment = spacetimedb.reducer(
  { assignmentId: t.u64(), ...ASSIGNMENT_ARGS },
  (ctx) => {
    activeMember(ctx);
    throw new SenderError('Esta versión de la app no comprueba ediciones simultáneas. Actualiza la página antes de volver a editar la tarea.');
  },
);

export const publish_work = spacetimedb.reducer(
  {
    assignmentId: t.u64(),
    title: t.string(),
    description: t.string(),
    coauthors: t.array(t.identity()),
  },
  (ctx, { assignmentId, title, description, coauthors }) => {
    activeMember(ctx);
    if (!ctx.db.assignment.id.find(assignmentId)) throw new SenderError('La tarea no existe.');
    if (title.trim().length > 200) throw new SenderError('El título excede 200 caracteres.');
    const authors = new Map([[ctx.sender.toHexString(), ctx.sender]]);
    for (const coauthor of coauthors) {
      const row = ctx.db.member.identity.find(coauthor);
      if (!row || row.status !== 'active') throw new SenderError('Un coautor no es miembro activo.');
      authors.set(coauthor.toHexString(), coauthor);
    }
    const row = ctx.db.work.insert({
      id: 0n,
      assignmentId,
      title: title.trim(),
      description: description.trim(),
      version: 1,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
    for (const author of authors.values()) {
      ctx.db.workAuthor.insert({ id: 0n, workId: row.id, author });
    }
    saveWorkSnapshot(ctx, row.id);
    log(ctx, 'publish', 'work', row.id);
  },
);

export const update_work = spacetimedb.reducer(
  { workId: t.u64(), title: t.string(), description: t.string() },
  (ctx) => {
    activeMember(ctx);
    throw new SenderError('Esta versión de la app no comprueba ediciones simultáneas. Actualiza la página antes de volver a editar el trabajo.');
  },
);

function requireWorkAuthor(ctx: Ctx, workId: bigint, action: string) {
  if (!ctx.db.work.id.find(workId)) throw new SenderError('El trabajo no existe.');
  const isAuthor = [...ctx.db.workAuthor.workId.filter(workId)].some((a) =>
    a.author.isEqual(ctx.sender),
  );
  if (!isAuthor) throw new SenderError(`Solo el autor o los coautores ${action} de este trabajo.`);
}

/**
 * Registra un archivo ya subido al almacenamiento. El tamaño se valida aquí para que el
 * límite no dependa de la interfaz; el almacenamiento debe rechazar además las subidas que
 * lo excedan (el backend firma cada subida con ese tope).
 */
export const attach_work_file = spacetimedb.reducer(
  {
    workId: t.u64(),
    name: t.string(),
    size: t.u64(),
    contentType: t.string(),
    storageKey: t.string(),
  },
  (ctx, { workId, name, size, contentType, storageKey }) => {
    activeMember(ctx);
    requireWorkAuthor(ctx, workId, 'adjuntan archivos');
    // Una clave escrita por el cliente no demuestra que el objeto exista ni que sea suyo.
    void name; void size; void contentType; void storageKey;
    throw new SenderError('Sube el archivo mediante el servicio de archivos verificados.');
  },
);

export const remove_work_file = spacetimedb.reducer({ fileId: t.u64() }, (ctx) => {
  activeMember(ctx);
  throw new SenderError('Esta versión de la app no comprueba ediciones simultáneas. Actualiza la página antes de volver a retirar el archivo.');
});

// ---------------------------------------------------------------------------
// Mensajería
// ---------------------------------------------------------------------------

/** Deben coincidir con `REACTIONS`, `EDIT_WINDOW_MS` y los límites de stickers de `@b20/core`. */
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EDIT_WINDOW_MICROS = 15n * 60n * 1_000_000n;
const MAX_STICKERS_PER_PACK = 30;
const MAX_STICKER_BYTES = 1024n * 1024n;
const STICKER_TYPES = ['image/webp', 'image/png', 'image/gif', 'image/jpeg'];
const BUILT_IN_COMMANDS = [
  'tarea',
  'trabajo',
  'clase',
  'nota',
  'pregunta',
  'sticker',
  'codigo',
  'comandos',
];
const STICKER_TOKEN = /\[\[sticker:(\d{1,20})\]\]/g;

/**
 * Texto de un mensaje nuevo o editado. Cada sticker citado debe ser del paquete propio o de
 * uno compartido; al usarlo queda marcado para que siga viéndose en la conversación.
 */
function messageText(ctx: Ctx, text: string): string {
  const clean = requireText(text, 'El mensaje');
  for (const match of clean.matchAll(STICKER_TOKEN)) {
    const row = ctx.db.sticker.id.find(BigInt(match[1] ?? '0'));
    const pack = row ? ctx.db.stickerPack.id.find(row.packId) : null;
    if (!row || !pack || (!pack.shared && !pack.owner.isEqual(ctx.sender))) {
      throw new SenderError('Ese sticker no está disponible.');
    }
    if (!row.used) ctx.db.sticker.id.update({ ...row, used: true });
  }
  return clean;
}

function requireConversation(ctx: Ctx, conversationId: bigint) {
  const conversation = ctx.db.directConversation.id.find(conversationId);
  if (
    !conversation ||
    (!conversation.userA.isEqual(ctx.sender) && !conversation.userB.isEqual(ctx.sender))
  ) {
    throw new SenderError('No participas en esa conversación.');
  }
  return conversation;
}

export const send_group_message = spacetimedb.reducer(
  { text: t.string(), replyToId: t.u64().optional() },
  (ctx, { text, replyToId }) => {
    activeMember(ctx);
    delivery2.validateMentions(ctx, text);
    if (replyToId !== undefined) {
      const target = ctx.db.groupMessage.id.find(replyToId);
      if (!target || target.deletedAt)
        throw new SenderError('El mensaje al que respondes ya no está.');
    }
    ctx.db.groupMessage.insert({
      id: 0n,
      sender: ctx.sender,
      text: messageText(ctx, text),
      sentAt: ctx.timestamp,
      replyToId,
      editedAt: undefined,
      deletedAt: undefined,
      deletedBy: undefined,
    });
  },
);

/** Un mensaje que el remitente puede leer, del canal o de uno de sus 1 a 1. */
function readableMessage(ctx: Ctx, scope: string, messageId: bigint) {
  if (scope === 'group') {
    const row = ctx.db.groupMessage.id.find(messageId);
    if (row) return { scope, row } as const;
  } else if (scope === 'direct') {
    const row = ctx.db.directMessage.id.find(messageId);
    if (row) {
      requireConversation(ctx, row.conversationId);
      return { scope, row } as const;
    }
  } else if (scope === 'channel') {
    const row = ctx.db.channelMessage.id.find(messageId);
    if (row) { delivery2.channel(ctx, row.channelId); return { scope, row } as const; }
  }
  throw new SenderError('El mensaje no existe o no participas en esa conversación.');
}

export const edit_message = spacetimedb.reducer(
  { scope: t.string(), messageId: t.u64(), text: t.string() },
  (ctx, { scope, messageId, text }) => {
    activeMember(ctx);
    const found = readableMessage(ctx, scope, messageId);
    const { row } = found;
    if (!row.sender.isEqual(ctx.sender)) throw new SenderError('Solo puedes editar tus mensajes.');
    if (
      row.deletedAt ||
      ctx.timestamp.microsSinceUnixEpoch - row.sentAt.microsSinceUnixEpoch > EDIT_WINDOW_MICROS
    ) {
      throw new SenderError('Ya no se puede editar: pasaron más de 15 minutos o se eliminó.');
    }
    const clean = messageText(ctx, text);
    delivery2.validateMentions(ctx, text, found.scope === 'direct'
      ? [ctx.db.directConversation.id.find(found.row.conversationId)!.userA, ctx.db.directConversation.id.find(found.row.conversationId)!.userB] : undefined);
    if (found.scope === 'group') {
      ctx.db.groupMessage.id.update({ ...found.row, text: clean, editedAt: ctx.timestamp });
    } else if (found.scope === 'channel') {
      delivery2.channel(ctx, found.row.channelId, true);
      ctx.db.channelMessage.id.update({ ...found.row, text: clean, editedAt: ctx.timestamp });
    } else {
      ctx.db.directMessage.id.update({ ...found.row, text: clean, editedAt: ctx.timestamp });
    }
  },
);

/**
 * Elimina para todos: queda el hueco sin texto. Quien lo envió puede siempre; en el canal
 * también un creador, y eso queda en el historial. En un 1 a 1 nadie más.
 */
export const delete_message = spacetimedb.reducer(
  { scope: t.string(), messageId: t.u64() },
  (ctx, { scope, messageId }) => {
    const me = activeMember(ctx);
    const found = readableMessage(ctx, scope, messageId);
    const { row } = found;
    if (row.deletedAt) throw new SenderError('Ese mensaje ya se eliminó.');
    const own = row.sender.isEqual(ctx.sender);
    if (!own && !(found.scope !== 'direct' && me.isCreator)) {
      throw new SenderError(
        'Solo quien lo envió puede eliminarlo (en el canal, también un administrador).',
      );
    }
    const change = { text: '', deletedAt: ctx.timestamp, deletedBy: ctx.sender };
    if (found.scope === 'group') ctx.db.groupMessage.id.update({ ...found.row, ...change });
    else if (found.scope === 'channel') ctx.db.channelMessage.id.update({ ...found.row, ...change });
    else ctx.db.directMessage.id.update({ ...found.row, ...change });
    for (const reaction of [...ctx.db.messageReaction.messageId.filter(messageId)]) {
      if (reaction.scope === scope) ctx.db.messageReaction.id.delete(reaction.id);
    }
    if (!own) log(ctx, 'moderate', `${scope}_message`, messageId);
  },
);

/** Pone, cambia o quita (si es la misma) la reacción de quien llama. */
export const toggle_reaction = spacetimedb.reducer(
  { scope: t.string(), messageId: t.u64(), emoji: t.string() },
  (ctx, { scope, messageId, emoji }) => {
    activeMember(ctx);
    if (!REACTIONS.includes(emoji)) throw new SenderError('Esa reacción no está disponible.');
    const { row } = readableMessage(ctx, scope, messageId);
    if (row.deletedAt) throw new SenderError('No se puede reaccionar a un mensaje eliminado.');
    const current = [...ctx.db.messageReaction.messageId.filter(messageId)].find(
      (r) => r.scope === scope && r.member.isEqual(ctx.sender),
    );
    if (current) ctx.db.messageReaction.id.delete(current.id);
    if (current?.emoji !== emoji) {
      ctx.db.messageReaction.insert({ id: 0n, scope, messageId, member: ctx.sender, emoji });
    }
  },
);

export const create_sticker_pack = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  activeMember(ctx);
  ctx.db.stickerPack.insert({
    id: 0n,
    owner: ctx.sender,
    name: requireText(name, 'El nombre del paquete', 60),
    shared: false,
    createdAt: ctx.timestamp,
  });
});

function requireOwnPack(ctx: Ctx, packId: bigint) {
  const pack = ctx.db.stickerPack.id.find(packId);
  if (!pack) throw new SenderError('El paquete no existe.');
  if (!pack.owner.isEqual(ctx.sender))
    throw new SenderError('Solo quien importó el paquete puede cambiarlo.');
  return pack;
}

/** Registra una imagen ya subida al almacenamiento (el backend firma la subida con el tope de 1 MB). */
export const add_sticker = spacetimedb.reducer(
  {
    packId: t.u64(),
    storageKey: t.string(),
    contentType: t.string(),
    size: t.u64(),
    animated: t.bool(),
  },
  (ctx, { packId, storageKey, contentType, size, animated }) => {
    activeMember(ctx);
    requireOwnPack(ctx, packId);
    if ([...ctx.db.sticker.iter()].filter((row) => row.packId === packId).length >= MAX_STICKERS_PER_PACK) {
      throw new SenderError(`Un paquete tiene como máximo ${MAX_STICKERS_PER_PACK} stickers.`);
    }
    if (!STICKER_TYPES.includes(contentType))
      throw new SenderError('Solo imágenes WebP, PNG, GIF o JPEG.');
    if (size === 0n || size > MAX_STICKER_BYTES)
      throw new SenderError('Un sticker pesa como máximo 1 MB.');
    ctx.db.sticker.insert({
      id: 0n,
      packId,
      storageKey: requireText(storageKey, 'La ubicación del sticker', 500),
      contentType,
      size,
      animated,
      used: false,
      createdAt: ctx.timestamp,
    });
  },
);

export const set_sticker_pack_shared = spacetimedb.reducer(
  { packId: t.u64(), shared: t.bool() },
  (ctx, { packId, shared }) => {
    activeMember(ctx);
    const pack = requireOwnPack(ctx, packId);
    ctx.db.stickerPack.id.update({ ...pack, shared });
  },
);

/** Quita el paquete y sus stickers sin usar; los que ya se enviaron se quedan en sus mensajes. */
export const remove_sticker_pack = spacetimedb.reducer({ packId: t.u64() }, (ctx, { packId }) => {
  activeMember(ctx);
  requireOwnPack(ctx, packId);
  for (const row of [...ctx.db.sticker.iter()].filter((row) => row.packId === packId)) {
    if (!row.used) {
      if (row.storageKey.startsWith('native:')) nativeStickers.removeUnusedStickerBlob(ctx, row.id);
      ctx.db.sticker.id.delete(row.id);
    }
  }
  ctx.db.stickerPack.id.delete(packId);
});

function commandName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/^\/+/, '');
}

export const save_chat_command = spacetimedb.reducer(
  { id: t.u64().optional(), name: t.string(), description: t.string(), text: t.string() },
  (ctx, { id, name, description, text }) => {
    activeMember(ctx);
    const clean = commandName(name);
    if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(clean)) {
      throw new SenderError('Usa de 1 a 24 letras sin acentos, números o guiones, sin espacios.');
    }
    if (BUILT_IN_COMMANDS.includes(clean))
      throw new SenderError(`«/${clean}» ya es un comando de la app.`);
    const own = [...ctx.db.chatCommand.owner.filter(ctx.sender)];
    if (own.some((c) => c.name === clean && c.id !== id))
      throw new SenderError(`Ya tienes un comando «/${clean}».`);
    const fields = {
      name: clean,
      description: description.trim().slice(0, 80),
      text: requireText(text, 'El texto del comando', 2000),
    };
    if (id !== undefined) {
      const existing = own.find((c) => c.id === id);
      if (!existing) throw new SenderError('El comando no existe.');
      ctx.db.chatCommand.id.update({ ...existing, ...fields });
    } else {
      ctx.db.chatCommand.insert({ id: 0n, owner: ctx.sender, ...fields, createdAt: ctx.timestamp });
    }
  },
);

export const remove_chat_command = spacetimedb.reducer(
  { commandId: t.u64() },
  (ctx, { commandId }) => {
    activeMember(ctx);
    const row = ctx.db.chatCommand.id.find(commandId);
    if (!row || !row.owner.isEqual(ctx.sender)) throw new SenderError('El comando no existe.');
    ctx.db.chatCommand.id.delete(commandId);
  },
);

function orderedPair(a: Ctx['sender'], b: Ctx['sender']) {
  return a.toHexString() < b.toHexString() ? [a, b] : [b, a];
}

function findConversation(ctx: Ctx, a: Ctx['sender'], b: Ctx['sender']) {
  const [userA, userB] = orderedPair(a, b);
  for (const row of ctx.db.directConversation.userA.filter(userA)) {
    if (row.userB.isEqual(userB)) return row;
  }
  return undefined;
}

export const open_direct_conversation = spacetimedb.reducer(
  { other: t.identity() },
  (ctx, { other }) => {
    activeMember(ctx);
    if (other.isEqual(ctx.sender)) throw new SenderError('No puedes abrir una conversación contigo.');
    const otherRow = ctx.db.member.identity.find(other);
    if (!otherRow || otherRow.status !== 'active') throw new SenderError('Ese compañero no está activo.');
    delivery2.assertDirectAllowed(ctx, ctx.sender, other);
    if (findConversation(ctx, ctx.sender, other)) return;
    const [userA, userB] = orderedPair(ctx.sender, other);
    ctx.db.directConversation.insert({ id: 0n, userA, userB, createdAt: ctx.timestamp });
  },
);

export const send_direct_message = spacetimedb.reducer(
  { conversationId: t.u64(), text: t.string(), replyToId: t.u64().optional() },
  (ctx, { conversationId, text, replyToId }) => {
    activeMember(ctx);
    const conversation = requireConversation(ctx, conversationId);
    delivery2.assertDirectAllowed(ctx, ctx.sender, conversation.userA.isEqual(ctx.sender) ? conversation.userB : conversation.userA);
    delivery2.validateMentions(ctx, text, [conversation.userA, conversation.userB]);
    if (replyToId !== undefined) {
      const target = ctx.db.directMessage.id.find(replyToId);
      if (!target || target.conversationId !== conversationId || target.deletedAt) {
        throw new SenderError('El mensaje al que respondes ya no está.');
      }
    }
    ctx.db.directMessage.insert({
      id: 0n,
      conversationId,
      sender: ctx.sender,
      text: messageText(ctx, text),
      sentAt: ctx.timestamp,
      replyToId,
      editedAt: undefined,
      deletedAt: undefined,
      deletedBy: undefined,
    });
  },
);

// ---------------------------------------------------------------------------
// Cumpleaños
// ---------------------------------------------------------------------------

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const share_birthday = spacetimedb.reducer(
  { day: t.u8(), month: t.u8(), remind: t.bool() },
  (ctx, { day, month, remind }) => {
    activeMember(ctx);
    if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) {
      throw new SenderError('Fecha inválida.');
    }
    const row = { identity: ctx.sender, day, month, remind, sharedAt: ctx.timestamp };
    if (ctx.db.birthday.identity.find(ctx.sender)) ctx.db.birthday.identity.update(row);
    else ctx.db.birthday.insert(row);
  },
);

export const withdraw_birthday = spacetimedb.reducer((ctx) => {
  ctx.db.birthday.identity.delete(ctx.sender);
});

// ---------------------------------------------------------------------------
// Actividades, notas y preguntas
// ---------------------------------------------------------------------------

function requireSubject(ctx: Ctx, subjectId: bigint) {
  if (!ctx.db.subject.id.find(subjectId)) throw new SenderError('La materia no existe.');
}

const NOTE_VISIBILITY = ['personal', 'group'];
const NOTE_SOURCE = ['student', 'teacher', 'ai'];

const ACTIVITY_ARGS = {
  subjectId: t.u64(),
  termId: t.u64().optional(),
  topic: t.string(),
  date: t.string(),
  title: t.string(),
  objective: t.string(),
  instructions: t.string(),
};

function checkActivity(
  ctx: Ctx,
  input: {
    subjectId: bigint;
    termId?: bigint;
    topic: string;
    date: string;
    title: string;
    objective: string;
    instructions: string;
  },
) {
  requireSubject(ctx, input.subjectId);
  if (input.termId !== undefined) {
    const termRow = ctx.db.term.id.find(input.termId);
    if (!termRow || termRow.subjectId !== input.subjectId) {
      throw new SenderError('El parcial no pertenece a esa materia.');
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new SenderError('Fecha inválida.');
  return {
    subjectId: input.subjectId,
    termId: input.termId,
    topic: input.topic.trim(),
    date: input.date,
    title: requireText(input.title, 'El título', 200),
    objective: input.objective.trim(),
    instructions: input.instructions.trim(),
  };
}

export const create_activity = spacetimedb.reducer(ACTIVITY_ARGS, (ctx, input) => {
  activeMember(ctx);
  const row = ctx.db.activity.insert({
    id: 0n,
    ...checkActivity(ctx, input),
    version: 1,
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
    updatedBy: ctx.sender,
    updatedAt: ctx.timestamp,
  });
  saveRevision(ctx, 'activity', row.id, 1, {
    title: row.title,
    summary: row.objective,
    body: row.instructions,
  });
  log(ctx, 'create', 'activity', row.id);
});

/** Edición wiki con permiso y versión comprobados por la operación v2. */
function updateActivityContent(ctx: Ctx, activityId: bigint, input: Parameters<typeof checkActivity>[1]) {
  activeMember(ctx);
  const row = ctx.db.activity.id.find(activityId);
  if (!row) throw new SenderError('La actividad no existe.');
  savePageSnapshot(ctx, 'activity', activityId);
  const next = {
    ...row,
    ...checkActivity(ctx, input),
    version: row.version + 1,
    updatedBy: ctx.sender,
    updatedAt: ctx.timestamp,
  };
  ctx.db.activity.id.update(next);
  saveRevision(ctx, 'activity', activityId, next.version, {
    title: next.title,
    summary: next.objective,
    body: next.instructions,
  });
  log(ctx, 'update', 'activity', activityId);
}

export const update_activity = spacetimedb.reducer(
  { activityId: t.u64(), ...ACTIVITY_ARGS },
  (ctx) => {
    activeMember(ctx);
    throw new SenderError('Esta versión de la app no comprueba ediciones simultáneas. Actualiza la página antes de volver a editar la actividad.');
  },
);

export const add_evidence = spacetimedb.reducer(
  { activityId: t.u64(), content: t.string(), participants: t.array(t.identity()) },
  (ctx, { activityId, content, participants }) => {
    activeMember(ctx);
    if (!ctx.db.activity.id.find(activityId)) throw new SenderError('La actividad no existe.');
    const team = new Map([[ctx.sender.toHexString(), ctx.sender]]);
    for (const p of participants) {
      const row = ctx.db.member.identity.find(p);
      if (!row || row.status !== 'active') throw new SenderError('Un participante no es miembro activo.');
      team.set(p.toHexString(), p);
    }
    savePageSnapshot(ctx, 'activity', activityId);
    ctx.db.evidence.insert({
      id: 0n,
      activityId,
      author: ctx.sender,
      participants: [...team.values()],
      content: requireText(content, 'La evidencia', 20_000),
      createdAt: ctx.timestamp,
    });
    // Una guía cita toda la experiencia de clase, incluidas las evidencias de sus equipos.
    bumpMaterial(ctx, 'activity', activityId);
  },
);

export const save_note = spacetimedb.reducer(
  {
    noteId: t.u64().optional(),
    subjectId: t.u64(),
    topic: t.string(),
    title: t.string(),
    body: t.string(),
    tags: t.array(t.string()),
    visibility: t.string(),
    source: t.string(),
  },
  (ctx, { noteId, subjectId, topic, title, body, tags, visibility, source }) => {
    activeMember(ctx);
    if (noteId !== undefined) {
      throw new SenderError('Actualiza la aplicación para editar la nota con su versión actual.');
    }
    requireSubject(ctx, subjectId);
    if (!NOTE_VISIBILITY.includes(visibility)) throw new SenderError('Visibilidad inválida.');
    if (!NOTE_SOURCE.includes(source)) throw new SenderError('Origen inválido.');
    const fields = {
      subjectId,
      topic: topic.trim(),
      title: requireText(title, 'El título', 200),
      body: requireText(body, 'El contenido', 50_000),
      tags: [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
      visibility,
      source,
    };
    const row = ctx.db.note.insert({
      id: 0n,
      ...fields,
      author: ctx.sender,
      version: 1,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
    delivery2.captureNote(ctx, row.id, ctx.sender);
    log(ctx, 'create', 'note', row.id);
  },
);

export const comment_note = spacetimedb.reducer(
  { noteId: t.u64(), text: t.string() },
  (ctx, { noteId, text }) => {
    activeMember(ctx);
    const row = ctx.db.note.id.find(noteId);
    if (!row || delivery2.withdrawn(ctx.db, 'note', noteId) || (row.visibility !== 'group' && !row.author.isEqual(ctx.sender))) {
      throw new SenderError('La nota no existe.');
    }
    ctx.db.noteComment.insert({
      id: 0n,
      noteId,
      author: ctx.sender,
      text: requireText(text, 'El comentario'),
      createdAt: ctx.timestamp,
    });
  },
);

export const ask_question = spacetimedb.reducer(
  { subjectId: t.u64(), topic: t.string(), title: t.string(), body: t.string() },
  (ctx, { subjectId, topic, title, body }) => {
    activeMember(ctx);
    requireSubject(ctx, subjectId);
    ctx.db.question.insert({
      id: 0n,
      subjectId,
      topic: topic.trim(),
      title: requireText(title, 'La pregunta', 200),
      body: body.trim(),
      author: ctx.sender,
      status: 'open',
      acceptedAnswerId: undefined,
      resolvedAt: undefined,
      createdAt: ctx.timestamp,
    });
  },
);

export const answer_question = spacetimedb.reducer(
  { questionId: t.u64(), body: t.string() },
  (ctx, { questionId, body }) => {
    activeMember(ctx);
    if (!delivery2.canReadTarget(ctx.db, ctx.sender, 'question', questionId) || delivery2.withdrawn(ctx.db, 'question', questionId)) throw new SenderError('La pregunta no existe.');
    ctx.db.answer.insert({
      id: 0n,
      questionId,
      author: ctx.sender,
      body: requireText(body, 'La respuesta', 20_000),
      createdAt: ctx.timestamp,
    });
  },
);

function ownQuestion(ctx: Ctx, questionId: bigint) {
  activeMember(ctx);
  const row = ctx.db.question.id.find(questionId);
  if (!row || delivery2.withdrawn(ctx.db, 'question', questionId)) throw new SenderError('La pregunta no existe.');
  if (!row.author.isEqual(ctx.sender)) throw new SenderError('Solo quien preguntó puede hacer esto.');
  return row;
}

export const accept_answer = spacetimedb.reducer(
  { questionId: t.u64(), answerId: t.u64() },
  (ctx, { questionId, answerId }) => {
    const row = ctx.db.answer.id.find(answerId);
    const q = ownQuestion(ctx, questionId);
    if (!row || row.questionId !== questionId) {
      throw new SenderError('La respuesta no es de esta pregunta.');
    }
    if (delivery2.withdrawn(ctx.db, 'answer', answerId) || !delivery2.canReadTarget(ctx.db, ctx.sender, 'answer', answerId)) {
      throw new SenderError('La respuesta no está disponible.');
    }
    ctx.db.question.id.update({
      ...q,
      status: 'resolved',
      acceptedAnswerId: answerId,
      resolvedAt: ctx.timestamp,
    });
  },
);

export const reopen_question = spacetimedb.reducer({ questionId: t.u64() }, (ctx, { questionId }) => {
  const q = ownQuestion(ctx, questionId);
  ctx.db.question.id.update({ ...q, status: 'open', acceptedAnswerId: undefined, resolvedAt: undefined });
});

// ---------------------------------------------------------------------------
// Votaciones (3.8). Deben coincidir con las reglas de `packages/core/src/polls.ts`.
// ---------------------------------------------------------------------------

const MAX_POLL_OPTIONS = 10;
const MAX_POLL_OPTION_LENGTH = 120;
const MAX_POLL_NOTE_LENGTH = 2000;
const MIN_POLL_DURATION_MICROS = 10n * 60n * 1_000_000n;

const pollInput = {
  title: t.string(),
  description: t.string(),
  options: t.array(t.string()),
  multiple: t.bool(),
  allowChange: t.bool(),
  eligible: t.array(t.identity()),
  closesAt: t.timestamp(),
};

function pollContent(
  ctx: Ctx,
  input: {
    title: string;
    description: string;
    options: string[];
    multiple: boolean;
    allowChange: boolean;
    eligible: Ctx['sender'][];
    closesAt: Ctx['timestamp'];
  },
) {
  const options: string[] = [];
  for (const raw of input.options) {
    const option = raw.trim();
    if (!option) continue;
    if (option.length > MAX_POLL_OPTION_LENGTH) {
      throw new SenderError(`Cada opción debe tener a lo más ${MAX_POLL_OPTION_LENGTH} caracteres.`);
    }
    if (options.some((o) => o.toLocaleLowerCase('es') === option.toLocaleLowerCase('es'))) {
      throw new SenderError(`La opción «${option}» está repetida.`);
    }
    options.push(option);
  }
  if (options.length < 2) throw new SenderError('Escribe al menos dos opciones.');
  if (options.length > MAX_POLL_OPTIONS) {
    throw new SenderError(`Una votación admite hasta ${MAX_POLL_OPTIONS} opciones.`);
  }
  if (input.closesAt.microsSinceUnixEpoch - ctx.timestamp.microsSinceUnixEpoch < MIN_POLL_DURATION_MICROS) {
    throw new SenderError('El cierre debe ser al menos 10 minutos después de ahora.');
  }
  const eligible = input.eligible.filter(
    (id, i, all) =>
      all.findIndex((other) => other.isEqual(id)) === i &&
      ctx.db.member.identity.find(id)?.status === 'active',
  );
  if (!eligible.length) throw new SenderError('Elige al menos a un participante.');
  return {
    title: requireText(input.title, 'La pregunta', 200),
    description: input.description.trim().slice(0, 2000),
    options,
    multiple: input.multiple,
    allowChange: input.allowChange,
    eligible,
    closesAt: input.closesAt,
  };
}

function findPoll(ctx: Ctx, pollId: bigint) {
  activeMember(ctx);
  const row = ctx.db.poll.id.find(pollId);
  if (!row) throw new SenderError('La votación no existe.');
  return row;
}

/** Abierta hasta su cierre; la cancelación manda. */
function pollStatusOf(ctx: Ctx, row: { closesAt: Ctx['timestamp']; cancelledAt?: Ctx['timestamp'] }) {
  if (row.cancelledAt) return 'cancelled';
  return ctx.timestamp.microsSinceUnixEpoch < row.closesAt.microsSinceUnixEpoch ? 'open' : 'closed';
}

function ownOpenPoll(ctx: Ctx, pollId: bigint, action: string) {
  const row = findPoll(ctx, pollId);
  if (!row.createdBy.isEqual(ctx.sender)) {
    throw new SenderError(`Solo quien creó la votación puede ${action}.`);
  }
  if (pollStatusOf(ctx, row) !== 'open') throw new SenderError('La votación ya no está abierta.');
  return row;
}

export const create_poll = spacetimedb.reducer(
  { ...pollInput, restartOf: t.u64().optional() },
  (ctx, input) => {
    activeMember(ctx);
    const content = pollContent(ctx, input);
    if (input.restartOf !== undefined) {
      const previous = findPoll(ctx, input.restartOf);
      if (pollStatusOf(ctx, previous) !== 'cancelled') {
        throw new SenderError('Solo se reinicia una votación cancelada.');
      }
    }
    const row = ctx.db.poll.insert({
      id: 0n,
      ...content,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
      cancelledAt: undefined,
      cancelReason: '',
      restartOf: input.restartOf,
      decision: '',
      decidedBy: undefined,
      decidedAt: undefined,
    });
    log(ctx, 'crear', 'poll', row.id);
  },
);

export const update_poll = spacetimedb.reducer({ pollId: t.u64(), ...pollInput }, (ctx, input) => {
  const row = ownOpenPoll(ctx, input.pollId, 'editarla');
  if ([...ctx.db.pollVote.pollId.filter(row.id)].length) {
    throw new SenderError('Ya tiene votos: para cambiarla, cancélala y reiníciala.');
  }
  ctx.db.poll.id.update({ ...row, ...pollContent(ctx, input), updatedAt: ctx.timestamp });
  log(ctx, 'editar', 'poll', row.id);
});

export const cast_vote = spacetimedb.reducer(
  { pollId: t.u64(), choices: t.array(t.u32()) },
  (ctx, { pollId, choices }) => {
    const row = findPoll(ctx, pollId);
    const status = pollStatusOf(ctx, row);
    if (status === 'cancelled') throw new SenderError('La votación fue cancelada.');
    if (status === 'closed') throw new SenderError('La votación ya cerró.');
    if (!row.eligible.some((id) => id.isEqual(ctx.sender))) {
      throw new SenderError('No estás entre los participantes de esta votación.');
    }
    const key = `${pollId}:${ctx.sender.toHexString()}`;
    const previous = ctx.db.pollVote.key.find(key);
    if (previous && !row.allowChange) {
      throw new SenderError('Ya votaste y esta votación no permite cambiar el voto.');
    }
    if (!choices.length) throw new SenderError('Elige una opción.');
    if (!row.multiple && choices.length > 1) throw new SenderError('Solo puedes elegir una opción.');
    if (new Set(choices).size !== choices.length) throw new SenderError('Elegiste la misma opción dos veces.');
    if (choices.some((c) => c >= row.options.length)) throw new SenderError('La opción no existe.');
    const sorted = [...choices].sort((a, b) => a - b);
    if (previous) {
      ctx.db.pollVote.key.update({ ...previous, choices: sorted, changedAt: ctx.timestamp });
    } else {
      ctx.db.pollVote.insert({
        key,
        pollId,
        voter: ctx.sender,
        choices: sorted,
        votedAt: ctx.timestamp,
        changedAt: undefined,
      });
    }
  },
);

export const cancel_poll = spacetimedb.reducer(
  { pollId: t.u64(), reason: t.string() },
  (ctx, { pollId, reason }) => {
    const row = ownOpenPoll(ctx, pollId, 'cancelarla');
    ctx.db.poll.id.update({
      ...row,
      cancelledAt: ctx.timestamp,
      cancelReason: requireText(reason, 'La razón', MAX_POLL_NOTE_LENGTH),
    });
    log(ctx, 'cancelar', 'poll', pollId);
  },
);

export const record_poll_decision = spacetimedb.reducer(
  { pollId: t.u64(), decision: t.string() },
  (ctx, { pollId, decision }) => {
    const row = findPoll(ctx, pollId);
    if (pollStatusOf(ctx, row) !== 'closed') {
      throw new SenderError('El acuerdo se registra cuando la votación cierra.');
    }
    ctx.db.poll.id.update({
      ...row,
      decision: requireText(decision, 'El acuerdo', MAX_POLL_NOTE_LENGTH),
      decidedBy: ctx.sender,
      decidedAt: ctx.timestamp,
    });
    log(ctx, 'registrar acuerdo', 'poll', pollId);
  },
);

export const mark_seen = spacetimedb.reducer((ctx) => {
  activeMember(ctx);
  const row = { identity: ctx.sender, at: ctx.timestamp };
  if (ctx.db.lastSeen.identity.find(ctx.sender)) ctx.db.lastSeen.identity.update(row);
  else ctx.db.lastSeen.insert(row);
});

// ---------------------------------------------------------------------------
// Guías de estudio (3.5), primera versión manual
// ---------------------------------------------------------------------------

// Mismos límites que `packages/core/src/guides.ts`.
const GUIDE_SECTION_COUNT = 8;
const MAX_GUIDE_TOPICS = 40;
const MAX_GUIDE_TOPIC_LENGTH = 120;
const MAX_GUIDE_SECTION_LENGTH = 20_000;
const GUIDE_SOURCE_KINDS = ['trabajo', 'tarea', 'actividad', 'nota', 'pregunta'];

const GUIDE_ARGS = {
  subjectId: t.u64(),
  termId: t.u64().optional(),
  title: t.string(),
  topics: t.array(t.string()),
  sections: t.array(t.string()),
};

const GUIDE_SOURCE_REF = t.object('GuideSourceRef', { kind: t.string(), refId: t.u64() });

function checkGuide(
  ctx: Ctx,
  input: { subjectId: bigint; termId?: bigint; title: string; topics: string[]; sections: string[] },
) {
  requireSubject(ctx, input.subjectId);
  if (input.termId !== undefined) {
    const row = ctx.db.term.id.find(input.termId);
    if (row?.subjectId !== input.subjectId) {
      throw new SenderError('El parcial no pertenece a esa materia.');
    }
  }
  const seen = new Set<string>();
  const topics = input.topics
    .map((topic) => topic.trim())
    .filter((topic) => topic && !seen.has(topic.toLowerCase()) && seen.add(topic.toLowerCase()));
  if (!topics.length) throw new SenderError('Escribe al menos un tema del temario.');
  if (topics.length > MAX_GUIDE_TOPICS) throw new SenderError('El temario tiene demasiados temas.');
  if (topics.some((topic) => topic.length > MAX_GUIDE_TOPIC_LENGTH)) {
    throw new SenderError('Un tema del temario es demasiado largo.');
  }
  if (input.sections.length > GUIDE_SECTION_COUNT) {
    throw new SenderError('La guía tiene secciones de más.');
  }
  const sections = Array.from({ length: GUIDE_SECTION_COUNT }, (_, i) =>
    (input.sections[i] ?? '').trim(),
  );
  if (sections.some((text) => text.length > MAX_GUIDE_SECTION_LENGTH)) {
    throw new SenderError('Una sección es demasiado larga.');
  }
  return {
    subjectId: input.subjectId,
    termId: input.termId,
    title: requireText(input.title, 'El título', 200),
    topics,
    sections,
  };
}

function requireGuide(ctx: Ctx, guideId: bigint) {
  const row = ctx.db.studyGuide.id.find(guideId);
  if (!row) throw new SenderError('La guía no existe.');
  return row;
}

/** Versión actual del material citado; comprueba que exista, sea del grupo y de la materia. */
function sourceVersion(ctx: Ctx, kind: string, refId: bigint, subjectId: bigint): number {
  if (!GUIDE_SOURCE_KINDS.includes(kind)) throw new SenderError('Tipo de fuente inválido.');
  const target = ({ trabajo: 'work', tarea: 'assignment', actividad: 'activity', nota: 'note', pregunta: 'question' } as Record<string, string>)[kind];
  if (!delivery2.canReadTarget(ctx.db, ctx.sender, target, refId) || delivery2.withdrawn(ctx.db, target, refId)) {
    throw new SenderError('Una de las fuentes ya no existe o no es del grupo.');
  }
  let found: { subjectId: bigint; version: number } | undefined;
  if (kind === 'trabajo') {
    const row = ctx.db.work.id.find(refId);
    const parent = row && ctx.db.assignment.id.find(row.assignmentId);
    if (row && parent) found = { subjectId: parent.subjectId, version: row.version };
  } else if (kind === 'tarea') {
    found = ctx.db.assignment.id.find(refId) ?? undefined;
  } else if (kind === 'actividad') {
    found = ctx.db.activity.id.find(refId) ?? undefined;
  } else if (kind === 'nota') {
    // Las notas personales no se comparten, así que tampoco sirven de fuente.
    const row = ctx.db.note.id.find(refId);
    if (row?.visibility === 'group') found = row;
  } else {
    const row = ctx.db.question.id.find(refId);
    if (row) found = { subjectId: row.subjectId, version: delivery2.extraVersion(ctx, 'question', refId) };
  }
  if (!found) throw new SenderError('Una de las fuentes ya no existe o no es del grupo.');
  if (found.subjectId !== subjectId) {
    throw new SenderError('Las fuentes deben ser de la misma materia.');
  }
  return found.version;
}

function addGuideSources(
  ctx: Ctx,
  guide: { id: bigint; subjectId: bigint },
  refs: { kind: string; refId: bigint }[],
) {
  for (const ref of refs) {
    const version = sourceVersion(ctx, ref.kind, ref.refId, guide.subjectId);
    const duplicate = [...ctx.db.guideSource.guideId.filter(guide.id)].some(
      (row) => row.kind === ref.kind && row.refId === ref.refId,
    );
    if (duplicate) continue;
    ctx.db.guideSource.insert({
      id: 0n,
      guideId: guide.id,
      kind: ref.kind,
      refId: ref.refId,
      sourceVersion: version,
      status: 'pending',
      reason: 'Falta revisarla.',
      topics: [],
      addedBy: ctx.sender,
      addedAt: ctx.timestamp,
    });
  }
}

export const create_guide = spacetimedb.reducer(
  { ...GUIDE_ARGS, sources: t.array(GUIDE_SOURCE_REF) },
  (ctx, { sources, ...input }) => {
    activeMember(ctx);
    const row = ctx.db.studyGuide.insert({
      id: 0n,
      ...checkGuide(ctx, input),
      version: 1,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      updatedBy: ctx.sender,
      updatedAt: ctx.timestamp,
    });
    addGuideSources(ctx, row, sources);
    delivery2.captureGuide(ctx, row.id, ctx.sender);
    log(ctx, 'create', 'study_guide', row.id);
  },
);

/** Aplicación compartida por la ruta V2; el reducer heredado no admite ediciones sin versión. */
function applyGuideUpdate(ctx: Ctx, { guideId, ...input }: Parameters<typeof checkGuide>[1] & { guideId: bigint }) {
  activeMember(ctx);
  const row = requireGuide(ctx, guideId);
  if (delivery2.withdrawn(ctx.db, 'guide', guideId)) throw new SenderError('La guía está retirada.');
  const checked = checkGuide(ctx, input);
  if (checked.subjectId !== row.subjectId) {
    throw new SenderError('La materia de una guía no cambia.');
  }
  delivery2.captureGuide(ctx, guideId);
  ctx.db.studyGuide.id.update({
    ...row,
    ...checked,
    version: row.version + 1,
    updatedBy: ctx.sender,
    updatedAt: ctx.timestamp,
  });
  // Un tema que se quitó del temario deja de contar en las fuentes.
  for (const source of [...ctx.db.guideSource.guideId.filter(guideId)]) {
    const topics = source.topics.filter((topic) => checked.topics.includes(topic));
    if (topics.length !== source.topics.length) ctx.db.guideSource.id.update({ ...source, topics });
  }
  log(ctx, 'update', 'study_guide', guideId);
  delivery2.captureGuide(ctx, guideId, ctx.sender);
}

/** Una versión antigua debe actualizarse antes de editar material compartido. */
export const update_guide = spacetimedb.reducer(
  { guideId: t.u64(), ...GUIDE_ARGS },
  (ctx) => {
    activeMember(ctx);
    throw new SenderError('Actualiza la aplicación para editar la guía con su versión actual.');
  },
);

export const add_guide_sources = spacetimedb.reducer(
  { guideId: t.u64(), sources: t.array(GUIDE_SOURCE_REF) },
  (ctx, { guideId, sources }) => {
    activeMember(ctx);
    delivery2.captureGuide(ctx, guideId);
    addGuideSources(ctx, requireGuide(ctx, guideId), sources);
    delivery2.bumpExtra(ctx, 'guide', guideId);
    log(ctx, 'update', 'study_guide', guideId);
  },
);

function requireGuideSource(ctx: Ctx, sourceId: bigint) {
  const row = ctx.db.guideSource.id.find(sourceId);
  if (row && delivery2.withdrawn(ctx.db, 'guide', row.guideId)) throw new SenderError('La guía está retirada.');
  if (!row) throw new SenderError('La fuente no existe.');
  return row;
}

export const update_guide_source = spacetimedb.reducer(
  { sourceId: t.u64(), status: t.string(), reason: t.string(), topics: t.array(t.string()) },
  (ctx, { sourceId, status, reason, topics }) => {
    activeMember(ctx);
    const row = requireGuideSource(ctx, sourceId);
    const guide = requireGuide(ctx, row.guideId);
    delivery2.captureGuide(ctx, guide.id);
    if (status !== 'processed' && status !== 'pending') {
      throw new SenderError('Estado de fuente inválido.');
    }
    const why = reason.trim();
    if (why.length > 200) throw new SenderError('La razón es demasiado larga.');
    if (status === 'pending' && !why) throw new SenderError('Di por qué la fuente sigue pendiente.');
    if (topics.some((topic) => !guide.topics.includes(topic))) {
      throw new SenderError('Un tema no está en el temario de la guía.');
    }
    ctx.db.guideSource.id.update({
      ...row,
      status,
      reason: status === 'pending' ? why : '',
      topics: guide.topics.filter((topic) => topics.includes(topic)),
    });
    delivery2.bumpExtra(ctx, 'guide', guide.id);
    log(ctx, 'update', 'guide_source', sourceId);
  },
);

/** Toma la versión actual del material, después de revisar lo que cambió. */
export const refresh_guide_source = spacetimedb.reducer(
  { sourceId: t.u64() },
  (ctx, { sourceId }) => {
    activeMember(ctx);
    const row = requireGuideSource(ctx, sourceId);
    const guide = requireGuide(ctx, row.guideId);
    const version = sourceVersion(ctx, row.kind, row.refId, guide.subjectId);
    delivery2.captureGuide(ctx, guide.id);
    ctx.db.guideSource.id.update({ ...row, sourceVersion: version });
    delivery2.bumpExtra(ctx, 'guide', guide.id);
    log(ctx, 'update', 'guide_source', sourceId);
  },
);

export const remove_guide_source = spacetimedb.reducer(
  { sourceId: t.u64() },
  (ctx, { sourceId }) => {
    activeMember(ctx);
    const row = requireGuideSource(ctx, sourceId);
    delivery2.captureGuide(ctx, row.guideId);
    ctx.db.guideSource.id.delete(sourceId);
    delivery2.bumpExtra(ctx, 'guide', row.guideId);
    log(ctx, 'delete', 'guide_source', sourceId);
  },
);

/** Un compañero revisa la versión actual; quien la guardó no puede. Una por persona y versión. */
export const review_guide = spacetimedb.reducer(
  { guideId: t.u64(), verdict: t.string(), comment: t.string() },
  (ctx, { guideId, verdict, comment }) => {
    activeMember(ctx);
    const guide = requireGuide(ctx, guideId);
    if (guide.updatedBy.isEqual(ctx.sender)) {
      throw new SenderError('Guardaste esta versión; la revisa otro compañero.');
    }
    if (verdict !== 'approved' && verdict !== 'changes') {
      throw new SenderError('Resultado de revisión inválido.');
    }
    const text = comment.trim();
    if (text.length > 2000) throw new SenderError('El comentario es demasiado largo.');
    if (verdict === 'changes' && !text) throw new SenderError('Di qué cambios propones.');
    for (const row of [...ctx.db.guideReview.guideId.filter(guideId)]) {
      if (row.guideVersion === guide.version && row.reviewer.isEqual(ctx.sender)) {
        ctx.db.guideReview.id.delete(row.id);
      }
    }
    ctx.db.guideReview.insert({
      id: 0n,
      guideId,
      guideVersion: guide.version,
      reviewer: ctx.sender,
      verdict,
      comment: text,
      createdAt: ctx.timestamp,
    });
    log(ctx, 'review', 'study_guide', guideId);
  },
);

// ---------------------------------------------------------------------------
// Puedo ayudarte / necesito ayuda
// ---------------------------------------------------------------------------

const HELP_POST_ARGS = {
  kind: t.string(),
  subjectId: t.u64(),
  title: t.string(),
  topic: t.string(),
  description: t.string(),
  level: t.string(),
  modality: t.string(),
  availability: t.string(),
};

function optionalHelpText(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length > max) throw new SenderError(`${field} excede ${max} caracteres.`);
  return trimmed;
}

function requireHelpPost(ctx: Ctx, postId: bigint) {
  const post = ctx.db.helpPost.id.find(postId);
  if (!post) throw new SenderError('La publicación no existe.');
  return post;
}

function requireOwnHelpPost(ctx: Ctx, postId: bigint) {
  const post = requireHelpPost(ctx, postId);
  if (!post.author.isEqual(ctx.sender)) {
    throw new SenderError('Solo el autor puede cambiar esta publicación.');
  }
  if (post.status === 'withdrawn') throw new SenderError('La publicación fue retirada.');
  return post;
}

function requireOpenHelpPost(ctx: Ctx, postId: bigint) {
  const post = requireHelpPost(ctx, postId);
  if (post.status !== 'open') throw new SenderError('La publicación ya no está abierta.');
  if (ctx.db.member.identity.find(post.author)?.status !== 'active') {
    throw new SenderError('El autor ya no está activo en el grupo.');
  }
  return post;
}

/** Cerrar una publicación no interrumpe los contactos ya aceptados ni sus chats. */
function closePendingHelpContacts(ctx: Ctx, postId: bigint, reason: string) {
  for (const request of ctx.db.helpContactRequest.postId.filter(postId)) {
    if (request.status !== 'pending') continue;
    ctx.db.helpContactRequest.id.update({
      ...request,
      status: 'closed',
      updatedAt: ctx.timestamp,
      closedBy: ctx.sender,
      closeReason: reason,
    });
  }
}

export const save_help_post = spacetimedb.reducer(
  { id: t.u64().optional(), ...HELP_POST_ARGS },
  (ctx, { id, ...input }) => {
    activeMember(ctx);
    const existing = id === undefined ? undefined : requireOwnHelpPost(ctx, id);
    requireSubject(ctx, input.subjectId);
    if (!['offer', 'request'].includes(input.kind)) throw new SenderError('El tipo de ayuda no existe.');
    if (!['initial', 'basics', 'advanced'].includes(input.level)) {
      throw new SenderError('El nivel del contenido no existe.');
    }
    if (!['messages', 'video', 'in_person', 'flexible'].includes(input.modality)) {
      throw new SenderError('La modalidad no existe.');
    }
    if (existing && existing.kind !== input.kind) {
      throw new SenderError('El tipo de una publicación no cambia.');
    }
    const fields = {
      ...input,
      title: requireText(input.title, 'El título', 200),
      topic: requireText(input.topic, 'El tema', 120),
      description: requireText(input.description, 'La descripción', 4000),
      availability: optionalHelpText(input.availability, 'La disponibilidad', 500),
      updatedAt: ctx.timestamp,
    };
    if (existing) {
      ctx.db.helpPost.id.update({ ...existing, ...fields });
      log(ctx, 'update', 'help_post', existing.id);
    } else {
      const post = ctx.db.helpPost.insert({
        id: 0n,
        ...fields,
        status: 'open',
        author: ctx.sender,
        createdAt: ctx.timestamp,
        withdrawnBy: undefined,
        withdrawalReason: undefined,
      });
      log(ctx, 'create', 'help_post', post.id);
    }
  },
);

export const set_help_post_status = spacetimedb.reducer(
  { postId: t.u64(), status: t.string() },
  (ctx, { postId, status }) => {
    activeMember(ctx);
    const post = requireOwnHelpPost(ctx, postId);
    if (status !== 'open' && status !== 'closed') throw new SenderError('Estado de publicación inválido.');
    if (post.status === status) return;
    ctx.db.helpPost.id.update({ ...post, status, updatedAt: ctx.timestamp });
    if (status === 'closed') closePendingHelpContacts(ctx, postId, 'post_closed');
    log(ctx, status === 'closed' ? 'close' : 'reopen', 'help_post', postId);
  },
);

export const withdraw_help_post = spacetimedb.reducer(
  { postId: t.u64(), reason: t.string() },
  (ctx, { postId, reason }) => {
    activeMember(ctx);
    const post = requireHelpPost(ctx, postId);
    if (post.status === 'withdrawn') throw new SenderError('La publicación ya fue retirada.');
    const own = post.author.isEqual(ctx.sender);
    if (!own) requireCreator(ctx);
    const withdrawalReason = optionalHelpText(reason, 'El motivo', 500);
    if (!own && !withdrawalReason) throw new SenderError('Indica el motivo de la retirada.');
    ctx.db.helpPost.id.update({
      ...post,
      status: 'withdrawn',
      updatedAt: ctx.timestamp,
      withdrawnBy: ctx.sender,
      withdrawalReason: withdrawalReason || undefined,
    });
    closePendingHelpContacts(ctx, postId, 'post_withdrawn');
    // El motivo solo vive en la fila privada del autor, nunca en el historial público.
    log(ctx, 'withdraw', 'help_post', postId);
  },
);

export const send_help_contact = spacetimedb.reducer(
  { postId: t.u64(), message: t.string() },
  (ctx, { postId, message }) => {
    activeMember(ctx);
    const post = requireOpenHelpPost(ctx, postId);
    if (post.author.isEqual(ctx.sender)) throw new SenderError('No puedes solicitar contacto contigo.');
    for (const request of ctx.db.helpContactRequest.postId.filter(postId)) {
      if (request.sender.isEqual(ctx.sender)) {
        throw new SenderError('Ya solicitaste contacto para esta publicación.');
      }
    }
    ctx.db.helpContactRequest.insert({
      id: 0n,
      postId,
      sender: ctx.sender,
      recipient: post.author,
      subjectId: post.subjectId,
      postTitle: post.title,
      postTopic: post.topic,
      postKind: post.kind,
      message: optionalHelpText(message, 'El mensaje', 1000),
      status: 'pending',
      conversationId: undefined,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
      closedBy: undefined,
      closeReason: undefined,
    });
  },
);

function requireHelpContact(ctx: Ctx, requestId: bigint) {
  const request = ctx.db.helpContactRequest.id.find(requestId);
  if (!request || (!request.sender.isEqual(ctx.sender) && !request.recipient.isEqual(ctx.sender))) {
    throw new SenderError('El contacto no existe.');
  }
  return request;
}

export const respond_help_contact = spacetimedb.reducer(
  { requestId: t.u64(), decision: t.string() },
  (ctx, { requestId, decision }) => {
    activeMember(ctx);
    const request = requireHelpContact(ctx, requestId);
    if (!request.recipient.isEqual(ctx.sender)) throw new SenderError('Solo el destinatario puede responder.');
    if (request.status !== 'pending') throw new SenderError('El contacto ya no está pendiente.');
    if (decision !== 'accepted' && decision !== 'rejected') throw new SenderError('Respuesta inválida.');
    let conversationId = request.conversationId;
    if (decision === 'accepted') {
      requireOpenHelpPost(ctx, request.postId);
      if (ctx.db.member.identity.find(request.sender)?.status !== 'active') {
        throw new SenderError('El compañero que pidió contacto ya no está activo.');
      }
      let conversation = findConversation(ctx, request.sender, request.recipient);
      if (!conversation) {
        const [userA, userB] = orderedPair(request.sender, request.recipient);
        conversation = ctx.db.directConversation.insert({ id: 0n, userA, userB, createdAt: ctx.timestamp });
      }
      conversationId = conversation.id;
    }
    ctx.db.helpContactRequest.id.update({ ...request, status: decision, conversationId, updatedAt: ctx.timestamp });
  },
);

export const cancel_help_contact = spacetimedb.reducer(
  { requestId: t.u64() },
  (ctx, { requestId }) => {
    activeMember(ctx);
    const request = requireHelpContact(ctx, requestId);
    if (!request.sender.isEqual(ctx.sender)) throw new SenderError('Solo el remitente puede cancelar.');
    if (request.status !== 'pending') throw new SenderError('El contacto ya no está pendiente.');
    ctx.db.helpContactRequest.id.update({ ...request, status: 'cancelled', updatedAt: ctx.timestamp });
  },
);

export const close_help_contact = spacetimedb.reducer(
  { requestId: t.u64() },
  (ctx, { requestId }) => {
    activeMember(ctx);
    const request = requireHelpContact(ctx, requestId);
    if (request.status !== 'accepted') throw new SenderError('Solo puedes cerrar un contacto aceptado.');
    ctx.db.helpContactRequest.id.update({
      ...request,
      status: 'closed',
      updatedAt: ctx.timestamp,
      closedBy: ctx.sender,
      closeReason: 'participant',
    });
  },
);

// ---------------------------------------------------------------------------
// Tareas y Actividades: versiones completas, seguimiento y archivos verificados
// ---------------------------------------------------------------------------

type ResourceKind = 'assignment' | 'activity' | 'work' | 'evidence' | typeof delivery2.extraKinds[number];
const RESOURCE_KINDS: readonly string[] = ['assignment', 'activity', 'work', 'evidence', ...delivery2.extraKinds];
const hexIdentity = (value: string) => value.trim().replace(/^0x/i, '').toLowerCase();

function resourceKind(value: string): ResourceKind {
  if (!RESOURCE_KINDS.includes(value)) throw new SenderError('Tipo de recurso inválido.');
  return value as ResourceKind;
}

function targetVersion(ctx: Ctx, kind: string, targetId: bigint): number {
  if (delivery2.extraKinds.includes(kind as typeof delivery2.extraKinds[number])) return delivery2.extraVersion(ctx, kind, targetId);
  switch (resourceKind(kind)) {
    case 'assignment': {
      const row = ctx.db.assignment.id.find(targetId);
      if (!row) throw new SenderError('La tarea no existe.');
      return row.version;
    }
    case 'activity': {
      const row = ctx.db.activity.id.find(targetId);
      if (!row) throw new SenderError('La actividad no existe.');
      return row.version;
    }
    case 'work': {
      const row = ctx.db.work.id.find(targetId);
      if (!row) throw new SenderError('El trabajo no existe.');
      return row.version;
    }
    case 'evidence':
      if (!ctx.db.evidence.id.find(targetId)) throw new SenderError('La evidencia no existe.');
      return ctx.db.evidenceDetail.evidenceId.find(targetId)?.version ?? 1;
  }
  throw new SenderError('El recurso no existe.');
}

function expectVersion(actual: number, expected: number) {
  if (actual !== expected) {
    throw new SenderError('El contenido cambió mientras lo editabas. Actualiza y revisa los cambios antes de guardar.');
  }
}

function requireTargetWriter(ctx: Ctx, kind: string, targetId: bigint, actor = ctx.sender) {
  const person = ctx.db.member.identity.find(actor);
  if (!person || person.status !== 'active') throw new SenderError('No eres miembro activo del grupo.');
  targetVersion(ctx, kind, targetId);
  if (delivery2.extraKinds.includes(kind as typeof delivery2.extraKinds[number])) {
    delivery2.extraWriter(ctx, kind, targetId, actor); return;
  }
  if (delivery2.withdrawn(ctx.db, kind, targetId)) throw new SenderError('El contenido está retirado.');
  if (kind === 'work') {
    if (![...ctx.db.workAuthor.workId.filter(targetId)].some((row) => row.author.isEqual(actor))) {
      throw new SenderError('Solo el autor o los coautores editan este trabajo.');
    }
  } else if (kind === 'evidence') {
    const row = ctx.db.evidence.id.find(targetId)!;
    if (!row.author.isEqual(actor)) {
      throw new SenderError('Solo el autor modifica los archivos de esta evidencia.');
    }
  }
}

function workMetadata(ctx: Ctx, workId: bigint) {
  const row = ctx.db.workDetail.workId.find(workId);
  return { topic: row?.topic ?? '', status: row?.status ?? 'draft' };
}

function workStatus(value: string) {
  if (value !== 'draft' && value !== 'final') throw new SenderError('Estado del trabajo inválido.');
  return value;
}

function optionalText(value: string, name: string, limit: number) {
  const clean = value.trim();
  if (clean.length > limit) throw new SenderError(`${name} excede ${limit} caracteres.`);
  return clean;
}

function setWorkDetail(ctx: Ctx, workId: bigint, topic: string, status: string, actor = ctx.sender) {
  const detail = { workId, topic: optionalText(topic, 'El tema', 120), status: workStatus(status), updatedBy: actor };
  if (ctx.db.workDetail.workId.find(workId)) ctx.db.workDetail.workId.update(detail);
  else ctx.db.workDetail.insert(detail);
}

function setAssignmentTopic(ctx: Ctx, assignmentId: bigint, topic: string) {
  const detail = { assignmentId, topic: optionalText(topic, 'El tema', 120) };
  if (ctx.db.assignmentDetail.assignmentId.find(assignmentId)) ctx.db.assignmentDetail.assignmentId.update(detail);
  else ctx.db.assignmentDetail.insert(detail);
}

/** Copia metadatos legacy antes de retirar una fila; el objeto sigue disponible en historial. */
function mirrorLegacyFiles(ctx: Ctx, workId: bigint) {
  for (const old of ctx.db.workFile.workId.filter(workId)) {
    const id = `legacy:${old.id}`;
    if (!ctx.db.resourceFile.id.find(id)) ctx.db.resourceFile.insert({
      id, targetKind: 'work', targetId: workId, name: old.name, size: old.size,
      contentType: old.contentType, storageKey: old.storageKey, etag: '',
      uploadedBy: old.uploadedBy, createdAt: old.createdAt, removedAt: undefined,
    });
  }
}

function attachmentIds(ctx: Ctx, kind: string, targetId: bigint): string[] {
  if (kind === 'work') mirrorLegacyFiles(ctx, targetId);
  return [...ctx.db.resourceFile.targetId.filter(targetId)]
    .filter((row) => row.targetKind === kind && row.removedAt === undefined)
    .map((row) => row.id).sort();
}

function saveWorkSnapshot(ctx: Ctx, workId: bigint, actor?: Ctx['sender'], restoredFrom?: number) {
  const row = ctx.db.work.id.find(workId);
  if (!row) throw new SenderError('El trabajo no existe.');
  if ([...ctx.db.workRevision.workId.filter(workId)].some((r) => r.version === row.version)) return;
  const detail = workMetadata(ctx, workId);
  ctx.db.workRevision.insert({
    id: 0n, workId, version: row.version, title: row.title, description: row.description,
    ...detail, authors: [...ctx.db.workAuthor.workId.filter(workId)].map((r) => r.author),
    attachmentIds: attachmentIds(ctx, 'work', workId),
    editedBy: actor ?? ctx.db.workDetail.workId.find(workId)?.updatedBy ?? row.createdBy,
    editedAt: row.updatedAt, restoredFrom,
  });
}

function activeLinks(ctx: Ctx, activityId: bigint) {
  return [...ctx.db.activityLink.activityId.filter(activityId)].filter((row) => row.removedAt === undefined);
}

function savePageSnapshot(ctx: Ctx, page: 'assignment' | 'activity', pageId: bigint,
  actor?: Ctx['sender'], restoredFrom?: number) {
  const row = page === 'assignment' ? ctx.db.assignment.id.find(pageId) : ctx.db.activity.id.find(pageId);
  if (!row) throw new SenderError('La página no existe.');
  if ([...ctx.db.pageSnapshot.pageId.filter(pageId)].some((r) => r.page === page && r.version === row.version)) return;
  const task = page === 'assignment' ? ctx.db.assignment.id.find(pageId)! : undefined;
  const session = page === 'activity' ? ctx.db.activity.id.find(pageId)! : undefined;
  const links = session ? activeLinks(ctx, pageId) : [];
  ctx.db.pageSnapshot.insert({
    id: 0n, page, pageId, version: row.version, subjectId: row.subjectId, termId: row.termId,
    kind: task?.kind ?? '', topic: session?.topic ?? ctx.db.assignmentDetail.assignmentId.find(pageId)?.topic ?? '',
    date: session?.date ?? '', title: row.title, summary: session?.objective ?? '', body: row.instructions,
    dueDate: task?.dueDate ?? '', attachmentIds: attachmentIds(ctx, page, pageId),
    assignmentIds: links.filter((r) => r.targetKind === 'assignment').map((r) => r.targetId),
    noteIds: links.filter((r) => r.targetKind === 'note').map((r) => r.targetId),
    editedBy: actor ?? row.updatedBy, editedAt: row.updatedAt, restoredFrom,
  });
}

function saveTargetBaseline(ctx: Ctx, kind: string, targetId: bigint) {
  if (kind === 'note') { delivery2.captureNote(ctx, targetId); return; }
  if (kind === 'guide') { delivery2.captureGuide(ctx, targetId); return; }
  if (kind === 'work') saveWorkSnapshot(ctx, targetId);
  else if (kind === 'assignment' || kind === 'activity') savePageSnapshot(ctx, kind, targetId);
  else if (kind === 'evidence') {
    const row = ctx.db.evidence.id.find(targetId);
    if (!row) throw new SenderError('La evidencia no existe.');
    savePageSnapshot(ctx, 'activity', row.activityId);
  }
}

/** Cada cambio material invalida revisiones de versiones anteriores, sin borrarlas. */
function bumpMaterial(ctx: Ctx, kind: string, targetId: bigint, actor = ctx.sender, restoredFrom?: number) {
  if (delivery2.extraKinds.includes(kind as typeof delivery2.extraKinds[number])) {
    delivery2.bumpExtra(ctx, kind, targetId, actor); return;
  }
  const version = targetVersion(ctx, kind, targetId) + 1;
  if (kind === 'work') {
    const row = ctx.db.work.id.find(targetId)!;
    const detail = workMetadata(ctx, targetId);
    ctx.db.work.id.update({ ...row, version, updatedAt: ctx.timestamp });
    setWorkDetail(ctx, targetId, detail.topic, detail.status, actor);
    saveWorkSnapshot(ctx, targetId, actor, restoredFrom);
  } else if (kind === 'assignment') {
    const row = ctx.db.assignment.id.find(targetId)!;
    ctx.db.assignment.id.update({ ...row, version, updatedBy: actor, updatedAt: ctx.timestamp });
    saveRevision(ctx, 'assignment', targetId, version,
      { title: row.title, summary: '', body: row.instructions, dueDate: row.dueDate }, actor);
  } else if (kind === 'activity') {
    const row = ctx.db.activity.id.find(targetId)!;
    ctx.db.activity.id.update({ ...row, version, updatedBy: actor, updatedAt: ctx.timestamp });
    saveRevision(ctx, 'activity', targetId, version,
      { title: row.title, summary: row.objective, body: row.instructions }, actor);
  } else {
    const detail = { evidenceId: targetId, version, updatedBy: actor, updatedAt: ctx.timestamp };
    if (ctx.db.evidenceDetail.evidenceId.find(targetId)) ctx.db.evidenceDetail.evidenceId.update(detail);
    else ctx.db.evidenceDetail.insert(detail);
    const evidence = ctx.db.evidence.id.find(targetId)!;
    bumpMaterial(ctx, 'activity', evidence.activityId, actor);
  }
}

export const set_progress = spacetimedb.reducer(
  { targetKind: t.string(), targetId: t.u64(), status: t.string() },
  (ctx, { targetKind, targetId, status }) => {
    activeMember(ctx);
    if (targetKind !== 'assignment' && targetKind !== 'activity') throw new SenderError('Tipo de página inválido.');
    targetVersion(ctx, targetKind, targetId);
    if (!['pending', 'in_progress', 'done'].includes(status)) throw new SenderError('Avance inválido.');
    const row = { key: `${ctx.sender.toHexString()}:${targetKind}:${targetId}`, owner: ctx.sender,
      targetKind, targetId, status, updatedAt: ctx.timestamp };
    if (ctx.db.personalProgress.key.find(row.key)) ctx.db.personalProgress.key.update(row);
    else ctx.db.personalProgress.insert(row);
  },
);

export const create_assignment_v2 = spacetimedb.reducer(
  { ...ASSIGNMENT_ARGS, topic: t.string() },
  (ctx, { topic, ...input }) => {
    activeMember(ctx);
    const row = ctx.db.assignment.insert({ id: 0n, ...checkAssignment(ctx, input), version: 1,
      createdBy: ctx.sender, createdAt: ctx.timestamp, updatedBy: ctx.sender, updatedAt: ctx.timestamp });
    setAssignmentTopic(ctx, row.id, topic);
    saveRevision(ctx, 'assignment', row.id, 1, { title: row.title, summary: '', body: row.instructions, dueDate: row.dueDate });
    log(ctx, 'create', 'assignment', row.id);
  },
);

export const update_assignment_v2 = spacetimedb.reducer(
  { assignmentId: t.u64(), ...ASSIGNMENT_ARGS, topic: t.string(), expectedVersion: t.u32() },
  (ctx, { assignmentId, topic, expectedVersion, ...input }) => {
    activeMember(ctx);
    expectVersion(targetVersion(ctx, 'assignment', assignmentId), expectedVersion);
    // La versión previa conserva el tema anterior, antes de actualizar los datos complementarios.
    savePageSnapshot(ctx, 'assignment', assignmentId);
    setAssignmentTopic(ctx, assignmentId, topic);
    updateAssignmentContent(ctx, assignmentId, input);
  },
);

export const update_activity_v2 = spacetimedb.reducer(
  { activityId: t.u64(), ...ACTIVITY_ARGS, expectedVersion: t.u32() },
  (ctx, { activityId, expectedVersion, ...input }) => {
    activeMember(ctx);
    expectVersion(targetVersion(ctx, 'activity', activityId), expectedVersion);
    updateActivityContent(ctx, activityId, input);
  },
);

export const publish_work_v2 = spacetimedb.reducer(
  { assignmentId: t.u64(), title: t.string(), description: t.string(), coauthors: t.array(t.identity()),
    topic: t.string(), status: t.string() },
  (ctx, { assignmentId, title, description, coauthors, topic, status }) => {
    activeMember(ctx);
    targetVersion(ctx, 'assignment', assignmentId);
    const authors = new Map([[ctx.sender.toHexString(), ctx.sender]]);
    for (const author of coauthors) {
      if (ctx.db.member.identity.find(author)?.status !== 'active') throw new SenderError('Un coautor no es miembro activo.');
      authors.set(author.toHexString(), author);
    }
    const row = ctx.db.work.insert({ id: 0n, assignmentId,
      title: optionalText(title, 'El título', 200), description: optionalText(description, 'La descripción', 50_000),
      version: 1, createdBy: ctx.sender, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
    for (const author of authors.values()) ctx.db.workAuthor.insert({ id: 0n, workId: row.id, author });
    setWorkDetail(ctx, row.id, topic, status);
    saveWorkSnapshot(ctx, row.id, ctx.sender);
    log(ctx, 'publish', 'work', row.id);
  },
);

export const save_work_version = spacetimedb.reducer(
  { workId: t.u64(), title: t.string(), description: t.string(), topic: t.string(), status: t.string(), expectedVersion: t.u32() },
  (ctx, { workId, title, description, topic, status, expectedVersion }) => {
    activeMember(ctx); requireTargetWriter(ctx, 'work', workId);
    expectVersion(targetVersion(ctx, 'work', workId), expectedVersion);
    saveWorkSnapshot(ctx, workId);
    const row = ctx.db.work.id.find(workId)!;
    ctx.db.work.id.update({ ...row, title: optionalText(title, 'El título', 200),
      description: optionalText(description, 'La descripción', 50_000) });
    setWorkDetail(ctx, workId, topic, status);
    bumpMaterial(ctx, 'work', workId);
    log(ctx, 'update', 'work', workId);
  },
);

function restoreAttachments(ctx: Ctx, kind: string, targetId: bigint, ids: string[]) {
  const selected = new Set(ids);
  for (const id of ids) {
    const file = ctx.db.resourceFile.id.find(id);
    if (!file || file.targetKind !== kind || file.targetId !== targetId) {
      throw new SenderError('Un archivo de esta versión no está disponible.');
    }
  }
  for (const file of ctx.db.resourceFile.targetId.filter(targetId)) {
    if (file.targetKind !== kind) continue;
    const active = selected.has(file.id);
    ctx.db.resourceFile.id.update({ ...file, removedAt: active ? undefined : ctx.timestamp });
    if (file.id.startsWith('legacy:')) {
      const oldId = BigInt(file.id.slice(7));
      if (!active) ctx.db.workFile.id.delete(oldId);
      else if (!ctx.db.workFile.id.find(oldId)) ctx.db.workFile.insert({
        id: oldId, workId: targetId, name: file.name, size: file.size, contentType: file.contentType,
        storageKey: file.storageKey, uploadedBy: file.uploadedBy, createdAt: file.createdAt,
      });
    }
  }
}

export const restore_work_version = spacetimedb.reducer(
  { workId: t.u64(), version: t.u32(), expectedVersion: t.u32() },
  (ctx, { workId, version, expectedVersion }) => {
    activeMember(ctx); requireTargetWriter(ctx, 'work', workId);
    expectVersion(targetVersion(ctx, 'work', workId), expectedVersion);
    saveWorkSnapshot(ctx, workId);
    const previous = [...ctx.db.workRevision.workId.filter(workId)].find((row) => row.version === version);
    if (!previous) throw new SenderError('Esa versión no está disponible en el historial.');
    const row = ctx.db.work.id.find(workId)!;
    ctx.db.work.id.update({ ...row, title: previous.title, description: previous.description });
    setWorkDetail(ctx, workId, previous.topic, previous.status);
    restoreAttachments(ctx, 'work', workId, previous.attachmentIds);
    bumpMaterial(ctx, 'work', workId, ctx.sender, version);
    log(ctx, 'restore', 'work', workId);
  },
);

export const review_work = spacetimedb.reducer(
  { workId: t.u64(), expectedVersion: t.u32(), comment: t.string() },
  (ctx, { workId, expectedVersion, comment }) => {
    activeMember(ctx);
    const version = targetVersion(ctx, 'work', workId);
    expectVersion(version, expectedVersion);
    if (workMetadata(ctx, workId).status !== 'final') throw new SenderError('Primero los autores deben marcar esta versión como final.');
    if ([...ctx.db.workAuthor.workId.filter(workId)].some((row) => row.author.isEqual(ctx.sender))) {
      throw new SenderError('La revisión debe hacerla un compañero que no sea autor o coautor.');
    }
    const text = requireText(comment, 'El comentario de revisión', 2000);
    if ([...ctx.db.workReview.workId.filter(workId)].some((row) => row.version === version && row.reviewer.isEqual(ctx.sender))) {
      throw new SenderError('Ya revisaste esta versión. Tu revisión queda en el historial.');
    }
    ctx.db.workReview.insert({ id: 0n, workId, version, reviewer: ctx.sender, comment: text, createdAt: ctx.timestamp });
    log(ctx, 'review', 'work', workId);
  },
);

export const comment_academic = spacetimedb.reducer(
  { targetKind: t.string(), targetId: t.u64(), text: t.string() },
  (ctx, { targetKind, targetId, text }) => {
    activeMember(ctx);
    if (targetKind !== 'work' && targetKind !== 'evidence') throw new SenderError('Tipo de comentario inválido.');
    targetVersion(ctx, targetKind, targetId);
    ctx.db.academicComment.insert({ id: 0n, targetKind, targetId, author: ctx.sender,
      text: requireText(text, 'El comentario', 2000), createdAt: ctx.timestamp });
  },
);

function replaceActivityLinks(ctx: Ctx, activityId: bigint, assignmentIds: bigint[], noteIds: bigint[]) {
  const session = ctx.db.activity.id.find(activityId);
  if (!session) throw new SenderError('La actividad no existe.');
  const selected = [
    ...new Set(assignmentIds.map(String)),
    ...new Set(noteIds.map(String)),
  ];
  if (selected.length > 100) throw new SenderError('Puedes enlazar hasta 100 materiales por actividad.');
  for (const id of assignmentIds) {
    const row = ctx.db.assignment.id.find(id);
    if (!row || row.subjectId !== session.subjectId) throw new SenderError('La tarea enlazada debe pertenecer a esta materia.');
  }
  for (const id of noteIds) {
    const row = ctx.db.note.id.find(id);
    if (!row || row.subjectId !== session.subjectId || row.visibility !== 'group') {
      throw new SenderError('Solo puedes enlazar notas compartidas de esta materia.');
    }
  }
  const wanted = new Set([
    ...assignmentIds.map((id) => `assignment:${id}`), ...noteIds.map((id) => `note:${id}`),
  ]);
  for (const row of ctx.db.activityLink.activityId.filter(activityId)) {
    const key = `${row.targetKind}:${row.targetId}`;
    ctx.db.activityLink.id.update({ ...row, removedAt: wanted.has(key) ? undefined : ctx.timestamp });
    wanted.delete(key);
  }
  for (const key of wanted) {
    const [targetKind, id] = key.split(':');
    ctx.db.activityLink.insert({ id: 0n, activityId, targetKind, targetId: BigInt(id),
      createdBy: ctx.sender, createdAt: ctx.timestamp, removedAt: undefined });
  }
}

export const save_activity_links = spacetimedb.reducer(
  { activityId: t.u64(), assignmentIds: t.array(t.u64()), noteIds: t.array(t.u64()), expectedVersion: t.u32() },
  (ctx, { activityId, assignmentIds, noteIds, expectedVersion }) => {
    activeMember(ctx);
    expectVersion(targetVersion(ctx, 'activity', activityId), expectedVersion);
    savePageSnapshot(ctx, 'activity', activityId);
    replaceActivityLinks(ctx, activityId, assignmentIds, noteIds);
    bumpMaterial(ctx, 'activity', activityId);
    log(ctx, 'links', 'activity', activityId);
  },
);

export const restore_page_snapshot = spacetimedb.reducer(
  { page: t.string(), pageId: t.u64(), version: t.u32(), expectedVersion: t.u32() },
  (ctx, { page, pageId, version, expectedVersion }) => {
    activeMember(ctx);
    if (page !== 'assignment' && page !== 'activity') throw new SenderError('Tipo de página inválido.');
    expectVersion(targetVersion(ctx, page, pageId), expectedVersion);
    savePageSnapshot(ctx, page, pageId);
    const previous = [...ctx.db.pageSnapshot.pageId.filter(pageId)].find((r) => r.page === page && r.version === version);
    if (!previous) throw new SenderError('Esa versión completa no está disponible.');
    if (page === 'assignment') {
      const row = ctx.db.assignment.id.find(pageId)!;
      const checked = checkAssignment(ctx, { subjectId: previous.subjectId, termId: previous.termId,
        kind: previous.kind, title: previous.title, instructions: previous.body, dueDate: previous.dueDate });
      ctx.db.assignment.id.update({ ...row, ...checked });
      setAssignmentTopic(ctx, pageId, previous.topic);
    } else {
      const row = ctx.db.activity.id.find(pageId)!;
      const checked = checkActivity(ctx, { subjectId: previous.subjectId, termId: previous.termId,
        title: previous.title, topic: previous.topic, date: previous.date,
        objective: previous.summary, instructions: previous.body });
      ctx.db.activity.id.update({ ...row, ...checked });
      replaceActivityLinks(ctx, pageId, previous.assignmentIds, previous.noteIds);
    }
    restoreAttachments(ctx, page, pageId, previous.attachmentIds);
    bumpMaterial(ctx, page, pageId, ctx.sender, version);
    // La creación del snapshot ocurre dentro de bumpMaterial; añade la referencia de restauración.
    const current = [...ctx.db.pageSnapshot.pageId.filter(pageId)].find((r) => r.page === page && r.version === expectedVersion + 1);
    if (current) ctx.db.pageSnapshot.id.update({ ...current, restoredFrom: version });
    log(ctx, 'restore', page, pageId);
  },
);

function removeResource(ctx: Ctx, fileId: string, expectedVersion: number) {
  const legacy = /^legacy:(\d+)$/.exec(fileId);
  if (legacy) {
    const old = ctx.db.workFile.id.find(BigInt(legacy[1]));
    if (old) mirrorLegacyFiles(ctx, old.workId);
  }
  const file = ctx.db.resourceFile.id.find(fileId);
  if (!file || file.removedAt !== undefined) throw new SenderError('El archivo no está en la versión actual.');
  requireTargetWriter(ctx, file.targetKind, file.targetId);
  expectVersion(targetVersion(ctx, file.targetKind, file.targetId), expectedVersion);
  saveTargetBaseline(ctx, file.targetKind, file.targetId);
  ctx.db.resourceFile.id.update({ ...file, removedAt: ctx.timestamp });
  if (legacy) ctx.db.workFile.id.delete(BigInt(legacy[1]));
  bumpMaterial(ctx, file.targetKind, file.targetId, ctx.sender);
  log(ctx, 'remove', 'resource_file', fileId);
}

export const remove_resource_file = spacetimedb.reducer(
  { fileId: t.string(), expectedVersion: t.u32() },
  (ctx, { fileId, expectedVersion }) => { activeMember(ctx); removeResource(ctx, fileId, expectedVersion); },
);

/** Recupera un adjunto de evidencia, sin inventar un historial del texto de la evidencia. */
export const restore_resource_file = spacetimedb.reducer(
  { fileId: t.string(), expectedVersion: t.u32() },
  (ctx, { fileId, expectedVersion }) => {
    activeMember(ctx);
    const file = ctx.db.resourceFile.id.find(fileId);
    if (!file) throw new SenderError('El archivo no existe.');
    if (file.targetKind !== 'evidence') {
      throw new SenderError('Este archivo se restaura desde el historial de su trabajo o página.');
    }
    requireTargetWriter(ctx, file.targetKind, file.targetId);
    // Un reintento autorizado no añade otra versión si ya se recuperó el adjunto.
    if (file.removedAt === undefined) return;
    expectVersion(targetVersion(ctx, file.targetKind, file.targetId), expectedVersion);
    saveTargetBaseline(ctx, file.targetKind, file.targetId);
    ctx.db.resourceFile.id.update({ ...file, removedAt: undefined });
    bumpMaterial(ctx, file.targetKind, file.targetId);
    log(ctx, 'restore', 'resource_file', fileId);
  },
);

/** Una migración repetida nunca inventa el contenido anterior ni cambia IDs o versiones. */
export const backfill_academic_v2 = spacetimedb.reducer((ctx) => {
  requireCreator(ctx);
  for (const row of ctx.db.work.iter()) {
    if (!ctx.db.workDetail.workId.find(row.id)) setWorkDetail(ctx, row.id, '', 'draft', row.createdBy);
    saveWorkSnapshot(ctx, row.id);
  }
  for (const row of ctx.db.assignment.iter()) {
    if (!ctx.db.assignmentDetail.assignmentId.find(row.id)) setAssignmentTopic(ctx, row.id, '');
    savePageSnapshot(ctx, 'assignment', row.id);
  }
  for (const row of ctx.db.activity.iter()) savePageSnapshot(ctx, 'activity', row.id);
  for (const row of ctx.db.evidence.iter()) if (!ctx.db.evidenceDetail.evidenceId.find(row.id)) {
    ctx.db.evidenceDetail.insert({ evidenceId: row.id, version: 1, updatedBy: row.author, updatedAt: row.createdAt });
  }
  if (!ctx.db.academicMigration.id.find(2)) ctx.db.academicMigration.insert({ id: 2, completedAt: ctx.timestamp });
});

export const set_file_service = spacetimedb.reducer({ identity: t.identity() }, (ctx, { identity }) => {
  if (!isOwner(ctx)) throw new SenderError('Solo el propietario configura el servicio de archivos.');
  const row = { id: 0, identity };
  if (ctx.db.fileServiceConfig.id.find(0)) ctx.db.fileServiceConfig.id.update(row);
  else ctx.db.fileServiceConfig.insert(row);
  log(ctx, 'configure', 'file_service', '0');
});

function isFileService(ctx: Ctx): boolean {
  const configured = ctx.db.fileServiceConfig.id.find(0)?.identity.toHexString()
    ?? ctx.env.B20_FILE_SERVICE_IDENTITY;
  return !!configured && /^[0-9a-f]{64}$/.test(hexIdentity(configured)) &&
    hexIdentity(ctx.sender.toHexString()) === hexIdentity(configured);
}

function requireFileService(ctx: Ctx) {
  if (!isFileService(ctx)) {
    throw new SenderError('Solo el servicio de archivos puede confirmar una subida.');
  }
}

function resourceResult(file: typeof resourceFile.rowType.type) {
  return JSON.stringify({ fileId: file.id, storageKey: file.storageKey });
}

export const authorize_file_upload = spacetimedb.procedure(
  { targetKind: t.string(), targetId: t.u64(), expectedVersion: t.u32(), uploadId: t.string() }, t.string(),
  (ctx, { targetKind, targetId, expectedVersion, uploadId }) => ctx.withTx((tx) => {
    activeMember(tx); resourceKind(targetKind); requireTargetWriter(tx, targetKind, targetId);
    if (tx.db.resourceUpload.id.find(uploadId)) throw new SenderError('Esta subida usa almacenamiento de SpacetimeDB.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
      throw new SenderError('Identificador de subida inválido.');
    }
    const prior = tx.db.fileUploadIntent.id.find(uploadId);
    if (prior && (!prior.actor.isEqual(tx.sender) || prior.targetKind !== targetKind ||
        prior.targetId !== targetId || prior.expectedVersion !== expectedVersion)) {
      throw new SenderError('Esta subida ya está asociada a otro contenido.');
    }
    const committed = tx.db.resourceFile.id.find(uploadId);
    if (committed && (!committed.uploadedBy.isEqual(tx.sender) || committed.targetKind !== targetKind || committed.targetId !== targetId)) {
      throw new SenderError('La subida no pertenece a esta persona o contenido.');
    }
    if (!committed) {
      expectVersion(targetVersion(tx, targetKind, targetId), expectedVersion);
      if (!prior) tx.db.fileUploadIntent.insert({ id: uploadId, actor: tx.sender, targetKind, targetId,
        expectedVersion, createdAt: tx.timestamp,
        expiresAt: new Timestamp(tx.timestamp.microsSinceUnixEpoch + 30n * 60n * 1_000_000n),
      });
      else if (prior.expiresAt.microsSinceUnixEpoch < tx.timestamp.microsSinceUnixEpoch) {
        throw new SenderError('La autorización de subida venció. Inicia otra subida.');
      }
    }
    return JSON.stringify({ actor: tx.sender.toHexString(), targetKind, targetId: targetId.toString(),
      expectedVersion, intentVersion: expectedVersion, ...(committed ? { fileId: committed.id } : {}) });
  }),
);

export const get_file_upload_status = spacetimedb.procedure(
  { actor: t.string(), uploadId: t.string() }, t.string(),
  (ctx, { actor, uploadId }) => ctx.withTx((tx) => {
    requireFileService(tx);
    const file = tx.db.resourceFile.id.find(uploadId);
    return file && hexIdentity(file.uploadedBy.toHexString()) === hexIdentity(actor) ? resourceResult(file) : 'null';
  }),
);

export const finalize_file_upload = spacetimedb.reducer(
  { actor: t.string(), targetKind: t.string(), targetId: t.u64(), expectedVersion: t.u32(), uploadId: t.string(),
    name: t.string(), size: t.u64(), contentType: t.string(), storageKey: t.string(), etag: t.string() },
  (ctx, input) => {
    requireFileService(ctx);
    const { actor, targetKind, targetId, expectedVersion, uploadId } = input;
    if (ctx.db.resourceUpload.id.find(uploadId)) throw new SenderError('Esta subida usa almacenamiento de SpacetimeDB.');
    const intent = ctx.db.fileUploadIntent.id.find(uploadId);
    if (!intent || hexIdentity(intent.actor.toHexString()) !== hexIdentity(actor) ||
        intent.targetKind !== targetKind || intent.targetId !== targetId || intent.expectedVersion !== expectedVersion) {
      throw new SenderError('No existe una autorización válida para esta subida.');
    }
    requireTargetWriter(ctx, targetKind, targetId, intent.actor);
    const previous = ctx.db.resourceFile.id.find(uploadId);
    if (previous) {
      if (previous.storageKey !== input.storageKey || previous.etag !== input.etag || previous.size !== input.size ||
          previous.name !== input.name.trim() || previous.contentType !== input.contentType.trim()) {
        throw new SenderError('Una subida confirmada no puede sustituirse por otro archivo.');
      }
      return;
    }
    if (intent.expiresAt.microsSinceUnixEpoch < ctx.timestamp.microsSinceUnixEpoch) throw new SenderError('La autorización de subida venció.');
    expectVersion(targetVersion(ctx, targetKind, targetId), expectedVersion);
    if (input.size <= 0n || input.size > MAX_FILE_BYTES) throw new SenderError('El archivo debe medir entre 1 byte y 50 MB.');
    const storageKey = requireText(input.storageKey, 'La ubicación del archivo', 1000);
    const etag = requireText(input.etag, 'La comprobación del archivo', 300);
    saveTargetBaseline(ctx, targetKind, targetId);
    ctx.db.resourceFile.insert({ id: uploadId, targetKind, targetId,
      name: requireText(input.name, 'El nombre del archivo', 200), size: input.size,
      contentType: requireText(input.contentType, 'El tipo del archivo', 200), storageKey, etag,
      uploadedBy: intent.actor, createdAt: ctx.timestamp, removedAt: undefined });
    bumpMaterial(ctx, targetKind, targetId, intent.actor);
    log(ctx, 'attach', 'resource_file', uploadId);
  },
);

function readableResource(tx: Ctx, fileId: string) {
    activeMember(tx);
    const legacy = /^legacy:(\d+)$/.exec(fileId);
    if (legacy) {
      const old = tx.db.workFile.id.find(BigInt(legacy[1]));
      if (old) mirrorLegacyFiles(tx, old.workId);
    }
    const file = tx.db.resourceFile.id.find(fileId);
    if (!file) throw new SenderError('El archivo no existe.');
    if (delivery2.reportFileReadable(tx.db, tx.sender, fileId)) return file;
    if (!delivery2.canReadTarget(tx.db, tx.sender, file.targetKind, file.targetId)) throw new SenderError('No tienes acceso a este archivo.');
    if (file.targetKind === 'profile') {
      const profile = tx.db.memberProfile.id.find(file.targetId)!;
      if (profile.photoFileId !== fileId && !profile.memberId.isEqual(tx.sender)) throw new SenderError('Esta foto ya no está compartida.');
    }
    targetVersion(tx, file.targetKind, file.targetId);
    if (file.removedAt !== undefined) {
      // Las evidencias conservan adjuntos retirados como registros recuperables propios;
      // no tienen snapshots del texto. targetVersion ya comprobó que el destino existe.
      const historical = file.targetKind === 'evidence' || (file.targetKind === 'note'
        ? [...tx.db.noteVersion.noteId.filter(file.targetId)].some((v) => v.attachmentIds.includes(fileId))
        : file.targetKind === 'guide' ? [...tx.db.guideVersion.guideId.filter(file.targetId)].some((v) => v.attachmentIds.includes(fileId)) : file.targetKind === 'work'
        ? [...tx.db.workRevision.workId.filter(file.targetId)].some((r) => r.attachmentIds.includes(fileId))
        : (file.targetKind === 'assignment' || file.targetKind === 'activity') &&
          [...tx.db.pageSnapshot.pageId.filter(file.targetId)].some((r) => r.page === file.targetKind && r.attachmentIds.includes(fileId)));
      if (!historical) throw new SenderError('El archivo ya no está disponible.');
    }
    return file;
}

export const get_file_download_access = spacetimedb.procedure(
  { fileId: t.string() }, t.string(),
  (ctx, { fileId }) => ctx.withTx((tx) => {
    const file = readableResource(tx, fileId);
    return JSON.stringify({ fileId, storageKey: file.storageKey, name: file.name, size: file.size.toString(),
      contentType: file.contentType, etag: file.etag });
  }),
);

// ---------------------------------------------------------------------------
// Archivos nativos: reservas limitadas, bloques inmutables y confirmación atómica
// ---------------------------------------------------------------------------
const RESOURCE_CHUNK_BYTES = 1024 * 1024;
const RESOURCE_TTL = 24n * 60n * 60n * 1_000_000n;
const DEFAULT_RESOURCE_CAPACITY = 256n * 1024n * 1024n;
const MAX_RESOURCE_CAPACITY = 512n * 1024n * 1024n;
type UploadRow = typeof resourceUpload.rowType.type;

function digest(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function capacity(ctx: Ctx) {
  return ctx.db.resourceCapacity.id.find(0) ?? ctx.db.resourceCapacity.insert({
    id: 0, limitBytes: DEFAULT_RESOURCE_CAPACITY, reservedBytes: 0n,
  });
}
function releaseUpload(ctx: Ctx, row: UploadRow, state: string) {
  if (row.state !== 'pending') return;
  for (const chunk of ctx.db.resourceChunk.uploadId.filter(row.id)) ctx.db.resourceChunk.id.delete(chunk.id);
  const quota = capacity(ctx);
  ctx.db.resourceCapacity.id.update({ ...quota, reservedBytes: quota.reservedBytes - row.bytes });
  ctx.db.resourceUpload.id.update({ ...row, state });
}
function ownedUpload(ctx: Ctx, id: string) {
  activeMember(ctx);
  const row = ctx.db.resourceUpload.id.find(id);
  if (!row || !row.actor.isEqual(ctx.sender)) throw new SenderError('La subida no pertenece a esta persona.');
  return row;
}
function pendingUpload(ctx: Ctx, id: string) {
  const row = ownedUpload(ctx, id);
  if (row.state !== 'pending') throw new SenderError('La subida ya no está pendiente.');
  if (row.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) throw new SenderError('La subida venció.');
  requireTargetWriter(ctx, row.targetKind, row.targetId);
  return row;
}

/** Techo local de datos binarios; no sustituye la cuota real de Maincloud. */
export const set_resource_capacity = spacetimedb.reducer({ bytes: t.u64() }, (ctx, { bytes }) => {
  if (!isOwner(ctx)) throw new SenderError('Solo el propietario configura el espacio de archivos.');
  const quota = capacity(ctx);
  if (bytes < quota.reservedBytes || bytes > MAX_RESOURCE_CAPACITY) {
    throw new SenderError('El espacio debe cubrir lo reservado y no superar 512 MiB.');
  }
  ctx.db.resourceCapacity.id.update({ ...quota, limitBytes: bytes });
  log(ctx, 'configure', 'resource_capacity', '0');
});

export const begin_resource_upload = spacetimedb.reducer({
  uploadId: t.string(), targetKind: t.string(), targetId: t.u64(), expectedVersion: t.u32(),
  name: t.string(), mime: t.string(), bytes: t.u64(), sha256: t.string(),
}, (ctx, input) => {
  activeMember(ctx); resourceKind(input.targetKind); requireTargetWriter(ctx, input.targetKind, input.targetId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.uploadId)) {
    throw new SenderError('Identificador de subida inválido.');
  }
  if (input.bytes <= 0n || input.bytes > MAX_FILE_BYTES) throw new SenderError('El archivo debe medir entre 1 byte y 50 MB.');
  if (input.targetKind === 'profile' && (input.bytes > 5n * 1024n * 1024n || !['image/png', 'image/jpeg', 'image/webp'].includes(input.mime))) {
    throw new SenderError('Usa una foto PNG, JPEG o WebP de hasta 5 MiB.');
  }
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new SenderError('Comprobación SHA-256 inválida.');
  const name = requireText(input.name, 'El nombre del archivo', 200);
  const mime = requireText(input.mime, 'El tipo del archivo', 200);
  const previous = ctx.db.resourceUpload.id.find(input.uploadId);
  if (previous) {
    if (!previous.actor.isEqual(ctx.sender) || previous.targetKind !== input.targetKind || previous.targetId !== input.targetId ||
      previous.expectedVersion !== input.expectedVersion || previous.bytes !== input.bytes || previous.sha256 !== input.sha256 ||
      previous.name !== name || previous.mime !== mime) throw new SenderError('Esta subida ya está asociada a otro archivo.');
    if (previous.state === 'ready') return;
    pendingUpload(ctx, input.uploadId);
    return;
  }
  if (ctx.db.resourceFile.id.find(input.uploadId) || ctx.db.fileUploadIntent.id.find(input.uploadId)) {
    throw new SenderError('Identificador de subida ocupado.');
  }
  expectVersion(targetVersion(ctx, input.targetKind, input.targetId), input.expectedVersion);
  // Reclama reservas vencidas de esta persona antes de aplicar el límite concurrente.
  const own = [...ctx.db.resourceUpload.actor.filter(ctx.sender)];
  for (const row of own) if (row.state === 'pending' && row.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) releaseUpload(ctx, row, 'expired');
  if (own.filter((row) => row.state === 'pending' && row.expiresAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch).length >= 3) {
    throw new SenderError('Ya tienes tres subidas pendientes. Cancela o termina alguna.');
  }
  const quota = capacity(ctx);
  if (quota.reservedBytes + input.bytes > quota.limitBytes) throw new SenderError('No queda espacio reservado para este archivo.');
  const expiresAt = new Timestamp(ctx.timestamp.microsSinceUnixEpoch + RESOURCE_TTL);
  ctx.db.resourceUpload.insert({ id: input.uploadId, actor: ctx.sender, targetKind: input.targetKind,
    targetId: input.targetId, expectedVersion: input.expectedVersion, name, mime, bytes: input.bytes,
    sha256: input.sha256, chunkCount: Math.ceil(Number(input.bytes) / RESOURCE_CHUNK_BYTES), state: 'pending',
    createdAt: ctx.timestamp, expiresAt });
  ctx.db.resourceCapacity.id.update({ ...quota, reservedBytes: quota.reservedBytes + input.bytes });
  ctx.db.resourceExpiry.insert({ id: 0n, scheduledAt: ScheduleAt.time(expiresAt.microsSinceUnixEpoch), uploadId: input.uploadId });
});

export const put_resource_chunk = spacetimedb.reducer({
  uploadId: t.string(), index: t.u32(), bytes: t.byteArray(), sha256: t.string(),
}, (ctx, input) => {
  const upload = pendingUpload(ctx, input.uploadId);
  const expected = Math.min(RESOURCE_CHUNK_BYTES, Number(upload.bytes) - input.index * RESOURCE_CHUNK_BYTES);
  if (input.index >= upload.chunkCount || input.bytes.length !== expected) throw new SenderError('Tamaño o índice de bloque inválido.');
  if (digest(input.bytes) !== input.sha256) throw new SenderError('El bloque no supera la comprobación de integridad.');
  const id = `${input.uploadId}:${input.index}`;
  const previous = ctx.db.resourceChunk.id.find(id);
  if (previous) {
    if (previous.sha256 !== input.sha256) throw new SenderError('Un bloque recibido no puede sustituirse.');
    return;
  }
  ctx.db.resourceChunk.insert({ id, ...input });
});

export const finalize_resource_upload = spacetimedb.reducer({ uploadId: t.string() }, (ctx, { uploadId }) => {
  const existing = ownedUpload(ctx, uploadId);
  if (existing.state === 'ready') return;
  const upload = pendingUpload(ctx, uploadId);
  expectVersion(targetVersion(ctx, upload.targetKind, upload.targetId), upload.expectedVersion);
  const hash = sha256.create();
  for (let index = 0; index < upload.chunkCount; index++) {
    const chunk = ctx.db.resourceChunk.id.find(`${uploadId}:${index}`);
    if (!chunk) throw new SenderError('Faltan bloques del archivo. Reanuda la subida.');
    hash.update(chunk.bytes);
  }
  const actual = Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== upload.sha256) throw new SenderError('El archivo no supera la comprobación de integridad.');
  if (upload.targetKind === 'profile') {
    const head = ctx.db.resourceChunk.id.find(`${uploadId}:0`)!.bytes;
    const png = head.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => head[i] === b);
    const jpeg = head.length >= 3 && head[0] === 255 && head[1] === 216 && head[2] === 255;
    const webp = head.length >= 12 && [82, 73, 70, 70].every((b, i) => head[i] === b) && [87, 69, 66, 80].every((b, i) => head[i + 8] === b);
    if (!(upload.mime === 'image/png' && png || upload.mime === 'image/jpeg' && jpeg || upload.mime === 'image/webp' && webp)) {
      throw new SenderError('El contenido de la foto no coincide con su tipo de imagen.');
    }
  }
  saveTargetBaseline(ctx, upload.targetKind, upload.targetId);
  ctx.db.resourceFile.insert({ id: uploadId, targetKind: upload.targetKind, targetId: upload.targetId,
    name: upload.name, contentType: upload.mime, size: upload.bytes, storageKey: `stdb:${uploadId}`,
    etag: upload.sha256, uploadedBy: ctx.sender, createdAt: ctx.timestamp, removedAt: undefined });
  ctx.db.resourceUpload.id.update({ ...upload, state: 'ready' });
  bumpMaterial(ctx, upload.targetKind, upload.targetId);
  log(ctx, 'attach', 'resource_file', uploadId);
});

export const cancel_resource_upload = spacetimedb.reducer({ uploadId: t.string() }, (ctx, { uploadId }) => {
  const upload = ownedUpload(ctx, uploadId);
  if (upload.state === 'ready') return; // Confirmar y cancelar simultáneamente nunca borra una versión.
  releaseUpload(ctx, upload, 'cancelled');
});

export const expire_resource_upload = spacetimedb.reducer(
  { onSchedule: resourceExpiry }, { event: resourceExpiry.rowType }, (ctx, { event }) => {
    if (!ctx.sender.isEqual(ctx.identity)) throw new SenderError('Solo el programador interno puede limpiar subidas.');
    const upload = ctx.db.resourceUpload.id.find(event.uploadId);
    if (!upload || upload.state === 'ready' || upload.expiresAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch) return;
    releaseUpload(ctx, upload, 'expired');
    ctx.db.resourceUpload.id.delete(upload.id);
  },
);

export const get_resource_upload_status = spacetimedb.procedure({ uploadId: t.string() }, t.string(),
  (ctx, { uploadId }) => ctx.withTx((tx) => {
    activeMember(tx);
    // Distingue un intento nunca aceptado/ya limpiado de una respuesta perdida. No revela bytes.
    if (!tx.db.resourceUpload.id.find(uploadId)) return 'null';
    const upload = ownedUpload(tx, uploadId);
    const expired = upload.state === 'pending' && upload.expiresAt.microsSinceUnixEpoch <= tx.timestamp.microsSinceUnixEpoch;
    return JSON.stringify({ uploadId, state: expired ? 'expired' : upload.state, sha256: upload.sha256,
      ...(upload.state === 'ready' ? { fileId: upload.id } : {}),
      receivedIndexes: [...tx.db.resourceChunk.uploadId.filter(uploadId)].map((row) => row.index).sort((a, b) => a - b) });
  }));

export const get_resource_manifest = spacetimedb.procedure({ fileId: t.string() }, t.string(),
  (ctx, { fileId }) => ctx.withTx((tx) => {
    const file = readableResource(tx, fileId);
    const sourceId = file.storageKey.startsWith('stdb:') ? file.storageKey.slice(5) : undefined;
    const native = sourceId ? tx.db.resourceUpload.id.find(sourceId) : undefined;
    const direct = native?.state === 'ready';
    return JSON.stringify({ storageKind: direct ? 'spacetime' : 'legacy', fileId, name: file.name,
      mime: file.contentType, bytes: file.size.toString(), chunkCount: direct ? native.chunkCount : 0,
      sha256: direct ? native.sha256 : '' });
  }));

export const read_resource_chunk = spacetimedb.procedure({ fileId: t.string(), index: t.u32() },
  t.object('ResourceChunkResult', { index: t.u32(), bytes: t.byteArray(), sha256: t.string() }),
  (ctx, { fileId, index }) => ctx.withTx((tx) => {
    const file = readableResource(tx, fileId);
    if (!file.storageKey.startsWith('stdb:')) throw new SenderError('El archivo usa almacenamiento anterior.');
    const sourceId = file.storageKey.slice(5);
    if (tx.db.resourceUpload.id.find(sourceId)?.state !== 'ready') throw new SenderError('El archivo no está disponible.');
    const row = tx.db.resourceChunk.id.find(`${sourceId}:${index}`);
    if (!row) throw new SenderError('El bloque no existe.');
    return { index: row.index, bytes: row.bytes, sha256: row.sha256 };
  }));

// ---------------------------------------------------------------------------
// Vistas: lo único que leen los clientes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Repaso espaciado: contenido colaborativo y aprendizaje estrictamente personal
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Exposiciones: ensayos por texto y revisión explícita, sin novedades comunitarias
// ---------------------------------------------------------------------------

function presentationValue<T>(read: () => T): T {
  try { return read(); } catch (error) { throw new SenderError(error instanceof Error ? error.message : 'Los datos de la exposición no son válidos.'); }
}
function presentationRequest(value: string) { return requireText(value, 'La solicitud', 120); }
function ownPresentation(ctx: Ctx, practiceId: bigint, allowArchived = false) {
  activeMember(ctx);
  const row = ctx.db.presentationPractice.id.find(practiceId);
  if (!row || !row.ownerId.isEqual(ctx.sender)) throw new SenderError('La exposición no existe o no tienes acceso.');
  if (row.archived && !allowArchived) throw new SenderError('La exposición está archivada.');
  return row;
}
function presentationVersion(actual: number, expected: number | undefined) {
  if (actual !== expected) throw new SenderError('El contenido cambió. Actualiza antes de guardar.');
}
function presentationSourceVersion(db: ViewDb, sender: Ctx['sender'], subjectId: bigint, kind?: string, id?: bigint): number | undefined {
  if (kind === undefined && id === undefined) return undefined;
  if (id === undefined || (kind !== 'note' && kind !== 'guide')) throw new SenderError('La fuente debe ser una nota o guía accesible.');
  if (delivery2.withdrawn(db, kind, id)) throw new SenderError('La fuente está retirada o no está disponible.');
  const row = kind === 'note' ? db.note.id.find(id) : db.studyGuide.id.find(id);
  if (!row || row.subjectId !== subjectId || ('visibility' in row && row.visibility !== 'group' && !row.author.isEqual(sender))) {
    throw new SenderError('La fuente no existe, no es accesible o pertenece a otra materia.');
  }
  return row.version;
}
function presentationVisibleSource<T extends { subjectId: bigint; sourceKind?: string; sourceId?: bigint; sourceVersion?: number }>(db: ViewDb, sender: Ctx['sender'], row: T): T {
  try { presentationSourceVersion(db, sender, row.subjectId, row.sourceKind, row.sourceId); return row; }
  catch { return { ...row, sourceKind: undefined, sourceId: undefined, sourceVersion: undefined }; }
}
function ownPresentationAttempt(ctx: Ctx, attemptId: bigint) {
  activeMember(ctx);
  const attempt = ctx.db.presentationAttempt.id.find(attemptId);
  if (!attempt) throw new SenderError('El intento no existe.');
  ownPresentation(ctx, attempt.practiceId);
  return attempt;
}
function reviewablePresentationAttempt(ctx: Ctx, attemptId: bigint) {
  activeMember(ctx);
  const attempt = ctx.db.presentationAttempt.id.find(attemptId);
  const practice = attempt && ctx.db.presentationPractice.id.find(attempt.practiceId);
  if (!attempt || !practice || practice.archived || attempt.status !== 'completed' || !isActive(ctx.db, practice.ownerId)
    || !practice.reviewerId?.isEqual(ctx.sender)) throw new SenderError('No tienes acceso para revisar este intento.');
  return { attempt, practice };
}

export const save_presentation_practice = spacetimedb.reducer({
  practiceId: t.u64().optional(), subjectId: t.u64(), termId: t.u64().optional(), ...presentationConfiguration,
  sourceKind: t.string().optional(), sourceId: t.u64().optional(), expectedVersion: t.u32().optional(), requestId: t.string(),
}, (ctx, input) => {
  activeMember(ctx);
  const config = presentationValue(() => normalizePresentationConfiguration(input));
  const requestId = presentationRequest(input.requestId);
  const creationHash = digest(new TextEncoder().encode(JSON.stringify({ ...config, subjectId: String(input.subjectId),
    termId: input.termId?.toString(), sourceKind: input.sourceKind, sourceId: input.sourceId?.toString(), expectedVersion: input.expectedVersion })));
  if (input.practiceId === undefined) {
    const previous = [...ctx.db.presentationPractice.ownerId.filter(ctx.sender)].find((row) => row.requestId === requestId);
    if (previous) {
      if (previous.creationHash !== creationHash) throw new SenderError('La solicitud ya se usó con otro contenido.');
      return;
    }
  }
  requireSubject(ctx, input.subjectId);
  if (input.termId !== undefined && ctx.db.term.id.find(input.termId)?.subjectId !== input.subjectId) throw new SenderError('El parcial no pertenece a esa materia.');
  const sourceVersion = presentationSourceVersion(ctx.db, ctx.sender, input.subjectId, input.sourceKind, input.sourceId);
  const source = { sourceKind: input.sourceKind, sourceId: input.sourceId, sourceVersion };
  if (input.practiceId === undefined) {
    if ([...ctx.db.presentationPractice.ownerId.filter(ctx.sender)].length >= 200) throw new SenderError('Has alcanzado el máximo de 200 exposiciones.');
    ctx.db.presentationPractice.insert({ id: 0n, ownerId: ctx.sender, reviewerId: undefined,
      subjectId: input.subjectId, termId: input.termId, ...config, ...source, archived: false, version: 1,
      requestId, creationHash, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
  } else {
    const row = ownPresentation(ctx, input.practiceId); presentationVersion(row.version, input.expectedVersion);
    ctx.db.presentationPractice.id.update({ ...row, subjectId: input.subjectId, termId: input.termId, ...config, ...source,
      version: row.version + 1, updatedAt: ctx.timestamp });
  }
});

export const set_presentation_reviewer = spacetimedb.reducer({ practiceId: t.u64(), reviewerId: t.identity().optional(), expectedVersion: t.u32() },
  (ctx, { practiceId, reviewerId, expectedVersion }) => {
    const row = ownPresentation(ctx, practiceId); presentationVersion(row.version, expectedVersion);
    if (reviewerId && (reviewerId.isEqual(ctx.sender) || !isActive(ctx.db, reviewerId))) throw new SenderError('Elige a otro integrante activo como revisor.');
    ctx.db.presentationPractice.id.update({ ...row, reviewerId, version: row.version + 1, updatedAt: ctx.timestamp });
  });
export const archive_presentation_practice = spacetimedb.reducer({ practiceId: t.u64(), archived: t.bool(), expectedVersion: t.u32() },
  (ctx, { practiceId, archived, expectedVersion }) => {
    const row = ownPresentation(ctx, practiceId, true); presentationVersion(row.version, expectedVersion);
    ctx.db.presentationPractice.id.update({ ...row, archived, reviewerId: archived ? undefined : row.reviewerId,
      version: row.version + 1, updatedAt: ctx.timestamp });
  });
export const create_presentation_attempt = spacetimedb.reducer({ practiceId: t.u64(), requestId: t.string(), expectedVersion: t.u32() },
  (ctx, { practiceId, requestId: rawRequest, expectedVersion }) => {
    const row = ownPresentation(ctx, practiceId); const requestId = presentationRequest(rawRequest);
    const attempts = [...ctx.db.presentationAttempt.practiceId.filter(practiceId)];
    const previous = [...ctx.db.presentationAttempt.iter()].find((attempt) => attempt.requestId === requestId &&
      ctx.db.presentationPractice.id.find(attempt.practiceId)?.ownerId.isEqual(ctx.sender));
    if (previous) { if (previous.practiceId !== practiceId || previous.creationVersion !== expectedVersion) throw new SenderError('La solicitud ya se usó con otra versión.'); return; }
    presentationVersion(row.version, expectedVersion);
    if (row.sourceKind && row.sourceId !== undefined && delivery2.withdrawn(ctx.db, row.sourceKind, row.sourceId)) {
      throw new SenderError('La fuente está retirada. Cambia o elimina la referencia antes de crear otro intento.');
    }
    if (attempts.some((attempt) => attempt.status === 'draft')) throw new SenderError('Completa el borrador actual antes de crear otro intento.');
    if (attempts.length >= 100) throw new SenderError('La exposición admite hasta 100 intentos.');
    const last = attempts.sort((a, b) => b.number - a.number)[0];
    const { title, topic, audience, targetMinutes, keyPoints, sourceKind, sourceId, sourceVersion, subjectId, termId } = row;
    const attempt = ctx.db.presentationAttempt.insert({ id: 0n, practiceId, number: attempts.length + 1,
      title, topic, audience, targetMinutes, keyPoints, sourceKind, sourceId, sourceVersion, subjectId, termId,
      status: 'draft', body: last?.body ?? '', version: 1, requestId, creationVersion: expectedVersion,
      createdAt: ctx.timestamp, updatedAt: ctx.timestamp, completedAt: undefined });
    ctx.db.presentationPersonal.insert({ attemptId: attempt.id, clarity: '', examples: '', decisions: '', limitations: '', nextSteps: '' });
    ctx.db.presentationPractice.id.update({ ...row, version: row.version + 1, updatedAt: ctx.timestamp });
  });
export const save_presentation_attempt = spacetimedb.reducer({ attemptId: t.u64(), body: t.string(), clarity: t.string(), examples: t.string(),
  decisions: t.string(), limitations: t.string(), nextSteps: t.string(), expectedVersion: t.u32() }, (ctx, input) => {
    const row = ownPresentationAttempt(ctx, input.attemptId); presentationVersion(row.version, input.expectedVersion);
    if (row.status !== 'draft') throw new SenderError('El intento completado no se puede modificar. Crea uno nuevo.');
    const fields = presentationValue(() => ({ ...normalizePresentationObservations(input), nextSteps: normalizePresentationNextSteps(input.nextSteps) }));
    const body = presentationValue(() => normalizePresentationBody(input.body));
    ctx.db.presentationAttempt.id.update({ ...row, body, version: row.version + 1, updatedAt: ctx.timestamp });
    ctx.db.presentationPersonal.attemptId.update({ attemptId: row.id, ...fields });
  });
export const complete_presentation_attempt = spacetimedb.reducer({ attemptId: t.u64(), expectedVersion: t.u32() },
  (ctx, { attemptId, expectedVersion }) => {
    const row = ownPresentationAttempt(ctx, attemptId);
    if (row.status === 'completed' && (row.version === expectedVersion + 1 || row.version === expectedVersion)) return;
    presentationVersion(row.version, expectedVersion);
    if (row.status !== 'draft') throw new SenderError('El intento ya está completado.');
    const body = presentationValue(() => normalizePresentationBody(row.body, true));
    const questions = presentationValue(() => presentationGuidingQuestions(row));
    if ([...ctx.db.presentationQuestion.attemptId.filter(attemptId)].length + questions.length > 100) throw new SenderError('El intento admite hasta 100 preguntas, incluidas las cinco orientadoras.');
    ctx.db.presentationAttempt.id.update({ ...row, body, status: 'completed', version: row.version + 1,
      updatedAt: ctx.timestamp, completedAt: ctx.timestamp });
    for (const text of questions) ctx.db.presentationQuestion.insert({ id: 0n, attemptId, authorId: ctx.sender,
      kind: 'guided', text, answer: '', version: 1, requestId: '', createdAt: ctx.timestamp, answeredAt: undefined });
  });
export const ask_presentation_question = spacetimedb.reducer({ attemptId: t.u64(), text: t.string(), requestId: t.string() },
  (ctx, { attemptId, text: rawText, requestId: rawRequest }) => {
    activeMember(ctx);
    const attempt = ctx.db.presentationAttempt.id.find(attemptId);
    const practice = attempt && ctx.db.presentationPractice.id.find(attempt.practiceId);
    if (!attempt || !practice) throw new SenderError('El intento no existe.');
    const own = practice.ownerId.isEqual(ctx.sender);
    if (own) ownPresentation(ctx, practice.id); else reviewablePresentationAttempt(ctx, attemptId);
    const text = presentationValue(() => normalizePresentationQuestion(rawText)); const requestId = presentationRequest(rawRequest);
    const questions = [...ctx.db.presentationQuestion.attemptId.filter(attemptId)];
    const previous = [...ctx.db.presentationQuestion.iter()].find((question) => question.authorId.isEqual(ctx.sender) && question.requestId === requestId);
    if (previous) { if (previous.attemptId !== attemptId || previous.text !== text) throw new SenderError('La solicitud ya se usó con otro contenido.'); return; }
    const limit = attempt.status === 'draft' ? 95 : 100;
    if (questions.length >= limit) throw new SenderError('El intento admite hasta 100 preguntas, incluidas las cinco orientadoras.');
    ctx.db.presentationQuestion.insert({ id: 0n, attemptId, authorId: ctx.sender, kind: own ? 'personal' : 'peer', text,
      answer: '', version: 1, requestId, createdAt: ctx.timestamp, answeredAt: undefined });
  });
export const answer_presentation_question = spacetimedb.reducer({ questionId: t.u64(), answer: t.string(), expectedVersion: t.u32() },
  (ctx, { questionId, answer: rawAnswer, expectedVersion }) => {
    activeMember(ctx);
    const row = ctx.db.presentationQuestion.id.find(questionId); if (!row) throw new SenderError('La pregunta no existe.');
    ownPresentationAttempt(ctx, row.attemptId); presentationVersion(row.version, expectedVersion);
    const answer = presentationValue(() => normalizePresentationAnswer(rawAnswer));
    ctx.db.presentationQuestion.id.update({ ...row, answer, version: row.version + 1, answeredAt: ctx.timestamp });
  });
export const save_presentation_feedback = spacetimedb.reducer({ attemptId: t.u64(), clarity: t.string(), examples: t.string(), decisions: t.string(),
  limitations: t.string(), comment: t.string(), expectedVersion: t.u32().optional() }, (ctx, input) => {
    reviewablePresentationAttempt(ctx, input.attemptId);
    const fields = presentationValue(() => normalizePresentationFeedback(input));
    const row = [...ctx.db.presentationFeedback.attemptId.filter(input.attemptId)].find((feedback) => feedback.authorId.isEqual(ctx.sender));
    if (row) presentationVersion(row.version, input.expectedVersion);
    else if (input.expectedVersion !== undefined) throw new SenderError('El contenido cambió. Actualiza antes de guardar.');
    if (row) ctx.db.presentationFeedback.id.update({ ...row, ...fields, version: row.version + 1, updatedAt: ctx.timestamp });
    else ctx.db.presentationFeedback.insert({ id: 0n, attemptId: input.attemptId, authorId: ctx.sender, ...fields,
      version: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
  });

type SpacedCollectionRow = NonNullable<ReturnType<Ctx['db']['spacedCollection']['id']['find']>>;
type SpacedCardRow = NonNullable<ReturnType<Ctx['db']['spacedCard']['id']['find']>>;

const spacedKey = (id: bigint, sender: Ctx['sender']) => `${id}:${sender.toHexString()}`;

function spacedSourceVersion(db: ViewDb, sender: Ctx['sender'], collection: SpacedCollectionRow,
  kind: string, id: bigint): number | undefined {
  if ((kind !== 'note' && kind !== 'guide') || delivery2.withdrawn(db, kind, id)) return undefined;
  if (kind === 'guide') {
    const row = db.studyGuide.id.find(id);
    return row?.subjectId === collection.subjectId ? row.version : undefined;
  }
  if (kind !== 'note') return undefined;
  const row = db.note.id.find(id);
  if (!row || row.subjectId !== collection.subjectId) return undefined;
  if (row.visibility === 'group') return row.version;
  if (collection.visibility === 'personal' && row.author.isEqual(collection.ownerId)
    && row.author.isEqual(sender)) return row.version;
  return undefined;
}

function requireSpacedCollection(ctx: Ctx, id: bigint) {
  activeMember(ctx);
  const row = ctx.db.spacedCollection.id.find(id);
  if (!row || (row.visibility !== 'group' && !row.ownerId.isEqual(ctx.sender))) {
    throw new SenderError('La colección no existe o no tienes acceso.');
  }
  return row;
}

function requireSpacedEditable(ctx: Ctx, id: bigint) {
  const row = requireSpacedCollection(ctx, id);
  if (row.archived) throw new SenderError('La colección está archivada.');
  return row;
}

function requireSpacedVersion(actual: number, expected: number | undefined) {
  if (expected !== actual) throw new SenderError('El contenido cambió. Actualiza antes de guardar.');
}

/** Publicar comprueba también tarjetas archivadas: restaurarlas no puede filtrar fuentes privadas. */
function requireSpacedPublicSources(ctx: Ctx, collection: SpacedCollectionRow) {
  for (const card of ctx.db.spacedCard.collectionId.filter(collection.id)) {
    if (spacedSourceVersion(ctx.db, ctx.sender, { ...collection, visibility: 'group' },
      card.sourceKind, card.sourceId) === undefined) {
      throw new SenderError('Para compartir, todas las fuentes deben existir y ser del grupo.');
    }
  }
}

/** Referencia/archivo no cambia lo aprendido, pero invalida sesiones con versiones viejas. */
function preserveSpacedLearning(ctx: Ctx, before: SpacedCardRow, nextVersion: number) {
  for (const progress of ctx.db.spacedProgress.cardId.filter(before.id)) {
    // Una versión de contenido anterior ya estaba pendiente de reiniciar: no la actualizamos.
    if (progress.cardVersion !== before.version) continue;
    ctx.db.spacedProgress.key.update({ ...progress, cardVersion: nextVersion, revision: progress.revision + 1 });
  }
}

export const save_spaced_collection = spacetimedb.reducer(
  { collectionId: t.u64().optional(), subjectId: t.u64(), termId: t.u64().optional(),
    title: t.string(), visibility: t.string(), expectedVersion: t.u32().optional() },
  (ctx, input) => {
    activeMember(ctx);
    requireSubject(ctx, input.subjectId);
    if (input.termId !== undefined && ctx.db.term.id.find(input.termId)?.subjectId !== input.subjectId) {
      throw new SenderError('El parcial no pertenece a esa materia.');
    }
    if (!['personal', 'group'].includes(input.visibility)) throw new SenderError('Visibilidad inválida.');
    const title = requireText(input.title, 'El título', 200);
    if (input.collectionId === undefined) {
      ctx.db.spacedCollection.insert({ id: 0n, subjectId: input.subjectId, termId: input.termId, title,
        visibility: input.visibility, ownerId: ctx.sender, version: 1, archived: false,
        createdAt: ctx.timestamp, updatedAt: ctx.timestamp, updatedBy: ctx.sender });
      return;
    }
    const row = requireSpacedEditable(ctx, input.collectionId);
    requireSpacedVersion(row.version, input.expectedVersion);
    if (input.visibility !== row.visibility) {
      throw new SenderError('Usa Publicar para compartir una colección; su visibilidad no cambia al editar.');
    }
    if (row.subjectId !== input.subjectId && [...ctx.db.spacedCard.collectionId.filter(row.id)].length) {
      throw new SenderError('La materia no cambia mientras la colección tenga tarjetas.');
    }
    if (row.title === title && row.subjectId === input.subjectId && row.termId === input.termId) return;
    ctx.db.spacedCollection.id.update({ ...row, subjectId: input.subjectId, termId: input.termId, title,
      version: row.version + 1, updatedAt: ctx.timestamp, updatedBy: ctx.sender });
  },
);

export const publish_spaced_collection = spacetimedb.reducer(
  { collectionId: t.u64(), expectedVersion: t.u32() },
  (ctx, { collectionId, expectedVersion }) => {
    const row = requireSpacedEditable(ctx, collectionId);
    if (!row.ownerId.isEqual(ctx.sender)) throw new SenderError('Solo su creador puede publicar la colección.');
    requireSpacedVersion(row.version, expectedVersion);
    requireSpacedPublicSources(ctx, row);
    if (row.visibility === 'group') return;
    ctx.db.spacedCollection.id.update({ ...row, visibility: 'group', version: row.version + 1,
      updatedAt: ctx.timestamp, updatedBy: ctx.sender });
  },
);

export const archive_spaced_collection = spacetimedb.reducer(
  { collectionId: t.u64(), archived: t.bool(), expectedVersion: t.u32() },
  (ctx, { collectionId, archived, expectedVersion }) => {
    const row = requireSpacedCollection(ctx, collectionId);
    if (!row.ownerId.isEqual(ctx.sender)) throw new SenderError('Solo su creador puede archivar la colección.');
    requireSpacedVersion(row.version, expectedVersion);
    if (row.archived === archived) return;
    ctx.db.spacedCollection.id.update({ ...row, archived, version: row.version + 1,
      updatedAt: ctx.timestamp, updatedBy: ctx.sender });
  },
);

export const save_spaced_card = spacetimedb.reducer(
  { cardId: t.u64().optional(), collectionId: t.u64(), question: t.string(), explanation: t.string(),
    hint: t.string(), sourceKind: t.string(), sourceId: t.u64(), expectedVersion: t.u32().optional() },
  (ctx, input) => {
    const collection = requireSpacedEditable(ctx, input.collectionId);
    const question = requireText(input.question, 'La pregunta', 1000);
    const explanation = requireText(input.explanation, 'La explicación', 20_000);
    const hint = input.hint.trim();
    if (hint.length > 2000) throw new SenderError('La pista excede 2000 caracteres.');
    const sourceVersion = spacedSourceVersion(ctx.db, ctx.sender, collection, input.sourceKind, input.sourceId);
    if (sourceVersion === undefined) throw new SenderError('La fuente debe ser una nota o guía accesible de la misma materia.');
    if (input.cardId === undefined) {
      ctx.db.spacedCard.insert({ id: 0n, collectionId: collection.id, question, explanation, hint,
        sourceKind: input.sourceKind, sourceId: input.sourceId, sourceVersion, version: 1, archived: false,
        createdBy: ctx.sender, updatedBy: ctx.sender, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
      return;
    }
    const row = ctx.db.spacedCard.id.find(input.cardId);
    if (!row || row.collectionId !== collection.id) throw new SenderError('La tarjeta no existe.');
    requireSpacedVersion(row.version, input.expectedVersion);
    const contentChanged = row.question !== question || row.explanation !== explanation || row.hint !== hint;
    const sourceChanged = row.sourceKind !== input.sourceKind || row.sourceId !== input.sourceId
      || row.sourceVersion !== sourceVersion;
    if (!contentChanged && !sourceChanged) return;
    if (!contentChanged) preserveSpacedLearning(ctx, row, row.version + 1);
    ctx.db.spacedCard.id.update({ ...row, question, explanation, hint, sourceKind: input.sourceKind,
      sourceId: input.sourceId, sourceVersion, version: row.version + 1, updatedAt: ctx.timestamp,
      updatedBy: ctx.sender });
  },
);

export const archive_spaced_card = spacetimedb.reducer(
  { cardId: t.u64(), archived: t.bool(), expectedVersion: t.u32() },
  (ctx, { cardId, archived, expectedVersion }) => {
    activeMember(ctx);
    const row = ctx.db.spacedCard.id.find(cardId);
    if (!row) throw new SenderError('La tarjeta no existe.');
    requireSpacedEditable(ctx, row.collectionId);
    requireSpacedVersion(row.version, expectedVersion);
    if (row.archived === archived) return;
    preserveSpacedLearning(ctx, row, row.version + 1);
    ctx.db.spacedCard.id.update({ ...row, archived, version: row.version + 1,
      updatedAt: ctx.timestamp, updatedBy: ctx.sender });
  },
);

/** Corrige una referencia inaccesible sin exigir al cliente contenido que ya no puede leer. */
export const replace_spaced_card_source = spacetimedb.reducer(
  { cardId: t.u64(), expectedVersion: t.u32(), sourceKind: t.string(), sourceId: t.u64() },
  (ctx, { cardId, expectedVersion, sourceKind, sourceId }) => {
    activeMember(ctx);
    const row = ctx.db.spacedCard.id.find(cardId);
    if (!row) throw new SenderError('La tarjeta no existe.');
    const collection = requireSpacedEditable(ctx, row.collectionId);
    requireSpacedVersion(row.version, expectedVersion);
    const sourceVersion = spacedSourceVersion(ctx.db, ctx.sender, collection, sourceKind, sourceId);
    if (sourceVersion === undefined) throw new SenderError('La fuente debe ser una nota o guía accesible de la misma materia.');
    if (row.sourceKind === sourceKind && row.sourceId === sourceId && row.sourceVersion === sourceVersion) return;
    preserveSpacedLearning(ctx, row, row.version + 1);
    ctx.db.spacedCard.id.update({ ...row, sourceKind, sourceId, sourceVersion,
      version: row.version + 1, updatedBy: ctx.sender, updatedAt: ctx.timestamp });
  },
);

export const set_spaced_enrollment = spacetimedb.reducer(
  { collectionId: t.u64(), active: t.bool() },
  (ctx, { collectionId, active }) => {
    const collection = requireSpacedCollection(ctx, collectionId);
    if (active && collection.archived) throw new SenderError('La colección está archivada.');
    const key = spacedKey(collectionId, ctx.sender);
    const row = { key, memberId: ctx.sender, collectionId, active, updatedAt: ctx.timestamp };
    if (ctx.db.spacedEnrollment.key.find(key)) ctx.db.spacedEnrollment.key.update(row);
    else ctx.db.spacedEnrollment.insert(row);
  },
);

export const review_spaced_card = spacetimedb.reducer(
  { cardId: t.u64(), cardVersion: t.u32(), expectedRevision: t.u32(), rating: t.string(), requestId: t.string() },
  (ctx, { cardId, cardVersion, expectedRevision, rating, requestId }) => {
    activeMember(ctx);
    if (!['remembered', 'hint', 'again'].includes(rating)) throw new SenderError('Resultado de repaso inválido.');
    if (!requestId.trim() || requestId.length > 200) throw new SenderError('Identificador de repaso inválido.');
    const id = `${ctx.sender.toHexString()}:${requestId}`;
    const existing = ctx.db.spacedReview.id.find(id);
    if (existing) {
      if (existing.cardId !== cardId || existing.cardVersion !== cardVersion || existing.rating !== rating
        || existing.expectedRevision !== expectedRevision) throw new SenderError('Ese envío ya corresponde a otra revisión.');
      return;
    }
    const card = ctx.db.spacedCard.id.find(cardId);
    if (!card) throw new SenderError('La tarjeta no existe.');
    const collection = requireSpacedEditable(ctx, card.collectionId);
    if (card.archived || spacedSourceVersion(ctx.db, ctx.sender, collection, card.sourceKind, card.sourceId) === undefined) {
      throw new SenderError('La tarjeta o su fuente ya no está disponible.');
    }
    requireSpacedVersion(card.version, cardVersion);
    if (!ctx.db.spacedEnrollment.key.find(spacedKey(collection.id, ctx.sender))?.active) {
      throw new SenderError('Añade la colección a tu repaso antes de estudiar.');
    }
    const key = spacedKey(cardId, ctx.sender);
    const progress = ctx.db.spacedProgress.key.find(key);
    if ((progress?.revision ?? 0) !== expectedRevision) throw new SenderError('Ya se guardó una revisión más reciente. Actualiza tu cola.');
    const current = progress?.cardVersion === card.version ? progress : undefined;
    if (current && current.dueAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch) {
      throw new SenderError('Esta tarjeta todavía no está pendiente de repaso.');
    }
    const scheduled = nextSpacedSchedule(current?.step ?? 0, rating as SpacedRating, 0);
    const dueAt = new Timestamp(ctx.timestamp.microsSinceUnixEpoch + BigInt(scheduled.dueAt) * 1000n);
    const next = { key, memberId: ctx.sender, cardId, cardVersion, step: scheduled.step,
      revision: expectedRevision + 1, dueAt, reviewedAt: ctx.timestamp };
    if (progress) ctx.db.spacedProgress.key.update(next);
    else ctx.db.spacedProgress.insert(next);
    ctx.db.spacedReview.insert({ id, requestId, memberId: ctx.sender, cardId, cardVersion,
      expectedRevision, rating, step: scheduled.step, reviewedAt: ctx.timestamp, dueAt });
  },
);

// ---------------------------------------------------------------------------
// Aprende enseñando: práctica personal con un compañero invitado
// ---------------------------------------------------------------------------

const TEACHING_PROMPTS = [
  '¿En qué se diferencia este concepto de otro parecido?',
  '¿Por qué funciona el ejemplo que diste?',
  '¿Puedes describir un caso en el que este concepto no aplica?',
];

function teachingText(value: string, field: string, max = 12_000): string {
  const text = value.trim();
  if (text.length > max) throw new SenderError(`${field} excede ${max} caracteres.`);
  return text;
}

function ownTeachingPractice(ctx: Ctx, practiceId: bigint) {
  activeMember(ctx);
  const row = ctx.db.teachingPractice.id.find(practiceId);
  if (!row || !row.owner.isEqual(ctx.sender)) throw new SenderError('La práctica no existe.');
  return row;
}

function teachingPersonalRow(ctx: Ctx, practiceId: bigint) {
  const row = ctx.db.teachingPersonal.practiceId.find(practiceId);
  if (!row) throw new SenderError('La información personal de la práctica no existe.');
  return row;
}

function checkTeachingSource(
  ctx: Ctx,
  subjectId: bigint,
  sourceKind: string | undefined,
  sourceId: bigint | undefined,
) {
  if (sourceKind === undefined && sourceId === undefined) return undefined;
  if ((sourceKind !== 'note' && sourceKind !== 'guide') || sourceId === undefined) {
    throw new SenderError('La fuente debe ser una nota o guía accesible.');
  }
  if (delivery2.withdrawn(ctx.db, sourceKind, sourceId) || !delivery2.canReadTarget(ctx.db, ctx.sender, sourceKind, sourceId)) {
    throw new SenderError('La fuente no existe o no tienes acceso.');
  }
  const source = sourceKind === 'note'
    ? ctx.db.note.id.find(sourceId)
    : ctx.db.studyGuide.id.find(sourceId);
  if (!source || (sourceKind === 'note' && 'visibility' in source
    && source.visibility !== 'group' && !source.author.isEqual(ctx.sender))) {
    throw new SenderError('La fuente no existe o no tienes acceso.');
  }
  if (source.subjectId !== subjectId) throw new SenderError('La fuente debe ser de la misma materia.');
  return source.version;
}

export const create_teaching_practice = spacetimedb.reducer(
  {
    subjectId: t.u64(), topic: t.string(), concept: t.string(), example: t.string(), limits: t.string(),
    sourceKind: t.string().optional(), sourceId: t.u64().optional(),
  },
  (ctx, { subjectId, topic, concept, example, limits, sourceKind, sourceId }) => {
    activeMember(ctx);
    requireSubject(ctx, subjectId);
    const fields = {
      topic: requireText(topic, 'El tema', 120),
      concept: teachingText(concept, 'El concepto'),
      example: teachingText(example, 'El ejemplo'),
      limits: teachingText(limits, 'Dónde aplica'),
    };
    const sourceVersion = checkTeachingSource(ctx, subjectId, sourceKind, sourceId);
    const row = ctx.db.teachingPractice.insert({
      id: 0n, owner: ctx.sender, reviewer: undefined, subjectId, ...fields,
      revisedConcept: '', revisedExample: '', revisedLimits: '', status: 'draft',
      createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
    });
    ctx.db.teachingPersonal.insert({
      practiceId: row.id, reflection: '', topicsToReview: '', sourceKind, sourceId, sourceVersion,
      publishedNoteId: undefined,
    });
  },
);

export const save_teaching_practice = spacetimedb.reducer(
  {
    practiceId: t.u64(), concept: t.string(), example: t.string(), limits: t.string(),
    revisedConcept: t.string(), revisedExample: t.string(), revisedLimits: t.string(),
    reflection: t.string(), topicsToReview: t.string(),
  },
  (ctx, { practiceId, reflection, topicsToReview, ...input }) => {
    const row = ownTeachingPractice(ctx, practiceId);
    if (row.status === 'completed') throw new SenderError('Reabre la práctica para seguir editando.');
    const personal = teachingPersonalRow(ctx, practiceId);
    const initial = {
      concept: teachingText(input.concept, 'El concepto'),
      example: teachingText(input.example, 'El ejemplo'),
      limits: teachingText(input.limits, 'Dónde aplica'),
    };
    if (row.status !== 'draft' && (row.concept !== initial.concept
      || row.example !== initial.example || row.limits !== initial.limits)) {
      throw new SenderError('La explicación inicial se conserva al comenzar la práctica.');
    }
    const revised = {
      revisedConcept: teachingText(input.revisedConcept, 'El concepto revisado'),
      revisedExample: teachingText(input.revisedExample, 'El ejemplo revisado'),
      revisedLimits: teachingText(input.revisedLimits, 'Dónde aplica la revisión'),
    };
    const nextPersonal = {
      ...personal,
      reflection: teachingText(reflection, 'La reflexión'),
      topicsToReview: teachingText(topicsToReview, 'Los temas por repasar', 4000),
    };
    ctx.db.teachingPractice.id.update({ ...row, ...initial, ...revised, updatedAt: ctx.timestamp });
    ctx.db.teachingPersonal.practiceId.update(nextPersonal);
  },
);

export const start_teaching_practice = spacetimedb.reducer(
  { practiceId: t.u64() },
  (ctx, { practiceId }) => {
    const row = ownTeachingPractice(ctx, practiceId);
    if (row.status === 'practicing') return;
    if (row.status !== 'draft') throw new SenderError('Reabre la práctica para continuar.');
    requireText(row.concept, 'El concepto', 12_000);
    requireText(row.example, 'El ejemplo', 12_000);
    requireText(row.limits, 'Dónde aplica', 12_000);
    for (const text of TEACHING_PROMPTS) {
      ctx.db.teachingQuestion.insert({
        id: 0n, practiceId, author: ctx.sender, kind: 'guided', text, answer: '',
        createdAt: ctx.timestamp, answeredAt: undefined,
      });
    }
    ctx.db.teachingPractice.id.update({ ...row, status: 'practicing', updatedAt: ctx.timestamp });
  },
);

export const complete_teaching_practice = spacetimedb.reducer(
  { practiceId: t.u64() },
  (ctx, { practiceId }) => {
    const row = ownTeachingPractice(ctx, practiceId);
    if (row.status === 'completed') return;
    if (row.status !== 'practicing') throw new SenderError('Comienza la práctica antes de completarla.');
    const personal = teachingPersonalRow(ctx, practiceId);
    requireText(row.revisedConcept, 'El concepto revisado', 12_000);
    requireText(row.revisedExample, 'El ejemplo revisado', 12_000);
    requireText(row.revisedLimits, 'Dónde aplica la revisión', 12_000);
    requireText(personal.reflection, 'La reflexión', 12_000);
    if (![...ctx.db.teachingQuestion.practiceId.filter(practiceId)].some((q) => q.answer.trim())) {
      throw new SenderError('Responde al menos una pregunta antes de completar la práctica.');
    }
    ctx.db.teachingPractice.id.update({ ...row, status: 'completed', updatedAt: ctx.timestamp });
  },
);

export const reopen_teaching_practice = spacetimedb.reducer(
  { practiceId: t.u64() },
  (ctx, { practiceId }) => {
    const row = ownTeachingPractice(ctx, practiceId);
    if (row.status !== 'completed') throw new SenderError('Solo puedes reabrir una práctica completada.');
    ctx.db.teachingPractice.id.update({ ...row, status: 'practicing', updatedAt: ctx.timestamp });
  },
);

export const set_teaching_reviewer = spacetimedb.reducer(
  { practiceId: t.u64(), reviewer: t.identity().optional() },
  (ctx, { practiceId, reviewer }) => {
    const row = ownTeachingPractice(ctx, practiceId);
    if (reviewer !== undefined) {
      if (row.status !== 'practicing') throw new SenderError('Invita a un compañero durante la práctica.');
      if (reviewer.isEqual(ctx.sender)) throw new SenderError('Elige a otro integrante como compañero.');
      if (ctx.db.member.identity.find(reviewer)?.status !== 'active') {
        throw new SenderError('El compañero debe ser un miembro activo.');
      }
    }
    ctx.db.teachingPractice.id.update({ ...row, reviewer, updatedAt: ctx.timestamp });
  },
);

export const ask_teaching_question = spacetimedb.reducer(
  { practiceId: t.u64(), text: t.string() },
  (ctx, { practiceId, text }) => {
    activeMember(ctx);
    const row = ctx.db.teachingPractice.id.find(practiceId);
    if (!row?.reviewer?.isEqual(ctx.sender) || ctx.db.member.identity.find(row.owner)?.status !== 'active') {
      throw new SenderError('La práctica no existe o ya no estás invitado.');
    }
    if (row.status !== 'practicing') throw new SenderError('La práctica debe estar en curso.');
    const body = requireText(text, 'La pregunta', 4000);
    ctx.db.teachingQuestion.insert({
      id: 0n, practiceId, author: ctx.sender, kind: 'peer', text: body, answer: '',
      createdAt: ctx.timestamp, answeredAt: undefined,
    });
    ctx.db.teachingPractice.id.update({ ...row, updatedAt: ctx.timestamp });
  },
);

export const answer_teaching_question = spacetimedb.reducer(
  { questionId: t.u64(), answer: t.string() },
  (ctx, { questionId, answer }) => {
    activeMember(ctx);
    const question = ctx.db.teachingQuestion.id.find(questionId);
    if (!question) throw new SenderError('La pregunta no existe.');
    const row = ownTeachingPractice(ctx, question.practiceId);
    if (row.status !== 'practicing') throw new SenderError('La práctica debe estar en curso.');
    ctx.db.teachingQuestion.id.update({
      ...question, answer: requireText(answer, 'La respuesta', 4000), answeredAt: ctx.timestamp,
    });
    ctx.db.teachingPractice.id.update({ ...row, updatedAt: ctx.timestamp });
  },
);

/** La transacción crea una sola nota y guarda su referencia sin publicar datos privados. */
export const publish_teaching_explanation = spacetimedb.reducer(
  { practiceId: t.u64() },
  (ctx, { practiceId }) => {
    const row = ownTeachingPractice(ctx, practiceId);
    const personal = teachingPersonalRow(ctx, practiceId);
    if (personal.publishedNoteId !== undefined) return;
    if (row.status !== 'completed') throw new SenderError('Completa la práctica antes de publicarla.');
    const published = ctx.db.note.insert({
      id: 0n, subjectId: row.subjectId, topic: row.topic, title: row.topic,
      body: `Concepto\n${row.revisedConcept}\n\nEjemplo\n${row.revisedExample}\n\nDónde aplica y dónde no\n${row.revisedLimits}`,
      tags: ['aprende-ensenando'], visibility: 'group', source: 'student', author: row.owner,
      version: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
    });
    ctx.db.teachingPersonal.practiceId.update({ ...personal, publishedNoteId: published.id });
    log(ctx, 'create', 'note', published.id);
  },
);

export type ViewDb = Parameters<Parameters<typeof spacetimedb.view>[2]>[0]['db'];

// Salas: la ficha y la conversación tienen vistas independientes para que una
// invitación pendiente nunca entregue materiales ni historial privado.
const ROOM_METADATA = { title: t.string(), topic: t.string(), objective: t.string(), startsAt: t.timestamp(),
  endsAt: t.timestamp(), capacity: t.u32().optional() };
export const create_study_room = spacetimedb.reducer({ requestId: t.string(), subjectId: t.u64(), ...ROOM_METADATA,
  visibility: t.string(), helpContactId: t.u64().optional(), sourceKind: t.string().optional(), sourceId: t.u64().optional() }, rooms.createRoom);
export const update_study_room = spacetimedb.reducer({ roomId: t.u64(), ...ROOM_METADATA, expectedVersion: t.u32() }, rooms.updateRoom);
export const join_study_room = spacetimedb.reducer({ roomId: t.u64() }, rooms.joinRoom);
export const leave_study_room = spacetimedb.reducer({ roomId: t.u64() }, rooms.leaveRoom);
export const invite_study_room_member = spacetimedb.reducer({ roomId: t.u64(), memberId: t.identity() }, rooms.inviteMember);
export const respond_study_room_invitation = spacetimedb.reducer({ roomId: t.u64(), accepted: t.bool() }, rooms.respondInvitation);
export const remove_study_room_member = spacetimedb.reducer({ roomId: t.u64(), memberId: t.identity() }, rooms.removeMember);
export const set_study_room_status = spacetimedb.reducer({ roomId: t.u64(), status: t.string(), expectedVersion: t.u32() }, rooms.setRoomStatus);
export const set_study_room_material = spacetimedb.reducer({ roomId: t.u64(), kind: t.string(), sourceId: t.u64(), enabled: t.bool() }, rooms.setMaterial);
export const send_study_room_entry = spacetimedb.reducer({ roomId: t.u64(), kind: t.string(), text: t.string(), requestId: t.string() }, rooms.sendEntry);
export const control_study_room_timer = spacetimedb.reducer({ roomId: t.u64(), action: t.string(), expectedVersion: t.u32(),
  studyMinutes: t.u32().optional(), breakMinutes: t.u32().optional() }, rooms.controlTimer);
export const save_study_room_summary = spacetimedb.reducer({ roomId: t.u64(), text: t.string(), expectedVersion: t.u32() }, rooms.saveSummary);
export const publish_study_room_summary = spacetimedb.reducer({ roomId: t.u64(), expectedVersion: t.u32() }, rooms.publishSummary);
export const study_room_clock = spacetimedb.procedure({ roomId: t.u64() }, t.timestamp(),
  (ctx, { roomId }) => ctx.withTx((tx) => rooms.roomClock(tx, roomId)));
export const study_rooms = spacetimedb.view({ name: 'study_rooms', public: true }, t.array(studyRoom.rowType),
  (ctx) => rooms.visibleRooms(ctx.db, ctx.sender));
export const room_members = spacetimedb.view({ name: 'room_members', public: true }, t.array(roomMember.rowType),
  (ctx) => rooms.visibleMembers(ctx.db, ctx.sender));
export const room_materials = spacetimedb.view({ name: 'room_materials', public: true }, t.array(roomMaterial.rowType),
  (ctx) => rooms.visibleMaterials(ctx.db, ctx.sender));
export const room_entries = spacetimedb.view({ name: 'room_entries', public: true }, t.array(roomEntry.rowType),
  (ctx) => rooms.visibleEntries(ctx.db, ctx.sender));
export const room_timers = spacetimedb.view({ name: 'room_timers', public: true }, t.array(roomTimer.rowType),
  (ctx) => rooms.visibleTimers(ctx.db, ctx.sender));
export const room_summaries = spacetimedb.view({ name: 'room_summaries', public: true }, t.array(roomSummary.rowType),
  (ctx) => rooms.visibleSummaries(ctx.db, ctx.sender));
export const my_help_room_links = spacetimedb.view({ name: 'my_help_room_links', public: true }, t.array(helpRoomLink.rowType),
  (ctx) => rooms.visibleHelpLinks(ctx.db, ctx.sender));

export const assignment_details = spacetimedb.view(
  { name: 'assignment_details', public: true }, t.array(assignmentDetail.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.assignmentDetail.iter()] : [],
);
export const my_progress = spacetimedb.view(
  { name: 'my_progress', public: true }, t.array(personalProgress.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.personalProgress.owner.filter(ctx.sender)] : [],
);
export const work_details = spacetimedb.view(
  { name: 'work_details', public: true }, t.array(workDetail.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.workDetail.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'work', r.workId)) : [],
);
export const work_revisions = spacetimedb.view(
  { name: 'work_revisions', public: true }, t.array(workRevision.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.workRevision.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'work', r.workId)) : [],
);
export const work_reviews = spacetimedb.view(
  { name: 'work_reviews', public: true }, t.array(workReview.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.workReview.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'work', r.workId)) : [],
);
export const academic_comments = spacetimedb.view(
  { name: 'academic_comments', public: true }, t.array(academicComment.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.academicComment.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, r.targetKind, r.targetId)) : [],
);
export const evidence_details = spacetimedb.view(
  { name: 'evidence_details', public: true }, t.array(evidenceDetail.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.evidenceDetail.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'evidence', r.evidenceId)) : [],
);
/** Una nota que después se vuelve personal deja de exponerse también por sus enlaces. */
export const activity_links = spacetimedb.view(
  { name: 'activity_links', public: true }, t.array(activityLink.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.activityLink.iter()].filter((row) =>
    row.targetKind !== 'note' || ctx.db.note.id.find(row.targetId)?.visibility === 'group') : [],
);
export const page_snapshots = spacetimedb.view(
  { name: 'page_snapshots', public: true }, t.array(pageSnapshot.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.pageSnapshot.iter()].map((row) => ({ ...row,
    noteIds: row.noteIds.filter((id) => ctx.db.note.id.find(id)?.visibility === 'group'),
  })) : [],
);
/** La ubicación interna no sale por suscripciones; la API comprueba cada descarga. */
const resourceFileInfo = t.object('ResourceFileInfo', {
  id: t.string(), targetKind: t.string(), targetId: t.u64(), name: t.string(), size: t.u64(),
  contentType: t.string(), etag: t.string(), uploadedBy: t.identity(), createdAt: t.timestamp(),
  removedAt: t.timestamp().optional(),
});
export const resource_files = spacetimedb.view(
  { name: 'resource_files', public: true }, t.array(resourceFileInfo),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.resourceFile.iter()].filter((file) => {
    if (delivery2.reportFileReadable(ctx.db, ctx.sender, file.id)) return true;
    if (!delivery2.canReadTarget(ctx.db, ctx.sender, file.targetKind, file.targetId)) return false;
    if (file.targetKind === 'profile') {
      const profile = ctx.db.memberProfile.id.find(file.targetId);
      return profile?.memberId.isEqual(ctx.sender) || profile?.photoFileId === file.id;
    }
    return true;
  }).map(({ storageKey: _key, ...row }) => row) : [],
);

function isActive(db: ViewDb, sender: Ctx['sender']): boolean {
  return db.member.identity.find(sender)?.status === 'active';
}

function visiblePresentationPractices(db: ViewDb, sender: Ctx['sender']) {
  if (!isActive(db, sender)) return [];
  return [...db.presentationPractice.iter()].flatMap((row) => {
    if (row.ownerId.isEqual(sender)) return [row];
    if (row.archived || !row.reviewerId?.isEqual(sender) || !isActive(db, row.ownerId)) return [];
    const last = [...db.presentationAttempt.practiceId.filter(row.id)].filter((attempt) => attempt.status === 'completed')
      .sort((a, b) => b.number - a.number)[0];
    if (!last) return [];
    const { title, topic, audience, targetMinutes, keyPoints, sourceKind, sourceId, sourceVersion, subjectId, termId } = last;
    return [presentationVisibleSource(db, sender, { ...row, title, topic, audience, targetMinutes, keyPoints,
      sourceKind, sourceId, sourceVersion, subjectId, termId, requestId: '', creationHash: '' })];
  });
}
function visiblePresentationAttempts(db: ViewDb, sender: Ctx['sender']) {
  return visiblePresentationPractices(db, sender).flatMap((practice) => [...db.presentationAttempt.practiceId.filter(practice.id)]
    .filter((attempt) => practice.ownerId.isEqual(sender) || attempt.status === 'completed')
    .map((attempt) => practice.ownerId.isEqual(sender) ? attempt : presentationVisibleSource(db, sender, { ...attempt, requestId: '' })));
}
export const presentation_practices = spacetimedb.view({ name: 'presentation_practices', public: true }, t.array(presentationPractice.rowType),
  (ctx) => visiblePresentationPractices(ctx.db, ctx.sender));
export const presentation_attempts = spacetimedb.view({ name: 'presentation_attempts', public: true }, t.array(presentationAttempt.rowType),
  (ctx) => visiblePresentationAttempts(ctx.db, ctx.sender));
export const my_presentation_personal = spacetimedb.view({ name: 'my_presentation_personal', public: true }, t.array(presentationPersonal.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.presentationPersonal.iter()].filter((row) => {
    const attempt = ctx.db.presentationAttempt.id.find(row.attemptId);
    return attempt && ctx.db.presentationPractice.id.find(attempt.practiceId)?.ownerId.isEqual(ctx.sender);
  }) : []);
export const presentation_questions = spacetimedb.view({ name: 'presentation_questions', public: true }, t.array(presentationQuestion.rowType),
  (ctx) => visiblePresentationAttempts(ctx.db, ctx.sender).flatMap((attempt) => [...ctx.db.presentationQuestion.attemptId.filter(attempt.id)]
    .map((row) => row.authorId.isEqual(ctx.sender) ? row : { ...row, requestId: '' })));
export const presentation_feedback = spacetimedb.view({ name: 'presentation_feedback', public: true }, t.array(presentationFeedback.rowType),
  (ctx) => visiblePresentationAttempts(ctx.db, ctx.sender).flatMap((attempt) => {
    const practice = ctx.db.presentationPractice.id.find(attempt.practiceId)!;
    return [...ctx.db.presentationFeedback.attemptId.filter(attempt.id)].filter((row) => practice.ownerId.isEqual(ctx.sender) || row.authorId.isEqual(ctx.sender));
  }));

function visibleSpacedCollections(db: ViewDb, sender: Ctx['sender']) {
  if (!isActive(db, sender)) return [];
  return [...db.spacedCollection.iter()].filter((row) => row.visibility === 'group' || row.ownerId.isEqual(sender));
}

export const spaced_collections = spacetimedb.view(
  { name: 'spaced_collections', public: true }, t.array(spacedCollection.rowType),
  (ctx) => visibleSpacedCollections(ctx.db, ctx.sender),
);

/** La accesibilidad actual de la fuente se comprueba incluso en colecciones compartidas. */
export const spaced_cards = spacetimedb.view(
  { name: 'spaced_cards', public: true }, t.array(spacedCard.rowType),
  (ctx) => visibleSpacedCollections(ctx.db, ctx.sender).flatMap((collection) =>
    [...ctx.db.spacedCard.collectionId.filter(collection.id)].filter((card) =>
      spacedSourceVersion(ctx.db, ctx.sender, collection, card.sourceKind, card.sourceId) !== undefined)),
);

/** Solo el identificador para reparar: nunca devuelve texto ni detalles de la fuente inaccesible. */
export const spaced_unavailable_cards = spacetimedb.view(
  { name: 'spaced_unavailable_cards', public: true },
  t.array(t.object('SpacedUnavailableCard', {
    id: t.u64(), collectionId: t.u64(), version: t.u32(), archived: t.bool(),
  })),
  (ctx) => visibleSpacedCollections(ctx.db, ctx.sender).flatMap((collection) =>
    [...ctx.db.spacedCard.collectionId.filter(collection.id)]
      .filter((card) => spacedSourceVersion(ctx.db, ctx.sender, collection, card.sourceKind, card.sourceId) === undefined)
      .map(({ id, collectionId, version, archived }) => ({ id, collectionId, version, archived }))),
);

export const my_spaced_enrollments = spacetimedb.view(
  { name: 'my_spaced_enrollments', public: true }, t.array(spacedEnrollment.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.spacedEnrollment.memberId.filter(ctx.sender)] : [],
);

export const my_spaced_progress = spacetimedb.view(
  { name: 'my_spaced_progress', public: true }, t.array(spacedProgress.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.spacedProgress.memberId.filter(ctx.sender)] : [],
);

export const my_spaced_reviews = spacetimedb.view(
  { name: 'my_spaced_reviews', public: true }, t.array(spacedReview.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.spacedReview.memberId.filter(ctx.sender)] : [],
);

export const help_posts = spacetimedb.view(
  { name: 'help_posts', public: true },
  t.array(helpPost.rowType),
  (ctx) => {
    if (!isActive(ctx.db, ctx.sender)) return [];
    return [...ctx.db.helpPost.iter()].filter((post) =>
      post.author.isEqual(ctx.sender) || (post.status !== 'withdrawn' && isActive(ctx.db, post.author)),
    );
  },
);

/** Ni siquiera los administradores pueden leer los contactos de otras personas. */
export const my_help_contact_requests = spacetimedb.view(
  { name: 'my_help_contact_requests', public: true },
  t.array(helpContactRequest.rowType),
  (ctx) => {
    if (!isActive(ctx.db, ctx.sender)) return [];
    return [
      ...ctx.db.helpContactRequest.sender.filter(ctx.sender),
      ...ctx.db.helpContactRequest.recipient.filter(ctx.sender),
    ];
  },
);

/** Fila propia de membresía (vacía si aún no te unes). */
export const my_member = spacetimedb.view(
  { name: 'my_member', public: true },
  t.array(member.rowType),
  (ctx) => {
    const row = ctx.db.member.identity.find(ctx.sender);
    return row ? [row] : [];
  },
);

/** Lista autorizada: solo la ven los creadores, que son quienes invitan. */
export const invitations = spacetimedb.view(
  { name: 'invitations', public: true },
  t.array(invitation.rowType),
  (ctx) => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.status === 'active' && me.isCreator ? [...ctx.db.invitation.iter()] : [];
  },
);

export const members = spacetimedb.view(
  { name: 'members', public: true },
  t.array(member.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.member.iter()] : []),
);

export const subjects = spacetimedb.view(
  { name: 'subjects', public: true },
  t.array(subject.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.subject.iter()] : []),
);

export const terms = spacetimedb.view(
  { name: 'terms', public: true },
  t.array(term.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.term.iter()] : []),
);

export const calendar = spacetimedb.view(
  { name: 'calendar', public: true },
  t.array(termDates.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.termDates.iter()] : []),
);

export const assignments = spacetimedb.view(
  { name: 'assignments', public: true },
  t.array(assignment.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.assignment.iter()] : []),
);

export const page_revisions = spacetimedb.view(
  { name: 'page_revisions', public: true },
  t.array(pageRevision.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.pageRevision.iter()] : []),
);

export const works = spacetimedb.view(
  { name: 'works', public: true },
  t.array(work.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.work.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'work', r.id)) : []),
);

export const work_authors = spacetimedb.view(
  { name: 'work_authors', public: true },
  t.array(workAuthor.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.workAuthor.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'work', r.workId)) : []),
);

export const work_files = spacetimedb.view(
  { name: 'work_files', public: true },
  t.array(workFile.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.workFile.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'work', r.workId)) : []),
);

export const group_messages = spacetimedb.view(
  { name: 'group_messages', public: true },
  t.array(groupMessage.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.groupMessage.iter()] : []),
);

export const birthdays = spacetimedb.view(
  { name: 'birthdays', public: true },
  t.array(birthday.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.birthday.iter()] : []),
);

export const change_history = spacetimedb.view(
  { name: 'change_history', public: true },
  t.array(changeLog.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.changeLog.iter()].filter((r) => {
    if (['invitation', 'auth_config', 'file_service', 'resource_capacity'].includes(r.entity)) {
      return ctx.db.member.identity.find(ctx.sender)?.isCreator === true;
    }
    const kind = r.entity === 'study_guide' ? 'guide' : r.entity;
    if (['note', 'guide', 'question', 'answer', 'work', 'evidence'].includes(kind) && /^\d+$/.test(r.entityId)) {
      return delivery2.canReadTarget(ctx.db, ctx.sender, kind, BigInt(r.entityId));
    }
    if (r.entity === 'resource_file') {
      const file = ctx.db.resourceFile.id.find(r.entityId);
      if (!file || !delivery2.canReadTarget(ctx.db, ctx.sender, file.targetKind, file.targetId)) return false;
      if (file.targetKind === 'profile') {
        const profile = ctx.db.memberProfile.id.find(file.targetId);
        return profile?.memberId.isEqual(ctx.sender) || profile?.photoFileId === file.id;
      }
      return true;
    }
    if (r.entity === 'guide_source' && /^\d+$/.test(r.entityId)) {
      const source = ctx.db.guideSource.id.find(BigInt(r.entityId));
      return source ? delivery2.canReadTarget(ctx.db, ctx.sender, 'guide', source.guideId) : r.actor.isEqual(ctx.sender);
    }
    if (r.entity === 'help_post' && /^\d+$/.test(r.entityId)) {
      const post = ctx.db.helpPost.id.find(BigInt(r.entityId));
      return !!post && (post.status !== 'withdrawn' || post.author.isEqual(ctx.sender) || ctx.db.member.identity.find(ctx.sender)?.isCreator === true);
    }
    if (r.entity === 'member_profile' && /^\d+$/.test(r.entityId)) return delivery2.canReadTarget(ctx.db, ctx.sender, 'profile', BigInt(r.entityId));
    return ['member', 'subject', 'term', 'calendar', 'assignment', 'activity', 'poll', 'group_message', 'channel_message'].includes(r.entity)
      || r.actor.isEqual(ctx.sender);
  }) : []),
);

/** Solo las conversaciones 1 a 1 en las que participas. */
export const my_direct_conversations = spacetimedb.view(
  { name: 'my_direct_conversations', public: true },
  t.array(directConversation.rowType),
  (ctx) => {
    if (!isActive(ctx.db, ctx.sender)) return [];
    return [
      ...ctx.db.directConversation.userA.filter(ctx.sender),
      ...ctx.db.directConversation.userB.filter(ctx.sender),
    ];
  },
);

/** Solo los mensajes de tus conversaciones 1 a 1. */
export const my_direct_messages = spacetimedb.view(
  { name: 'my_direct_messages', public: true },
  t.array(directMessage.rowType),
  (ctx) => {
    if (!isActive(ctx.db, ctx.sender)) return [];
    const conversations = [
      ...ctx.db.directConversation.userA.filter(ctx.sender),
      ...ctx.db.directConversation.userB.filter(ctx.sender),
    ];
    return conversations.flatMap((c) => [...ctx.db.directMessage.conversationId.filter(c.id)]);
  },
);

/** Reacciones del canal y de tus 1 a 1; nunca las de conversaciones ajenas. */
export const message_reactions = spacetimedb.view(
  { name: 'message_reactions', public: true },
  t.array(messageReaction.rowType),
  (ctx) => {
    if (!isActive(ctx.db, ctx.sender)) return [];
    const mine = new Set(
      [
        ...ctx.db.directConversation.userA.filter(ctx.sender),
        ...ctx.db.directConversation.userB.filter(ctx.sender),
      ].map((c) => c.id),
    );
    return [...ctx.db.messageReaction.iter()].filter((r) => {
      if (r.scope === 'group') return true;
      if (r.scope === 'channel') return !!ctx.db.channelMessage.id.find(r.messageId);
      const message = ctx.db.directMessage.id.find(r.messageId);
      return message != null && mine.has(message.conversationId);
    });
  },
);

/** Tus paquetes y los que el grupo compartió. */
export const sticker_packs = spacetimedb.view(
  { name: 'sticker_packs', public: true },
  t.array(stickerPack.rowType),
  (ctx) =>
    isActive(ctx.db, ctx.sender)
      ? [...ctx.db.stickerPack.iter()].filter((p) => p.shared || p.owner.isEqual(ctx.sender))
      : [],
);

/** Stickers de esos paquetes y los que ya se enviaron en algún mensaje. */
export const stickers = spacetimedb.view(
  { name: 'stickers', public: true },
  t.array(sticker.rowType),
  (ctx) => {
    if (!isActive(ctx.db, ctx.sender)) return [];
    const visible = nativeStickers.visibleStickerIds(ctx.db, ctx.sender);
    return [...ctx.db.sticker.iter()].filter((row) => visible.has(row.id));
  },
);

export const my_chat_commands = spacetimedb.view(
  { name: 'my_chat_commands', public: true },
  t.array(chatCommand.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.chatCommand.owner.filter(ctx.sender)] : []),
);

export const activities = spacetimedb.view(
  { name: 'activities', public: true },
  t.array(activity.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.activity.iter()] : []),
);

export const evidences = spacetimedb.view(
  { name: 'evidences', public: true },
  t.array(evidence.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.evidence.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'evidence', r.id)) : []),
);

/** Notas del grupo y las personales propias; nunca las personales de otros. */
function visibleNotes(db: ViewDb, sender: Ctx['sender']) {
  if (!isActive(db, sender)) return [];
  return [...db.note.iter()].filter((n) => delivery2.canReadTarget(db, sender, 'note', n.id));
}

export const notes = spacetimedb.view(
  { name: 'notes', public: true },
  t.array(note.rowType),
  (ctx) => visibleNotes(ctx.db, ctx.sender),
);

export const note_comments = spacetimedb.view(
  { name: 'note_comments', public: true },
  t.array(noteComment.rowType),
  (ctx) =>
    visibleNotes(ctx.db, ctx.sender).flatMap((n) => [...ctx.db.noteComment.noteId.filter(n.id)]),
);

function visibleTeachingPractices(db: ViewDb, sender: Ctx['sender']) {
  if (!isActive(db, sender)) return [];
  return [...db.teachingPractice.iter()].filter((row) => row.owner.isEqual(sender)
    || (row.reviewer?.isEqual(sender) && isActive(db, row.owner)));
}

export const teaching_practices = spacetimedb.view(
  { name: 'teaching_practices', public: true },
  t.array(teachingPractice.rowType),
  (ctx) => visibleTeachingPractices(ctx.db, ctx.sender),
);

export const my_teaching_personal = spacetimedb.view(
  { name: 'my_teaching_personal', public: true },
  t.array(teachingPersonal.rowType),
  (ctx) => {
    if (!isActive(ctx.db, ctx.sender)) return [];
    return [...ctx.db.teachingPersonal.iter()].filter((row) =>
      ctx.db.teachingPractice.id.find(row.practiceId)?.owner.isEqual(ctx.sender));
  },
);

export const teaching_questions = spacetimedb.view(
  { name: 'teaching_questions', public: true },
  t.array(teachingQuestion.rowType),
  (ctx) => visibleTeachingPractices(ctx.db, ctx.sender)
    .flatMap((row) => [...ctx.db.teachingQuestion.practiceId.filter(row.id)]),
);

export const questions = spacetimedb.view(
  { name: 'questions', public: true },
  t.array(question.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.question.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'question', r.id)) : []),
);

export const answers = spacetimedb.view(
  { name: 'answers', public: true },
  t.array(answer.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.answer.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'answer', r.id)) : []),
);

export const my_last_seen = spacetimedb.view(
  { name: 'my_last_seen', public: true },
  t.array(lastSeen.rowType),
  (ctx) => {
    const row = ctx.db.lastSeen.identity.find(ctx.sender);
    return row ? [row] : [];
  },
);

export const study_guides = spacetimedb.view(
  { name: 'study_guides', public: true },
  t.array(studyGuide.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.studyGuide.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'guide', r.id)) : []),
);

export const guide_sources = spacetimedb.view(
  { name: 'guide_sources', public: true },
  t.array(guideSource.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.guideSource.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'guide', r.guideId)) : []),
);

export const guide_reviews = spacetimedb.view(
  { name: 'guide_reviews', public: true },
  t.array(guideReview.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.guideReview.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'guide', r.guideId)) : []),
);

/** Votaciones nominales: todo el grupo ve las votaciones y los votos, nadie de fuera. */
export const polls = spacetimedb.view(
  { name: 'polls', public: true },
  t.array(poll.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.poll.iter()] : []),
);

export const poll_votes = spacetimedb.view(
  { name: 'poll_votes', public: true },
  t.array(pollVote.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.pollVote.iter()] : []),
);

// Segunda entrega: se añaden tablas y operaciones sin alterar los esquemas históricos.
export const create_chat_channel = spacetimedb.reducer({ name: t.string(), kind: t.string(), subjectId: t.u64().optional() }, delivery2.createChatChannel);
export const set_chat_channel_archived = spacetimedb.reducer({ channelId: t.u64(), archived: t.bool() }, (ctx, { channelId, archived }) => {
  const row = delivery2.channel(ctx, channelId);
  if (!row.createdBy.isEqual(ctx.sender) && !activeMember(ctx).isCreator) throw new SenderError('Solo el creador del canal o un administrador puede archivarlo.');
  ctx.db.chatChannel.id.update({ ...row, archivedAt: archived ? ctx.timestamp : undefined });
});
export const send_channel_message = spacetimedb.reducer({ channelId: t.u64(), text: t.string(), replyToId: t.u64().optional() }, delivery2.sendChannelMessage);
export const mark_conversation_read = spacetimedb.reducer({ scope: t.string(), conversationId: t.string(), messageId: t.u64() }, delivery2.markConversationRead);
export const set_conversation_muted = spacetimedb.reducer({ scope: t.string(), conversationId: t.string(), muted: t.bool() }, (ctx, { scope, conversationId, muted }) => {
  delivery2.conversationAccess(ctx, scope, conversationId);
  const key = `${ctx.sender.toHexString()}:${scope}:${conversationId}`;
  const old = ctx.db.conversationState.key.find(key);
  const row = { key, memberId: ctx.sender, scope, conversationId, muted, readThroughId: old?.readThroughId, updatedAt: ctx.timestamp };
  if (old) ctx.db.conversationState.key.update(row); else ctx.db.conversationState.insert(row);
});
export const set_member_blocked = spacetimedb.reducer({ memberId: t.identity(), blocked: t.bool() }, (ctx, { memberId, blocked }) => {
  activeMember(ctx);
  if (memberId.isEqual(ctx.sender) || !isActive(ctx.db, memberId)) throw new SenderError('Selecciona otro compañero activo.');
  const key = `${ctx.sender.toHexString()}:${memberId.toHexString()}`;
  if (!blocked) { ctx.db.memberBlock.key.delete(key); return; }
  if (!ctx.db.memberBlock.key.find(key)) ctx.db.memberBlock.insert({ key, owner: ctx.sender, memberId, createdAt: ctx.timestamp });
});
export const report_message = spacetimedb.reducer({ scope: t.string(), messageId: t.u64(), reason: t.string(), shareText: t.bool(), attachmentIds: t.array(t.string()) }, delivery2.reportMessage);
export const resolve_message_report = spacetimedb.reducer({ reportId: t.u64() }, (ctx, { reportId }) => {
  if (!activeMember(ctx).isCreator) throw new SenderError('Solo un administrador resuelve reportes.');
  const row = ctx.db.messageReport.id.find(reportId);
  if (!row) throw new SenderError('El reporte no existe.');
  ctx.db.messageReport.id.update({ ...row, status: 'resolved', resolvedBy: ctx.sender, resolvedAt: ctx.timestamp });
});
export const save_member_profile = spacetimedb.reducer({ expectedVersion: t.u32(), preferredName: t.string(), bio: t.string(), interests: t.array(t.string()),
  learningGoals: t.string(), skills: t.array(t.string()), helpTopics: t.array(t.string()), portfolioLinks: t.array(t.string()),
  subjectIds: t.array(t.u64()), photoFileId: t.string().optional() }, saveMemberProfile);
export const withdraw_content = spacetimedb.reducer({ kind: t.string(), targetId: t.u64(), withdrawn: t.bool(), expectedVersion: t.u32(), reason: t.string() }, withdrawContent);
export const save_note_v2 = spacetimedb.reducer({ noteId: t.u64().optional(), expectedVersion: t.u32().optional(), subjectId: t.u64(), termId: t.u64().optional(),
  session: t.string(), topic: t.string(), title: t.string(), body: t.string(), tags: t.array(t.string()), visibility: t.string(), source: t.string(),
  assignmentIds: t.array(t.u64()), activityIds: t.array(t.u64()), questionIds: t.array(t.u64()) }, knowledge.saveNoteV2);
export const publish_note_version = spacetimedb.reducer({ noteId: t.u64(), expectedVersion: t.u32() }, knowledge.publishNoteVersion);
export const restore_note_version = spacetimedb.reducer({ noteId: t.u64(), version: t.u32(), expectedVersion: t.u32() }, knowledge.restoreNoteVersion);
export const update_guide_v2 = spacetimedb.reducer({ guideId: t.u64(), expectedVersion: t.u32(), ...GUIDE_ARGS }, (ctx, { expectedVersion, ...input }) => {
  activeMember(ctx);
  expectVersion(requireGuide(ctx, input.guideId).version, expectedVersion); applyGuideUpdate(ctx, input);
});
export const restore_guide_version = spacetimedb.reducer({ guideId: t.u64(), version: t.u32(), expectedVersion: t.u32() }, knowledge.restoreGuideVersion);
export const comment_question = spacetimedb.reducer({ questionId: t.u64(), answerId: t.u64().optional(), text: t.string() }, knowledge.commentQuestion);
export const toggle_answer_usefulness = spacetimedb.reducer({ answerId: t.u64() }, knowledge.toggleAnswerUsefulness);
export const save_question_links = spacetimedb.reducer({ questionId: t.u64(), noteIds: t.array(t.u64()), guideIds: t.array(t.u64()) }, knowledge.saveQuestionLinks);

export const chat_channels = spacetimedb.view({ name: 'chat_channels', public: true }, t.array(chatChannel.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.chatChannel.iter()] : []);
export const channel_messages = spacetimedb.view({ name: 'channel_messages', public: true }, t.array(channelMessage.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.channelMessage.iter()] : []);
export const my_conversation_states = spacetimedb.view({ name: 'my_conversation_states', public: true }, t.array(conversationState.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.conversationState.memberId.filter(ctx.sender)] : []);
export const my_blocked_members = spacetimedb.view({ name: 'my_blocked_members', public: true }, t.array(memberBlock.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.memberBlock.owner.filter(ctx.sender)] : []);
export const my_message_reports = spacetimedb.view({ name: 'my_message_reports', public: true }, t.array(messageReport.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.messageReport.iter()].filter((r) => r.reporter.isEqual(ctx.sender) || ctx.db.member.identity.find(ctx.sender)?.isCreator) : []);
export const member_profiles = spacetimedb.view({ name: 'member_profiles', public: true }, t.array(memberProfile.rowType),
  (ctx) => isActive(ctx.db, ctx.sender) ? [...ctx.db.memberProfile.iter()].filter((r) => isActive(ctx.db, r.memberId)) : []);
export const note_details = spacetimedb.view({ name: 'note_details', public: true }, t.array(noteDetail.rowType),
  (ctx) => [...ctx.db.noteDetail.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'note', r.noteId))
    .map((r) => ctx.db.note.id.find(r.noteId)?.author.isEqual(ctx.sender) ? r : { ...r, publishedFromId: undefined, publishedFromVersion: undefined }));
export const note_versions = spacetimedb.view({ name: 'note_versions', public: true }, t.array(noteVersion.rowType),
  (ctx) => [...ctx.db.noteVersion.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'note', r.noteId) && (r.visibility === 'group' || r.author.isEqual(ctx.sender))));
export const guide_versions = spacetimedb.view({ name: 'guide_versions', public: true }, t.array(guideVersion.rowType),
  (ctx) => [...ctx.db.guideVersion.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'guide', r.guideId)));
export const question_comments = spacetimedb.view({ name: 'question_comments', public: true }, t.array(questionComment.rowType),
  (ctx) => [...ctx.db.questionComment.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'question', r.questionId) && (r.answerId === undefined || delivery2.canReadTarget(ctx.db, ctx.sender, 'answer', r.answerId))));
export const answer_usefulness = spacetimedb.view({ name: 'answer_usefulness', public: true }, t.array(answerUsefulness.rowType),
  (ctx) => [...ctx.db.answerUsefulness.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'answer', r.answerId)));
export const question_links = spacetimedb.view({ name: 'question_links', public: true }, t.array(questionLink.rowType),
  (ctx) => [...ctx.db.questionLink.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, 'question', r.questionId) && delivery2.canReadTarget(ctx.db, ctx.sender, r.targetKind, r.targetId)));
export const resource_versions = spacetimedb.view({ name: 'resource_versions', public: true }, t.array(resourceVersion.rowType),
  (ctx) => [...ctx.db.resourceVersion.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, r.targetKind, r.targetId)));
export const content_statuses = spacetimedb.view({ name: 'content_statuses', public: true }, t.array(contentStatus.rowType),
  (ctx) => [...ctx.db.contentStatus.iter()].filter((r) => delivery2.canReadTarget(ctx.db, ctx.sender, r.kind, r.targetId)));

/** Bytes de stickers privados: las suscripciones solo reciben metadatos. */
export const create_sticker_pack_native = spacetimedb.procedure({ requestId: t.string(), name: t.string() }, t.u64(),
  (ctx, input) => ctx.withTx((tx) => nativeStickers.createStickerPackNative(tx, input)));
export const add_sticker_native = spacetimedb.procedure({ requestId: t.string(), packId: t.u64(), name: t.string(),
  contentType: t.string(), animated: t.bool(), bytes: t.byteArray() }, t.u64(),
  (ctx, input) => ctx.withTx((tx) => nativeStickers.addStickerNative(tx, input)));
export const read_sticker_bytes = spacetimedb.procedure({ stickerId: t.u64() },
  t.object('StickerBytesResult', { bytes: t.byteArray(), contentType: t.string() }),
  (ctx, input) => ctx.withTx((tx) => nativeStickers.readStickerBytes(tx, input)));

/** Procedencia mínima para no volver a premiar copias de aportes retirados. */
export const contribution_origins = spacetimedb.view({ name: 'contribution_origins', public: true },
  t.array(t.object('ContributionOrigin', { kind: t.string(), refId: t.u64(), memberId: t.identity(), creditedAt: t.timestamp(), duplicateOf: t.u64().optional() })),
  (ctx) => readContributionOrigins(ctx.db, ctx.sender));
