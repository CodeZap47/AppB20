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
    packId: t.u64().index('btree'),
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

/** Última vez que cada miembro marcó las novedades como vistas (7.1). */
const lastSeen = table(
  { name: 'last_seen' },
  {
    identity: t.identity().primaryKey(),
    at: t.timestamp(),
  },
);

const spacetimedb = schema({
  appConfig,
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
  lastSeen,
});
export default spacetimedb;

type Ctx = ReducerCtx<typeof spacetimedb.schemaType>;

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
const ALLOWED_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

function activeMember(ctx: Ctx) {
  const row = ctx.db.member.identity.find(ctx.sender);
  if (!row || row.status !== 'active') throw new SenderError('No eres miembro activo del grupo.');
  return row;
}

function isOwner(ctx: Ctx): boolean {
  const config = ctx.db.appConfig.id.find(0);
  return config != null && config.owner.isEqual(ctx.sender);
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

/** Correo verificado del token OIDC de Google. */
function verifiedEmail(ctx: Ctx): string {
  const jwt = ctx.senderAuth.jwt;
  if (!jwt) throw new SenderError('Inicia sesión con Google para unirte al grupo.');
  if (!ALLOWED_ISSUERS.includes(jwt.issuer)) throw new SenderError('Emisor de sesión no permitido.');
  // TODO(Etapa 0): validar también la audiencia (client ID) cuando esté definida.
  const { email, email_verified: emailVerified } = jwt.fullPayload;
  if (typeof email !== 'string' || emailVerified !== true) {
    throw new SenderError('Tu cuenta de Google no tiene un correo verificado.');
  }
  return email.toLowerCase();
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

/** Al publicar por primera vez, quien publica queda como creador inicial. */
export const init = spacetimedb.init((ctx) => {
  ctx.db.appConfig.insert({ id: 0, owner: ctx.sender });
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

export const remove_member = spacetimedb.reducer(
  { identity: t.identity() },
  (ctx, { identity }) => {
    requireCreator(ctx);
    const row = ctx.db.member.identity.find(identity);
    if (!row) throw new SenderError('Ese miembro no existe.');
    ctx.db.member.identity.update({ ...row, status: 'removed' });
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
) {
  ctx.db.pageRevision.insert({
    id: 0n,
    page,
    pageId,
    version,
    editedBy: ctx.sender,
    editedAt: ctx.timestamp,
    ...content,
    dueDate: content.dueDate,
  });
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

/**
 * Edición tipo wiki: no exige ser quien creó la página, solo ser miembro activo. La
 * responsabilidad de cada cambio queda en `page_revision` y en `change_log`.
 */
export const update_assignment = spacetimedb.reducer(
  { assignmentId: t.u64(), ...ASSIGNMENT_ARGS },
  (ctx, { assignmentId, ...input }) => {
    activeMember(ctx);
    const row = ctx.db.assignment.id.find(assignmentId);
    if (!row) throw new SenderError('La tarea no existe.');
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
    log(ctx, 'publish', 'work', row.id);
  },
);

export const update_work = spacetimedb.reducer(
  { workId: t.u64(), title: t.string(), description: t.string() },
  (ctx, { workId, title, description }) => {
    activeMember(ctx);
    const row = ctx.db.work.id.find(workId);
    if (!row) throw new SenderError('El trabajo no existe.');
    const isAuthor = [...ctx.db.workAuthor.workId.filter(workId)].some((a) =>
      a.author.isEqual(ctx.sender),
    );
    if (!isAuthor) throw new SenderError('Solo el autor o los coautores editan este trabajo.');
    if (title.trim().length > 200) throw new SenderError('El título excede 200 caracteres.');
    ctx.db.work.id.update({
      ...row,
      title: title.trim(),
      description: description.trim(),
      version: row.version + 1,
      updatedAt: ctx.timestamp,
    });
    log(ctx, 'update', 'work', workId);
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
    if (size === 0n) throw new SenderError('El archivo está vacío.');
    if (size > MAX_FILE_BYTES) throw new SenderError('El límite es de 50 MB por archivo.');
    const row = ctx.db.workFile.insert({
      id: 0n,
      workId,
      name: requireText(name, 'El nombre del archivo', 200),
      size,
      contentType: contentType.trim() || 'application/octet-stream',
      storageKey: requireText(storageKey, 'La ubicación del archivo', 500),
      uploadedBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
    log(ctx, 'attach', 'work_file', row.id);
  },
);

export const remove_work_file = spacetimedb.reducer({ fileId: t.u64() }, (ctx, { fileId }) => {
  activeMember(ctx);
  const row = ctx.db.workFile.id.find(fileId);
  if (!row) throw new SenderError('El archivo no existe.');
  requireWorkAuthor(ctx, row.workId, 'quitan archivos');
  ctx.db.workFile.id.delete(fileId);
  log(ctx, 'remove', 'work_file', fileId);
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
    if (found.scope === 'group') {
      ctx.db.groupMessage.id.update({ ...found.row, text: clean, editedAt: ctx.timestamp });
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
    if (!own && !(found.scope === 'group' && me.isCreator)) {
      throw new SenderError(
        'Solo quien lo envió puede eliminarlo (en el canal, también un administrador).',
      );
    }
    const change = { text: '', deletedAt: ctx.timestamp, deletedBy: ctx.sender };
    if (found.scope === 'group') ctx.db.groupMessage.id.update({ ...found.row, ...change });
    else ctx.db.directMessage.id.update({ ...found.row, ...change });
    for (const reaction of [...ctx.db.messageReaction.messageId.filter(messageId)]) {
      if (reaction.scope === scope) ctx.db.messageReaction.id.delete(reaction.id);
    }
    if (!own) log(ctx, 'moderate', 'group_message', messageId);
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
    if ([...ctx.db.sticker.packId.filter(packId)].length >= MAX_STICKERS_PER_PACK) {
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
  for (const row of [...ctx.db.sticker.packId.filter(packId)]) {
    if (!row.used) ctx.db.sticker.id.delete(row.id);
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
    if (findConversation(ctx, ctx.sender, other)) return;
    const [userA, userB] = orderedPair(ctx.sender, other);
    ctx.db.directConversation.insert({ id: 0n, userA, userB, createdAt: ctx.timestamp });
  },
);

export const send_direct_message = spacetimedb.reducer(
  { conversationId: t.u64(), text: t.string(), replyToId: t.u64().optional() },
  (ctx, { conversationId, text, replyToId }) => {
    activeMember(ctx);
    requireConversation(ctx, conversationId);
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

/** Edición tipo wiki, igual que `update_assignment`: cualquier miembro activo. */
export const update_activity = spacetimedb.reducer(
  { activityId: t.u64(), ...ACTIVITY_ARGS },
  (ctx, { activityId, ...input }) => {
    activeMember(ctx);
    const row = ctx.db.activity.id.find(activityId);
    if (!row) throw new SenderError('La actividad no existe.');
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
    ctx.db.evidence.insert({
      id: 0n,
      activityId,
      author: ctx.sender,
      participants: [...team.values()],
      content: requireText(content, 'La evidencia', 20_000),
      createdAt: ctx.timestamp,
    });
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
    if (noteId === undefined) {
      const row = ctx.db.note.insert({
        id: 0n,
        ...fields,
        author: ctx.sender,
        version: 1,
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
      });
      log(ctx, 'create', 'note', row.id);
      return;
    }
    const row = ctx.db.note.id.find(noteId);
    if (!row) throw new SenderError('La nota no existe.');
    if (!row.author.isEqual(ctx.sender)) {
      throw new SenderError('Solo su autor edita esta nota; los demás pueden comentar.');
    }
    ctx.db.note.id.update({ ...row, ...fields, version: row.version + 1, updatedAt: ctx.timestamp });
    log(ctx, 'update', 'note', noteId);
  },
);

export const comment_note = spacetimedb.reducer(
  { noteId: t.u64(), text: t.string() },
  (ctx, { noteId, text }) => {
    activeMember(ctx);
    const row = ctx.db.note.id.find(noteId);
    if (!row || (row.visibility !== 'group' && !row.author.isEqual(ctx.sender))) {
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
    if (!ctx.db.question.id.find(questionId)) throw new SenderError('La pregunta no existe.');
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
  if (!row) throw new SenderError('La pregunta no existe.');
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

export const mark_seen = spacetimedb.reducer((ctx) => {
  activeMember(ctx);
  const row = { identity: ctx.sender, at: ctx.timestamp };
  if (ctx.db.lastSeen.identity.find(ctx.sender)) ctx.db.lastSeen.identity.update(row);
  else ctx.db.lastSeen.insert(row);
});

// ---------------------------------------------------------------------------
// Vistas: lo único que leen los clientes
// ---------------------------------------------------------------------------

type ViewDb = Parameters<Parameters<typeof spacetimedb.view>[2]>[0]['db'];

function isActive(db: ViewDb, sender: Ctx['sender']): boolean {
  return db.member.identity.find(sender)?.status === 'active';
}

/** Fila propia de membresía (vacía si aún no te unes). */
export const my_member = spacetimedb.view(
  { name: 'my_member', public: true },
  t.array(member.rowType),
  (ctx) => {
    const row = ctx.db.member.identity.find(ctx.sender);
    return row ? [row] : [];
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
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.work.iter()] : []),
);

export const work_authors = spacetimedb.view(
  { name: 'work_authors', public: true },
  t.array(workAuthor.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.workAuthor.iter()] : []),
);

export const work_files = spacetimedb.view(
  { name: 'work_files', public: true },
  t.array(workFile.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.workFile.iter()] : []),
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
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.changeLog.iter()] : []),
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
    return [...ctx.db.sticker.iter()].filter((row) => {
      if (row.used) return true;
      const pack = ctx.db.stickerPack.id.find(row.packId);
      return pack != null && (pack.shared || pack.owner.isEqual(ctx.sender));
    });
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
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.evidence.iter()] : []),
);

/** Notas del grupo y las personales propias; nunca las personales de otros. */
function visibleNotes(db: ViewDb, sender: Ctx['sender']) {
  if (!isActive(db, sender)) return [];
  return [...db.note.iter()].filter((n) => n.visibility === 'group' || n.author.isEqual(sender));
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

export const questions = spacetimedb.view(
  { name: 'questions', public: true },
  t.array(question.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.question.iter()] : []),
);

export const answers = spacetimedb.view(
  { name: 'answers', public: true },
  t.array(answer.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.answer.iter()] : []),
);

export const my_last_seen = spacetimedb.view(
  { name: 'my_last_seen', public: true },
  t.array(lastSeen.rowType),
  (ctx) => {
    const row = ctx.db.lastSeen.identity.find(ctx.sender);
    return row ? [row] : [];
  },
);
