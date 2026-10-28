import { describe, expect, it, vi } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import { formatChatPostReference } from '@b20/core';

describe('publicaciones compartidas de la demo', () => {
  it('resuelve IDs sintéticos, conserva destinos exactos y no crea enlaces externos', async () => {
    const state = createDemoState(); const source = new DemoDataSource(state, 'demo-1');
    try {
      const data = source.getSnapshot(); const answer = data.answers[0]!;
      const external = vi.spyOn(source, 'createFeedShare');
      const target = { kind: 'answer', id: answer.id } as const;
      expect(formatChatPostReference(target)).toContain('[[recurso:');
      expect(await source.resolveChatPosts([target])).toMatchObject([{ available: true, path: `/m/preguntas/${answer.questionId}?respuesta=${answer.id}` }]);
      expect((await source.searchChatPosts('', 'assignment')).length).toBeGreaterThan(0);
      expect(external).not.toHaveBeenCalled();
    } finally { source.dispose(); }
  });
  it('un recurso privado o eliminado no expone sus metadatos ni al autor', async () => {
    const state = createDemoState(); const source = new DemoDataSource(state, 'demo-1');
    try {
      const target = { kind: 'note', id: 'n2' } as const;
      expect(await source.resolveChatPosts([target])).toEqual([{ target, available: false }]);
      expect((await source.searchChatPosts('', 'note')).every(row => row.target.id !== target.id)).toBe(true);
      const missing = { kind: 'post', id: 'no-existe' } as const;
      expect(await source.resolveChatPosts([missing])).toEqual([{ target: missing, available: false }]);
    } finally { source.dispose(); }
  });
});
