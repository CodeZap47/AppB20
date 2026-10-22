import { memberIdentityFor } from './authIdentity';
import { SenderError } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { activeMember, expectVersion, isActive, log, requireSubject, requireText, type Ctx, type ViewDb } from './moduleContext';
import { withdrawn } from './delivery2Handlers';
import { ROOM_LIMITS, roomTimerMinutesError } from '../../core/src/rooms';

type Identity = Ctx['sender'];
type Room = NonNullable<ReturnType<Ctx['db']['studyRoom']['id']['find']>>;
type Timer = NonNullable<ReturnType<Ctx['db']['roomTimer']['roomId']['find']>>;
const activeStatuses = ['scheduled', 'active'];
const memberKey = (roomId: bigint, member: Identity) => `${roomId}:${member.toHexString()}`;

function optionalText(value: string, field: string, max: number) {
  const result = value.trim();
  if (result.length > max) throw new SenderError(`${field} excede ${max} caracteres.`);
  return result;
}
function requestToken(value: string) { return requireText(value, 'El identificador de solicitud', 128); }
function participation(db: ViewDb, roomId: bigint, person: Identity) {
  return db.roomMember.key.find(memberKey(roomId, person));
}
function canPreview(db: ViewDb, room: Room, person: Identity) {
  const member = participation(db, room.id, person);
  return member?.status !== 'removed'
    && (room.visibility === 'group' || member?.status === 'joined' || member?.status === 'invited');
}
export function joined(db: ViewDb, roomId: bigint, person: Identity) {
  return isActive(db, person) && participation(db, roomId, person)?.status === 'joined';
}
function countMembers(db: ViewDb, roomId: bigint) {
  return [...db.roomMember.roomId.filter(roomId)].filter((r) => r.status === 'joined' && isActive(db, r.memberId)).length;
}
function readRoom(ctx: Ctx, roomId: bigint) {
  activeMember(ctx);
  const row = ctx.db.studyRoom.id.find(roomId);
  if (!row) throw new SenderError('La sala no está disponible.');
  return row;
}
function memberRoom(ctx: Ctx, roomId: bigint) {
  const row = readRoom(ctx, roomId);
  if (!joined(ctx.db, roomId, memberIdentityFor(ctx))) throw new SenderError('Inscríbete en la sala para acceder a su contenido.');
  return row;
}
function ownRoom(ctx: Ctx, roomId: bigint) {
  const row = memberRoom(ctx, roomId);
  if (!row.organizer.isEqual(memberIdentityFor(ctx))) throw new SenderError('Solo el organizador puede hacer esto.');
  return row;
}
function requireOngoing(row: Room) {
  if (!activeStatuses.includes(row.status)) throw new SenderError('La sala ya finalizó o fue cancelada.');
}
function metadata(input: { title: string; topic: string; objective: string; startsAt: Timestamp; endsAt: Timestamp; capacity?: number }, minimum = 1) {
  if (input.startsAt.microsSinceUnixEpoch < 0n || input.endsAt.microsSinceUnixEpoch <= input.startsAt.microsSinceUnixEpoch) {
    throw new SenderError('El final debe ser posterior al inicio de la sesión.');
  }
  if (input.capacity !== undefined && (!Number.isInteger(input.capacity) || input.capacity < minimum || input.capacity > 10_000)) {
    throw new SenderError(`El cupo debe admitir a los ${minimum} participantes inscritos y no superar 10000.`);
  }
  return {
    title: requireText(input.title, 'El título', ROOM_LIMITS.title), topic: requireText(input.topic, 'El tema', ROOM_LIMITS.topic),
    objective: requireText(input.objective, 'El objetivo', ROOM_LIMITS.objective), startsAt: input.startsAt, endsAt: input.endsAt,
    capacity: input.capacity,
  };
}
/** Solo materiales que cualquier integrante del grupo puede consultar. */
function sourceVersion(db: ViewDb, kind: string, sourceId: bigint, subjectId: bigint) {
  if (kind !== 'note' && kind !== 'guide') throw new SenderError('Solo puedes añadir notas compartidas o guías.');
  const row = kind === 'note' ? db.note.id.find(sourceId) : db.studyGuide.id.find(sourceId);
  if (!row || row.subjectId !== subjectId || withdrawn(db, kind, sourceId)
    || (kind === 'note' && db.note.id.find(sourceId)?.visibility !== 'group')) {
    throw new SenderError('El material no está disponible para el grupo en esta materia. Publica primero una copia si es personal.');
  }
  return row.version;
}
function updateCount(ctx: Ctx, row: Room) {
  ctx.db.studyRoom.id.update({ ...row, participantCount: countMembers(ctx.db, row.id), updatedAt: ctx.timestamp });
}
function insertMember(ctx: Ctx, roomId: bigint, person: Identity, status: string, invitedBy?: Identity) {
  const key = memberKey(roomId, person);
  const old = ctx.db.roomMember.key.find(key);
  const row = { key, roomId, memberId: person, status, invitedBy: invitedBy ?? old?.invitedBy,
    joinedAt: status === 'joined' ? ctx.timestamp : undefined, updatedAt: ctx.timestamp };
  if (old) ctx.db.roomMember.key.update(row); else ctx.db.roomMember.insert(row);
}
function checkSpace(db: ViewDb, row: Room) {
  if (row.capacity !== undefined && countMembers(db, row.id) >= row.capacity) throw new SenderError('La sala ya alcanzó su cupo.');
}

export interface CreateRoomInput {
  requestId: string; title: string; subjectId: bigint; topic: string; objective: string;
  startsAt: Timestamp; endsAt: Timestamp; capacity?: number; visibility: string;
  helpContactId?: bigint; sourceKind?: string; sourceId?: bigint;
}
export function createRoom(ctx: Ctx, input: CreateRoomInput) {
  activeMember(ctx);
  const requestId = requestToken(input.requestId);
  if ([...ctx.db.studyRoom.organizer.filter(memberIdentityFor(ctx))].some((row) => row.requestId === requestId)) return;
  requireSubject(ctx, input.subjectId);
  if (!['group', 'private'].includes(input.visibility)) throw new SenderError('La visibilidad no es válida.');
  const fields = metadata(input);
  let contact;
  if (input.helpContactId !== undefined) {
    contact = ctx.db.helpContactRequest.id.find(input.helpContactId);
    if (!contact || contact.status !== 'accepted'
      || (!contact.sender.isEqual(memberIdentityFor(ctx)) && !contact.recipient.isEqual(memberIdentityFor(ctx)))
      || !isActive(ctx.db, contact.sender) || !isActive(ctx.db, contact.recipient)
      || contact.subjectId !== input.subjectId) throw new SenderError('El contacto aceptado de Ayuda no está disponible.');
    const existing = [...ctx.db.helpRoomLink.contactId.filter(contact.id)]
      .find((link) => activeStatuses.includes(ctx.db.studyRoom.id.find(link.roomId)?.status ?? ''));
    if (existing) {
      const room = ctx.db.studyRoom.id.find(existing.roomId)!;
      if (!canPreview(ctx.db, room, memberIdentityFor(ctx))) throw new SenderError('Este contacto ya tiene una sala activa; pide una nueva invitación al organizador.');
      return;
    }
  }
  if ((input.sourceId === undefined) !== (input.sourceKind === undefined)) throw new SenderError('El material de origen está incompleto.');
  const materialVersion = input.sourceId !== undefined
    ? sourceVersion(ctx.db, input.sourceKind!, input.sourceId, input.subjectId) : undefined;
  const room = ctx.db.studyRoom.insert({ id: 0n, requestId, organizer: memberIdentityFor(ctx), subjectId: input.subjectId,
    ...fields, visibility: input.visibility, status: 'scheduled', version: 1, participantCount: 1,
    createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
  insertMember(ctx, room.id, memberIdentityFor(ctx), 'joined');
  ctx.db.roomTimer.insert({ roomId: room.id, phase: 'study', state: 'idle', studyMinutes: 25, breakMinutes: 5,
    remainingMs: 25n * 60_000n, startedAt: undefined, version: 1, updatedBy: memberIdentityFor(ctx), updatedAt: ctx.timestamp });
  ctx.db.roomSummary.insert({ roomId: room.id, text: '', version: 1, updatedBy: memberIdentityFor(ctx), updatedAt: ctx.timestamp, publishedNoteId: undefined });
  if (input.sourceId !== undefined) ctx.db.roomMaterial.insert({ id: 0n, roomId: room.id, kind: input.sourceKind!,
    sourceId: input.sourceId, sourceVersion: materialVersion!, addedBy: memberIdentityFor(ctx), addedAt: ctx.timestamp });
  if (contact) {
    ctx.db.helpRoomLink.insert({ id: 0n, contactId: contact.id, roomId: room.id, memberA: contact.sender, memberB: contact.recipient });
    insertMember(ctx, room.id, contact.sender.isEqual(memberIdentityFor(ctx)) ? contact.recipient : contact.sender, 'invited', memberIdentityFor(ctx));
  }
}
export function updateRoom(ctx: Ctx, input: { roomId: bigint; title: string; topic: string; objective: string; startsAt: Timestamp; endsAt: Timestamp; capacity?: number; expectedVersion: number }) {
  const row = memberRoom(ctx, input.roomId); requireOngoing(row); expectVersion(row.version, input.expectedVersion);
  const fields = metadata(input, countMembers(ctx.db, row.id));
  ctx.db.studyRoom.id.update({ ...row, ...fields, version: row.version + 1, updatedAt: ctx.timestamp });
}
export function joinRoom(ctx: Ctx, input: { roomId: bigint }) {
  const room = readRoom(ctx, input.roomId); requireOngoing(room);
  const member = participation(ctx.db, room.id, memberIdentityFor(ctx));
  if (member?.status === 'joined') return;
  if (member?.status === 'removed') throw new SenderError('El organizador debe volver a invitarte antes de entrar.');
  if (room.visibility !== 'group') throw new SenderError('Acepta una invitación para entrar a esta sala privada.');
  checkSpace(ctx.db, room);
  insertMember(ctx, room.id, memberIdentityFor(ctx), 'joined'); updateCount(ctx, room);
}
export function leaveRoom(ctx: Ctx, input: { roomId: bigint }) {
  const room = memberRoom(ctx, input.roomId);
  if (room.organizer.isEqual(memberIdentityFor(ctx))) throw new SenderError('El organizador debe cancelar la sala en lugar de abandonarla.');
  insertMember(ctx, room.id, memberIdentityFor(ctx), 'left'); updateCount(ctx, room);
}
export function inviteMember(ctx: Ctx, input: { roomId: bigint; memberId: Identity }) {
  const room = ownRoom(ctx, input.roomId); requireOngoing(room);
  if (!isActive(ctx.db, input.memberId)) throw new SenderError('El integrante ya no está activo.');
  if (participation(ctx.db, room.id, input.memberId)?.status === 'joined') return;
  insertMember(ctx, room.id, input.memberId, 'invited', memberIdentityFor(ctx));
  updateCount(ctx, room);
}
export function respondInvitation(ctx: Ctx, input: { roomId: bigint; accepted: boolean }) {
  const room = readRoom(ctx, input.roomId); requireOngoing(room);
  const member = participation(ctx.db, room.id, memberIdentityFor(ctx));
  if (member?.status === 'joined' && input.accepted) return;
  if (member?.status !== 'invited') throw new SenderError('No tienes una invitación pendiente para esta sala.');
  if (input.accepted) checkSpace(ctx.db, room);
  insertMember(ctx, room.id, memberIdentityFor(ctx), input.accepted ? 'joined' : 'declined'); updateCount(ctx, room);
}
export function removeMember(ctx: Ctx, input: { roomId: bigint; memberId: Identity }) {
  const room = ownRoom(ctx, input.roomId); requireOngoing(room);
  if (room.organizer.isEqual(input.memberId)) throw new SenderError('El organizador no puede retirarse a sí mismo.');
  const member = participation(ctx.db, room.id, input.memberId);
  if (!member) throw new SenderError('El integrante no participa en esta sala.');
  insertMember(ctx, room.id, input.memberId, 'removed'); updateCount(ctx, room);
}
export function setRoomStatus(ctx: Ctx, input: { roomId: bigint; status: string; expectedVersion: number }) {
  const room = ownRoom(ctx, input.roomId); expectVersion(room.version, input.expectedVersion);
  if (!['active', 'completed', 'cancelled'].includes(input.status)) throw new SenderError('El estado de la sala no es válido.');
  if (room.status === input.status) return;
  requireOngoing(room);
  if (input.status === 'active' && room.status !== 'scheduled') throw new SenderError('La sesión ya comenzó.');
  if (input.status === 'completed' && room.status !== 'active') throw new SenderError('Comienza la sesión antes de finalizarla.');
  ctx.db.studyRoom.id.update({ ...room, status: input.status, version: room.version + 1, updatedAt: ctx.timestamp });
  if (input.status !== 'active') stopTimer(ctx, room.id);
}
export function setMaterial(ctx: Ctx, input: { roomId: bigint; kind: string; sourceId: bigint; enabled: boolean }) {
  const room = memberRoom(ctx, input.roomId); requireOngoing(room);
  if (!['note', 'guide'].includes(input.kind)) throw new SenderError('El tipo de material no es válido.');
  const previous = [...ctx.db.roomMaterial.roomId.filter(room.id)].find((r) => r.kind === input.kind && r.sourceId === input.sourceId);
  if (!input.enabled) { if (previous) ctx.db.roomMaterial.id.delete(previous.id); return; }
  const version = sourceVersion(ctx.db, input.kind, input.sourceId, room.subjectId);
  if (previous) return;
  ctx.db.roomMaterial.insert({ id: 0n, roomId: room.id, kind: input.kind, sourceId: input.sourceId,
    sourceVersion: version, addedBy: memberIdentityFor(ctx), addedAt: ctx.timestamp });
}
export function sendEntry(ctx: Ctx, input: { roomId: bigint; kind: string; text: string; requestId: string }) {
  const room = memberRoom(ctx, input.roomId);
  const requestId = requestToken(input.requestId);
  if (!['message', 'question', 'conclusion'].includes(input.kind)) throw new SenderError('El tipo de aporte no es válido.');
  const text = requireText(input.text, 'El mensaje', ROOM_LIMITS.entry);
  const previous = [...ctx.db.roomEntry.roomId.filter(room.id)].find((r) => r.author.isEqual(memberIdentityFor(ctx)) && r.requestId === requestId);
  if (previous) {
    if (previous.kind !== input.kind || previous.text !== text) throw new SenderError('El intento ya se usó para otro mensaje.');
    return;
  }
  requireOngoing(room);
  ctx.db.roomEntry.insert({ id: 0n, roomId: room.id, author: memberIdentityFor(ctx), kind: input.kind,
    text, requestId, createdAt: ctx.timestamp });
}
function remaining(timer: Timer, now: Timestamp) {
  if (timer.state !== 'running' || !timer.startedAt) return timer.remainingMs;
  const difference = now.microsSinceUnixEpoch - timer.startedAt.microsSinceUnixEpoch;
  const elapsed = difference > 0n ? difference / 1000n : 0n;
  return timer.remainingMs > elapsed ? timer.remainingMs - elapsed : 0n;
}
function stopTimer(ctx: Ctx, roomId: bigint) {
  const timer = ctx.db.roomTimer.roomId.find(roomId);
  if (!timer) return;
  ctx.db.roomTimer.roomId.update({ ...timer, remainingMs: remaining(timer, ctx.timestamp), state: 'paused', startedAt: undefined,
    version: timer.version + 1, updatedBy: memberIdentityFor(ctx), updatedAt: ctx.timestamp });
}
export function controlTimer(ctx: Ctx, input: { roomId: bigint; action: string; expectedVersion: number; studyMinutes?: number; breakMinutes?: number }) {
  const room = memberRoom(ctx, input.roomId); requireOngoing(room);
  if (room.status !== 'active') throw new SenderError('El organizador debe comenzar la sesión antes de usar el temporizador.');
  const timer = ctx.db.roomTimer.roomId.find(room.id);
  if (!timer) throw new SenderError('El temporizador no está disponible.');
  expectVersion(timer.version, input.expectedVersion);
  const studyMinutes = input.studyMinutes ?? timer.studyMinutes, breakMinutes = input.breakMinutes ?? timer.breakMinutes;
  const durationError = roomTimerMinutesError(studyMinutes, breakMinutes);
  if (durationError) throw new SenderError(durationError);
  if ((studyMinutes !== timer.studyMinutes || breakMinutes !== timer.breakMinutes) && input.action !== 'reset' && input.action !== 'start') {
    throw new SenderError('Reinicia el temporizador para cambiar la duración.');
  }
  let phase = timer.phase, state = timer.state, remainingMs = remaining(timer, ctx.timestamp), startedAt: Timestamp | undefined;
  const duration = (value: string) => BigInt(value === 'study' ? studyMinutes : breakMinutes) * 60_000n;
  if (input.action === 'start') {
    if (timer.state !== 'idle') throw new SenderError('Usa continuar, reiniciar o la siguiente fase.');
    state = 'running'; remainingMs = duration(phase); startedAt = ctx.timestamp;
  } else if (input.action === 'pause') {
    if (timer.state !== 'running') throw new SenderError('El temporizador no está corriendo.');
    state = 'paused';
  } else if (input.action === 'resume') {
    if (timer.state !== 'paused' || remainingMs === 0n) throw new SenderError('No hay un bloque pausado que pueda continuar.');
    state = 'running'; startedAt = ctx.timestamp;
  } else if (input.action === 'reset') {
    state = 'idle'; remainingMs = duration(phase);
  } else if (input.action === 'next') {
    if (timer.state === 'idle' || remainingMs !== 0n) throw new SenderError('Espera a que termine el bloque para pasar a la siguiente fase.');
    phase = phase === 'study' ? 'break' : 'study'; state = 'running'; remainingMs = duration(phase); startedAt = ctx.timestamp;
  } else throw new SenderError('La acción del temporizador no es válida.');
  ctx.db.roomTimer.roomId.update({ ...timer, phase, state, studyMinutes, breakMinutes, remainingMs, startedAt,
    version: timer.version + 1, updatedBy: memberIdentityFor(ctx), updatedAt: ctx.timestamp });
}
export function saveSummary(ctx: Ctx, input: { roomId: bigint; text: string; expectedVersion: number }) {
  const room = memberRoom(ctx, input.roomId);
  if (room.status === 'cancelled') throw new SenderError('La sala cancelada es de consulta.');
  const summary = ctx.db.roomSummary.roomId.find(room.id);
  if (!summary) throw new SenderError('El resumen no está disponible.');
  expectVersion(summary.version, input.expectedVersion);
  ctx.db.roomSummary.roomId.update({ ...summary, text: optionalText(input.text, 'El resumen', ROOM_LIMITS.summary),
    version: summary.version + 1, updatedBy: memberIdentityFor(ctx), updatedAt: ctx.timestamp });
}
export function publishSummary(ctx: Ctx, input: { roomId: bigint; expectedVersion: number }) {
  const room = ownRoom(ctx, input.roomId);
  const summary = ctx.db.roomSummary.roomId.find(room.id);
  if (!summary) throw new SenderError('El resumen no está disponible.');
  if (summary.publishedNoteId !== undefined) return;
  expectVersion(summary.version, input.expectedVersion);
  if (room.status !== 'completed') throw new SenderError('Finaliza la sala antes de publicar el resumen.');
  const body = requireText(summary.text, 'El resumen', ROOM_LIMITS.summary);
  const note = ctx.db.note.insert({ id: 0n, subjectId: room.subjectId, title: room.title, topic: room.topic, body,
    tags: ['sala-de-estudio'], visibility: 'group', source: 'student', author: room.organizer, version: 1,
    createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
  ctx.db.roomSummary.roomId.update({ ...summary, publishedNoteId: note.id, version: summary.version + 1,
    updatedBy: memberIdentityFor(ctx), updatedAt: ctx.timestamp });
  log(ctx, 'create', 'note', note.id);
}

/** La baja de una cuenta no concede acceso a su historial al administrador. */
export function removeGroupMember(ctx: Ctx, person: Identity) {
  // Una reinvitación al grupo no restaura las autorizaciones de salas privadas.
  for (const member of ctx.db.roomMember.memberId.filter(person)) {
    ctx.db.roomMember.key.update({ ...member, status: 'removed', joinedAt: undefined, updatedAt: ctx.timestamp });
  }
  for (const room of ctx.db.studyRoom.iter()) {
    if (room.organizer.isEqual(person) && activeStatuses.includes(room.status)) {
      ctx.db.studyRoom.id.update({ ...room, status: 'cancelled', version: room.version + 1,
        participantCount: countMembers(ctx.db, room.id), updatedAt: ctx.timestamp });
      stopTimer(ctx, room.id);
    } else if (participation(ctx.db, room.id, person)) updateCount(ctx, room);
  }
}

export function visibleRooms(db: ViewDb, sender: Identity) {
  if (!isActive(db, sender)) return [];
  return [...db.studyRoom.iter()].filter((room) => canPreview(db, room, sender))
    .map((row) => ({ ...row, participantCount: countMembers(db, row.id) }));
}
export function visibleMembers(db: ViewDb, sender: Identity) {
  return visibleRooms(db, sender).flatMap((room) => [...db.roomMember.roomId.filter(room.id)].filter((row) =>
    joined(db, room.id, sender) || (row.memberId.isEqual(sender) && row.status === 'invited')));
}
export function visibleMaterials(db: ViewDb, sender: Identity) {
  if (!isActive(db, sender)) return [];
  return [...db.roomMaterial.iter()].filter((row) => {
    if (!joined(db, row.roomId, sender)) return false;
    const room = db.studyRoom.id.find(row.roomId);
    if (!room) return false;
    try { sourceVersion(db, row.kind, row.sourceId, room.subjectId); return true; } catch { return false; }
  });
}
export function visibleEntries(db: ViewDb, sender: Identity) {
  return isActive(db, sender) ? [...db.roomEntry.iter()].filter((row) => joined(db, row.roomId, sender)) : [];
}
export function visibleTimers(db: ViewDb, sender: Identity) {
  return isActive(db, sender) ? [...db.roomTimer.iter()].filter((row) => joined(db, row.roomId, sender)) : [];
}
export function visibleSummaries(db: ViewDb, sender: Identity) {
  return isActive(db, sender) ? [...db.roomSummary.iter()].filter((row) => joined(db, row.roomId, sender)) : [];
}
export function visibleHelpLinks(db: ViewDb, sender: Identity) {
  const visible = new Set(visibleRooms(db, sender).map((row) => row.id));
  return [...db.helpRoomLink.iter()].filter((row) => visible.has(row.roomId)
    && (row.memberA.isEqual(sender) || row.memberB.isEqual(sender)));
}
export function roomClock(ctx: Ctx, roomId: bigint) {
  memberRoom(ctx, roomId);
  return ctx.timestamp;
}
