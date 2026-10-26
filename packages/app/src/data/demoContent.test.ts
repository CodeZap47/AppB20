import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import type { ModerateContentInput } from './membershipTypes';
import { contentImpactSignature } from './membershipTypes';
import type { WithdrawableKind } from './delivery2Types';

let now: Date, source: DemoDataSource;
beforeEach(() => { now = new Date('2026-10-24T12:00:00Z'); source = new DemoDataSource(createDemoState(now), 'demo-2', () => now); });
afterEach(() => source.dispose());
const decision = (kind: WithdrawableKind, targetId: string, expectedVersion: number, other: Partial<ModerateContentInput> = {}): ModerateContentInput => {
  const entry = source.getSnapshot().adminContentEntries?.find((row) => row.kind === kind && row.targetId === targetId);
  return { operationId: `review-${kind}-${targetId}-${expectedVersion}`, kind, targetId, expectedVersion, withdrawn: true, reason: 'Moderación revisada', acknowledgeImpact: false,
    expectedImpact: entry ? contentImpactSignature(entry) : undefined, ...other };
};

describe('administración de aportes en la simulación', () => {
  it('conserva publicaciones y comentarios después de dar de baja al autor', () => {
    source.setViewer('demo-1'); const before = source.getSnapshot();
    const post = before.feedPosts[0]!;
    source.removeMember(post.authorId);
    expect(source.getSnapshot().feedPosts.find((row) => row.id === post.id)?.text).toBe(post.text);
    expect(source.getSnapshot().feedComments.filter((row) => row.postId === post.id)).toHaveLength(before.feedComments.filter((row) => row.postId === post.id).length);
  });

  it('no enumera notas personales ni mensajes directos y registra fallos por elemento sin repetir retiradas', () => {
    const subjectId = source.getSnapshot().subjects[0]!.id;
    const privateNote = source.saveNote({ subjectId, title: 'Privado', body: 'Texto privado', topic: '', tags: [], source: 'student', visibility: 'personal' });
    const conversation = source.openDirectConversation('demo-3'); const direct = source.sendDirectMessage(conversation, 'Privado también');
    source.setViewer('demo-1');
    expect(source.getSnapshot().adminContentEntries?.some((row) => row.targetId === privateNote || row.targetId === direct)).toBe(false);
    const post = source.getSnapshot().adminContentEntries!.find((row) => row.kind === 'feed_post' && row.foreignDependencies > 0)!;
    const input = decision(post.kind, post.targetId, post.version);
    expect(() => source.moderateContentItem(input)).toThrow('impacto');
    expect(source.getSnapshot().adminContentResults?.at(-1)).toMatchObject({ status: 'failed' });
    const reviewed = { ...input, operationId: 'acknowledged', acknowledgeImpact: true };
    source.moderateContentItem(reviewed); source.moderateContentItem(reviewed);
    expect(source.getSnapshot().trashEntries.filter((row) => row.kind === post.kind && row.targetId === post.targetId)).toHaveLength(1);
    expect(source.getSnapshot().adminContentResults?.filter((row) => row.operationId === 'acknowledged')).toHaveLength(1);
    expect(() => source.moderateContentItem({ ...reviewed, reason: 'Una nueva decisión' })).toThrow('otra decisión');
    source.setViewer('demo-2'); expect(source.getSnapshot().adminContentEntries).toBeUndefined();
  });

  it('restaurar el feed respeta comentarios moderados y eliminados por separado', () => {
    source.setViewer('demo-1'); const snapshot = source.getSnapshot();
    const post = snapshot.feedPosts.find((row) => snapshot.feedComments.filter((comment) => comment.postId === row.id).length >= 2)!;
    const comments = snapshot.feedComments.filter((row) => row.postId === post.id);
    source.moderateContentItem(decision('feed_comment', comments[0]!.id, 1));
    source.deleteFeedComment({ commentId: comments[1]!.id });
    source.moderateContentItem(decision('feed_post', post.id, 1, { acknowledgeImpact: true }));
    expect(source.getSnapshot().feedPosts.some((row) => row.id === post.id)).toBe(false);
    expect(() => source.commentFeedPost({ postId: post.id, text: 'Nuevo', requestId: 'after-withdraw' })).toThrow('disponible');
    source.moderateContentItem(decision('feed_post', post.id, 2, { withdrawn: false }));
    expect(source.getSnapshot().feedPosts.some((row) => row.id === post.id)).toBe(true);
    expect(source.getSnapshot().feedComments.some((row) => comments.some((comment) => comment.id === row.id))).toBe(false);
    expect(source.getSnapshot().adminContentEntries?.some((row) => row.kind === 'feed_comment' && row.targetId === comments[1]!.id)).toBe(false);
  });

  it.each(['group', 'channel'] as const)('retira, restaura y purga un mensaje %s con sus archivos sin perder respuestas', async (scope) => {
    const channelId = scope === 'channel' ? source.createChatChannel({ name: 'Moderación', kind: 'topic' }) as string : '';
    const id = scope === 'group' ? source.sendGroupMessage('Contenido grupal a moderar') : source.sendChannelMessage(channelId, 'Contenido grupal a moderar');
    const kind = `${scope}_message` as WithdrawableKind;
    const fileId = await source.attachResourceFile(kind as 'group_message' | 'channel_message', id, new File(['bytes'], 'prueba.txt'), 1);
    source.setViewer('demo-3'); const reply = scope === 'group' ? source.sendGroupMessage('Respuesta conservada', id) : source.sendChannelMessage(channelId, 'Respuesta conservada', id);
    source.setViewer('demo-1'); const entry = source.getSnapshot().adminContentEntries!.find((row) => row.kind === kind && row.targetId === id)!;
    source.moderateContentItem(decision(kind, id, entry.version, { acknowledgeImpact: true }));
    const messages = () => scope === 'group' ? source.getSnapshot().groupMessages : source.getSnapshot().channelMessages;
    expect(messages().find((row) => row.id === id)).toMatchObject({ text: '', deletedAt: now });
    await expect(source.downloadResourceFile(fileId)).rejects.toThrow();
    source.setViewer('demo-2');
    expect(() => source.editMessage(scope, id, 'Evitar retirada')).toThrow('retirado');
    expect(() => source.toggleReaction(scope, id, '👍')).toThrow('retirado');
    source.setViewer('demo-1'); source.moderateContentItem(decision(kind, id, 3, { withdrawn: false }));
    expect(messages().find((row) => row.id === id)?.text).toBe('Contenido grupal a moderar');
    expect(await (await source.downloadResourceFile(fileId)).text()).toBe('bytes');
    source.moderateContentItem(decision(kind, id, 4, { acknowledgeImpact: true }));
    now = new Date(now.getTime() + 30 * 86_400_000); await source.getTrashClock();
    expect(messages().find((row) => row.id === id)).toMatchObject({ text: '', deletedAt: now });
    expect(messages().find((row) => row.id === reply)).toMatchObject({ text: 'Respuesta conservada', replyToId: id });
    await expect(source.downloadResourceFile(fileId)).rejects.toThrow();
    expect(source.getSnapshot().adminContentEntries?.some((row) => row.targetId === id)).toBe(false);
  });

  it('mantiene evidencia reportada con autorización independiente y cierra descargas ajenas', async () => {
    const id = source.sendGroupMessage('Mensaje reportado');
    const fileId = await source.attachResourceFile('group_message', id, new File(['evidencia'], 'reporte.txt'), 1);
    source.setViewer('demo-3'); const reportId = source.reportMessage({ scope: 'group', messageId: id, reason: 'Revisar', shareText: true, attachmentIds: [fileId] });
    source.setViewer('demo-1'); const entry = source.getSnapshot().adminContentEntries!.find((row) => row.kind === 'group_message' && row.targetId === id)!;
    expect(entry.reportReferences).toBeGreaterThan(0);
    source.moderateContentItem(decision('group_message', id, 2, { acknowledgeImpact: true }));
    expect(await (await source.downloadResourceFile(fileId)).text()).toBe('evidencia');
    source.setViewer('demo-4'); await expect(source.downloadResourceFile(fileId)).rejects.toThrow();
    source.setViewer('demo-1'); now = new Date(now.getTime() + 30 * 86_400_000); await source.getTrashClock();
    expect(source.getSnapshot().messageReports.find((row) => row.id === reportId)?.evidenceText).toBe('Mensaje reportado');
    expect(await (await source.downloadResourceFile(fileId)).text()).toBe('evidencia');
  });
});
