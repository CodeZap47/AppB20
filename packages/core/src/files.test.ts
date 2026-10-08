import { describe, expect, it } from 'vitest';
import { fileSizeError, formatBytes, MAX_FILE_BYTES } from './files';

describe('límite de archivos', () => {
  it('es de 50 MB', () => {
    expect(MAX_FILE_BYTES).toBe(52_428_800);
  });

  it('acepta hasta el límite exacto y rechaza lo que lo pasa', () => {
    expect(fileSizeError('a.pdf', 1)).toBeUndefined();
    expect(fileSizeError('a.pdf', MAX_FILE_BYTES)).toBeUndefined();
    expect(fileSizeError('a.pdf', MAX_FILE_BYTES + 1)).toBe(
      '«a.pdf» pesa más de 50 MB y el límite es de 50 MB por archivo.',
    );
    expect(fileSizeError('video.mp4', 82 * 1024 * 1024)).toBe(
      '«video.mp4» pesa 82 MB y el límite es de 50 MB por archivo.',
    );
  });

  it('rechaza archivos vacíos', () => {
    expect(fileSizeError('vacio.txt', 0)).toBe('«vacio.txt» está vacío.');
  });
});

describe('formatBytes', () => {
  it('elige la unidad según el tamaño', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(840 * 1024)).toBe('840 KB');
    expect(formatBytes(12.44 * 1024 * 1024)).toBe('12.4 MB');
    expect(formatBytes(MAX_FILE_BYTES)).toBe('50 MB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
  });
});
