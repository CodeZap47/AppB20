import { ROOM_LIMITS, roomRemainingMs, roomTimerMinutesError, studyRoomFieldsError } from '@b20/core';
import type { HelpContactRequest, Id, Member, Note, StudyGuide, Subject } from './types';
import { emptyStudyRooms, type ControlStudyRoomTimerInput, type CreateStudyRoomInput, type StudyRoom, type StudyRoomActions, type StudyRoomEntryKind, type StudyRoomMaterialKind, type StudyRoomMember, type StudyRoomStatus, type StudyRoomsSnapshot, type UpdateStudyRoomInput } from './roomTypes';

export interface RoomsState extends StudyRoomsSnapshot {
  members: Member[]; subjects: Subject[]; notes: Note[]; guides: StudyGuide[]; helpContacts: HelpContactRequest[];
}
interface Context {
  state(): RoomsState; active(): Member; id(): Id; now(): Date; emit(): void;
  sourceAvailable(kind: StudyRoomMaterialKind, sourceId: Id): boolean;
}
const text = (value: string, label: string, maximum: number, optional = false) => {
  const cleaned = value.trim();
  if ((!optional && !cleaned) || cleaned.length > maximum) throw new Error(`${label}: escribe ${optional ? 'hasta' : 'entre 1 y'} ${maximum} caracteres.`);
  return cleaned;
};
const ongoing = (room: StudyRoom) => room.status === 'scheduled' || room.status === 'active';

export function demoRoomExamples(now: Date, subjectId: Id): StudyRoomsSnapshot {
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  return { ...emptyStudyRooms(),
    studyRooms: [{ id: 'room-demo-open', requestId: 'demo-open', organizerId: 'demo-2', subjectId,
      title: 'Sala de prueba: decisiones', topic: 'Condiciones y decisiones', objective: 'Estudiar un ejemplo y escribir una conclusión entre compañeros.',
      startsAt: later(60), endsAt: later(120), capacity: 5, visibility: 'group', status: 'scheduled', participantCount: 1, version: 1, createdAt: now, updatedAt: now }],
    roomMembers: [{ roomId: 'room-demo-open', memberId: 'demo-2', status: 'joined', joinedAt: now, updatedAt: now }],
    roomMaterials: [{ id: 'room-demo-material', roomId: 'room-demo-open', kind: 'note', sourceId: 'n1', sourceVersion: 1, addedBy: 'demo-2', addedAt: now }],
    roomTimers: [{ roomId: 'room-demo-open', phase: 'study', state: 'idle', studyMinutes: 25, breakMinutes: 5, remainingMs: 1_500_000, version: 1, updatedAt: now }],
    roomSummaries: [{ roomId: 'room-demo-open', text: '', version: 1, updatedBy: 'demo-2', updatedAt: now }],
  };
}

/** Estado privado compartido por las sesiones de la demo, con permisos equivalentes al servidor. */
export class DemoRoomsStore implements StudyRoomActions {
  constructor(private ctx: Context) {}
  private member(roomId: Id, memberId = this.ctx.active().id) {
    return this.ctx.state().roomMembers.find((row) => row.roomId === roomId && row.memberId === memberId);
  }
  private room(roomId: Id, organizer = false): StudyRoom {
    const me = this.ctx.active();
    const room = this.ctx.state().studyRooms.find((row) => row.id === roomId);
    if (!room || this.member(roomId, me.id)?.status !== 'joined' || (organizer && room.organizerId !== me.id)) throw new Error('No tienes acceso a esta sala.');
    return room;
  }
  private open(room: StudyRoom) {
    if (!ongoing(room)) throw new Error('La sala ya terminó o está cancelada.');
  }
  private version(actual: number, expected: number) {
    if (actual !== expected) throw new Error('Otra persona guardó cambios. Actualiza antes de guardar; conserva tu borrador.');
  }
  private bump(room: StudyRoom) { room.version++; room.updatedAt = this.ctx.now(); }
  private count(room: StudyRoom) {
    room.participantCount = this.ctx.state().roomMembers.filter((row) => row.roomId === room.id && row.status === 'joined' && this.ctx.state().members.some((m) => m.id === row.memberId && m.status === 'active')).length;
  }
  private setMember(room: StudyRoom, memberId: Id, status: StudyRoomMember['status'], invitedBy?: Id) {
    const state = this.ctx.state(); const old = this.member(room.id, memberId); const now = this.ctx.now();
    const row: StudyRoomMember = { roomId: room.id, memberId, status, invitedBy: invitedBy ?? old?.invitedBy,
      joinedAt: status === 'joined' ? now : undefined, updatedAt: now };
    state.roomMembers = [...state.roomMembers.filter((r) => r.roomId !== room.id || r.memberId !== memberId), row];
    this.count(room);
    room.updatedAt = now;
  }
  private availableSource(room: Pick<StudyRoom, 'subjectId'>, kind: StudyRoomMaterialKind, sourceId: Id) {
    if (kind !== 'note' && kind !== 'guide') throw new Error('El tipo de material no es válido.');
    const state = this.ctx.state();
    const source = kind === 'note' ? state.notes.find((row) => row.id === sourceId && row.visibility === 'group') : state.guides.find((row) => row.id === sourceId);
    if (!source || source.withdrawnAt || !this.ctx.sourceAvailable(kind, sourceId)) throw new Error('El material no está disponible para el grupo. Publica primero una copia de tu nota personal.');
    if (source.subjectId !== room.subjectId) throw new Error('El material debe pertenecer a la misma materia.');
    return source;
  }
  snapshot(viewerId: Id): StudyRoomsSnapshot {
    const s = this.ctx.state();
    if (!s.members.some((row) => row.id === viewerId && row.status === 'active')) return emptyStudyRooms();
    const own = new Map(s.roomMembers.filter((row) => row.memberId === viewerId).map((row) => [row.roomId, row]));
    const studyRooms = s.studyRooms.filter((room) => own.get(room.id)?.status !== 'removed' && (room.visibility === 'group' || ['joined', 'invited'].includes(own.get(room.id)?.status ?? '')));
    const visible = new Set(studyRooms.map((row) => row.id));
    const joined = new Set(studyRooms.filter((row) => own.get(row.id)?.status === 'joined').map((row) => row.id));
    return {
      studyRooms, roomMembers: s.roomMembers.filter((row) => visible.has(row.roomId) && (joined.has(row.roomId) || row.memberId === viewerId)),
      roomMaterials: s.roomMaterials.filter((row) => {
        if (!joined.has(row.roomId)) return false;
        const room = studyRooms.find((r) => r.id === row.roomId)!;
        try { this.availableSource(room, row.kind, row.sourceId); return true; } catch { return false; }
      }),
      roomEntries: s.roomEntries.filter((row) => joined.has(row.roomId)),
      roomTimers: s.roomTimers.filter((row) => joined.has(row.roomId)),
      roomSummaries: s.roomSummaries.filter((row) => joined.has(row.roomId)),
      helpRoomLinks: s.helpRoomLinks.filter((row) => visible.has(row.roomId) && s.helpContacts.some((c) => c.id === row.contactId && (c.senderId === viewerId || c.recipientId === viewerId))),
    };
  }
  createStudyRoom(input: CreateStudyRoomInput): Id {
    const me = this.ctx.active(); const state = this.ctx.state();
    const requestId = text(input.requestId, 'El identificador del intento', 128);
    const existing = state.studyRooms.find((r) => r.organizerId === me.id && r.requestId === requestId);
    if (existing) return existing.id;
    const error = studyRoomFieldsError(input); if (error) throw new Error(error);
    if (!state.subjects.some((row) => row.id === input.subjectId)) throw new Error('La materia no existe.');
    if (!['group', 'private'].includes(input.visibility)) throw new Error('La visibilidad no es válida.');
    let invitee: Id | undefined;
    if (input.helpContactId) {
      const contact = state.helpContacts.find((c) => c.id === input.helpContactId && (c.senderId === me.id || c.recipientId === me.id));
      if (!contact || contact.status !== 'accepted') throw new Error('El contacto de Ayuda debe estar aceptado.');
      if (contact.subjectId !== input.subjectId) throw new Error('La sala debe usar la materia del contacto de Ayuda.');
      const activeLink = state.helpRoomLinks.find((l) => l.contactId === contact.id && state.studyRooms.some((r) => r.id === l.roomId && ongoing(r)));
      if (activeLink) {
        const existingRoom = state.studyRooms.find((r) => r.id === activeLink.roomId)!;
        const membership = this.member(existingRoom.id, me.id);
        if (membership?.status === 'removed' || (existingRoom.visibility === 'private' && !['joined', 'invited'].includes(membership?.status ?? ''))) {
          throw new Error('Este contacto ya tiene una sala activa; pide una nueva invitación al organizador.');
        }
        return activeLink.roomId;
      }
      invitee = contact.senderId === me.id ? contact.recipientId : contact.senderId;
      if (!state.members.some((m) => m.id === invitee && m.status === 'active')) throw new Error('La otra persona ya no es integrante activo.');
    }
    if (Boolean(input.sourceKind) !== Boolean(input.sourceId)) throw new Error('Selecciona un material válido.');
    const source = input.sourceKind && input.sourceId ? this.availableSource(input, input.sourceKind, input.sourceId) : undefined;
    let id: Id; do { id = `room-${this.ctx.id()}`; } while (state.studyRooms.some((r) => r.id === id));
    const now = this.ctx.now();
    const room: StudyRoom = { id, requestId, organizerId: me.id, subjectId: input.subjectId, title: input.title.trim(), topic: input.topic.trim(), objective: input.objective.trim(),
      startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), capacity: input.capacity, visibility: input.visibility,
      status: 'scheduled', version: 1, participantCount: 1, createdAt: now, updatedAt: now };
    state.studyRooms.push(room);
    state.roomMembers.push({ roomId: id, memberId: me.id, status: 'joined', joinedAt: now, updatedAt: now });
    if (invitee) state.roomMembers.push({ roomId: id, memberId: invitee, status: 'invited', invitedBy: me.id, updatedAt: now });
    state.roomTimers.push({ roomId: id, phase: 'study', state: 'idle', studyMinutes: 25, breakMinutes: 5, remainingMs: 25 * 60_000, version: 1, updatedAt: now });
    state.roomSummaries.push({ roomId: id, text: '', version: 1, updatedBy: me.id, updatedAt: now });
    if (input.helpContactId) state.helpRoomLinks.push({ contactId: input.helpContactId, roomId: id });
    if (source && input.sourceKind) state.roomMaterials.push({ id: `material-${this.ctx.id()}`, roomId: id, kind: input.sourceKind, sourceId: source.id, sourceVersion: source.version, addedBy: me.id, addedAt: now });
    this.ctx.emit(); return id;
  }
  updateStudyRoom(roomId: Id, input: UpdateStudyRoomInput) {
    const room = this.room(roomId); this.open(room); this.version(room.version, input.expectedVersion);
    const error = studyRoomFieldsError(input); if (error) throw new Error(error);
    if (input.capacity !== undefined && input.capacity < room.participantCount) throw new Error('El cupo no puede ser menor que los inscritos.');
    Object.assign(room, { title: input.title.trim(), topic: input.topic.trim(), objective: input.objective.trim(), startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), capacity: input.capacity });
    this.bump(room); this.ctx.emit();
  }
  joinStudyRoom(roomId: Id) {
    const me = this.ctx.active(); const room = this.ctx.state().studyRooms.find((r) => r.id === roomId);
    if (!room || room.visibility !== 'group') throw new Error('Necesitas una invitación para esta sala.');
    this.open(room); const status = this.member(roomId)?.status;
    if (status === 'joined') return;
    if (status === 'removed') throw new Error('Necesitas una nueva invitación para regresar.');
    if (room.capacity !== undefined && room.participantCount >= room.capacity) throw new Error('La sala no tiene cupo disponible.');
    this.setMember(room, me.id, 'joined'); this.ctx.emit();
  }
  leaveStudyRoom(roomId: Id) {
    const room = this.room(roomId);
    if (room.organizerId === this.ctx.active().id) throw new Error('Como organizador, cancela o finaliza la sala.');
    this.setMember(room, this.ctx.active().id, 'left'); this.ctx.emit();
  }
  inviteStudyRoomMember(roomId: Id, memberId: Id) {
    const room = this.room(roomId, true); this.open(room);
    if (!this.ctx.state().members.some((m) => m.id === memberId && m.status === 'active')) throw new Error('Elige un integrante activo.');
    if (this.member(roomId, memberId)?.status === 'joined') return;
    this.setMember(room, memberId, 'invited', this.ctx.active().id); this.ctx.emit();
  }
  respondStudyRoomInvitation(roomId: Id, accepted: boolean) {
    const me = this.ctx.active(); const room = this.ctx.state().studyRooms.find((r) => r.id === roomId);
    if (room && accepted && this.member(roomId)?.status === 'joined') { this.open(room); return; }
    if (!room || this.member(roomId)?.status !== 'invited') throw new Error('La invitación ya no está disponible.');
    this.open(room);
    if (accepted && room.capacity !== undefined && room.participantCount >= room.capacity) throw new Error('La sala no tiene cupo disponible.');
    this.setMember(room, me.id, accepted ? 'joined' : 'declined'); this.ctx.emit();
  }
  removeStudyRoomMember(roomId: Id, memberId: Id) {
    const room = this.room(roomId, true); this.open(room);
    if (memberId === room.organizerId) throw new Error('No puedes retirarte como organizador.');
    if (!this.member(roomId, memberId)) throw new Error('La persona no participa en la sala.');
    this.setMember(room, memberId, 'removed'); this.ctx.emit();
  }
  setStudyRoomStatus(roomId: Id, status: Exclude<StudyRoomStatus, 'scheduled'>, expectedVersion: number) {
    const room = this.room(roomId, true); this.version(room.version, expectedVersion);
    if (room.status === status) return;
    this.open(room);
    if (!['active', 'completed', 'cancelled'].includes(status) || (status === 'active' && room.status !== 'scheduled') || (status === 'completed' && room.status !== 'active')) throw new Error('El cambio de estado no está permitido.');
    room.status = status; this.bump(room);
    if (!ongoing(room)) this.stopTimer(roomId);
    this.ctx.emit();
  }
  setStudyRoomMaterial(roomId: Id, kind: StudyRoomMaterialKind, sourceId: Id, enabled: boolean) {
    const room = this.room(roomId); this.open(room); const state = this.ctx.state();
    if (kind !== 'note' && kind !== 'guide') throw new Error('El tipo de material no es válido.');
    const previous = state.roomMaterials.find((r) => r.roomId === roomId && r.kind === kind && r.sourceId === sourceId);
    if (enabled) {
      const source = this.availableSource(room, kind, sourceId); if (previous) return;
      state.roomMaterials.push({ id: `material-${this.ctx.id()}`, roomId, kind, sourceId, sourceVersion: source.version, addedBy: this.ctx.active().id, addedAt: this.ctx.now() });
    } else state.roomMaterials = state.roomMaterials.filter((r) => r !== previous);
    this.ctx.emit();
  }
  sendStudyRoomEntry(roomId: Id, kind: StudyRoomEntryKind, value: string, requestId: string): Id {
    const room = this.room(roomId); const me = this.ctx.active(); const state = this.ctx.state();
    const cleaned = text(value, 'El mensaje', ROOM_LIMITS.entry); const request = text(requestId, 'El identificador del intento', 128);
    if (!['message', 'question', 'conclusion'].includes(kind)) throw new Error('El tipo de aporte no es válido.');
    const previous = state.roomEntries.find((r) => r.roomId === roomId && r.authorId === me.id && r.requestId === request);
    if (previous) { if (previous.text !== cleaned || previous.kind !== kind) throw new Error('El intento ya se usó para otro mensaje.'); return previous.id; }
    this.open(room);
    let id: Id; do { id = `entry-${this.ctx.id()}`; } while (state.roomEntries.some((r) => r.id === id));
    state.roomEntries.push({ id, roomId, authorId: me.id, kind, text: cleaned, requestId: request, createdAt: this.ctx.now() });
    this.ctx.emit(); return id;
  }
  private stopTimer(roomId: Id) {
    const timer = this.ctx.state().roomTimers.find((r) => r.roomId === roomId)!;
    timer.remainingMs = roomRemainingMs(timer, this.ctx.now()); timer.startedAt = undefined; timer.state = 'paused'; timer.version++; timer.updatedAt = this.ctx.now();
  }
  controlStudyRoomTimer(roomId: Id, input: ControlStudyRoomTimerInput) {
    const room = this.room(roomId); this.open(room);
    if (room.status !== 'active') throw new Error('Comienza la sesión antes de usar el temporizador.');
    const timer = this.ctx.state().roomTimers.find((r) => r.roomId === roomId)!; this.version(timer.version, input.expectedVersion);
    const studyMinutes = input.studyMinutes ?? timer.studyMinutes; const breakMinutes = input.breakMinutes ?? timer.breakMinutes;
    const error = roomTimerMinutesError(studyMinutes, breakMinutes); if (error) throw new Error(error);
    if (!['start', 'pause', 'resume', 'reset', 'next'].includes(input.action)) throw new Error('La acción del temporizador no es válida.');
    const remaining = roomRemainingMs(timer, this.ctx.now());
    if (input.action === 'start' && timer.state !== 'idle') throw new Error('El temporizador ya comenzó.');
    if (input.action === 'pause' && timer.state !== 'running') throw new Error('El temporizador no está corriendo.');
    if (input.action === 'resume' && (timer.state !== 'paused' || remaining === 0)) throw new Error('El temporizador no se puede continuar.');
    if (input.action === 'next' && remaining > 0) throw new Error('Termina el bloque actual antes de pasar al siguiente.');
    if ((studyMinutes !== timer.studyMinutes || breakMinutes !== timer.breakMinutes) && !['reset', 'start'].includes(input.action)) throw new Error('Reinicia para cambiar la duración de los bloques.');
    timer.studyMinutes = studyMinutes; timer.breakMinutes = breakMinutes;
    if (input.action === 'next') timer.phase = timer.phase === 'study' ? 'break' : 'study';
    const duration = (timer.phase === 'study' ? studyMinutes : breakMinutes) * 60_000;
    timer.remainingMs = ['start', 'reset', 'next'].includes(input.action) ? duration : remaining;
    timer.state = input.action === 'reset' ? 'idle' : input.action === 'pause' ? 'paused' : 'running';
    timer.startedAt = timer.state === 'running' ? this.ctx.now() : undefined; timer.version++; timer.updatedAt = this.ctx.now(); this.ctx.emit();
  }
  saveStudyRoomSummary(roomId: Id, value: string, expectedVersion: number) {
    const room = this.room(roomId); if (room.status === 'cancelled') throw new Error('La sala está cancelada.');
    const summary = this.ctx.state().roomSummaries.find((r) => r.roomId === roomId)!; this.version(summary.version, expectedVersion);
    summary.text = text(value, 'El resumen', ROOM_LIMITS.summary, true); summary.version++; summary.updatedBy = this.ctx.active().id; summary.updatedAt = this.ctx.now(); this.ctx.emit();
  }
  publishStudyRoomSummary(roomId: Id, expectedVersion: number): Id {
    const room = this.room(roomId, true); const state = this.ctx.state(); const summary = state.roomSummaries.find((r) => r.roomId === roomId)!;
    if (summary.publishedNoteId) return summary.publishedNoteId;
    this.version(summary.version, expectedVersion);
    if (room.status !== 'completed') throw new Error('Finaliza la sala antes de publicar el resumen.');
    const body = text(summary.text, 'El resumen', ROOM_LIMITS.summary); const now = this.ctx.now();
    let id: Id; do { id = this.ctx.id(); } while (state.notes.some((n) => n.id === id));
    state.notes.push({ id, subjectId: room.subjectId, topic: room.topic, title: room.title, body, tags: ['sala-de-estudio'], visibility: 'group', source: 'student', authorId: room.organizerId, version: 1, createdAt: now, updatedAt: now });
    summary.publishedNoteId = id; summary.version++; summary.updatedAt = now; summary.updatedBy = this.ctx.active().id; this.ctx.emit(); return id;
  }
  getStudyRoomClock(roomId: Id): Date { this.room(roomId); return this.ctx.now(); }
  memberRemoved(memberId: Id) {
    const state = this.ctx.state();
    for (const room of state.studyRooms) {
      if (room.organizerId === memberId && ongoing(room)) { room.status = 'cancelled'; this.stopTimer(room.id); this.bump(room); }
      const member = this.member(room.id, memberId); if (member) { member.status = 'removed'; member.joinedAt = undefined; member.updatedAt = this.ctx.now(); this.count(room); }
    }
  }
}
