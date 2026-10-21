import { describe, expect, it } from 'vitest';
import { cleanFeedComment, cleanFeedPost, cleanFeedReaction, FEED_LIMITS, feedReactionKey } from './feed';

describe('feed', () => {
  it('acepta solo reacciones y destinos de la lista', () => {
    expect(cleanFeedReaction('note', '🎉')).toEqual({ kind: 'note', emoji: '🎉' });
    expect(() => cleanFeedReaction('member', '🎉')).toThrow('No se puede reaccionar');
    expect(() => cleanFeedReaction('note', '💩')).toThrow('no está disponible');
  });

  it('limpia publicaciones y comentarios con sus límites', () => {
    expect(cleanFeedPost('  Hola\r\ngrupo  ')).toBe('Hola\ngrupo');
    expect(() => cleanFeedPost('   ')).toThrow('vacío');
    expect(() => cleanFeedPost('a'.repeat(FEED_LIMITS.post + 1))).toThrow(String(FEED_LIMITS.post));
    expect(() => cleanFeedComment('a'.repeat(FEED_LIMITS.comment + 1))).toThrow(String(FEED_LIMITS.comment));
  });

  it('usa una clave por persona y contenido', () => {
    expect(feedReactionKey('post', '7', 'abc')).toBe('post:7:abc');
  });
});
