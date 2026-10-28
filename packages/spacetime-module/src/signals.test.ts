import { Identity, Timestamp } from 'spacetimedb';
import { describe, expect, it, vi } from 'vitest';
import { SIGNAL_LIMITS, starterSignalDefinitions, type SignalCommand, type SignalsSnapshot } from '../../core/src/signals';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) };
});
import { signal_action, signal_snapshot, expire_signals, type Ctx } from './index';
import { readSignalState } from './signalsHandlers';

type Row = Record<string, unknown>;
const owner = Identity.fromString('a'.repeat(64));
const peer = Identity.fromString('b'.repeat(64));
const admin = Identity.fromString('c'.repeat(64));
const stranger = Identity.fromString('d'.repeat(64));
const internal = Identity.fromString('e'.repeat(64));
const keyOf = (value: unknown) => value instanceof Identity ? value.toHexString() : String(value);
function tableStore(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map(row => [keyOf(row[primary]), row]));
  let next = 1n;
  return new Proxy({ rows, iter: () => rows.values(), insert(input: Row) {
    const row: Row = { ...input, ...(input.id === 0n ? { id: next++ } : {}) };
    if (rows.has(keyOf(row[primary]))) throw new Error('Duplicate primary key');
    rows.set(keyOf(row[primary]), row); return row;
  } }, { get(target, field: string) {
    if (field in target) return target[field as keyof typeof target];
    return {
      find: (value: unknown) => rows.get(keyOf(value)),
      update: (row: Row) => { rows.set(keyOf(row[primary]), { ...row }); return row; },
      delete: (value: unknown) => rows.delete(keyOf(value)),
      filter: (value: unknown) => [...rows.values()].filter(row => keyOf(row[field]) === keyOf(value)),
    };
  } });
}

function setup() {
  const initial: Record<string, Row[]> = {
    appConfig: [{ id: 0, owner: admin }],
    authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }],
    member: [owner, peer, admin].map(identity => ({ identity, status: 'active', isCreator: identity === admin })),
    subject: [{ id: 1n }],
    note: [{ id: 10n, author: owner, visibility: 'personal', subjectId: 1n, version: 2, title: 'Fuente privada' }],
    work: [{ id: 20n, assignmentId: 30n, version: 3, createdBy: owner }],
    assignment: [{ id: 30n, subjectId: 1n }],
  };
  const primary: Record<string, string> = { member: 'identity', authIdentityLink: 'sessionIdentity', signalRecord: 'key', contentStatus: 'key', contentRetention: 'key' };
  const stores = new Map<string, ReturnType<typeof tableStore>>();
  const db = new Proxy({}, { get: (_, name: string) => {
    if (!stores.has(name)) stores.set(name, tableStore(primary[name] ?? 'id', initial[name]));
    return stores.get(name);
  } });
  const mutable = { db, sender: owner, identity: internal, timestamp: new Timestamp(1_800_000_000_000_000n), env: {},
    senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'student@example.test', email_verified: true } } } };
  const ctx = mutable as unknown as Ctx & Parameters<typeof signal_snapshot>[0];
  const as = (person: Identity) => { mutable.sender = person; };
  const view = (): SignalsSnapshot => JSON.parse(signal_snapshot(ctx)[0]!.json);
  let request = 0;
  const action = (command: Omit<SignalCommand, 'requestId'> | Record<string, unknown>, requestId = `request-${++request}`) => {
    signal_action(ctx, { payload: JSON.stringify({ ...command, requestId }) });
    return view().receipts.find(receipt => receipt.requestId === requestId)?.id;
  };
  const dictionary = () => action({ action: 'createDictionary', subjectId: '1', topic: 'Redes', title: 'Convención de redes', definitions: starterSignalDefinitions() })!;
  const publish = (id: string) => action({ action: 'publishDictionary', dictionaryId: id, expectedVersion: view().dictionaries.find(row => row.id === id)!.version });
  const rows = (name: string) => [...(db as Record<string, ReturnType<typeof tableStore>>)[name]!.rows.values()];
  return { ctx, mutable, as, action, view, dictionary, publish, rows };
}

describe('Lenguaje de señales: persistencia y permisos', () => {
  it('rechaza sesiones ausentes, extraños, payloads inválidos y materias inexistentes sin guardar', () => {
    const s = setup();
    s.as(stranger); expect(signal_snapshot(s.ctx)).toEqual([]); expect(() => s.dictionary()).toThrow(/activo/);
    s.as(owner);
    expect(() => signal_action(s.ctx, { payload: '[]' })).toThrow();
    expect(() => signal_action(s.ctx, { payload: '{' })).toThrow(/válida/);
    expect(() => s.action({ action: 'createDictionary', subjectId: '9', topic: 'x', title: 'x', definitions: starterSignalDefinitions() })).toThrow(/materia/);
    expect(s.rows('signalRecord')).toHaveLength(0);
    s.mutable.senderAuth.jwt.audience = ['untrusted'];
    expect(() => s.dictionary()).toThrow(/aplicación/);
  });

  it('mantiene borradores privados, versiones compartidas inmutables y reintentos sin duplicados', () => {
    const s = setup();
    const input = { action: 'createDictionary', subjectId: '1', topic: 'Redes', title: 'Redes', definitions: starterSignalDefinitions() };
    const id = s.action(input, 'same')!; s.action(input, 'same');
    expect(s.view().dictionaries).toHaveLength(1);
    expect(() => s.action({ ...input, title: 'Otro' }, 'same')).toThrow();
    s.as(peer); expect(s.view().dictionaries).toHaveLength(0);
    s.as(admin); expect(s.view().dictionaries).toHaveLength(0);
    s.as(owner); s.publish(id);
    const oldVersion = JSON.stringify(s.view().versions[0]);
    s.action({ action: 'saveDictionary', dictionaryId: id, expectedVersion: s.view().dictionaries[0]!.version, title: 'Redes nuevas', topic: 'Redes', definitions: starterSignalDefinitions() });
    expect(JSON.stringify(s.view().versions[0])).toBe(oldVersion);
    expect(() => s.action({ action: 'publishDictionary', dictionaryId: id, expectedVersion: 1 })).toThrow();
    s.as(peer);
    expect(s.view().versions).toHaveLength(1);
    expect(s.view().dictionaries[0]?.draft ?? []).toHaveLength(0);
    expect(() => s.action({ action: 'archiveDictionary', dictionaryId: id, expectedVersion: s.view().dictionaries[0]!.version, archived: true })).toThrow();
  });

  it('mapea la identidad de sesión a la membresía y revoca inmediatamente una baja', () => {
    const s = setup(); const id = s.dictionary(); s.publish(id);
    s.ctx.db.authIdentityLink.insert({ sessionIdentity: stranger, memberIdentity: owner, createdAt: s.ctx.timestamp });
    s.as(stranger); expect(s.view().dictionaries[0]?.authorId).toBe(owner.toHexString());
    s.action({ action: 'saveMessage', dictionaryId: id, dictionaryVersion: 1, medium: 'pen', reference: '12', answer: 'A', repeat: false });
    expect(s.view().messages).toHaveLength(1);
    s.ctx.db.member.identity.update({ ...s.ctx.db.member.identity.find(owner)!, status: 'removed' });
    expect(signal_snapshot(s.ctx)).toEqual([]);
    expect(() => s.action({ action: 'saveMessage', dictionaryId: id, dictionaryVersion: 1, medium: 'pen', reference: '12', answer: 'A', repeat: false })).toThrow(/activo/);
  });

  it('resuelve prácticas en el servidor, oculta la solución pendiente y no comparte el historial', () => {
    const s = setup(); const id = s.dictionary(); s.publish(id);
    const attemptId = s.action({ action: 'startAttempt', dictionaryId: id, dictionaryVersion: 1, medium: 'foot', mode: 'recognize' })!;
    expect(s.view().attempts[0]?.expected).toBeUndefined();
    const expected = readSignalState(s.ctx.db).attempts[0]!.expected!;
    const answer = { action: 'answerAttempt', attemptId, expectedVersion: 1, answer: expected };
    s.action(answer, 'answer'); s.action(answer, 'answer');
    expect(s.view().attempts[0]?.correct).toBe(true);
    s.as(peer); expect(s.view().attempts).toHaveLength(0); expect(s.view().receipts).toHaveLength(0);
    s.as(admin); expect(s.view().attempts).toHaveLength(0);
  });

  it('exige aceptación de pareja, oculta objetivo al receptor y serializa turnos', () => {
    const s = setup(); const id = s.dictionary(); s.publish(id);
    const sessionId = s.action({ action: 'invitePartner', dictionaryId: id, dictionaryVersion: 1, medium: 'knuckle', guestId: peer.toHexString() })!;
    s.as(admin); expect(s.view().sessions).toHaveLength(0);
    s.as(peer); expect(s.view().sessions[0]?.status).toBe('pending'); expect(s.view().turns).toHaveLength(0);
    expect(() => s.action({ action: 'sendTurn', sessionId, expectedVersion: 1, reference: '2', answer: 'B', repeat: false })).toThrow();
    s.action({ action: 'respondInvitation', sessionId, expectedVersion: 1, accept: true });
    s.as(owner); s.action({ action: 'startSession', sessionId, expectedVersion: s.view().sessions[0]!.version });
    s.action({ action: 'sendTurn', sessionId, expectedVersion: s.view().sessions[0]!.version, reference: '2', answer: 'B', repeat: false });
    s.as(peer); const turn = s.view().turns[0]!; expect(turn.expected).toBeUndefined();
    const expected = readSignalState(s.ctx.db).turns[0]!.expected!;
    s.action({ action: 'answerTurn', turnId: turn.id, expectedVersion: turn.version, answer: expected }, 'turn-response');
    s.action({ action: 'answerTurn', turnId: turn.id, expectedVersion: turn.version, answer: expected }, 'turn-response');
    expect(s.view().turns[0]?.correct).toBe(true);
    expect(() => s.action({ action: 'answerTurn', turnId: turn.id, expectedVersion: turn.version, answer: expected })).toThrow();
    s.as(owner); expect(() => s.action({ action: 'sendTurn', sessionId, expectedVersion: s.view().sessions[0]!.version, reference: '3', answer: 'C', repeat: false })).toThrow();
  });

  it('vuelve a autorizar fuentes y no concede una nota personal al administrador o compañero', () => {
    const s = setup();
    const card = { action: 'saveCard', expectedVersion: 0, subjectId: '1', topic: 'TCP', reference: 'Pregunta 1', body: 'Mi resumen', conditions: 'Conexión fiable', support: 'Borrador', source: { kind: 'note', id: '10', version: 2, location: 'Sección privada' } };
    const id = s.action(card)!; expect(s.view().cards[0]?.sourceAvailable).toBe(true);
    s.as(peer); expect(s.view().cards).toHaveLength(0); expect(() => s.action(card)).toThrow();
    s.as(admin); expect(() => s.action(card)).toThrow();
    s.as(owner);
    s.ctx.db.contentStatus.insert({ key: 'note:10', kind: 'note', targetId: 10n, withdrawnAt: s.ctx.timestamp, withdrawnBy: owner, reason: 'Retirada de prueba' });
    const shown = s.view().cards.find(row => row.id === id)!;
    expect(shown.body).toBe('Mi resumen'); expect(shown.sourceAvailable).toBe(false);
    expect(shown.source).toBeUndefined();
    expect(() => s.action({ ...card, cardId: id, expectedVersion: 1 })).toThrow();
  });

  it('programa la purga privada a los 30 días y rechaza invocaciones externas del programador', () => {
    const s = setup(); const id = s.dictionary(); s.publish(id);
    const messageId = s.action({ action: 'saveMessage', dictionaryId: id, dictionaryVersion: 1, medium: 'pen', reference: '1', answer: 'A', repeat: false })!;
    s.action({ action: 'trash', kind: 'message', id: messageId, expectedVersion: 1 });
    expect(s.view().messages).toHaveLength(0); expect(s.view().trash).toHaveLength(1);
    const expiry = s.rows('signalExpiry')[0]!;
    expect(expiry.at).toBe(BigInt(Number(s.ctx.timestamp.microsSinceUnixEpoch / 1000n) + SIGNAL_LIMITS.retentionMs));
    expect(() => expire_signals(s.ctx, { event: expiry as never })).toThrow(/programador/);
    s.mutable.sender = internal;
    s.mutable.timestamp = new Timestamp(BigInt(expiry.at as bigint) * 1000n);
    expire_signals(s.ctx, { event: expiry as never });
    expect(readSignalState(s.ctx.db).messages).toHaveLength(0);
    s.as(owner); expect(s.view().trash).toHaveLength(0);
  });
});
