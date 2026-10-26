import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import { sha256 } from '@noble/hashes/sha2.js';

// Solo sustituye el registro del SDK; ejecuta permisos, tablas y handlers reales.
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import { begin_resource_upload, finalize_resource_upload, get_resource_manifest, put_resource_chunk, read_resource_chunk, resource_files, type Ctx } from './index';
import { assertDirectAllowed, canReadTarget, channel, conversationAccess, createChatChannel, markConversationRead, reportFileReadable, reportMessage, sendChannelMessage, validateMentions } from './delivery2Handlers';

const person = (digit: string) => Identity.fromString(digit.repeat(64));
const admin = person('a'); const author = person('b'); const recipient = person('c'); const third = person('d');
const keyOf = (value: unknown): string => value && typeof value === 'object' && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
type Row = Record<string, unknown>;
function tableStore(key: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[key]), row]));
  let next = initial.reduce((max, row) => typeof row.id === 'bigint' && row.id >= max ? row.id + 1n : max, 1n);
  return new Proxy({ rows, iter: () => rows.values(), insert: (value: Row) => {
    const row: Row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) }; rows.set(keyOf(row[key]), row); return row;
  } }, { get(target, name) {
    if (name in target) return target[name as keyof typeof target];
    return { find: (value: unknown) => rows.get(keyOf(value)), update: (row: Row) => { rows.set(keyOf(row[key]), { ...row }); return row; }, delete: (value: unknown) => rows.delete(keyOf(value)), filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[String(name)]) === keyOf(value)) };
  } });
}
function setup() {
  const at = new Timestamp(1_790_000_000_000_000n);
  const keys: Record<string, string> = { member: 'identity', memberBlock: 'key', conversationState: 'key', resourceVersion: 'key', contentStatus: 'key' };
  const initial: Record<string, Row[]> = {
    appConfig: [{ id: 0, owner: admin }],
    authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }],
    member: [admin, author, recipient, third].map((identity) => ({ identity, displayName: identity.toHexString()[0], status: 'active', isCreator: identity === admin })),
    subject: [{ id: 1n, name: 'Programación' }],
    chatChannel: [{ id: 10n, name: 'Materia', kind: 'subject', subjectId: 1n, createdBy: author, createdAt: at }, { id: 11n, name: 'Proyecto', kind: 'project', createdBy: author, createdAt: at }],
    channelMessage: [{ id: 20n, channelId: 10n, sender: author, text: 'Uno', sentAt: at }, { id: 21n, channelId: 10n, sender: recipient, text: 'Dos', sentAt: at }],
    groupMessage: [{ id: 30n, sender: author, text: 'General', sentAt: at }],
    directConversation: [{ id: 40n, userA: author, userB: recipient }],
    directMessage: [{ id: 50n, conversationId: 40n, sender: author, text: 'Evidencia elegida', sentAt: at }],
  };
  const tables = new Map<string, ReturnType<typeof tableStore>>();
  const db = new Proxy({}, { get: (_target, property: string) => {
    if (!tables.has(property)) tables.set(property, tableStore(keys[property] ?? 'id', initial[property])); return tables.get(property);
  } });
  const mutable = { db, sender: author, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'alumno@example.com', email_verified: true } } } };
  const ctx = mutable as unknown as Ctx & Parameters<typeof resource_files>[0];
  const proc = { withTx: (fn: (tx: typeof ctx) => unknown) => fn(ctx) } as unknown as Parameters<typeof get_resource_manifest>[0];
  const as = (identity: Identity) => { mutable.sender = identity; };
  const rows = (table: string) => [...(db as Record<string, ReturnType<typeof tableStore>>)[table].rows.values()];
  return { ctx, proc, as, rows, db: ctx.db };
}
const hash = (bytes: Uint8Array) => Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('servidor: canales y lectura por conversación', () => {
  it('valida materia, impide respuestas cruzadas y mantiene lectura del canal archivado', () => {
    const { ctx, rows, db } = setup();
    expect(() => createChatChannel(ctx, { name: 'Sin materia', kind: 'subject' })).toThrow(/materia/);
    createChatChannel(ctx, { name: 'Tema nuevo', kind: 'topic' });
    expect(rows('chatChannel')).toHaveLength(3);
    expect(() => sendChannelMessage(ctx, { channelId: 11n, text: 'Cruzado', replyToId: 20n })).toThrow(/este canal/);
    const old = db.chatChannel.id.find(10n)!;
    db.chatChannel.id.update({ ...old, archivedAt: ctx.timestamp });
    expect(() => sendChannelMessage(ctx, { channelId: 10n, text: 'Nuevo' })).toThrow(/archivado/);
    expect(() => channel(ctx, 10n)).not.toThrow();
  });
  it('no retrocede el puntero ni lo comparte con otros usuarios o canales', () => {
    const { ctx, as, rows } = setup();
    markConversationRead(ctx, { scope: 'channel', conversationId: '10', messageId: 21n });
    markConversationRead(ctx, { scope: 'channel', conversationId: '10', messageId: 20n });
    expect(rows('conversationState')[0].readThroughId).toBe(21n);
    expect(() => markConversationRead(ctx, { scope: 'channel', conversationId: '11', messageId: 21n })).toThrow(/otra conversación/);
    as(recipient); markConversationRead(ctx, { scope: 'channel', conversationId: '10', messageId: 20n });
    expect(rows('conversationState')).toHaveLength(2);
    expect(rows('conversationState')[1].readThroughId).toBe(20n);
  });
  it('valida pertenencia a directos y menciones aunque el tercero sea administrador', () => {
    const { ctx, as } = setup();
    expect(() => validateMentions(ctx, `[[mencion:${recipient.toHexString()}]]`, [author, recipient])).not.toThrow();
    expect(() => validateMentions(ctx, `[[mencion:${third.toHexString()}]]`, [author, recipient])).toThrow(/no participa/);
    expect(() => validateMentions(ctx, '[[mencion:invalida]]')).toThrow(/no es válida/);
    for (const identity of [third, admin]) { as(identity); expect(() => conversationAccess(ctx, 'direct', '40')).toThrow(/No participas/); }
  });
  it('el bloqueo prohíbe envíos en ambos sentidos y mantiene acceso al historial', () => {
    const { ctx, as, db } = setup();
    db.memberBlock.insert({ key: `${author.toHexString()}:${recipient.toHexString()}`, owner: author, memberId: recipient, createdAt: ctx.timestamp });
    expect(() => assertDirectAllowed(ctx, author, recipient)).toThrow(/No se pueden/);
    as(recipient); expect(() => assertDirectAllowed(ctx, recipient, author)).toThrow(/No se pueden/);
    expect(() => conversationAccess(ctx, 'direct', '40')).not.toThrow();
    expect(canReadTarget(ctx.db, recipient, 'direct_message', 50n)).toBe(true);
  });
});

describe('servidor: bytes privados y evidencia seleccionada', () => {
  it('solo los participantes descargan el DM; un reporte concede únicamente el adjunto elegido', () => {
    const { ctx, proc, as, rows } = setup();
    const bytes = new Uint8Array([0, 42, 255]);
    const ids = ['12345678-1234-4234-8234-123456789abc', '12345678-1234-4234-8234-123456789abd'];
    for (let index = 0; index < ids.length; index++) {
      const uploadId = ids[index]!;
      begin_resource_upload(ctx, { uploadId, targetKind: 'direct_message', targetId: 50n, expectedVersion: index + 1, name: `prueba${index}.bin`, mime: 'application/octet-stream', bytes: 3n, sha256: hash(bytes) });
      put_resource_chunk(ctx, { uploadId, index: 0, bytes, sha256: hash(bytes) });
      finalize_resource_upload(ctx, { uploadId });
    }
    for (const identity of [third, admin]) {
      as(identity); expect(resource_files(ctx)).toEqual([]);
      expect(() => get_resource_manifest(proc, { fileId: ids[0]! })).toThrow();
      expect(() => read_resource_chunk(proc, { fileId: ids[0]!, index: 0 })).toThrow();
      expect(() => reportMessage(ctx, { scope: 'direct', messageId: 50n, reason: 'Sin acceso', shareText: true, attachmentIds: [] })).toThrow();
    }
    as(recipient);
    expect(read_resource_chunk(proc, { fileId: ids[0]!, index: 0 }).bytes).toEqual(bytes);
    reportMessage(ctx, { scope: 'direct', messageId: 50n, reason: 'Solo este archivo', shareText: false, attachmentIds: [ids[0]!] });
    expect(rows('messageReport')[0]).toMatchObject({ evidenceText: '', attachmentIds: [ids[0]] });
    as(admin);
    expect(reportFileReadable(ctx.db, admin, ids[0]!)).toBe(true);
    expect(reportFileReadable(ctx.db, admin, ids[1]!)).toBe(false);
    expect(resource_files(ctx).map((file) => file.id)).toEqual([ids[0]]);
    expect(read_resource_chunk(proc, { fileId: ids[0]!, index: 0 }).bytes).toEqual(bytes);
    expect(() => read_resource_chunk(proc, { fileId: ids[1]!, index: 0 })).toThrow();
    as(third); expect(() => read_resource_chunk(proc, { fileId: ids[0]!, index: 0 })).toThrow();
  });
  it('rechaza archivos ajenos al mensaje y conserva una copia expresa del texto elegido', () => {
    const { ctx, as, db, rows } = setup();
    db.resourceFile.insert({ id: 'wrong', targetKind: 'group_message', targetId: 30n, name: 'otro.txt', size: 1n, contentType: 'text/plain', storageKey: 'spacetime:wrong', etag: 'x', uploadedBy: author, createdAt: ctx.timestamp, removedAt: undefined });
    as(recipient);
    expect(() => reportMessage(ctx, { scope: 'direct', messageId: 50n, reason: 'Motivo', shareText: true, attachmentIds: ['wrong'] })).toThrow(/este mensaje/);
    reportMessage(ctx, { scope: 'direct', messageId: 50n, reason: 'Motivo', shareText: true, attachmentIds: [] });
    expect(rows('messageReport')[0].evidenceText).toBe('Evidencia elegida');
    const original = db.directMessage.id.find(50n)!;
    db.directMessage.id.update({ ...original, text: 'Contenido cambiado' });
    expect(rows('messageReport')[0].evidenceText).toBe('Evidencia elegida');
  });
});
