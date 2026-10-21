import { Identity, Timestamp } from 'spacetimedb';
import { describe, expect, it, vi } from 'vitest';
import { createStudyRoomActions, type RoomActionsConnection } from './roomsActions';
import { enrichStudyRoomsSnapshot, type RoomSnapshotConnection } from './roomsSnapshot';
import { emptySnapshot } from './spacetimeSnapshot';
import type { Snapshot } from './types';

const SELF = '00000000000000000000000000000000000000000000000000000000000000aa';
const PEER = '00000000000000000000000000000000000000000000000000000000000000bb';
const THIRD = '00000000000000000000000000000000000000000000000000000000000000cc';
const person = (id = SELF) => Identity.fromString(id);
const now = new Date('2026-10-21T12:00:00Z');
const at = Timestamp.fromDate(now);
type Row<Key extends keyof RoomSnapshotConnection['db']> = ReturnType<RoomSnapshotConnection['db'][Key]['iter']> extends Iterable<infer R> ? R : never;
const table = <T,>(rows: T[]) => ({ iter: () => rows.values() });

function fixture() {
  const rooms: Row<'studyRooms'>[] = [{ id: 9007199254740993n, requestId: 'attempt', organizer: person(), subjectId: 10n, title: 'Sala privada', topic: 'Decisiones', objective: 'Comparar ejemplos',
    startsAt: at, endsAt: Timestamp.fromDate(new Date(now.getTime() + 3_600_000)), capacity: 3, visibility: 'private', status: 'active', version: 4, participantCount: 2, createdAt: at, updatedAt: at }];
  const roomId = rooms[0]!.id;
  const members: Row<'roomMembers'>[] = [SELF, PEER].map((memberId) => ({ key: `${roomId}:${memberId}`, roomId, memberId: person(memberId), status: 'joined', invitedBy: person(), joinedAt: at, updatedAt: at }));
  const materials: Row<'roomMaterials'>[] = [{ id: 1n, roomId, kind: 'note', sourceId: 1n, sourceVersion: 7, addedBy: person(), addedAt: at }];
  const entries: Row<'roomEntries'>[] = [{ id: 2n, roomId, author: person(), kind: 'question', text: 'Duda reservada', requestId: 'question-attempt', createdAt: at }];
  const timers: Row<'roomTimers'>[] = [{ roomId, phase: 'study', state: 'running', remainingMs: 1_500_000n, studyMinutes: 25, breakMinutes: 5, startedAt: at, version: 2, updatedBy: person(), updatedAt: at }];
  const summaries: Row<'roomSummaries'>[] = [{ roomId, text: 'Conclusión reservada', version: 3, updatedBy: person(), updatedAt: at, publishedNoteId: 8n }];
  const links: Row<'myHelpRoomLinks'>[] = [{ id: 1n, contactId: 7n, roomId, memberA: person(), memberB: person(PEER) }];
  const connection: RoomSnapshotConnection = { db: { studyRooms: table(rooms), roomMembers: table(members), roomMaterials: table(materials), roomEntries: table(entries), roomTimers: table(timers), roomSummaries: table(summaries), myHelpRoomLinks: table(links) } };
  const base = (viewer = SELF): Snapshot => ({ ...emptySnapshot('ready'), me: { id: viewer, displayName: 'Persona', status: 'active', isCreator: viewer === THIRD, joinedAt: now },
    members: [SELF, PEER, THIRD].map((id) => ({ id, displayName: 'Persona', status: 'active', isCreator: id === THIRD, joinedAt: now })),
    notes: [{ id: '1', subjectId: '10', topic: 'Decisiones', title: 'Fuente', body: 'Texto compartido', tags: [], visibility: 'group', source: 'student', authorId: SELF, version: 7, createdAt: now, updatedAt: now }] });
  return { connection, rooms, members, materials, entries, timers, summaries, links, base, roomId: roomId.toString() };
}

describe('Vistas de Salas con bindings generados', () => {
  it('convierte IDs u64 y fechas sin perder precisión y entrega el material accesible', () => {
    const f = fixture(); const snapshot = enrichStudyRoomsSnapshot(f.connection, f.base(), SELF);
    expect(snapshot.studyRooms[0]).toMatchObject({ id: '9007199254740993', organizerId: SELF, startsAt: now, participantCount: 2 });
    expect(snapshot.roomTimers[0]).toMatchObject({ remainingMs: 1_500_000, startedAt: now });
    expect(snapshot.roomMaterials[0]).toMatchObject({ sourceId: '1', sourceVersion: 7 });
    expect(snapshot.roomSummaries[0]?.publishedNoteId).toBe('8');
    expect(snapshot.helpRoomLinks).toEqual([{ contactId: '7', roomId: f.roomId }]);
  });
  it('el invitado solo recibe su ficha mientras terceros y administradores no ven nada', () => {
    const f = fixture(); f.members[1]!.status = 'invited';
    const invited = enrichStudyRoomsSnapshot(f.connection, f.base(PEER), PEER);
    expect(invited.studyRooms).toHaveLength(1); expect(invited.roomMembers).toHaveLength(1);
    expect(invited.roomEntries).toEqual([]); expect(invited.roomSummaries).toEqual([]); expect(invited.roomMaterials).toEqual([]); expect(invited.roomTimers).toEqual([]);
    const admin = enrichStudyRoomsSnapshot(f.connection, f.base(THIRD), THIRD);
    expect(admin.studyRooms).toEqual([]); expect(admin.helpRoomLinks).toEqual([]);
    expect(JSON.stringify(admin)).not.toMatch(/Duda reservada|Conclusión reservada/);
  });
  it('retira todas las filas cuando cambia la membresía y evita usar caché privada huérfana', () => {
    const f = fixture(); f.members[1]!.status = 'removed';
    const removed = enrichStudyRoomsSnapshot(f.connection, f.base(PEER), PEER);
    expect(removed.studyRooms).toEqual([]); expect(removed.roomEntries).toEqual([]); expect(removed.helpRoomLinks).toEqual([]);
    f.rooms[0]!.visibility = 'group';
    const former = f.base(); former.me = { ...former.me!, status: 'removed' };
    expect(enrichStudyRoomsSnapshot(f.connection, former, SELF).studyRooms).toEqual([]);
    const noSession = f.base(); noSession.me = undefined;
    expect(enrichStudyRoomsSnapshot(f.connection, noSession, SELF).studyRooms).toEqual([]);
    f.members.length = 0;
    const preview = enrichStudyRoomsSnapshot(f.connection, f.base(), SELF);
    expect(preview.studyRooms).toHaveLength(1); expect(preview.roomEntries).toEqual([]);
  });
  it('no entrega identificadores de fuentes retiradas, personales o de otra materia', () => {
    const f = fixture();
    for (const note of [{ withdrawnAt: now }, { visibility: 'personal' as const }, { subjectId: '11' }]) {
      const snapshot = f.base(); snapshot.notes[0] = { ...snapshot.notes[0]!, ...note };
      expect(enrichStudyRoomsSnapshot(f.connection, snapshot, SELF).roomMaterials).toEqual([]);
    }
    f.timers[0]!.remainingMs = 9_007_199_254_740_993n;
    expect(() => enrichStudyRoomsSnapshot(f.connection, f.base(), SELF)).toThrow('duración');
  });
});

function actionFixture() {
  const f = fixture();
  type Reducers = RoomActionsConnection['reducers'];
  const reducers = {
    createStudyRoom: vi.fn<Reducers['createStudyRoom']>().mockResolvedValue(undefined),
    updateStudyRoom: vi.fn<Reducers['updateStudyRoom']>().mockResolvedValue(undefined),
    joinStudyRoom: vi.fn<Reducers['joinStudyRoom']>().mockResolvedValue(undefined),
    leaveStudyRoom: vi.fn<Reducers['leaveStudyRoom']>().mockResolvedValue(undefined),
    inviteStudyRoomMember: vi.fn<Reducers['inviteStudyRoomMember']>().mockResolvedValue(undefined),
    respondStudyRoomInvitation: vi.fn<Reducers['respondStudyRoomInvitation']>().mockResolvedValue(undefined),
    removeStudyRoomMember: vi.fn<Reducers['removeStudyRoomMember']>().mockResolvedValue(undefined),
    setStudyRoomStatus: vi.fn<Reducers['setStudyRoomStatus']>().mockResolvedValue(undefined),
    setStudyRoomMaterial: vi.fn<Reducers['setStudyRoomMaterial']>().mockResolvedValue(undefined),
    sendStudyRoomEntry: vi.fn<Reducers['sendStudyRoomEntry']>().mockResolvedValue(undefined),
    controlStudyRoomTimer: vi.fn<Reducers['controlStudyRoomTimer']>().mockResolvedValue(undefined),
    saveStudyRoomSummary: vi.fn<Reducers['saveStudyRoomSummary']>().mockResolvedValue(undefined),
    publishStudyRoomSummary: vi.fn<Reducers['publishStudyRoomSummary']>().mockResolvedValue(undefined),
  };
  const clock = vi.fn<RoomActionsConnection['procedures']['studyRoomClock']>().mockResolvedValue(at);
  const connection: RoomActionsConnection = { db: f.connection.db, reducers, procedures: { studyRoomClock: clock } };
  return { ...f, reducers, clock, actions: createStudyRoomActions(() => connection, () => SELF) };
}

describe('Acciones de Salas con contratos reales de SpacetimeDB', () => {
  it('mapea fechas, identidades, versiones y referencias exactas', async () => {
    const f = actionFixture();
    const input = { requestId: 'attempt', title: 'Sala privada', subjectId: '10', topic: 'Decisiones', objective: 'Comparar ejemplos', startsAt: now, endsAt: new Date(now.getTime() + 3_600_000), visibility: 'private' as const, helpContactId: '7', sourceKind: 'note' as const, sourceId: '1' };
    expect(await f.actions.createStudyRoom(input)).toBe(f.roomId);
    expect(f.reducers.createStudyRoom).toHaveBeenCalledWith({ ...input, subjectId: 10n, startsAt: at, endsAt: Timestamp.fromDate(input.endsAt), helpContactId: 7n, sourceId: 1n });
    await f.actions.updateStudyRoom(f.roomId, { ...input, expectedVersion: 4 });
    expect(f.reducers.updateStudyRoom.mock.calls[0]?.[0].roomId).toBe(9007199254740993n);
    await f.actions.inviteStudyRoomMember(f.roomId, PEER);
    expect(f.reducers.inviteStudyRoomMember).toHaveBeenCalledWith({ roomId: 9007199254740993n, memberId: person(PEER) });
    await f.actions.setStudyRoomMaterial(f.roomId, 'note', '9007199254740994', true);
    expect(f.reducers.setStudyRoomMaterial).toHaveBeenCalledWith({ roomId: 9007199254740993n, kind: 'note', sourceId: 9007199254740994n, enabled: true });
    await f.actions.controlStudyRoomTimer(f.roomId, { action: 'pause', expectedVersion: 2 });
    expect(f.reducers.controlStudyRoomTimer).toHaveBeenCalledWith({ roomId: 9007199254740993n, action: 'pause', expectedVersion: 2 });
    expect(await f.actions.getStudyRoomClock(f.roomId)).toEqual(now);
  });
  it('correlaciona reintentos, la sala existente de Ayuda y la publicación ya guardada', async () => {
    const f = actionFixture();
    expect(await f.actions.createStudyRoom({ requestId: 'another-attempt', title: 'Sala privada', subjectId: '10', topic: 'Decisiones', objective: 'Comparar', startsAt: now, endsAt: new Date(now.getTime() + 3_600_000), visibility: 'private', helpContactId: '7' })).toBe(f.roomId);
    expect(await f.actions.sendStudyRoomEntry(f.roomId, 'question', 'Duda reservada', 'question-attempt')).toBe('2');
    expect(await f.actions.publishStudyRoomSummary(f.roomId, 3)).toBe('8');
    expect(await f.actions.publishStudyRoomSummary(f.roomId, 0)).toBe('8');
    f.summaries[0]!.publishedNoteId = undefined;
    await expect(f.actions.publishStudyRoomSummary(f.roomId, 3)).rejects.toThrow('Actualiza');
  });
});
