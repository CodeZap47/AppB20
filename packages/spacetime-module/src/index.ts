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

const groupMessage = table(
  { name: 'group_message' },
  {
    id: t.u64().primaryKey().autoInc(),
    sender: t.identity(),
    text: t.string(),
    sentAt: t.timestamp(),
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
  birthday,
  changeLog,
  activity,
  evidence,
  note,
  noteComment,
  question,
  answer,
  lastSeen,
  studyGuide,
  guideSource,
  guideReview,
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
  content: { title: string; summary: string; body: string },
) {
  ctx.db.pageRevision.insert({
    id: 0n,
    page,
    pageId,
    version,
    editedBy: ctx.sender,
    editedAt: ctx.timestamp,
    ...content,
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
  saveRevision(ctx, 'assignment', row.id, 1, { title: row.title, summary: '', body: row.instructions });
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

export const send_group_message = spacetimedb.reducer({ text: t.string() }, (ctx, { text }) => {
  activeMember(ctx);
  ctx.db.groupMessage.insert({
    id: 0n,
    sender: ctx.sender,
    text: requireText(text, 'El mensaje'),
    sentAt: ctx.timestamp,
  });
});

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
  { conversationId: t.u64(), text: t.string() },
  (ctx, { conversationId, text }) => {
    activeMember(ctx);
    const conversation = ctx.db.directConversation.id.find(conversationId);
    if (
      !conversation ||
      (!conversation.userA.isEqual(ctx.sender) && !conversation.userB.isEqual(ctx.sender))
    ) {
      throw new SenderError('No participas en esa conversación.');
    }
    ctx.db.directMessage.insert({
      id: 0n,
      conversationId,
      sender: ctx.sender,
      text: requireText(text, 'El mensaje'),
      sentAt: ctx.timestamp,
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
    if (row) found = { subjectId: row.subjectId, version: 1 };
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
    log(ctx, 'create', 'study_guide', row.id);
  },
);

/** Como en un wiki: cualquier miembro activo edita; la materia no cambia. */
export const update_guide = spacetimedb.reducer(
  { guideId: t.u64(), ...GUIDE_ARGS },
  (ctx, { guideId, ...input }) => {
    activeMember(ctx);
    const row = requireGuide(ctx, guideId);
    const checked = checkGuide(ctx, input);
    if (checked.subjectId !== row.subjectId) {
      throw new SenderError('La materia de una guía no cambia.');
    }
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
  },
);

export const add_guide_sources = spacetimedb.reducer(
  { guideId: t.u64(), sources: t.array(GUIDE_SOURCE_REF) },
  (ctx, { guideId, sources }) => {
    activeMember(ctx);
    addGuideSources(ctx, requireGuide(ctx, guideId), sources);
    log(ctx, 'update', 'study_guide', guideId);
  },
);

function requireGuideSource(ctx: Ctx, sourceId: bigint) {
  const row = ctx.db.guideSource.id.find(sourceId);
  if (!row) throw new SenderError('La fuente no existe.');
  return row;
}

export const update_guide_source = spacetimedb.reducer(
  { sourceId: t.u64(), status: t.string(), reason: t.string(), topics: t.array(t.string()) },
  (ctx, { sourceId, status, reason, topics }) => {
    activeMember(ctx);
    const row = requireGuideSource(ctx, sourceId);
    const guide = requireGuide(ctx, row.guideId);
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
    ctx.db.guideSource.id.update({ ...row, sourceVersion: version });
    log(ctx, 'update', 'guide_source', sourceId);
  },
);

export const remove_guide_source = spacetimedb.reducer(
  { sourceId: t.u64() },
  (ctx, { sourceId }) => {
    activeMember(ctx);
    requireGuideSource(ctx, sourceId);
    ctx.db.guideSource.id.delete(sourceId);
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

export const study_guides = spacetimedb.view(
  { name: 'study_guides', public: true },
  t.array(studyGuide.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.studyGuide.iter()] : []),
);

export const guide_sources = spacetimedb.view(
  { name: 'guide_sources', public: true },
  t.array(guideSource.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.guideSource.iter()] : []),
);

export const guide_reviews = spacetimedb.view(
  { name: 'guide_reviews', public: true },
  t.array(guideReview.rowType),
  (ctx) => (isActive(ctx.db, ctx.sender) ? [...ctx.db.guideReview.iter()] : []),
);
