import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import * as agent from './agentHandlers';
import { remove_member } from './index';
import type { Ctx } from './index';

const identity = (digit: string) => Identity.fromString(digit.repeat(64));
const admin = identity('a'); const owner = identity('b'); const peer = identity('c'); const removed = identity('d');
const at = new Timestamp(1_700_000_000_000_000n);
type Row = Record<string, unknown>;
const keyOf = (value: unknown): string => value && typeof value === 'object' && 'toHexString' in value ? (value as Identity).toHexString() : String(value);

function store(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[primary]), row]));
  let next = 100n;
  return new Proxy({ rows, iter: () => rows.values(), insert: (value: Row) => {
    const row: Row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) };
    rows.set(keyOf(row[primary]), row); return row;
  } }, { get(target, name: string) {
    if (name in target) return target[name as keyof typeof target];
    return { find: (value: unknown) => [...rows.values()].find((row) => keyOf(row[name]) === keyOf(value)),
      filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[name]) === keyOf(value)),
      update: (row: Row) => { rows.set(keyOf(row[primary]), { ...row }); return row; },
      delete: (value: unknown) => rows.delete(keyOf(value)) };
  } });
}

const essay = 'Un ciclo while repite instrucciones mientras su condición sea verdadera. Si el índice nunca cambia, el ciclo no termina y el programa se queda congelado. Por eso conviene revisar el incremento antes de ejecutar el programa completo.';
const instructions = 'Explica qué ocurre cuando la condición de un ciclo nunca deja de cumplirse.';

function setup() {
  const member = [admin, owner, peer, removed].map((person) => ({ identity: person, displayName: person === peer ? 'Ana Pérez' : 'Alumno', isCreator: person === admin, status: person === removed ? 'removed' : 'active' }));
  const work = (id: bigint, description: string) => ({ id, assignmentId: 1n, title: '', description, version: 2, createdBy: owner, createdAt: at, updatedAt: at });
  const initial: Record<string, Row[]> = {
    member, appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['test'] }],
    assignment: [{ id: 1n, subjectId: 1n, kind: 'tarea', title: 'Ciclos', instructions, version: 1, createdBy: admin, createdAt: at, updatedBy: admin, updatedAt: at }],
    work: [work(10n, 'Mi trabajo propio sobre recursión y casos base que se resuelven paso a paso.'), work(11n, essay), work(12n, 'Trabajo de mi equipo con Ana.')],
    workAuthor: [{ id: 1n, workId: 10n, author: owner }, { id: 2n, workId: 11n, author: peer }, { id: 3n, workId: 12n, author: owner }, { id: 4n, workId: 12n, author: peer }],
    evidence: [{ id: 20n, activityId: 1n, author: owner, participants: [], content: 'Yo probé el ciclo y aprendí a imprimir el índice.', createdAt: at }, { id: 21n, activityId: 1n, author: peer, participants: [owner], content: essay, createdAt: at }],
    note: [{ id: 30n, subjectId: 1n, topic: '', title: 'Apunte', body: 'Nota mía.', tags: [], visibility: 'personal', source: 'student', author: owner, version: 1, createdAt: at, updatedAt: at },
      { id: 31n, subjectId: 1n, topic: '', title: 'Docente', body: 'Material del docente.', tags: [], visibility: 'group', source: 'teacher', author: owner, version: 1, createdAt: at, updatedAt: at }],
  };
  const keys: Record<string, string> = { member: 'identity', contentStatus: 'key', agentProfile: 'owner', agentStyleSource: 'key', evidenceDetail: 'evidenceId', noteDetail: 'noteId' };
  const tables = new Map<string, ReturnType<typeof store>>();
  const db = new Proxy({}, { get(_target, property: string) {
    if (!tables.has(property)) tables.set(property, store(keys[property] ?? 'id', initial[property]));
    return tables.get(property);
  } });
  const state = { db, sender: owner, identity: admin, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://auth.spacetimedb.com/oidc', audience: ['test'], fullPayload: { email: 'alumno@example.com', email_verified: true } } } };
  return { ctx: state as unknown as Ctx, as: (sender: Identity) => { state.sender = sender; },
    rows: (table: string) => [...(db as Record<string, ReturnType<typeof store>>)[table].rows.values()] };
}
const sources = (...refs: [string, string][]) => JSON.stringify(refs.map(([kind, refId]) => ({ kind, refId })));
function ready() {
  const s = setup(); agent.enableAgent(s.ctx, { premisesVersion: 1 });
  agent.startAgentSession(s.ctx, { assignmentId: 1n, requestId: 'sesion-1' });
  const sessionId = s.rows('agentSession')[0]!.id as bigint; return { ...s, sessionId };
}

describe('perfil y entrenamiento del agente', () => {
  it('exige consentimiento con la versión vigente de las premisas y membresía activa', () => {
    const { ctx, as, rows } = setup();
    expect(() => agent.trainAgent(ctx, { sources: sources(['work', '10']), expectedStyleVersion: 0 })).toThrow('Activa tu agente');
    expect(() => agent.enableAgent(ctx, { premisesVersion: 0 })).toThrow('premisas cambiaron');
    as(removed); expect(() => agent.enableAgent(ctx, { premisesVersion: 1 })).toThrow();
    as(owner); agent.enableAgent(ctx, { premisesVersion: 1 }); expect(rows('agentProfile')).toHaveLength(1);
  });
  it('entrena solo con textos propios, guarda versión de cada fuente y conserva cinco perfiles', () => {
    const { ctx, rows } = ready();
    expect(() => agent.trainAgent(ctx, { sources: sources(['work', '11']), expectedStyleVersion: 0 })).toThrow('autor');
    expect(() => agent.trainAgent(ctx, { sources: sources(['evidence', '21']), expectedStyleVersion: 0 })).toThrow('publicaste');
    expect(() => agent.trainAgent(ctx, { sources: sources(['note', '31']), expectedStyleVersion: 0 })).toThrow('escribiste');
    agent.trainAgent(ctx, { sources: sources(['work', '10'], ['work', '12'], ['evidence', '20'], ['note', '30']), expectedStyleVersion: 0 });
    expect(rows('agentStyleSource').map((r) => [r.kind, r.refVersion])).toEqual([['work', 2], ['work', 2], ['evidence', 1], ['note', 1]]);
    const features = JSON.parse(rows('agentStyleSnapshot')[0]!.features as string); expect(features.tone).toBe('Cercano, en primera persona');
    expect(() => agent.trainAgent(ctx, { sources: sources(['work', '10']), expectedStyleVersion: 0 })).toThrow('cambió');
    for (let v = 1; v <= 6; v++) agent.trainAgent(ctx, { sources: sources(['work', '10']), expectedStyleVersion: v });
    expect(rows('agentStyleSnapshot').map((r) => r.version)).toEqual([3, 4, 5, 6, 7]);
    expect(rows('agentStyleSource')).toHaveLength(1);
  });
  it('rechaza fuentes retiradas', () => {
    const { ctx } = ready(); (ctx.db as unknown as Record<string, { insert(row: Row): void }>).contentStatus.insert({ key: 'work:10', withdrawnAt: at });
    expect(() => agent.trainAgent(ctx, { sources: sources(['work', '10']), expectedStyleVersion: 0 })).toThrow('retirada');
  });
});

describe('sesiones, borrador y sugerencias', () => {
  it('crea una sesión idempotente, versiona el borrador y programa su vencimiento', () => {
    const { ctx, rows, sessionId } = ready();
    agent.startAgentSession(ctx, { assignmentId: 1n, requestId: 'sesion-1' }); expect(rows('agentSession')).toHaveLength(1);
    agent.saveAgentDraft(ctx, { sessionId, expectedDraftVersion: 0, stage: 'review', draft: 'Mi texto.' });
    expect(rows('agentSession')[0]).toMatchObject({ draft: 'Mi texto.', draftVersion: 1, stage: 'review' });
    expect(() => agent.saveAgentDraft(ctx, { sessionId, expectedDraftVersion: 0, stage: 'review', draft: 'Otro.' })).toThrow('cambió');
    expect(() => agent.saveAgentDraft(ctx, { sessionId, expectedDraftVersion: 1, stage: 'publicar', draft: 'Otro.' })).toThrow('etapa');
    expect(rows('agentExpiry')).toHaveLength(1); expect(rows('agentExpiry')[0]!.generation).toBe(rows('agentSession')[0]!.generation);
  });
  it('otra persona no ve ni modifica la sesión', () => {
    const { ctx, as, sessionId } = ready(); as(peer); agent.enableAgent(ctx, { premisesVersion: 1 });
    expect(() => agent.saveAgentDraft(ctx, { sessionId, expectedDraftVersion: 0, stage: 'review', draft: 'x' })).toThrow('no existe');
    expect(agent.agentReadable(ctx.db, peer, owner)).toBe(false); expect(agent.agentReadable(ctx.db, owner, owner)).toBe(true);
  });
  it('aplica en el servidor la sugerencia aceptada y rechaza las que ya no corresponden', () => {
    const { ctx, rows, sessionId } = ready();
    agent.saveAgentDraft(ctx, { sessionId, expectedDraftVersion: 0, stage: 'review', draft: 'El ciclo ciclo termina.' });
    expect(() => agent.proposeAgentSuggestions(ctx, { sessionId, draftVersion: 1, suggestions: JSON.stringify([{ reason: 'x', original: 'no existe', replacement: 'y' }]) })).toThrow('no corresponde');
    agent.proposeAgentSuggestions(ctx, { sessionId, draftVersion: 1, suggestions: JSON.stringify([{ reason: 'Se repite', original: 'ciclo ciclo', replacement: 'ciclo' }, { reason: 'Añade un ejemplo propio', original: '', replacement: '' }]) });
    const [repeat, example] = rows('agentSuggestion') as { id: bigint }[];
    agent.resolveAgentSuggestion(ctx, { suggestionId: repeat!.id, accept: true });
    expect(rows('agentSession')[0]).toMatchObject({ draft: 'El ciclo termina.', draftVersion: 2 });
    agent.resolveAgentSuggestion(ctx, { suggestionId: example!.id, accept: true });
    expect(rows('agentSuggestion').map((r) => r.state)).toEqual(['accepted', 'rejected']);
    expect(rows('agentSession')[0]!.draftVersion).toBe(2);
  });
});

describe('originalidad calculada en el servidor', () => {
  it('compara solo contra lo publicado por otras personas, sin la consigna, y guarda diez comparaciones', () => {
    const { ctx, rows, sessionId } = ready();
    agent.saveAgentDraft(ctx, { sessionId, expectedDraftVersion: 0, stage: 'review', draft: `${instructions} ${essay}` });
    agent.checkAgentOriginality(ctx, { sessionId, draftVersion: 1 });
    const matches = JSON.parse(rows('agentOriginalityCheck')[0]!.matches as string) as { refKey: string; score: number; level: string; authorName: string; excluded: { instructionGroups: number } }[];
    expect(matches.map((m) => m.refKey)).toEqual(['work:11']);
    expect(matches[0]).toMatchObject({ authorName: 'Ana Pérez', level: 'block' }); expect(matches[0]!.excluded.instructionGroups).toBeGreaterThan(0);
    agent.acknowledgeAgentMatch(ctx, { checkId: rows('agentOriginalityCheck')[0]!.id as bigint, refKey: 'work:11' });
    expect(rows('agentOriginalityCheck')[0]!.acknowledged).toEqual(['work:11']);
    expect(() => agent.acknowledgeAgentMatch(ctx, { checkId: rows('agentOriginalityCheck')[0]!.id as bigint, refKey: 'work:10' })).toThrow('no está');
    expect(() => agent.checkAgentOriginality(ctx, { sessionId, draftVersion: 0 })).toThrow('cambió');
    for (let i = 0; i < 11; i++) agent.checkAgentOriginality(ctx, { sessionId, draftVersion: 1 });
    expect(rows('agentOriginalityCheck')).toHaveLength(10);
  });
  it('excluye lo retirado y olvida el contenido purgado en fuentes y comparaciones', () => {
    const { ctx, rows, sessionId } = ready();
    agent.trainAgent(ctx, { sources: sources(['work', '10']), expectedStyleVersion: 0 });
    agent.saveAgentDraft(ctx, { sessionId, expectedDraftVersion: 0, stage: 'review', draft: essay });
    agent.checkAgentOriginality(ctx, { sessionId, draftVersion: 1 });
    agent.purgeAgentSource(ctx.db, 'work', 11n); agent.purgeAgentSource(ctx.db, 'work', 10n);
    expect(JSON.parse(rows('agentOriginalityCheck')[0]!.matches as string)).toEqual([]); expect(rows('agentStyleSource')).toHaveLength(0);
    (ctx.db as unknown as Record<string, { insert(row: Row): void }>).contentStatus.insert({ key: 'work:11', withdrawnAt: at });
    agent.checkAgentOriginality(ctx, { sessionId, draftVersion: 1 });
    expect(JSON.parse([...rows('agentOriginalityCheck')].at(-1)!.matches as string)).toEqual([]);
  });
});

describe('retención y purga', () => {
  it('vence una sesión inactiva solo si no se volvió a usar', () => {
    const { ctx, as, rows, sessionId } = ready(); const first = rows('agentExpiry')[0]! as { generation: number };
    agent.saveAgentDraft(ctx, { sessionId, expectedDraftVersion: 0, stage: 'review', draft: 'Texto.' });
    expect(() => agent.expireAgentSession(ctx, { sessionId, generation: first.generation })).toThrow('programador');
    as(admin); agent.expireAgentSession(ctx, { sessionId, generation: first.generation }); expect(rows('agentSession')).toHaveLength(1);
    agent.expireAgentSession(ctx, { sessionId, generation: rows('agentSession')[0]!.generation as number });
    expect(rows('agentSession')).toHaveLength(0); expect(rows('agentExpiry')).toHaveLength(0);
  });
  it('dar de baja conserva los datos privados y desactivar borra solo el agente propio', () => {
    const { ctx, as, rows, sessionId } = ready();
    agent.trainAgent(ctx, { sources: sources(['work', '10']), expectedStyleVersion: 0 });
    agent.saveAgentDraft(ctx, { sessionId, expectedDraftVersion: 0, stage: 'review', draft: essay }); agent.checkAgentOriginality(ctx, { sessionId, draftVersion: 1 });
    as(peer); agent.enableAgent(ctx, { premisesVersion: 1 });
    const retained = Object.fromEntries(['agentStyleSource', 'agentStyleSnapshot', 'agentSession', 'agentOriginalityCheck', 'agentExpiry'].map(table => [table, [...rows(table)]]));
    as(admin); remove_member(ctx, { identity: owner });
    for (const [table, records] of Object.entries(retained)) expect(rows(table), table).toEqual(records);
    expect(rows('agentProfile').map((r) => keyOf(r.owner))).toEqual([owner.toHexString(), peer.toHexString()]);
    as(owner); expect(() => agent.saveAgentDraft(ctx, { sessionId, expectedDraftVersion: 1, stage: 'review', draft: 'No autorizado' })).toThrow('activo');
    as(peer); agent.disableAgent(ctx); expect(rows('agentProfile').map((r) => keyOf(r.owner))).toEqual([owner.toHexString()]);
  });
});
