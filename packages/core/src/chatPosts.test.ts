import { describe, expect, it } from 'vitest';
import { CHAT_POST_KINDS, chatPostReferencesIn, cleanChatPostRef, decodeChatPostRef, encodeChatPostRef, formatChatPostReference } from './chatPosts';
describe('referencias de publicaciones para chat', () => {
  it('codifica todos los tipos y conserva identificadores largos compuestos', () => {
    const target = { kind: 'ranking' as const, id: `parcial:123|${'a'.repeat(64)}|1234567890` };
    expect(decodeChatPostRef(encodeChatPostRef(target))).toEqual(target);
    for (const kind of CHAT_POST_KINDS) expect(decodeChatPostRef(encodeChatPostRef({ kind, id: 'demo-1' }))).toEqual({ kind, id: 'demo-1' });
    expect(chatPostReferencesIn(`Texto ${formatChatPostReference(target)} ${formatChatPostReference(target)}`)).toEqual([target]);
  });
  it('rechaza versiones desconocidas, URLs, secuencias dañadas y referencias inválidas', () => {
    for (const value of ['', 'abcde', '_', 'a'.repeat(2000), 'eyJ2IjoyLCJraW5kIjoibm90ZSIsImlkIjoiMSJ9']) expect(decodeChatPostRef(value)).toBeUndefined();
    expect(() => cleanChatPostRef({ kind: 'note', id: 'https://evil.example' })).toThrow();
    expect(() => cleanChatPostRef({ kind: 'note', id: '1', path: '//evil.example' }, true)).not.toThrow();
    expect(cleanChatPostRef({ kind: 'note', id: '1', path: '//evil.example' }, true)).toEqual({ kind: 'note', id: '1' });
    expect(() => cleanChatPostRef({ kind: 'note', id: 'demo' }, true)).toThrow();
  });
});
