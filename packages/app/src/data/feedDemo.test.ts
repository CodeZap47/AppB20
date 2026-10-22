import { describe, expect, it } from 'vitest';
import { buildNews, ownFeedNews } from '../lib/whatsNew';
import { createDemoState, DemoDataSource } from './demo';

describe('feed en modo demo', () => {
  it('arranca con publicaciones, comentarios y reacciones de ejemplo', () => {
    const snapshot = new DemoDataSource(createDemoState(), 'demo-1').getSnapshot();
    expect(snapshot.feedPosts.length).toBeGreaterThan(0);
    expect(snapshot.feedComments.length).toBeGreaterThan(0);
    expect(snapshot.feedReactions.some((r) => r.targetKind === 'note')).toBe(true);
  });

  it('reacciona una vez por persona: cambiar reemplaza y repetir quita', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-2');
    const target = { targetKind: 'post' as const, targetId: 'fp1' };
    const mine = () => source.getSnapshot().feedReactions.filter((r) => r.targetId === 'fp1' && r.memberId === 'demo-2');
    source.toggleFeedReaction({ ...target, emoji: '👍' });
    source.toggleFeedReaction({ ...target, emoji: '😂' });
    expect(mine().map((r) => r.emoji)).toEqual(['😂']);
    source.toggleFeedReaction({ ...target, emoji: '😂' });
    expect(mine()).toEqual([]);
    expect(() => source.toggleFeedReaction({ targetKind: 'note', targetId: 'no-existe', emoji: '👍' })).toThrow('disponible');
  });

  it('publica sin duplicar al reintentar y aparece como novedad para los demás', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-5');
    source.createFeedPost({ text: 'Hola grupo', requestId: 'r1' });
    source.createFeedPost({ text: 'Hola grupo', requestId: 'r1' });
    const posts = source.getSnapshot().feedPosts.filter((p) => p.authorId === 'demo-5');
    expect(posts).toHaveLength(1);
    expect(ownFeedNews(source.getSnapshot()).filter((n) => n.kind === 'publicacion').map((n) => n.preview)).toEqual(['Hola grupo']);
    expect(buildNews(source.getSnapshot()).some((n) => n.target?.id === posts[0]!.id)).toBe(false);
    source.setViewer('demo-3');
    const item = buildNews(source.getSnapshot()).find((n) => n.target?.id === posts[0]!.id);
    expect(item).toMatchObject({ kind: 'publicacion', actorId: 'demo-5', preview: 'Hola grupo' });
  });

  it('solo el autor edita; el autor o un administrador elimina, con comentarios y reacciones', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-3');
    expect(() => source.editFeedPost({ postId: 'fp2', text: 'Cambio' })).toThrow('Solo quien publicó');
    expect(() => source.deleteFeedPost({ postId: 'fp2' })).toThrow('administrador');
    source.commentFeedPost({ postId: 'fp1', text: 'Nos vemos', requestId: 'c1' });
    source.setViewer('demo-1');
    source.deleteFeedPost({ postId: 'fp1' });
    const snapshot = source.getSnapshot();
    expect(snapshot.feedPosts.some((p) => p.id === 'fp1')).toBe(false);
    expect(snapshot.feedComments.some((c) => c.postId === 'fp1')).toBe(false);
    expect(snapshot.feedReactions.some((r) => r.targetId === 'fp1')).toBe(false);
  });
});
