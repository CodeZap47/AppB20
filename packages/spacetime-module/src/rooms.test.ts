import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});

import {
  control_study_room_timer, create_study_room, invite_study_room_member, join_study_room, leave_study_room,
  my_help_room_links, publish_study_room_summary, remove_member, remove_study_room_member,
  respond_study_room_invitation, room_entries, room_materials, room_members, room_summaries, room_timers,
  save_study_room_summary, send_study_room_entry, set_study_room_material, set_study_room_status,
  study_room_clock, study_rooms, update_study_room, type Ctx,
} from './index';

type Row = Record<string, unknown>;
const person = (digit: string) => Identity.fromString(digit.repeat(64));
const owner = person('a'), peer = person('b'), third = person('c'), admin = person('d'), outsider = person('e');
const keyOf = (value: unknown) => typeof value === 'object' && value !== null && 'toHexString' in value
  ? (value as Identity).toHexString() : String(value);
function tableStore(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map((r) => [keyOf(r[primary]), r]));
  let next = initial.reduce((max, r) => typeof r.id === 'bigint' && r.id >= max ? r.id + 1n : max, 1n);
  return new Proxy({ rows, iter: () => rows.values(), insert: (input: Row) => {
    const row: Row = { ...input, ...(input.id === 0n ? { id: next++ } : {}) };
    rows.set(keyOf(row[primary]), row); return row;
  } }, { get(target, field: string) {
    if (field in target) return target[field as keyof typeof target];
    return { find: (value: unknown) => rows.get(keyOf(value)), update: (row: Row) => { rows.set(keyOf(row[primary]), { ...row }); return row; },
      delete: (value: unknown) => rows.delete(keyOf(value)), filter: (value: unknown) => [...rows.values()].filter((r) => keyOf(r[field]) === keyOf(value)) };
  } });
}
function setup() {
  const at = new Timestamp(1_790_000_000_000_000n);
  const initial: Record<string, Row[]> = {
    appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1', audiences: ['test'] }],
    member: [owner, peer, third, admin].map((identity) => ({ identity, status: 'active', isCreator: identity.isEqual(admin) })),
    subject: [{ id: 1n, name: 'Lógica' }, { id: 2n, name: 'Álgebra' }],
    note: [
      { id: 11n, subjectId: 1n, visibility: 'group', author: owner, version: 3, body: 'Material compartido' },
      { id: 12n, subjectId: 1n, visibility: 'personal', author: owner, version: 1, body: 'Fuente secreta' },
      { id: 13n, subjectId: 2n, visibility: 'group', author: peer, version: 1 },
    ],
    studyGuide: [{ id: 21n, subjectId: 1n, version: 2 }, { id: 22n, subjectId: 2n, version: 1 }],
    helpContactRequest: [{ id: 31n, sender: owner, recipient: peer, status: 'accepted', subjectId: 1n }],
  };
  const keys: Record<string, string> = { member: 'identity', roomMember: 'key', roomTimer: 'roomId', roomSummary: 'roomId', contentStatus: 'key' };
  const tables = new Map<string, ReturnType<typeof tableStore>>();
  const db = new Proxy({}, { get: (_target, name: string) => {
    if (!tables.has(name)) tables.set(name, tableStore(keys[name] ?? 'id', initial[name]));
    return tables.get(name);
  } });
  const state = { db, sender: owner, timestamp: at, env: {}, senderAuth: { jwt: {
    issuer: 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'member@example.test', email_verified: true },
  } } };
  const ctx = state as unknown as Ctx & Parameters<typeof study_rooms>[0];
  const proc = { withTx: (fn: (tx: typeof ctx) => unknown) => fn(ctx) } as unknown as Parameters<typeof study_room_clock>[0];
  const rows = (name: string) => [...(db as Record<string, ReturnType<typeof tableStore>>)[name].rows.values()];
  const room = (roomId: bigint) => ctx.db.studyRoom.id.find(roomId)!;
  const timer = (roomId: bigint) => ctx.db.roomTimer.roomId.find(roomId)!;
  const summary = (roomId: bigint) => ctx.db.roomSummary.roomId.find(roomId)!;
  let requestNumber = 0;
  const create = (changes: Partial<Parameters<typeof create_study_room>[1]> = {}) => {
    create_study_room(ctx, { requestId: `room-request-${++requestNumber}`, title: 'Repasamos recursividad', subjectId: 1n,
      topic: 'Recursividad', objective: 'Entender el caso base', startsAt: at,
      endsAt: new Timestamp(at.microsSinceUnixEpoch + 3_600_000_000n), visibility: 'group', ...changes });
    return rows('studyRoom').at(-1)!.id as bigint;
  };
  const as = (who: Identity) => { state.sender = who; };
  const tick = (seconds: number) => { state.timestamp = new Timestamp(state.timestamp.microsSinceUnixEpoch + BigInt(seconds) * 1_000_000n); };
  const status = (roomId: bigint, status: string) => set_study_room_status(ctx, { roomId, status, expectedVersion: room(roomId).version });
  const control = (roomId: bigint, action: string, changes: Partial<Parameters<typeof control_study_room_timer>[1]> = {}) =>
    control_study_room_timer(ctx, { roomId, action, expectedVersion: timer(roomId).version, ...changes });
  const save = (roomId: bigint, text = 'Resumen para publicar') => save_study_room_summary(ctx, { roomId, text, expectedVersion: summary(roomId).version });
  const allContent = () => [room_members(ctx), room_materials(ctx), room_entries(ctx), room_timers(ctx), room_summaries(ctx)];
  return { ctx, state, proc, rows, room, timer, summary, create, as, tick, status, control, save, allContent };
}

describe('Salas: ficha, participación y permisos del servidor', () => {
  it('crea una sala programada sin publicar actividad; la solicitud es idempotente por organizador', () => {
    const s = setup();
    const roomId = s.create({ requestId: 'create-once', sourceKind: 'note', sourceId: 11n });
    s.create({ requestId: 'create-once', title: 'No debe sobreescribir' });
    expect(s.rows('studyRoom')).toHaveLength(1);
    expect(s.room(roomId)).toMatchObject({ title: 'Repasamos recursividad', status: 'scheduled', version: 1, participantCount: 1 });
    expect(room_members(s.ctx)).toHaveLength(1);
    expect(room_materials(s.ctx)[0]).toMatchObject({ kind: 'note', sourceId: 11n, sourceVersion: 3 });
    expect(s.timer(roomId)).toMatchObject({ phase: 'study', state: 'idle', studyMinutes: 25, breakMinutes: 5, remainingMs: 1_500_000n });
    s.tick(7200);
    expect(study_rooms(s.ctx)[0].status).toBe('scheduled');
    expect(s.rows('changeLog')).toEqual([]);
    s.as(peer); s.create({ requestId: 'create-once' });
    expect(s.rows('studyRoom')).toHaveLength(2);
  });

  it('una sala abierta solo muestra su ficha a terceros y administradores', () => {
    const s = setup(); const roomId = s.create({ sourceKind: 'guide', sourceId: 21n });
    send_study_room_entry(s.ctx, { roomId, kind: 'question', text: 'Mi duda privada', requestId: 'private-q' });
    s.save(roomId, 'Resumen no publicado');
    for (const who of [peer, third, admin]) {
      s.as(who); expect(study_rooms(s.ctx)).toHaveLength(1);
      expect(study_rooms(s.ctx)[0]).not.toHaveProperty('sourceId');
      expect(study_rooms(s.ctx)[0]).not.toHaveProperty('contactId');
      expect(s.allContent()).toEqual([[], [], [], [], []]);
      expect(() => study_room_clock(s.proc, { roomId })).toThrow(/Inscríbete/);
      expect(() => send_study_room_entry(s.ctx, { roomId, kind: 'message', text: 'Intruso', requestId: 'attempt' })).toThrow();
    }
    s.as(outsider); expect(study_rooms(s.ctx)).toEqual([]); expect(s.allContent()).toEqual([[], [], [], [], []]);
  });

  it('las invitaciones privadas solo dan acceso a ficha y no consumen cupo', () => {
    const s = setup(); const roomId = s.create({ visibility: 'private', capacity: 2, sourceKind: 'note', sourceId: 11n });
    invite_study_room_member(s.ctx, { roomId, memberId: peer });
    invite_study_room_member(s.ctx, { roomId, memberId: third });
    expect(study_rooms(s.ctx)[0].participantCount).toBe(1);
    s.as(peer); expect(study_rooms(s.ctx)).toHaveLength(1);
    expect(room_members(s.ctx)).toHaveLength(1); expect(room_members(s.ctx)[0].memberId.isEqual(peer)).toBe(true);
    expect(room_materials(s.ctx)).toEqual([]); expect(room_summaries(s.ctx)).toEqual([]);
    expect(() => join_study_room(s.ctx, { roomId })).toThrow(/invitación/);
    respond_study_room_invitation(s.ctx, { roomId, accepted: true });
    expect(room_materials(s.ctx)).toHaveLength(1); expect(study_rooms(s.ctx)[0].participantCount).toBe(2);
    s.as(third); expect(() => respond_study_room_invitation(s.ctx, { roomId, accepted: true })).toThrow(/cupo/);
    expect(room_members(s.ctx)[0].status).toBe('invited');
    respond_study_room_invitation(s.ctx, { roomId, accepted: false });
    expect(study_rooms(s.ctx)).toEqual([]);
    s.as(admin); expect(study_rooms(s.ctx)).toEqual([]); expect(s.allContent()).toEqual([[], [], [], [], []]);
  });

  it('inscripción atómica respeta el último lugar y las invitaciones pueden esperar a un cupo libre', () => {
    const s = setup(); const roomId = s.create({ capacity: 2 });
    s.as(peer); join_study_room(s.ctx, { roomId }); join_study_room(s.ctx, { roomId });
    s.as(third); expect(() => join_study_room(s.ctx, { roomId })).toThrow(/cupo/);
    s.as(peer); leave_study_room(s.ctx, { roomId });
    expect(room_entries(s.ctx)).toEqual([]); expect(room_timers(s.ctx)).toEqual([]);
    s.as(third); join_study_room(s.ctx, { roomId });
    expect(study_rooms(s.ctx)[0].participantCount).toBe(2);
  });

  it('retirar expulsa de todas las vistas y bloquea reingreso hasta volver a invitar', () => {
    const s = setup(); const roomId = s.create({ sourceKind: 'guide', sourceId: 21n });
    s.as(peer); join_study_room(s.ctx, { roomId }); s.save(roomId, 'Contenido compartido privado');
    send_study_room_entry(s.ctx, { roomId, kind: 'conclusion', text: 'Mi conclusión', requestId: 'c1' });
    s.as(owner); remove_study_room_member(s.ctx, { roomId, memberId: peer });
    s.as(peer); expect(study_rooms(s.ctx)).toEqual([]); expect(s.allContent()).toEqual([[], [], [], [], []]);
    expect(() => join_study_room(s.ctx, { roomId })).toThrow(/volver a invitarte/);
    s.as(owner); invite_study_room_member(s.ctx, { roomId, memberId: peer });
    s.as(peer); expect(room_entries(s.ctx)).toEqual([]);
    respond_study_room_invitation(s.ctx, { roomId, accepted: true });
    expect(room_entries(s.ctx)).toHaveLength(1); expect(room_summaries(s.ctx)[0].text).toBe('Contenido compartido privado');
  });

  it('todos los inscritos editan la ficha con versión, pero la materia y visibilidad no son editables', () => {
    const s = setup(); const roomId = s.create({ capacity: 3 });
    s.as(peer); join_study_room(s.ctx, { roomId });
    const input = { roomId, title: 'Título compartido', topic: 'Otro tema', objective: 'Aclarar dudas',
      startsAt: s.room(roomId).startsAt, endsAt: s.room(roomId).endsAt, capacity: 2, expectedVersion: s.room(roomId).version };
    update_study_room(s.ctx, input);
    expect(s.room(roomId)).toMatchObject({ title: 'Título compartido', capacity: 2, subjectId: 1n, visibility: 'group', version: input.expectedVersion + 1 });
    expect(() => update_study_room(s.ctx, input)).toThrow(/cambió/);
    expect(() => update_study_room(s.ctx, { ...input, expectedVersion: s.room(roomId).version, capacity: 1 })).toThrow(/cupo/);
    expect(() => invite_study_room_member(s.ctx, { roomId, memberId: third })).toThrow(/organizador/);
    expect(() => remove_study_room_member(s.ctx, { roomId, memberId: owner })).toThrow(/organizador/);
    expect(() => s.status(roomId, 'active')).toThrow(/organizador/);
    s.as(owner); expect(() => leave_study_room(s.ctx, { roomId })).toThrow(/organizador/);
    expect(() => remove_study_room_member(s.ctx, { roomId, memberId: owner })).toThrow(/sí mismo/);
  });

  it.each([
    { title: '' }, { topic: '' }, { objective: '' }, { visibility: 'public' }, { capacity: 0 }, { capacity: 10001 },
    { subjectId: 999n }, { sourceKind: 'note' }, { sourceId: 11n }, { sourceKind: 'private', sourceId: 11n },
  ])('rechaza creación inválida sin añadir filas %#', (changes) => {
    const s = setup(); expect(() => s.create(changes)).toThrow(); expect(s.rows('studyRoom')).toEqual([]);
  });
});

describe('Salas: fuentes compartidas y contacto de Ayuda', () => {
  it('rechaza notas personales incluso del autor, fuentes retiradas y materias distintas', () => {
    const s = setup();
    for (const source of [{ sourceKind: 'note', sourceId: 12n }, { sourceKind: 'note', sourceId: 13n },
      { sourceKind: 'guide', sourceId: 22n }, { sourceKind: 'note', sourceId: 999n }]) {
      expect(() => s.create(source)).toThrow(/material/);
    }
    s.ctx.db.contentStatus.insert({ key: 'note:11', kind: 'note', targetId: 11n, withdrawnAt: s.state.timestamp, withdrawnBy: owner, reason: '' });
    expect(() => s.create({ sourceKind: 'note', sourceId: 11n })).toThrow(/material/);
    const roomId = s.create();
    expect(() => set_study_room_material(s.ctx, { roomId, kind: 'note', sourceId: 12n, enabled: true })).toThrow();
    expect(room_materials(s.ctx)).toEqual([]);
  });

  it('conserva la versión enlazada y deja de entregar referencias de fuentes retiradas o personales', () => {
    const s = setup(); const roomId = s.create({ sourceKind: 'note', sourceId: 11n });
    set_study_room_material(s.ctx, { roomId, kind: 'guide', sourceId: 21n, enabled: true });
    set_study_room_material(s.ctx, { roomId, kind: 'guide', sourceId: 21n, enabled: true });
    expect(room_materials(s.ctx)).toHaveLength(2);
    s.ctx.db.note.id.update({ ...s.ctx.db.note.id.find(11n)!, version: 4 });
    expect(room_materials(s.ctx).find((r) => r.kind === 'note')?.sourceVersion).toBe(3);
    s.ctx.db.note.id.update({ ...s.ctx.db.note.id.find(11n)!, visibility: 'personal' });
    expect(room_materials(s.ctx).map((r) => r.kind)).toEqual(['guide']);
    s.ctx.db.contentStatus.insert({ key: 'guide:21', kind: 'guide', targetId: 21n, withdrawnAt: s.state.timestamp, withdrawnBy: owner, reason: '' });
    expect(room_materials(s.ctx)).toEqual([]);
    set_study_room_material(s.ctx, { roomId, kind: 'note', sourceId: 11n, enabled: false });
    expect(s.rows('roomMaterial')).toHaveLength(1);
  });

  it('Ayuda permite a ambas personas crear, invita sin inscribir y guarda el origen solo para ellas', () => {
    const s = setup(); s.as(peer);
    const roomId = s.create({ visibility: 'private', helpContactId: 31n });
    expect(my_help_room_links(s.ctx)[0]).toMatchObject({ contactId: 31n, roomId });
    expect(study_rooms(s.ctx)[0]).not.toHaveProperty('contactId');
    s.as(owner); expect(room_members(s.ctx)[0].status).toBe('invited');
    expect(my_help_room_links(s.ctx)).toHaveLength(1); expect(room_entries(s.ctx)).toEqual([]);
    respond_study_room_invitation(s.ctx, { roomId, accepted: true });
    s.as(peer); invite_study_room_member(s.ctx, { roomId, memberId: third });
    s.as(third); respond_study_room_invitation(s.ctx, { roomId, accepted: true });
    expect(room_timers(s.ctx)).toHaveLength(1); expect(my_help_room_links(s.ctx)).toEqual([]);
    s.as(admin); expect(my_help_room_links(s.ctx)).toEqual([]);
  });

  it('elegir una sala abierta desde Ayuda no publica el contacto privado', () => {
    const s = setup(); const roomId = s.create({ visibility: 'group', helpContactId: 31n });
    s.as(third);
    expect(study_rooms(s.ctx).map((r) => r.id)).toContain(roomId);
    expect(my_help_room_links(s.ctx)).toEqual([]); expect(room_members(s.ctx)).toEqual([]);
    join_study_room(s.ctx, { roomId });
    expect(my_help_room_links(s.ctx)).toEqual([]);
    expect(s.allContent()[0]).toHaveLength(3);
  });

  it('impide dos salas activas por contacto; finalizar permite otra y cerrar el contacto no cancela la sala', () => {
    const s = setup(); const roomId = s.create({ visibility: 'private', helpContactId: 31n });
    s.as(peer); s.create({ helpContactId: 31n, visibility: 'private' }); expect(s.rows('studyRoom')).toHaveLength(1);
    s.as(owner); s.status(roomId, 'active'); s.status(roomId, 'completed');
    s.as(peer); const nextId = s.create({ helpContactId: 31n, visibility: 'private' });
    expect(nextId).not.toBe(roomId);
    const contact = s.ctx.db.helpContactRequest.id.find(31n)!;
    s.ctx.db.helpContactRequest.id.update({ ...contact, status: 'closed' });
    expect(s.room(nextId).status).toBe('scheduled'); expect(my_help_room_links(s.ctx)).toHaveLength(2);
    expect(() => s.create({ helpContactId: 31n })).toThrow(/contacto aceptado/);
  });

  it('rechaza contactos ajenos, pendientes, de otra materia o con integrantes dados de baja', () => {
    const s = setup(); s.as(third); expect(() => s.create({ helpContactId: 31n })).toThrow(/contacto/);
    s.as(owner);
    const contact = s.ctx.db.helpContactRequest.id.find(31n)!;
    s.ctx.db.helpContactRequest.id.update({ ...contact, status: 'pending' });
    expect(() => s.create({ helpContactId: 31n })).toThrow();
    s.ctx.db.helpContactRequest.id.update(contact);
    expect(() => s.create({ helpContactId: 31n, subjectId: 2n })).toThrow();
    s.ctx.db.member.identity.update({ ...s.ctx.db.member.identity.find(peer)!, status: 'removed' });
    expect(() => s.create({ helpContactId: 31n })).toThrow();
    expect(s.rows('studyRoom')).toEqual([]);
  });

  it('un contacto retirado no recupera la sala privada solicitando crearla otra vez', () => {
    const s = setup(); const roomId = s.create({ visibility: 'private', helpContactId: 31n });
    s.as(peer); respond_study_room_invitation(s.ctx, { roomId, accepted: true });
    leave_study_room(s.ctx, { roomId });
    expect(my_help_room_links(s.ctx)).toEqual([]);
    expect(() => s.create({ visibility: 'private', helpContactId: 31n })).toThrow(/pide una nueva invitación/);
    expect(s.rows('studyRoom')).toHaveLength(1);
    s.as(owner); invite_study_room_member(s.ctx, { roomId, memberId: peer });
    remove_study_room_member(s.ctx, { roomId, memberId: peer });
    s.as(peer);
    expect(() => s.create({ visibility: 'group', helpContactId: 31n })).toThrow(/pide una nueva invitación/);
    expect(study_rooms(s.ctx)).toEqual([]);
  });
});

describe('Salas: temporizador compartido, resumen y publicación', () => {
  it('el reloj es del servidor y requiere inscripción; el temporizador comienza explícitamente en sesión activa', () => {
    const s = setup(); const roomId = s.create();
    expect(study_room_clock(s.proc, { roomId })).toEqual(s.state.timestamp);
    expect(() => s.control(roomId, 'start')).toThrow(/comenzar la sesión/);
    s.tick(7200); expect(s.room(roomId).status).toBe('scheduled');
    s.status(roomId, 'active'); s.control(roomId, 'start');
    expect(s.timer(roomId)).toMatchObject({ state: 'running', startedAt: s.state.timestamp, remainingMs: 1_500_000n });
    s.as(peer); expect(() => study_room_clock(s.proc, { roomId })).toThrow();
    join_study_room(s.ctx, { roomId }); expect(study_room_clock(s.proc, { roomId })).toEqual(s.state.timestamp);
  });

  it('descuenta con timestamps al pausar y reconectar, sin escritura por segundo ni avanzar fases automáticamente', () => {
    const s = setup(); const roomId = s.create(); s.status(roomId, 'active');
    s.control(roomId, 'start', { studyMinutes: 1, breakMinutes: 2 });
    const version = s.timer(roomId).version;
    s.tick(20); expect(s.timer(roomId).version).toBe(version); expect(s.timer(roomId).remainingMs).toBe(60_000n);
    s.as(peer); join_study_room(s.ctx, { roomId });
    s.control(roomId, 'pause'); expect(s.timer(roomId)).toMatchObject({ state: 'paused', remainingMs: 40_000n, startedAt: undefined });
    s.tick(500); s.control(roomId, 'resume');
    expect(s.timer(roomId)).toMatchObject({ state: 'running', remainingMs: 40_000n, startedAt: s.state.timestamp });
    s.tick(40); expect(s.timer(roomId).phase).toBe('study');
    expect(s.timer(roomId).version).toBe(version + 2);
    s.control(roomId, 'next'); expect(s.timer(roomId)).toMatchObject({ phase: 'break', state: 'running', remainingMs: 120_000n });
    expect(() => s.control(roomId, 'next')).toThrow(/termine/);
    s.control(roomId, 'reset'); expect(s.timer(roomId)).toMatchObject({ phase: 'break', state: 'idle', remainingMs: 120_000n });
    expect(s.rows('changeLog')).toEqual([]);
  });

  it('los controles concurrentes y las duraciones inválidas se rechazan sin pisar el estado', () => {
    const s = setup(); const roomId = s.create(); s.status(roomId, 'active');
    const expectedVersion = s.timer(roomId).version;
    s.control(roomId, 'start');
    expect(() => s.control(roomId, 'pause', { expectedVersion })).toThrow(/cambió/);
    expect(s.timer(roomId).state).toBe('running');
    expect(() => s.control(roomId, 'start')).toThrow(/continuar/);
    expect(() => s.control(roomId, 'pause', { studyMinutes: 30 })).toThrow(/Reinicia/);
    expect(() => s.control(roomId, 'reset', { breakMinutes: 0 })).toThrow(/dur[ae]r/);
    expect(() => s.control(roomId, 'reset', { studyMinutes: 181 })).toThrow();
    s.tick(2000); s.control(roomId, 'pause');
    expect(s.timer(roomId).remainingMs).toBe(0n); expect(() => s.control(roomId, 'resume')).toThrow(/bloque pausado/);
    s.control(roomId, 'next'); expect(s.timer(roomId).phase).toBe('break');
  });

  it('conserva chat y aportes idempotentes dentro de la sala y los congela al finalizar', () => {
    const s = setup(); const roomId = s.create();
    for (const kind of ['message', 'question', 'conclusion']) {
      send_study_room_entry(s.ctx, { roomId, kind, text: `Aporte ${kind}`, requestId: `entry-${kind}` });
      send_study_room_entry(s.ctx, { roomId, kind, text: `Aporte ${kind}`, requestId: `entry-${kind}` });
    }
    expect(room_entries(s.ctx)).toHaveLength(3);
    expect(() => send_study_room_entry(s.ctx, { roomId, kind: 'message', text: 'Cambio de solicitud', requestId: 'entry-message' })).toThrow(/otro mensaje/);
    s.as(peer); join_study_room(s.ctx, { roomId });
    send_study_room_entry(s.ctx, { roomId, kind: 'message', text: 'Otro autor', requestId: 'entry-message' });
    expect(room_entries(s.ctx)).toHaveLength(4);
    s.as(owner); s.status(roomId, 'active'); s.control(roomId, 'start'); s.tick(5); s.status(roomId, 'completed');
    expect(s.timer(roomId)).toMatchObject({ state: 'paused', remainingMs: 1_495_000n });
    expect(() => send_study_room_entry(s.ctx, { roomId, kind: 'message', text: 'No', requestId: 'after' })).toThrow(/finalizó/);
    send_study_room_entry(s.ctx, { roomId, kind: 'message', text: 'Aporte message', requestId: 'entry-message' });
    expect(room_entries(s.ctx)).toHaveLength(4);
    expect(() => set_study_room_material(s.ctx, { roomId, kind: 'note', sourceId: 11n, enabled: true })).toThrow();
    s.as(peer); s.save(roomId, 'Podemos terminar el resumen después de la sesión');
    expect(room_summaries(s.ctx)[0].text).toContain('después');
    expect(s.rows('changeLog')).toEqual([]);
  });

  it('el resumen exige versión compartida y no publica antes de finalizar o sin contenido', () => {
    const s = setup(); const roomId = s.create(); s.save(roomId);
    s.as(peer); join_study_room(s.ctx, { roomId });
    expect(() => save_study_room_summary(s.ctx, { roomId, text: 'Borrador local', expectedVersion: 1 })).toThrow(/cambió/);
    expect(s.summary(roomId).text).toBe('Resumen para publicar');
    expect(() => publish_study_room_summary(s.ctx, { roomId, expectedVersion: 2 })).toThrow(/organizador/);
    s.as(owner); expect(() => publish_study_room_summary(s.ctx, { roomId, expectedVersion: 2 })).toThrow(/Finaliza/);
    s.status(roomId, 'active'); s.status(roomId, 'completed'); s.save(roomId, '');
    expect(() => publish_study_room_summary(s.ctx, { roomId, expectedVersion: s.summary(roomId).version })).toThrow(/vacío/);
  });

  it('publica una sola nota del organizador con el resumen exacto y conserva la independencia de ambas ediciones', () => {
    const s = setup(); const roomId = s.create({ visibility: 'private', helpContactId: 31n });
    send_study_room_entry(s.ctx, { roomId, kind: 'question', text: 'Pregunta privada secreta', requestId: 'private' });
    s.save(roomId, 'Solo esta explicación se publica.'); s.status(roomId, 'active'); s.status(roomId, 'completed');
    const version = s.summary(roomId).version;
    publish_study_room_summary(s.ctx, { roomId, expectedVersion: version });
    const noteId = s.summary(roomId).publishedNoteId!; const note = s.ctx.db.note.id.find(noteId)!;
    expect(note).toMatchObject({ body: 'Solo esta explicación se publica.', visibility: 'group', source: 'student', version: 1 });
    expect(note.author.isEqual(owner)).toBe(true);
    expect(note).not.toHaveProperty('roomId'); expect(note).not.toHaveProperty('contactId');
    expect(note.body).not.toContain('Pregunta privada');
    s.save(roomId, 'Resumen cambiado después');
    publish_study_room_summary(s.ctx, { roomId, expectedVersion: version });
    expect(s.summary(roomId).publishedNoteId).toBe(noteId); expect(s.rows('note')).toHaveLength(4);
    expect(s.ctx.db.note.id.find(noteId)?.body).toBe('Solo esta explicación se publica.');
    s.ctx.db.note.id.update({ ...note, body: 'Editado en Notas', version: 2 });
    expect(s.summary(roomId).text).toBe('Resumen cambiado después');
    expect(s.rows('changeLog')).toHaveLength(1); expect(s.rows('changeLog')[0]).toMatchObject({ entity: 'note', action: 'create', entityId: noteId.toString() });
  });

  it('cancelar deja todo en consulta y no permite reabrir; la baja del organizador cancela y detiene conservando el historial', () => {
    const s = setup(); const roomId = s.create({ visibility: 'private' });
    invite_study_room_member(s.ctx, { roomId, memberId: peer });
    s.as(peer); respond_study_room_invitation(s.ctx, { roomId, accepted: true });
    send_study_room_entry(s.ctx, { roomId, kind: 'message', text: 'Historial privado', requestId: 'history' });
    s.as(owner); s.status(roomId, 'active'); s.control(roomId, 'start'); s.tick(10);
    s.as(admin); remove_member(s.ctx, { identity: owner });
    expect(s.room(roomId).status).toBe('cancelled'); expect(s.timer(roomId)).toMatchObject({ state: 'paused', remainingMs: 1_490_000n });
    expect(study_rooms(s.ctx)).toEqual([]); expect(s.allContent()).toEqual([[], [], [], [], []]);
    s.as(owner); expect(study_rooms(s.ctx)).toEqual([]); expect(s.allContent()).toEqual([[], [], [], [], []]);
    s.as(peer); expect(room_entries(s.ctx)).toHaveLength(1);
    expect(study_rooms(s.ctx)[0].participantCount).toBe(1);
    expect(() => s.save(roomId, 'Ya no')).toThrow(/consulta/);
    expect(() => s.control(roomId, 'reset')).toThrow();
    expect(() => s.status(roomId, 'active')).toThrow(/organizador/);
  });

  it('la baja de un participante retira su acceso sin cancelar la sala ni ocupar cupo', () => {
    const s = setup(); const roomId = s.create({ capacity: 2 });
    s.as(peer); join_study_room(s.ctx, { roomId });
    s.as(admin); remove_member(s.ctx, { identity: peer });
    expect(s.room(roomId)).toMatchObject({ status: 'scheduled', participantCount: 1 });
    s.as(peer); expect(study_rooms(s.ctx)).toEqual([]); expect(s.allContent()).toEqual([[], [], [], [], []]);
    expect(() => s.save(roomId)).toThrow(/miembro activo/);
    s.ctx.db.member.identity.update({ ...s.ctx.db.member.identity.find(peer)!, status: 'active' });
    expect(study_rooms(s.ctx)).toEqual([]);
    expect(() => join_study_room(s.ctx, { roomId })).toThrow(/volver a invitarte/);
    s.as(third); join_study_room(s.ctx, { roomId }); expect(study_rooms(s.ctx)[0].participantCount).toBe(2);
  });
});
