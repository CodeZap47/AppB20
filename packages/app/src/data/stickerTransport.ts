import { detectImageType, isAnimatedWebp, MAX_STICKERS_PER_PACK, stickerFileError } from '@b20/core';

export interface StickerConnection {
  db: { stickers: { iter(): Iterable<{ id: bigint }> } };
  procedures: {
    createStickerPackNative(input: { requestId: string; name: string }): Promise<bigint>;
    addStickerNative(input: { requestId: string; packId: bigint; name: string; contentType: string; animated: boolean; bytes: Uint8Array }): Promise<bigint>;
    readStickerBytes(input: { stickerId: bigint }): Promise<{ bytes: Uint8Array; contentType: string }>;
  };
}

/** Los únicos recibos conservados son IDs y huellas; los bytes permanecen en la llamada. */
export class StickerTransport {
  private receipts = new Map<string, { packRequest: string; stickerRequests: string[] }>();
  constructor(private getConnection: () => StickerConnection, private identity: () => string) {}
  private session(connection: StickerConnection, actor: string) {
    if (this.getConnection() !== connection || this.identity() !== actor) throw new Error('La sesión cambió durante la transferencia de stickers.');
  }
  async import(packName: string, files: File[]): Promise<string> {
    const name = packName.trim();
    if (!name || name.length > 60) throw new Error('Escribe un nombre de paquete de hasta 60 caracteres.');
    if (!files.length || files.length > MAX_STICKERS_PER_PACK) throw new Error(`Elige entre 1 y ${MAX_STICKERS_PER_PACK} stickers.`);
    const connection = this.getConnection(); const actor = this.identity();
    const prepared: { name: string; contentType: string; animated: boolean; bytes: Uint8Array; hash: string }[] = [];
    for (const file of files) {
      if (file.size <= 0 || file.size > 1024 * 1024) throw new Error(`«${file.name}» debe pesar entre 1 byte y 1 MB.`);
      if (!file.name.trim() || file.name.length > 200) throw new Error('El nombre del sticker debe tener entre 1 y 200 caracteres.');
      const bytes = new Uint8Array(await file.arrayBuffer()); this.session(connection, actor);
      const contentType = detectImageType(bytes);
      const problem = stickerFileError(file.name, bytes.length, contentType);
      if (problem || !contentType || bytes.length !== file.size) throw new Error(problem ?? 'El contenido del sticker no coincide con su tamaño.');
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); this.session(connection, actor);
      const hash = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
      prepared.push({ name: file.name.trim(), contentType, bytes, hash, animated: contentType === 'image/gif' || (contentType === 'image/webp' && isAnimatedWebp(bytes)) });
    }
    const key = JSON.stringify([actor, name, prepared.map(({ name, hash }) => [name, hash])]);
    let receipt = this.receipts.get(key);
    if (!receipt) {
      receipt = { packRequest: crypto.randomUUID(), stickerRequests: prepared.map(() => crypto.randomUUID()) };
      if (this.receipts.size >= 50) this.receipts.delete(this.receipts.keys().next().value!);
      this.receipts.set(key, receipt);
    }
    const packId = await connection.procedures.createStickerPackNative({ requestId: receipt.packRequest, name }); this.session(connection, actor);
    for (let index = 0; index < prepared.length; index++) {
      const { hash: _hash, ...item } = prepared[index]!;
      await connection.procedures.addStickerNative({ ...item, packId, requestId: receipt.stickerRequests[index]! }); this.session(connection, actor);
    }
    return packId.toString();
  }
  async download(stickerId: string): Promise<Blob> {
    const connection = this.getConnection(); const actor = this.identity(); const id = BigInt(stickerId);
    const visible = () => [...connection.db.stickers.iter()].some((row) => row.id === id);
    if (!visible()) throw new Error('El sticker no está disponible.');
    const result = await connection.procedures.readStickerBytes({ stickerId: id }); this.session(connection, actor);
    if (!visible()) throw new Error('El sticker ya no está disponible.');
    const bytes = new Uint8Array(result.bytes); const actual = detectImageType(bytes);
    const problem = stickerFileError('Sticker', bytes.length, actual);
    if (problem || !actual || actual !== result.contentType) throw new Error(problem ?? 'El formato del sticker no coincide con su contenido.');
    return new Blob([bytes], { type: actual });
  }
}
