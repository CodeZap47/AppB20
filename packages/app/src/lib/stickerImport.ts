import { detectImageType, MAX_STICKERS_PER_PACK, stickerFileError } from '@b20/core';

/**
 * Prepara stickers para importarlos. Acepta imágenes sueltas (los .webp de la carpeta
 * «WhatsApp Stickers» o los que guardas desde WhatsApp Web) y paquetes `.wastickers`, que son
 * un ZIP con las imágenes, `title.txt` y un ícono `tray`. Todo se lee en el navegador.
 */

export interface PreparedStickers {
  files: File[];
  /** Nombre del paquete si venía en un `.wastickers`. */
  packName?: string;
  /** Lo que se dejó fuera y por qué. */
  skipped: string[];
}

const ZIP_NAME = /\.(wastickers|zip)$/i;
/** Topes para no descomprimir de más con un archivo malicioso. */
const MAX_ZIP_ENTRIES = 200;
const MAX_ZIP_TOTAL_BYTES = 60 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lector mínimo de ZIP: archivos guardados o con deflate, sin cifrar. */
export async function readZip(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('El archivo no es un ZIP válido.');
  const count = view.getUint16(end + 10, true);
  if (count > MAX_ZIP_ENTRIES) throw new Error('El paquete tiene demasiados archivos.');
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('El ZIP está dañado.');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/') || flags & 1) continue;
    total += size;
    if (total > MAX_ZIP_TOTAL_BYTES) throw new Error('El paquete es demasiado grande.');
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50)
      throw new Error('El ZIP está dañado.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    if (method === 0) entries.push({ name, bytes: data.slice() });
    else if (method === 8) entries.push({ name, bytes: await inflateRaw(data) });
  }
  return entries;
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

async function check(file: File): Promise<string | undefined> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return stickerFileError(file.name, file.size, detectImageType(head));
}

export async function prepareStickers(input: File[]): Promise<PreparedStickers> {
  const files: File[] = [];
  const skipped: string[] = [];
  let packName: string | undefined;

  for (const file of input) {
    if (!ZIP_NAME.test(file.name)) {
      const problem = await check(file);
      if (problem) skipped.push(problem);
      else files.push(file);
      continue;
    }
    let entries: ZipEntry[];
    try {
      entries = await readZip(await file.arrayBuffer());
    } catch (error) {
      skipped.push(
        `«${file.name}»: ${error instanceof Error ? error.message : 'no se pudo abrir.'}`,
      );
      continue;
    }
    const title = entries.find((e) => baseName(e.name).toLowerCase() === 'title.txt');
    if (title && !packName)
      packName = new TextDecoder().decode(title.bytes).trim().slice(0, 60) || undefined;
    for (const entry of entries) {
      const name = baseName(entry.name);
      // El ícono de la bandeja de WhatsApp no es un sticker.
      if (/^tray/i.test(name) || /\.txt$/i.test(name) || name.startsWith('.')) continue;
      const type = detectImageType(entry.bytes.subarray(0, 16));
      const problem = stickerFileError(name, entry.bytes.length, type);
      if (problem || !type) {
        skipped.push(problem ?? name);
        continue;
      }
      files.push(new File([entry.bytes as BlobPart], name, { type }));
    }
  }

  if (files.length > MAX_STICKERS_PER_PACK) {
    skipped.push(
      `Un paquete lleva como máximo ${MAX_STICKERS_PER_PACK} stickers; se dejaron fuera ${files.length - MAX_STICKERS_PER_PACK}.`,
    );
    files.length = MAX_STICKERS_PER_PACK;
  }
  return { files, packName, skipped };
}
