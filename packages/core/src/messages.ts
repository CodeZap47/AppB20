/**
 * Reglas de los mensajes (grupo y 1 a 1): editar, eliminar, reaccionar, stickers y comandos.
 * El módulo de SpacetimeDB repite estas validaciones; aquí sirven a la interfaz y a pruebas.
 */

/** Tiempo para corregir un mensaje después de enviarlo. */
export const EDIT_WINDOW_MS = 15 * 60_000;

/** Reacciones disponibles: un conjunto corto para que se lean igual en todas las pantallas. */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export type Reaction = (typeof REACTIONS)[number];

export function isReaction(value: string): value is Reaction {
  return (REACTIONS as readonly string[]).includes(value);
}

interface MessageLike {
  senderId: string;
  sentAt: Date;
  deletedAt?: Date;
}

/** Solo quien lo envió corrige su mensaje, dentro de los primeros 15 minutos. */
export function canEditMessage(viewerId: string, message: MessageLike, now: Date): boolean {
  return (
    !message.deletedAt &&
    message.senderId === viewerId &&
    now.getTime() - message.sentAt.getTime() <= EDIT_WINDOW_MS
  );
}

/**
 * Quien lo envió lo elimina para todos cuando quiera. En el canal del salón, los
 * administradores también pueden quitar mensajes ajenos; en un 1 a 1 nadie más.
 */
export function canDeleteMessage(
  viewerId: string,
  message: MessageLike,
  scope: 'group' | 'direct',
  viewerIsAdmin: boolean,
): boolean {
  if (message.deletedAt) return false;
  return message.senderId === viewerId || (scope === 'group' && viewerIsAdmin);
}

// ---------------------------------------------------------------------------
// Stickers
// ---------------------------------------------------------------------------

/** WhatsApp limita sus paquetes a 30 stickers; se usa el mismo tope. */
export const MAX_STICKERS_PER_PACK = 30;
/** Un sticker de WhatsApp pesa menos de 100 KB (500 KB si es animado); se deja margen. */
export const MAX_STICKER_BYTES = 1024 * 1024;
export const STICKER_TYPES = ['image/webp', 'image/png', 'image/gif', 'image/jpeg'] as const;
export type StickerType = (typeof STICKER_TYPES)[number];

/**
 * Tipo real de una imagen por sus primeros bytes, sin confiar en la extensión ni en lo que
 * declare el navegador. Devuelve undefined si no es WebP, PNG, GIF ni JPEG.
 */
export function detectImageType(bytes: Uint8Array): StickerType | undefined {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a'))
    return 'image/gif';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  return undefined;
}

/** Un WebP animado lleva el bloque ANIM; sirve para avisar que se moverá. */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 4, 64);
  for (let i = 12; i <= limit; i++) {
    if (
      bytes[i] === 0x41 &&
      bytes[i + 1] === 0x4e &&
      bytes[i + 2] === 0x49 &&
      bytes[i + 3] === 0x4d
    ) {
      return true;
    }
  }
  return false;
}

/** Motivo por el que un archivo no sirve como sticker, o undefined si sirve. */
export function stickerFileError(
  name: string,
  size: number,
  type: StickerType | undefined,
): string | undefined {
  if (!type) return `«${name}» no es una imagen WebP, PNG, GIF o JPEG.`;
  if (size > MAX_STICKER_BYTES) return `«${name}» pesa más de 1 MB, el límite para un sticker.`;
  if (size === 0) return `«${name}» está vacío.`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Comandos con «/»
// ---------------------------------------------------------------------------

/** Nombres reservados por los comandos que ya trae la app. */
export const BUILT_IN_COMMANDS = [
  'tarea',
  'trabajo',
  'clase',
  'nota',
  'pregunta',
  'sticker',
  'codigo',
  'comandos',
] as const;

/** Normaliza el nombre de un comando propio: minúsculas, sin acentos ni espacios. */
export function normalizeCommandName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/^\/+/, '');
}

/** Motivo por el que un nombre no sirve como comando, o undefined si sirve. */
export function commandNameError(name: string, taken: readonly string[] = []): string | undefined {
  if (!name) return 'Escribe un nombre para el comando.';
  if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(name)) {
    return 'Usa de 1 a 24 letras sin acentos, números o guiones, sin espacios.';
  }
  if ((BUILT_IN_COMMANDS as readonly string[]).includes(name))
    return `«/${name}» ya es un comando de la app.`;
  if (taken.includes(name)) return `Ya tienes un comando «/${name}».`;
  return undefined;
}
