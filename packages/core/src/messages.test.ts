import { describe, expect, it } from 'vitest';
import {
  canDeleteMessage,
  canEditMessage,
  commandNameError,
  detectImageType,
  EDIT_WINDOW_MS,
  isAnimatedWebp,
  isReaction,
  normalizeCommandName,
  stickerFileError,
} from './messages';

const sentAt = new Date(2026, 9, 8, 12, 0);
const message = { senderId: 'a', sentAt };

describe('editar y eliminar mensajes', () => {
  it('solo quien lo envió lo edita, y solo durante 15 minutos', () => {
    expect(canEditMessage('a', message, new Date(sentAt.getTime() + EDIT_WINDOW_MS))).toBe(true);
    expect(canEditMessage('a', message, new Date(sentAt.getTime() + EDIT_WINDOW_MS + 1))).toBe(
      false,
    );
    expect(canEditMessage('b', message, sentAt)).toBe(false);
    expect(canEditMessage('a', { ...message, deletedAt: sentAt }, sentAt)).toBe(false);
  });

  it('en un 1 a 1 solo quien lo envió lo elimina; en el grupo también un administrador', () => {
    expect(canDeleteMessage('a', message, 'direct', false)).toBe(true);
    expect(canDeleteMessage('b', message, 'direct', true)).toBe(false);
    expect(canDeleteMessage('b', message, 'group', false)).toBe(false);
    expect(canDeleteMessage('b', message, 'group', true)).toBe(true);
    expect(canDeleteMessage('a', { ...message, deletedAt: sentAt }, 'group', true)).toBe(false);
  });

  it('acepta solo las reacciones de la lista', () => {
    expect(isReaction('👍')).toBe(true);
    expect(isReaction('🍕')).toBe(false);
  });
});

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

describe('stickers', () => {
  it('reconoce la imagen por sus bytes, no por el nombre', () => {
    expect(detectImageType(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('image/webp');
    expect(detectImageType(bytes([0x89], 'PNG', [13, 10, 26, 10]))).toBe('image/png');
    expect(detectImageType(bytes('GIF89a'))).toBe('image/gif');
    expect(detectImageType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeUndefined();
  });

  it('detecta un WebP animado', () => {
    expect(
      isAnimatedWebp(
        bytes(
          'RIFF',
          [0, 0, 0, 0],
          'WEBPVP8X',
          [10, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          'ANIM',
        ),
      ),
    ).toBe(true);
    expect(isAnimatedWebp(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ', [0, 0, 0, 0]))).toBe(false);
  });

  it('rechaza lo que no es imagen o pesa más de 1 MB', () => {
    expect(stickerFileError('a.webp', 80_000, 'image/webp')).toBeUndefined();
    expect(stickerFileError('a.svg', 100, undefined)).toContain('no es una imagen');
    expect(stickerFileError('a.webp', 2 * 1024 * 1024, 'image/webp')).toContain('1 MB');
    expect(stickerFileError('a.webp', 0, 'image/webp')).toContain('vacío');
  });
});

describe('comandos propios', () => {
  it('normaliza el nombre', () => {
    expect(normalizeCommandName(' /Saludó ')).toBe('saludo');
  });

  it('no permite espacios, nombres de la app ni repetidos', () => {
    expect(commandNameError('saludo')).toBeUndefined();
    expect(commandNameError('')).toContain('Escribe');
    expect(commandNameError('hola mundo')).toContain('sin espacios');
    expect(commandNameError('tarea')).toContain('ya es un comando');
    expect(commandNameError('saludo', ['saludo'])).toContain('Ya tienes');
  });
});
