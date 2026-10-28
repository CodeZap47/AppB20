import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) };
});
import { available_chat_commands, chat_command_details, my_chat_commands, type Ctx } from './index';
import { commandReadable, removeChatCommand, saveChatCommand } from './chatCommandHandlers';

type Row = Record<string, unknown>;
const author = Identity.fromString('b'.repeat(64));
const peer = Identity.fromString('c'.repeat(64));
const admin = Identity.fromString('a'.repeat(64));
const outsider = Identity.fromString('d'.repeat(64));
const key = (value: unknown) => value && typeof value === 'object' && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function table(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map(row => [key(row[primary]), row]));
  let next = 10n;
  return new Proxy({ rows, iter: () => rows.values(), insert(value: Row) { const row: Row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) }; rows.set(key(row[primary]), row); return row; } }, {
    get(target, index) { if (index in target) return target[index as keyof typeof target]; return {
      find: (id: unknown) => rows.get(key(id)), delete: (id: unknown) => rows.delete(key(id)), update: (row: Row) => { rows.set(key(row[primary]), row); return row; },
      filter: (id: unknown) => [...rows.values()].filter(row => key(row[String(index)]) === key(id)),
    }; },
  });
}
function setup() {
  const initial: Record<string, Row[]> = {
    appConfig: [{ id: 0, owner: admin }],
    authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }],
    member: [author, peer, admin].map(identity => ({ identity, displayName: 'Alumno', status: 'active', isCreator: identity === admin })),
    chatCommand: [{ id: 1n, owner: author, name: 'legacy', description: '', text: 'Texto previo', createdAt: new Timestamp(1n) }],
  };
  const keys: Record<string, string> = { member: 'identity', authIdentityLink: 'sessionIdentity', chatCommandDetail: 'commandId' };
  const tables = new Map<string, ReturnType<typeof table>>();
  const db = new Proxy({}, { get: (_target, name: string) => { if (!tables.has(name)) tables.set(name, table(keys[name] ?? 'id', initial[name])); return tables.get(name); } });
  const mutable = { db, sender: author, timestamp: new Timestamp(1_790_000_000_000_000n), senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'alumno@example.com', email_verified: true } } } };
  return { ctx: mutable as unknown as Ctx, as: (sender: Identity) => { mutable.sender = sender; }, rows: (name: string) => [...(db as Record<string, ReturnType<typeof table>>)[name]!.rows.values()] };
}
let state: ReturnType<typeof setup>;
beforeEach(() => { state = setup(); });
const input = { name: '/Saludó', description: '', text: 'Hola' };
const view = (handler: unknown) => (handler as (ctx: Ctx) => Row[])(state.ctx);

describe('servidor: catálogo de comandos', () => {
  it('mantiene filas anteriores privadas y normaliza las nuevas', () => {
    expect(view(my_chat_commands)).toHaveLength(1);
    saveChatCommand(state.ctx, input);
    expect(state.rows('chatCommand').find(row => row.id === 10n)).toMatchObject({ name: 'saludo', text: 'Hola' });
    state.as(peer);
    expect(view(available_chat_commands)).toEqual([]);
    expect(view(chat_command_details)).toEqual([]);
    state.as(outsider);
    expect(() => saveChatCommand(state.ctx, input)).toThrow();
  });
  it('autor edita, administrador solo despublica, sin borrar su plantilla', () => {
    saveChatCommand(state.ctx, { ...input, visibility: 'classroom' });
    const id = 10n;
    state.as(peer);
    expect(view(available_chat_commands)).toHaveLength(1);
    expect(view(chat_command_details)[0]).toMatchObject({ shared: true, version: 1 });
    expect(() => saveChatCommand(state.ctx, { ...input, id })).toThrow(/autor/);
    expect(() => removeChatCommand(state.ctx, { commandId: id })).toThrow(/retirar/);
    state.as(admin);
    expect(() => saveChatCommand(state.ctx, { ...input, id })).toThrow(/autor/);
    removeChatCommand(state.ctx, { commandId: id });
    expect(state.rows('chatCommand').find(row => row.id === id)?.text).toBe('Hola');
    expect(state.rows('chatCommandDetail')[0]).toMatchObject({ shared: false, version: 2 });
    expect(commandReadable(state.ctx.db, peer, id)).toBe(false);
    expect(commandReadable(state.ctx.db, author, id)).toBe(true);
    state.as(author);
    removeChatCommand(state.ctx, { commandId: id });
    expect(state.rows('chatCommandDetail')).toEqual([]);
  });
  it('valida nombres por autor y por salón, versiones y acciones permitidas', () => {
    saveChatCommand(state.ctx, { ...input, visibility: 'classroom' });
    expect(() => saveChatCommand(state.ctx, input)).toThrow(/Ya tienes/);
    state.as(peer);
    expect(() => saveChatCommand(state.ctx, { ...input, visibility: 'classroom' })).toThrow(/salón/);
    saveChatCommand(state.ctx, { ...input, actionKind: 'create', resourceKind: 'nota', text: '' });
    const own = state.rows('chatCommand').find(row => (row.owner as Identity).isEqual(peer))!;
    expect(state.rows('chatCommandDetail').find(row => row.commandId === own.id)).toMatchObject({ actionKind: 'create', resourceKind: 'nota' });
    expect(view(my_chat_commands)).toEqual([]); // Older clients only understand text templates.
    expect(() => saveChatCommand(state.ctx, { ...input, id: own.id as bigint, expectedVersion: 9 })).toThrow(/cambió/);
    expect(() => saveChatCommand(state.ctx, { ...input, name: 'codigo' })).toThrow(/comando de la app/);
  });
});
