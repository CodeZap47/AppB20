import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import { addStickerNative, createStickerPackNative, readStickerBytes } from './nativeStickersHandlers';
import { remove_sticker_pack } from './index';
import type { Ctx } from './moduleContext';
const person = (digit: string) => Identity.fromString(digit.repeat(64));
const admin = person('a'), author = person('b'), peer = person('c');
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
type Row = Record<string, unknown>;
const keyOf = (value: unknown) => value && typeof value === 'object' && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function setup() {
  const initial: Record<string, Row[]> = { member: [admin, author, peer].map((identity) => ({ identity, isCreator: identity === admin, status: 'active' })),
    authConfig: [{ id: 0, issuer: 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1', audiences: ['test'] }] };
  const keys: Record<string, string> = { member: 'identity', stickerBlob: 'stickerId', stickerImport: 'requestId' };
  const allRows = new Map<string, Row[]>(); let next = 1n;
  const db = new Proxy({}, { get(_target, name: string) {
    if (!allRows.has(name)) allRows.set(name, initial[name] ?? []);
    const rows = allRows.get(name)!; const primary = keys[name] ?? 'id';
    return new Proxy({ iter: () => rows.values(), insert: (value: Row) => { const row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) }; rows.push(row); return row; } }, { get(target, field: string) {
      if (field in target) return target[field as keyof typeof target];
      return { find: (value: unknown) => rows.find((row) => keyOf(row[field]) === keyOf(value)),
        filter: (value: unknown) => rows.filter((row) => keyOf(row[field]) === keyOf(value)),
        update: (row: Row) => { const index = rows.findIndex((prior) => keyOf(prior[primary]) === keyOf(row[primary])); rows[index] = { ...row }; return row; },
        delete: (value: unknown) => { const index = rows.findIndex((row) => keyOf(row[field]) === keyOf(value)); if (index >= 0) rows.splice(index, 1); } };
    } });
  } });
  const state = { db, sender: author, timestamp: new Timestamp(1_700_000_000_000_000n), env: {}, senderAuth: { jwt: { issuer: 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'local@example.com', email_verified: true } } } };
  return { ctx: state as unknown as Ctx, as: (sender: Identity) => { state.sender = sender; }, rows: (name: string) => {
    if (!allRows.has(name)) allRows.set(name, initial[name] ?? []);
    return allRows.get(name)!;
  } };
}
const packRequest = { requestId: '10000000-0000-4000-8000-000000000001', name: 'Mi paquete' };
const stickerRequest = (packId: bigint) => ({ requestId: '20000000-0000-4000-8000-000000000001', packId, name: 'mi.png', contentType: 'image/png', animated: false, bytes: png });

describe('stickers con bytes privados en SpacetimeDB', () => {
  it('un reintento no crea otro paquete ni reserva dos veces los mismos bytes', () => {
    const { ctx, rows } = setup();
    const packId = createStickerPackNative(ctx, packRequest);
    expect(createStickerPackNative(ctx, packRequest)).toBe(packId);
    const request = stickerRequest(packId); const stickerId = addStickerNative(ctx, request);
    expect(addStickerNative(ctx, request)).toBe(stickerId);
    expect(rows('stickerBlob')).toHaveLength(1);
    expect(rows('resourceCapacity')[0]?.reservedBytes).toBe(8n);
    expect(rows('sticker')[0]?.storageKey).toBe(`native:${stickerId}`);
    expect(() => addStickerNative(ctx, { ...request, name: 'otro.png' })).toThrow('otro sticker');
    expect(() => addStickerNative(ctx, { ...request, bytes: new Uint8Array([...png, 1]) })).toThrow('otro sticker');
  });

  it('los bytes solo se leen desde el paquete propio/compartido o desde un mensaje que se puede leer', () => {
    const { ctx, as, rows } = setup(); const packId = createStickerPackNative(ctx, packRequest); const stickerId = addStickerNative(ctx, stickerRequest(packId));
    expect(readStickerBytes(ctx, { stickerId }).bytes).toEqual(png);
    as(admin); expect(() => readStickerBytes(ctx, { stickerId })).toThrow('disponible');
    as(peer); expect(() => readStickerBytes(ctx, { stickerId })).toThrow('disponible');
    // El flag usado por sí solo nunca concede lectura.
    rows('sticker')[0]!.used = true;
    as(admin); expect(() => readStickerBytes(ctx, { stickerId })).toThrow('disponible');
    rows('directConversation').push({ id: 10n, userA: author, userB: peer });
    rows('directMessage').push({ id: 20n, conversationId: 10n, text: `[[sticker:${stickerId}]]` });
    as(peer); expect(readStickerBytes(ctx, { stickerId }).bytes).toEqual(png);
    as(admin); expect(() => readStickerBytes(ctx, { stickerId })).toThrow('disponible');
    rows('stickerPack')[0]!.shared = true;
    expect(readStickerBytes(ctx, { stickerId }).bytes).toEqual(png);
  });

  it('valida tamaño y firma, mantiene el límite de 30 y comprueba la capacidad antes de insertar', () => {
    const { ctx, rows, as } = setup(); const packId = createStickerPackNative(ctx, packRequest); const request = stickerRequest(packId);
    expect(() => addStickerNative(ctx, { ...request, bytes: new Uint8Array() })).toThrow('1 MiB');
    expect(() => addStickerNative(ctx, { ...request, bytes: new Uint8Array(1024 * 1024 + 1) })).toThrow('1 MiB');
    expect(() => addStickerNative(ctx, { ...request, contentType: 'image/jpeg' })).toThrow('bytes');
    as(peer); expect(() => addStickerNative(ctx, request)).toThrow('importó'); as(author);
    addStickerNative(ctx, request);
    rows('resourceCapacity')[0]!.limitBytes = 8n;
    expect(() => addStickerNative(ctx, { ...request, requestId: '20000000-0000-4000-8000-000000000002' })).toThrow('espacio');
    rows('resourceCapacity')[0]!.limitBytes = 1000n;
    for (let index = 2; index <= 30; index++) addStickerNative(ctx, { ...request, requestId: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}` });
    expect(() => addStickerNative(ctx, { ...request, requestId: '20000000-0000-4000-8000-000000000031' })).toThrow('30');
    expect(addStickerNative(ctx, request)).toBe(rows('sticker')[0]?.id);
  });

  it('retirar un paquete libera bytes sin usar y conserva los que aparecen en mensajes', () => {
    const { ctx, rows } = setup(); const packId = createStickerPackNative(ctx, packRequest); const request = stickerRequest(packId);
    const usedId = addStickerNative(ctx, request); rows('sticker')[0]!.used = true;
    addStickerNative(ctx, { ...request, requestId: '20000000-0000-4000-8000-000000000002' });
    remove_sticker_pack(ctx, { packId });
    expect(rows('stickerBlob').map((row) => row.stickerId)).toEqual([usedId]);
    expect(rows('resourceCapacity')[0]?.reservedBytes).toBe(8n);
    expect(() => createStickerPackNative(ctx, packRequest)).toThrow('retirado');
  });
});
