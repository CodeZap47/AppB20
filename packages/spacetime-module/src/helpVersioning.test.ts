import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import './index';
import type { Ctx } from './index';
import { mutateHelp, readHelpHistory, assertLegacyHelpEditable } from './helpVersioning';
const owner = Identity.fromString('a'.repeat(64)), peer = Identity.fromString('b'.repeat(64));
type Row = Record<string, unknown>;
const key = (value: unknown): string => value instanceof Identity ? value.toHexString() : String(value);
function fixture() {
  const initial: Record<string, Row[]> = { member: [owner, peer].map(identity => ({ identity, status: 'active', isCreator: identity === peer })), appConfig: [{ id: 0, owner: peer }], authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }], subject: [{ id: 1n }] };
  const primary: Record<string, string> = { member: 'identity', helpVersion: 'postId', helpRevision: 'key', helpIntent: 'key' };
  const tables = new Map<string, Map<string, Row>>(); let next = 1n;
  const db = new Proxy({}, { get(_target, table: string) {
    if (!tables.has(table)) tables.set(table, new Map((initial[table] ?? []).map(row => [key(row[primary[table] ?? 'id']), row])));
    const rows = tables.get(table)!; const pk = primary[table] ?? 'id';
    return new Proxy({ iter: () => rows.values(), insert: (input: Row) => { const row: Row = { ...input, ...(input.id === 0n ? { id: next++ } : {}) }; rows.set(key(row[pk]), row); return row; } }, { get(target, index: string) {
      if (index in target) return target[index as keyof typeof target];
      return { find: (value: unknown) => [...rows.values()].find(row => key(row[index]) === key(value)), filter: (value: unknown) => [...rows.values()].filter(row => key(row[index]) === key(value)), update: (row: Row) => rows.set(key(row[pk]), row), delete: (value: unknown) => rows.delete(key(value)) };
    } });
  } });
  const state = { db, sender: owner, timestamp: new Timestamp(1_700_000_000_000_000n), env: {}, senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'owner@example.test', email_verified: true } } } };
  return { ctx: state as unknown as Ctx, as: (sender: Identity) => { state.sender = sender; }, rows: (table: string) => [...(tables.get(table)?.values() ?? [])] };
}
const fields = { kind: 'offer', subjectId: '1', title: 'Repasar lógica', topic: 'Condiciones', description: 'Explicación', level: 'initial', modality: 'messages', availability: '' };
const payload = (value: Record<string, unknown>) => JSON.stringify(value);
describe('Ayuda: transacciones versionadas y resultados idempotentes', () => {
  it('un envío repetido devuelve el mismo ID y un contenido distinto no reutiliza su intención', () => {
    const { ctx, rows } = fixture(); const input = { action: 'save', requestId: 'create', fields };
    const result = mutateHelp(ctx, payload(input)); expect(mutateHelp(ctx, payload(input))).toBe(result); expect(rows('helpPost')).toHaveLength(1);
    expect(() => mutateHelp(ctx, payload({ ...input, fields: { ...fields, title: 'Otro' } }))).toThrow('otro cambio');
  });
  it('versiona sin alterar la historia y no permite eludir la comprobación con la operación anterior', () => {
    const { ctx, rows } = fixture(); const { id } = JSON.parse(mutateHelp(ctx, payload({ action: 'save', requestId: 'create', fields }))) as { id: string };
    mutateHelp(ctx, payload({ action: 'save', id, expectedVersion: 1, requestId: 'edit', fields: { ...fields, description: 'Corrección' } }));
    expect(() => mutateHelp(ctx, payload({ action: 'save', id, expectedVersion: 1, requestId: 'stale', fields }))).toThrow('cambió');
    expect(() => assertLegacyHelpEditable(ctx, BigInt(id))).toThrow('Actualiza');
    expect(rows('helpRevision')).toHaveLength(2);
    expect(JSON.parse(readHelpHistory(ctx, BigInt(id))).map((row: { version: number }) => row.version)).toEqual([2, 1]);
  });
  it('el administrador no lee la historia de otra persona ni edita su oferta', () => {
    const { ctx, as } = fixture(); const { id } = JSON.parse(mutateHelp(ctx, payload({ action: 'save', requestId: 'create', fields }))) as { id: string };
    as(peer); expect(() => readHelpHistory(ctx, BigInt(id))).toThrow('autor');
    expect(() => mutateHelp(ctx, payload({ action: 'save', id, expectedVersion: 1, requestId: 'foreign', fields }))).toThrow('autor');
    expect(() => mutateHelp(ctx, payload({ action: 'withdraw', id, expectedVersion: 1, requestId: 'moderate', reason: '' }))).toThrow('motivo');
  });
});
