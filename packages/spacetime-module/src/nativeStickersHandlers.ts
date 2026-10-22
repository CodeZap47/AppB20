import { memberIdentityFor } from './authIdentity';
import { SenderError } from 'spacetimedb/server';
import { sha256 } from '@noble/hashes/sha2.js';
import { activeMember, isActive, requireText, type Ctx, type ViewDb } from './moduleContext';

const TOKEN = /\[\[sticker:(\d{1,20})\]\]/g;
const MAX_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (bytes: Uint8Array) => Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
function requestId(value: string) { if (!UUID.test(value)) throw new SenderError('Identificador de importación inválido.'); return value; }

/** La misma autorización protege tanto metadatos como bytes. Nunca usa el flag global used. */
export function visibleStickerIds(db: ViewDb, sender: Ctx['sender']): Set<bigint> {
  const visible = new Set<bigint>();
  if (!isActive(db, sender)) return visible;
  const collect = (messages: Iterable<{ text: string; deletedAt?: unknown }>) => {
    for (const message of messages) if (!message.deletedAt) for (const match of message.text.matchAll(TOKEN)) visible.add(BigInt(match[1]));
  };
  collect(db.groupMessage.iter()); collect(db.channelMessage.iter());
  for (const chat of [...db.directConversation.userA.filter(sender), ...db.directConversation.userB.filter(sender)]) collect(db.directMessage.conversationId.filter(chat.id));
  for (const sticker of db.sticker.iter()) {
    const pack = db.stickerPack.id.find(sticker.packId);
    if (pack && (pack.shared || pack.owner.isEqual(sender))) visible.add(sticker.id);
  }
  return visible;
}
function ownPack(ctx: Ctx, id: bigint) {
  activeMember(ctx);
  const pack = ctx.db.stickerPack.id.find(id);
  if (!pack || !pack.owner.isEqual(memberIdentityFor(ctx))) throw new SenderError('Solo quien importó el paquete puede cambiarlo.');
  return pack;
}
function imageType(bytes: Uint8Array): string | undefined {
  const has = (offset: number, header: number[]) => header.every((byte, index) => bytes[offset + index] === byte);
  if (has(0, [137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (has(0, [255, 216, 255])) return 'image/jpeg';
  if (has(0, [71, 73, 70, 56, 55, 97]) || has(0, [71, 73, 70, 56, 57, 97])) return 'image/gif';
  if (has(0, [82, 73, 70, 70]) && has(8, [87, 69, 66, 80])) return 'image/webp';
  return undefined;
}
export function createStickerPackNative(ctx: Ctx, input: { requestId: string; name: string }): bigint {
  activeMember(ctx); requestId(input.requestId);
  const name = requireText(input.name, 'El nombre del paquete', 60);
  const prior = ctx.db.stickerImport.requestId.find(input.requestId);
  if (prior) {
    if (!prior.owner.isEqual(memberIdentityFor(ctx)) || prior.name !== name) throw new SenderError('Esta importación ya corresponde a otro paquete.');
    if (!ctx.db.stickerPack.id.find(prior.packId)) throw new SenderError('El paquete ya fue retirado. Inicia una importación nueva.');
    return prior.packId;
  }
  const pack = ctx.db.stickerPack.insert({ id: 0n, owner: memberIdentityFor(ctx), name, shared: false, createdAt: ctx.timestamp });
  ctx.db.stickerImport.insert({ requestId: input.requestId, owner: memberIdentityFor(ctx), name, packId: pack.id, createdAt: ctx.timestamp });
  return pack.id;
}
export function addStickerNative(ctx: Ctx, input: { requestId: string; packId: bigint; name: string; contentType: string; animated: boolean; bytes: Uint8Array }): bigint {
  ownPack(ctx, input.packId); requestId(input.requestId);
  const name = requireText(input.name, 'El nombre del archivo', 200);
  if (!input.bytes.length || input.bytes.length > MAX_BYTES) throw new SenderError('Un sticker debe ocupar entre 1 byte y 1 MiB.');
  const detected = imageType(input.bytes);
  if (!detected || detected !== input.contentType) throw new SenderError('Los bytes del sticker no coinciden con una imagen PNG, JPEG, GIF o WebP.');
  const hash = digest(input.bytes);
  const prior = ctx.db.stickerBlob.requestId.find(input.requestId);
  if (prior) {
    const sticker = ctx.db.sticker.id.find(prior.stickerId);
    if (!sticker || sticker.packId !== input.packId || prior.hash !== hash || prior.name !== name || sticker.contentType !== input.contentType || sticker.animated !== input.animated) {
      throw new SenderError('Esta importación ya corresponde a otro sticker.');
    }
    return prior.stickerId;
  }
  if ([...ctx.db.sticker.iter()].filter((row) => row.packId === input.packId).length >= 30) throw new SenderError('Un paquete tiene como máximo 30 stickers.');
  const capacity = ctx.db.resourceCapacity.id.find(0) ?? ctx.db.resourceCapacity.insert({ id: 0, limitBytes: 256n * 1024n * 1024n, reservedBytes: 0n });
  const size = BigInt(input.bytes.length);
  if (capacity.reservedBytes + size > capacity.limitBytes) throw new SenderError('No queda espacio disponible para importar este sticker.');
  const sticker = ctx.db.sticker.insert({ id: 0n, packId: input.packId, storageKey: 'native:pending', contentType: input.contentType, size, animated: input.animated, used: false, createdAt: ctx.timestamp });
  ctx.db.sticker.id.update({ ...sticker, storageKey: `native:${sticker.id}` });
  ctx.db.stickerBlob.insert({ stickerId: sticker.id, requestId: input.requestId, name, bytes: input.bytes, hash });
  ctx.db.resourceCapacity.id.update({ ...capacity, reservedBytes: capacity.reservedBytes + size });
  return sticker.id;
}
export function readStickerBytes(ctx: Ctx, input: { stickerId: bigint }) {
  activeMember(ctx);
  if (!visibleStickerIds(ctx.db, memberIdentityFor(ctx)).has(input.stickerId)) throw new SenderError('El sticker no está disponible.');
  const sticker = ctx.db.sticker.id.find(input.stickerId); const blob = ctx.db.stickerBlob.stickerId.find(input.stickerId);
  if (!sticker || !blob) throw new SenderError('El sticker no tiene bytes nativos disponibles.');
  return { bytes: blob.bytes, contentType: sticker.contentType };
}
export function removeUnusedStickerBlob(ctx: Ctx, stickerId: bigint) {
  const blob = ctx.db.stickerBlob.stickerId.find(stickerId);
  if (!blob) return;
  const capacity = ctx.db.resourceCapacity.id.find(0);
  if (capacity) ctx.db.resourceCapacity.id.update({ ...capacity, reservedBytes: capacity.reservedBytes - BigInt(blob.bytes.length) });
  ctx.db.stickerBlob.stickerId.delete(stickerId);
}
