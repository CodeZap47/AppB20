import { describe, expect, it, vi } from 'vitest';
import { createChatPostActions } from './chatPostActions';

const target = { kind: 'answer', id: '27' } as const;
const preview = { target, available: true, title: 'Respuesta', description: 'Texto público', kindLabel: 'Respuesta', path: '/m/preguntas/3?respuesta=27' };
describe('catálogo interno de publicaciones', () => {
  it('resuelve y busca por la conexión autenticada sin crear enlaces públicos', async () => {
    const chatPostAction = vi.fn().mockResolvedValue(JSON.stringify([preview]));
    const source = createChatPostActions(() => ({ procedures: { chatPostAction } }));
    expect(await source.resolveChatPosts([target])).toEqual([preview]);
    await source.searchChatPosts('funciones', 'answer');
    expect(chatPostAction.mock.calls.map(([args]) => JSON.parse(args.payload))).toEqual([
      { action: 'resolve', targets: [target] }, { action: 'search', query: 'funciones', kind: 'answer' },
    ]);
  });
  it('no conserva metadatos inaccesibles y verifica la identidad de cada resultado', async () => {
    const chatPostAction = vi.fn().mockResolvedValueOnce(JSON.stringify([{ ...preview, available: false }]))
      .mockResolvedValueOnce(JSON.stringify([{ ...preview, target: { kind: 'note', id: '99' } }]));
    const source = createChatPostActions(() => ({ procedures: { chatPostAction } }));
    expect(await source.resolveChatPosts([target])).toEqual([{ target, available: false }]);
    await expect(source.resolveChatPosts([target])).rejects.toThrow('no coincide');
  });
  it.each(['https://evil.test', '//evil.test/m/notas/1', '/m/\\evil', '/m/notas/1\n'])('rechaza rutas externas o dañadas %s', async path => {
    const source = createChatPostActions(() => ({ procedures: { chatPostAction: async () => JSON.stringify([{ ...preview, path }]) } }));
    await expect(source.resolveChatPosts([target])).rejects.toThrow('incompleta');
  });
});
