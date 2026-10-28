import { describe, expect, it } from 'vitest';
import { cleanFeedResource, feedPreviewText } from './feedInteractions';

describe('Referencias y metadata de feed', () => {
  it('acepta referencias canónicas con tipos de id propios', () => {
    expect(cleanFeedResource({ kind: 'note', id: '18446744073709551615' })).toEqual({ kind: 'note', id: '18446744073709551615' });
    expect(cleanFeedResource({ kind: 'exam', id: '11111111-1111-4111-8111-111111111111' }).kind).toBe('exam');
    expect(cleanFeedResource({ kind: 'ranking', id: `parcial:1:2:2026-10-01|${'a'.repeat(64)}|1790000000000` }).kind).toBe('ranking');
  });
  it('rechaza tipos privados, ids ambiguos, rutas y números fuera de u64', () => {
    for (const value of [{ kind: 'dm', id: '1' }, { kind: 'note', id: '01' }, { kind: 'note', id: '0' }, { kind: 'note', id: '18446744073709551616' },
      { kind: 'exam', id: '../private' }, { kind: 'post', id: '1?private=true' }, { kind: 'ranking', id: 'fake' }, null]) expect(() => cleanFeedResource(value)).toThrow();
  });
  it('el extracto es texto acotado sin HTML, enlaces, código ni referencias a adjuntos', () => {
    const source = '# Tema\n<img src="https://private.test/file">![foto](resource:file-id)\n[Leer](https://private.test) ```secret code``` (attachment:file-id) resource:another-id';
    expect(feedPreviewText(source, 200)).toBe('Tema foto Leer');
    expect(feedPreviewText('x'.repeat(200), 80)).toHaveLength(80);
    expect(feedPreviewText(undefined, 100)).toBe('');
  });
});
