import { roomRemainingMs } from '@b20/core';
import { describe, expect, it, vi } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import type { CreateStudyRoomInput } from './types';

const NOW = new Date('2026-10-21T12:00:00Z');
const input: CreateStudyRoomInput = { requestId: 'first-room', title: 'Estudiar decisiones', subjectId: 'IDSE-05010103', topic: 'Decisiones', objective: 'Resolver dos ejemplos', startsAt: NOW, endsAt: new Date(NOW.getTime() + 3_600_000), visibility: 'group', capacity: 2 };
function setup() {
  const state = createDemoState(NOW); let now = NOW;
  const data = new DemoDataSource(state, 'demo-2', () => new Date(now));
  const peer = new DemoDataSource(state, 'demo-3', () => new Date(now));
  return { data, peer, state, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}
function room(data: DemoDataSource, id: string) { return data.getSnapshot().studyRooms.find((r) => r.id === id)!; }
function timer(data: DemoDataSource, id: string) { return data.getSnapshot().roomTimers.find((r) => r.roomId === id)!; }
function summary(data: DemoDataSource, id: string) { return data.getSnapshot().roomSummaries.find((r) => r.roomId === id)!; }

describe('Salas de estudio en DemoDataSource', () => {
  it('crea una sola sala por intento y no la inicia al alcanzar el horario', () => {
    const { data, advance } = setup(); const id = data.createStudyRoom(input);
    expect(data.createStudyRoom(input)).toBe(id);
    expect(room(data, id)).toMatchObject({ status: 'scheduled', participantCount: 1, version: 1 });
    advance(8_000_000);
    expect(room(data, id).status).toBe('scheduled');
    expect(() => data.controlStudyRoomTimer(id, { action: 'start', expectedVersion: 1 })).toThrow('Comienza');
    expect(() => data.createStudyRoom({ ...input, requestId: 'invalid-time', endsAt: NOW })).toThrow('posterior');
  });
  it('reserva cupo atómicamente y no permite reducirlo por debajo de los inscritos', () => {
    const { data, peer, state } = setup(); const id = data.createStudyRoom(input);
    peer.joinStudyRoom(id);
    const third = new DemoDataSource(state, 'demo-4');
    expect(() => third.joinStudyRoom(id)).toThrow('cupo');
    expect(() => peer.updateStudyRoom(id, { ...input, capacity: 1, expectedVersion: room(peer, id).version })).toThrow('inscritos');
    peer.updateStudyRoom(id, { ...input, title: 'Título compartido', expectedVersion: room(peer, id).version });
    expect(room(data, id).title).toBe('Título compartido');
    peer.leaveStudyRoom(id); third.joinStudyRoom(id);
    expect(room(data, id).participantCount).toBe(2);
    expect(() => data.leaveStudyRoom(id)).toThrow('organizador');
  });
  it('limita las vistas privadas y permite aceptar o rechazar sin reservar asiento', () => {
    const { data, peer, state } = setup(); const id = data.createStudyRoom({ ...input, visibility: 'private' });
    data.sendStudyRoomEntry(id, 'question', 'Duda privada', 'q1');
    data.saveStudyRoomSummary(id, 'Texto privado', 1);
    data.setStudyRoomMaterial(id, 'note', 'n1', true);
    expect(peer.getSnapshot().studyRooms.some((r) => r.id === id)).toBe(false);
    data.inviteStudyRoomMember(id, 'demo-3');
    expect(room(peer, id).participantCount).toBe(1);
    expect(peer.getSnapshot().roomMembers.filter((r) => r.roomId === id)).toHaveLength(1);
    for (const key of ['roomEntries', 'roomSummaries', 'roomTimers', 'roomMaterials'] as const) expect(peer.getSnapshot()[key].some((r) => r.roomId === id)).toBe(false);
    peer.respondStudyRoomInvitation(id, false);
    expect(peer.getSnapshot().studyRooms.some((r) => r.id === id)).toBe(false);
    data.inviteStudyRoomMember(id, 'demo-3'); peer.respondStudyRoomInvitation(id, true);
    expect(peer.getSnapshot().roomEntries.find((r) => r.roomId === id)?.text).toBe('Duda privada');
    const admin = new DemoDataSource(state, 'demo-1');
    expect(admin.getSnapshot().studyRooms.some((r) => r.id === id)).toBe(false);
    expect(() => admin.sendStudyRoomEntry(id, 'message', 'Sin permiso', 'x')).toThrow('acceso');
  });
  it('revoca en otro cliente abierto, bloquea reingreso y permite una nueva invitación', () => {
    const { data, peer } = setup(); const id = data.createStudyRoom(input); peer.joinStudyRoom(id);
    data.sendStudyRoomEntry(id, 'message', 'Contenido reservado', 'private');
    const changed = vi.fn(); peer.subscribe(changed); peer.getSnapshot();
    data.removeStudyRoomMember(id, 'demo-3');
    expect(changed).toHaveBeenCalled();
    expect(peer.getSnapshot().roomEntries.some((r) => r.roomId === id)).toBe(false);
    expect(peer.getSnapshot().roomTimers.some((r) => r.roomId === id)).toBe(false);
    expect(() => peer.joinStudyRoom(id)).toThrow('nueva invitación');
    expect(() => peer.saveStudyRoomSummary(id, 'Ya no puedo', 1)).toThrow('acceso');
    data.inviteStudyRoomMember(id, 'demo-3'); peer.respondStudyRoomInvitation(id, true);
    expect(peer.getSnapshot().roomEntries.find((r) => r.roomId === id)?.text).toBe('Contenido reservado');
  });
  it('los invitados no consumen cupo y aceptar comprueba la plaza vigente', () => {
    const { data, peer, state } = setup(); const id = data.createStudyRoom(input);
    data.inviteStudyRoomMember(id, 'demo-3');
    const third = new DemoDataSource(state, 'demo-4'); third.joinStudyRoom(id);
    expect(() => peer.respondStudyRoomInvitation(id, true)).toThrow('cupo');
    expect(peer.getSnapshot().roomMembers.find((r) => r.roomId === id && r.memberId === 'demo-3')?.status).toBe('invited');
  });
  it('dos clientes comparten reloj, pausa y fase sin autoavance ni escrituras por segundo', () => {
    const { data, peer, advance } = setup(); const id = data.createStudyRoom(input); peer.joinStudyRoom(id);
    data.setStudyRoomStatus(id, 'active', room(data, id).version);
    data.controlStudyRoomTimer(id, { action: 'start', expectedVersion: 1, studyMinutes: 1, breakMinutes: 1 });
    const first = timer(peer, id); expect(roomRemainingMs(first, peer.getStudyRoomClock(id))).toBe(60_000);
    advance(20_000);
    peer.controlStudyRoomTimer(id, { action: 'pause', expectedVersion: first.version });
    expect(timer(data, id)).toMatchObject({ state: 'paused', remainingMs: 40_000 });
    const staleVersion = timer(data, id).version;
    data.controlStudyRoomTimer(id, { action: 'resume', expectedVersion: staleVersion });
    expect(() => peer.controlStudyRoomTimer(id, { action: 'reset', expectedVersion: staleVersion })).toThrow('Otra persona');
    advance(90_000);
    const elapsed = timer(peer, id); expect(roomRemainingMs(elapsed, peer.getStudyRoomClock(id))).toBe(0);
    expect(elapsed.phase).toBe('study');
    peer.controlStudyRoomTimer(id, { action: 'next', expectedVersion: elapsed.version });
    expect(timer(data, id)).toMatchObject({ phase: 'break', remainingMs: 60_000, state: 'running' });
    expect(() => data.controlStudyRoomTimer(id, { action: 'next', expectedVersion: timer(data, id).version })).toThrow('Termina');
  });
  it('la baja del organizador cancela y detiene salas activas conservando el historial', () => {
    const { data, peer, state, advance } = setup(); const id = data.createStudyRoom(input); peer.joinStudyRoom(id);
    data.setStudyRoomStatus(id, 'active', room(data, id).version);
    data.controlStudyRoomTimer(id, { action: 'start', expectedVersion: 1 });
    data.sendStudyRoomEntry(id, 'conclusion', 'Se conserva el historial', 'history');
    advance(10_000);
    const admin = new DemoDataSource(state, 'demo-1', () => new Date(NOW.getTime() + 10_000)); admin.removeMember('demo-2');
    expect(room(peer, id).status).toBe('cancelled');
    expect(timer(peer, id)).toMatchObject({ state: 'paused', remainingMs: 1_490_000 });
    expect(peer.getSnapshot().roomEntries.find((r) => r.roomId === id)?.text).toBe('Se conserva el historial');
    expect(data.getSnapshot().studyRooms).toEqual([]);
    expect(() => peer.saveStudyRoomSummary(id, 'Cambio', 1)).toThrow('cancelada');
  });
  it('un resumen rechaza versiones viejas y publica una nota independiente una sola vez', () => {
    const { data, peer } = setup(); const id = data.createStudyRoom(input); peer.joinStudyRoom(id);
    peer.saveStudyRoomSummary(id, 'Conclusión común', 1);
    expect(() => data.saveStudyRoomSummary(id, 'Borrador anterior', 1)).toThrow('conserva tu borrador');
    expect(() => peer.publishStudyRoomSummary(id, 2)).toThrow('acceso');
    data.setStudyRoomStatus(id, 'active', room(data, id).version);
    data.setStudyRoomStatus(id, 'completed', room(data, id).version);
    const noteId = data.publishStudyRoomSummary(id, summary(data, id).version);
    expect(data.publishStudyRoomSummary(id, 0)).toBe(noteId);
    peer.saveStudyRoomSummary(id, 'Resultado posterior', summary(peer, id).version);
    expect(data.getSnapshot().notes.find((n) => n.id === noteId)).toMatchObject({ body: 'Conclusión común', visibility: 'group', source: 'student', authorId: 'demo-2' });
    expect(() => peer.sendStudyRoomEntry(id, 'message', 'Ya finalizó', 'ended')).toThrow('terminó');
  });
  it('retira materiales de otro cliente y rechaza referencias personales o de otra materia', () => {
    const { data, peer } = setup(); const id = data.createStudyRoom(input); peer.joinStudyRoom(id);
    data.setStudyRoomMaterial(id, 'note', 'n1', true);
    expect(peer.getSnapshot().roomMaterials.some((r) => r.roomId === id)).toBe(true);
    expect(() => data.setStudyRoomMaterial(id, 'note', 'n2', true)).toThrow('grupo');
    expect(() => data.setStudyRoomMaterial(id, 'note', 'n3', true)).toThrow('materia');
    data.withdrawContent('note', 'n1', true, 1, 'Retirada');
    expect(peer.getSnapshot().roomMaterials.some((r) => r.roomId === id)).toBe(false);
    expect(data.getSnapshot().roomMaterials.some((r) => r.roomId === id)).toBe(false);
  });
  it('crear desde Ayuda queda restringido a la pareja y mantiene una sala activa por contacto', () => {
    const { data, peer } = setup(); const fromHelp = { ...input, visibility: 'private' as const, helpContactId: 'hc3' };
    const id = data.createStudyRoom(fromHelp);
    expect(peer.createStudyRoom({ ...fromHelp, requestId: 'other-person' })).toBe(id);
    expect(() => data.createStudyRoom({ ...fromHelp, requestId: 'pending-contact', helpContactId: 'hc1' })).toThrow('aceptado');
    expect(data.createStudyRoom({ ...fromHelp, requestId: 'public-contact', visibility: 'group' })).toBe(id);
    data.setStudyRoomStatus(id, 'cancelled', room(data, id).version);
    expect(data.createStudyRoom({ ...fromHelp, requestId: 'next-session' })).not.toBe(id);
  });
  it('reintenta mensajes sin duplicados y no permite reutilizar el intento con otro contenido', () => {
    const { data } = setup(); const id = data.createStudyRoom(input);
    const message = data.sendStudyRoomEntry(id, 'message', 'Una sola vez', 'same-attempt');
    expect(data.sendStudyRoomEntry(id, 'message', 'Una sola vez', 'same-attempt')).toBe(message);
    expect(() => data.sendStudyRoomEntry(id, 'question', 'Diferente', 'same-attempt')).toThrow('otro mensaje');
  });
  it('no crea otra sala ni revela una sala privada activa después de salir', () => {
    const { data, peer } = setup(); const fromHelp = { ...input, visibility: 'private' as const, helpContactId: 'hc3' };
    const id = data.createStudyRoom(fromHelp); peer.respondStudyRoomInvitation(id, true); peer.leaveStudyRoom(id);
    expect(() => peer.createStudyRoom({ ...fromHelp, requestId: 'after-leaving' })).toThrow('pide una nueva invitación');
    expect(peer.getSnapshot().helpRoomLinks.some((r) => r.roomId === id)).toBe(false);
    data.inviteStudyRoomMember(id, 'demo-3');
    expect(peer.createStudyRoom({ ...fromHelp, requestId: 'new-invitation' })).toBe(id);
  });
  it('permite elegir una sala abierta desde Ayuda y mantiene privado el vínculo', () => {
    const { data, peer, state } = setup(); const id = data.createStudyRoom({ ...input, helpContactId: 'hc3' });
    const third = new DemoDataSource(state, 'demo-4');
    expect(room(third, id).visibility).toBe('group');
    expect(third.getSnapshot().helpRoomLinks.some((r) => r.roomId === id)).toBe(false);
    peer.respondStudyRoomInvitation(id, true);
    expect(peer.getSnapshot().helpRoomLinks).toContainEqual({ contactId: 'hc3', roomId: id });
  });
  it('cerrar un cliente no borra el estado ni las suscripciones de los demás', () => {
    const { data, peer } = setup(); const id = data.createStudyRoom(input); peer.joinStudyRoom(id);
    const changed = vi.fn(); peer.subscribe(changed); data.dispose();
    peer.sendStudyRoomEntry(id, 'message', 'Sigo aquí', 'after-dispose');
    expect(changed).toHaveBeenCalled();
    expect(room(peer, id).participantCount).toBe(2);
    expect(peer.getSnapshot().roomEntries.find((r) => r.roomId === id)?.text).toBe('Sigo aquí');
    expect(() => data.joinStudyRoom(id)).toThrow('terminó');
  });
});
