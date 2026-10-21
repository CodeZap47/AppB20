import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import { withdrawContent } from './communityHandlers';
import * as feed from './feedHandlers';
import type { Ctx } from './index';
import './index';

const identity = (digit: string) => Identity.fromString(digit.repeat(64));
const admin = identity('a'); const author = identity('b'); const other = identity('c'); const removed = identity('d');
const at = new Timestamp(1_700_000_000_000_000n);
type Row = Record<string, unknown>;
const keyOf = (value: unknown): string => value && typeof value === 'object' && 'toHexString' in value
  ? (value as Identity).toHexString() : String(value);

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

function setup() {
  const member = [admin, author, other, removed].map((person) => ({ identity: person, displayName: 'Alumno', isCreator: person === admin, status: person === removed ? 'removed' : 'active' }));
  const note = (id: bigint, visibility: string) => ({ id, subjectId: 1n, title: 'Apunte', topic: '', body: 'Contenido', tags: [], visibility, source: 'student', author, version: 1, createdAt: at, updatedAt: at });
  const initial: Record<string, Row[]> = {
    member, appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['test'] }], subject: [{ id: 1n, name: 'Lógica' }],
    note: [note(1n, 'group'), note(2n, 'personal')],
    question: [{ id: 3n, author, subjectId: 1n, title: 'Pregunta', body: 'Texto', topic: '', createdAt: at, status: 'open' }],
    poll: [{ id: 5n, title: 'Votación', cancelledAt: undefined }, { id: 6n, title: 'Cancelada', cancelledAt: at }],
  };
  const keys: Record<string, string> = { member: 'identity', contentStatus: 'key', feedReaction: 'key', noteDetail: 'noteId', resourceVersion: 'key' };
  const tables = new Map<string, ReturnType<typeof store>>();
  const db = new Proxy({}, { get(_target, property: string) {
    if (!tables.has(property)) tables.set(property, store(keys[property] ?? 'id', initial[property]));
    return tables.get(property);
  } });
  const state = { db, sender: author, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://auth.spacetimedb.com/oidc', audience: ['test'], fullPayload: { email: 'alumno@example.com', email_verified: true } } } };
  return { ctx: state as unknown as Ctx, as: (sender: Identity) => { state.sender = sender; },
    rows: (table: string) => [...(db as Record<string, ReturnType<typeof store>>)[table].rows.values()] };
}

describe('Reacciones del feed', () => {
  it('pone, cambia y quita una sola reacción por persona', () => {
    const { ctx, rows } = setup();
    feed.toggleFeedReaction(ctx, { targetKind: 'note', targetId: 1n, emoji: '👍' });
    feed.toggleFeedReaction(ctx, { targetKind: 'note', targetId: 1n, emoji: '🎉' });
    expect(rows('feedReaction')).toHaveLength(1);
    expect(rows('feedReaction')[0]).toMatchObject({ emoji: '🎉', target: 'note:1' });
    feed.toggleFeedReaction(ctx, { targetKind: 'note', targetId: 1n, emoji: '🎉' });
    expect(rows('feedReaction')).toHaveLength(0);
  });

  it('rechaza contenido personal ajeno, retirado, cancelado o emojis fuera de la lista', () => {
    const { ctx, as } = setup(); as(other);
    expect(() => feed.toggleFeedReaction(ctx, { targetKind: 'note', targetId: 2n, emoji: '👍' })).toThrow('disponible');
    expect(() => feed.toggleFeedReaction(ctx, { targetKind: 'poll', targetId: 6n, emoji: '👍' })).toThrow('disponible');
    expect(() => feed.toggleFeedReaction(ctx, { targetKind: 'note', targetId: 1n, emoji: '💩' })).toThrow('reacción');
    expect(() => feed.toggleFeedReaction(ctx, { targetKind: 'member', targetId: 1n, emoji: '👍' })).toThrow('reaccionar');
    as(author); withdrawContent(ctx, { kind: 'question', targetId: 3n, withdrawn: true, expectedVersion: 1, reason: '' });
    as(other); expect(() => feed.toggleFeedReaction(ctx, { targetKind: 'question', targetId: 3n, emoji: '👍' })).toThrow('disponible');
    as(removed); expect(() => feed.toggleFeedReaction(ctx, { targetKind: 'poll', targetId: 5n, emoji: '👍' })).toThrow('activo');
  });
});

describe('Publicaciones y comentarios', () => {
  it('publica una sola vez por solicitud y rechaza reutilizarla con otro texto', () => {
    const { ctx, rows } = setup(); const input = { text: ' Hola grupo ', requestId: 'r1' };
    feed.createFeedPost(ctx, input); feed.createFeedPost(ctx, input);
    expect(rows('feedPost')).toHaveLength(1); expect(rows('feedPost')[0]).toMatchObject({ text: 'Hola grupo' });
    expect(() => feed.createFeedPost(ctx, { ...input, text: 'Otra cosa' })).toThrow('otro contenido');
    expect(() => feed.createFeedPost(ctx, { text: 'x', subjectId: 9n, requestId: 'r2' })).toThrow();
  });

  it('solo el autor edita; autor o administrador elimina y se van sus reacciones', () => {
    const { ctx, rows, as } = setup(); feed.createFeedPost(ctx, { text: 'Hola', requestId: 'r1' });
    const postId = rows('feedPost')[0]!.id as bigint;
    as(other); feed.toggleFeedReaction(ctx, { targetKind: 'post', targetId: postId, emoji: '❤️' });
    expect(() => feed.editFeedPost(ctx, { postId, text: 'Cambio' })).toThrow('Solo quien publicó');
    expect(() => feed.deleteFeedPost(ctx, { postId })).toThrow('administrador');
    as(author); feed.editFeedPost(ctx, { postId, text: 'Hola a todos' });
    expect(rows('feedPost')[0]).toMatchObject({ text: 'Hola a todos', editedAt: at });
    as(admin); feed.deleteFeedPost(ctx, { postId });
    expect(rows('feedPost')[0]).toMatchObject({ text: '', deletedBy: admin });
    expect(rows('feedReaction')).toHaveLength(0);
    expect(feed.postReadable(ctx.db, other, postId)).toBe(false);
  });

  it('comenta con idempotencia; borra quien comentó, quien publicó o un administrador', () => {
    const { ctx, rows, as } = setup(); feed.createFeedPost(ctx, { text: 'Hola', requestId: 'r1' });
    const postId = rows('feedPost')[0]!.id as bigint;
    as(other); const comment = { postId, text: '¡Hola!', requestId: 'c1' };
    feed.commentFeedPost(ctx, comment); feed.commentFeedPost(ctx, comment);
    expect(rows('feedComment')).toHaveLength(1);
    const commentId = rows('feedComment')[0]!.id as bigint;
    as(admin); feed.commentFeedPost(ctx, { postId, text: 'Bienvenidos', requestId: 'c2' });
    const adminComment = rows('feedComment')[1]!.id as bigint;
    as(other); expect(() => feed.deleteFeedComment(ctx, { commentId: adminComment })).toThrow('No puedes');
    as(author); feed.deleteFeedComment(ctx, { commentId });
    expect(feed.commentReadable(ctx.db, other, rows('feedComment')[0] as never)).toBe(false);
  });
});
