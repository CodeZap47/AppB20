import { describe, expect, it } from 'vitest';
import type { FeedResourceRef } from '@b20/core';
import { createDemoState, DemoDataSource } from './demo';
import { feedThreadCommentCount } from './feedInteractionTypes';

describe('conversaciones y enlaces de recursos en demo', () => {
  it('comparte el hilo general entre sesiones y reintenta sin duplicar ni crear posts', async () => {
    const state = createDemoState(); const a = new DemoDataSource(state, 'demo-1'); const b = new DemoDataSource(state, 'demo-2');
    const target = { kind: 'assignment', id: state.assignments[0]!.id } as const;
    const postCount = a.getSnapshot().feedPosts.length;
    await Promise.all([a.addFeedThreadComment(target, 'Una duda del grupo', 'same'), a.addFeedThreadComment(target, 'Una duda del grupo', 'same')]);
    expect((await b.readFeedThread(target)).comments.map((r) => r.text)).toEqual(['Una duda del grupo']);
    expect(a.getSnapshot().feedPosts).toHaveLength(postCount);
    await expect(a.addFeedThreadComment(target, 'Otro contenido', 'same')).rejects.toThrow('otro comentario');
    await expect(a.addFeedThreadComment(target, 'x'.repeat(2001), 'long')).rejects.toThrow('2000');
    a.dispose(); b.dispose();
  });

  it('usa los comentarios canónicos de notas en ambas direcciones y al eliminar', async () => {
    const state = createDemoState(); const a = new DemoDataSource(state, 'demo-1'); const b = new DemoDataSource(state, 'demo-2');
    const note = a.getSnapshot().notes.find((r) => r.visibility === 'group' && !r.withdrawnAt)!;
    const target = { kind: 'note', id: note.id } as const;
    a.commentNote(note.id, 'Desde el módulo');
    const native = (await b.readFeedThread(target)).comments.find((r) => r.text === 'Desde el módulo')!;
    expect(native).toBeDefined();
    await Promise.all([a.addFeedThreadComment(target, 'Desde el feed', 'n1'), a.addFeedThreadComment(target, 'Desde el feed', 'n1')]);
    expect(b.getSnapshot().noteComments.filter((r) => r.text === 'Desde el feed')).toHaveLength(1);
    await a.deleteFeedThreadComment(target, native.id);
    expect(b.getSnapshot().noteComments.some((r) => r.id === native.id)).toBe(false);
    expect(feedThreadCommentCount(target, a.getSnapshot())).toBe((await a.readFeedThread(target)).comments.length);
    a.dispose(); b.dispose();
  });

  it('conecta comentarios de preguntas, respuestas, trabajos, evidencias y posts', async () => {
    const state = createDemoState(); state.works.forEach((row) => { row.status = 'final'; });
    const source = new DemoDataSource(state, 'demo-1'); const data = source.getSnapshot();
    const targets: FeedResourceRef[] = [
      { kind: 'post', id: data.feedPosts[0]!.id }, { kind: 'question', id: data.questions[0]!.id },
      { kind: 'answer', id: data.answers[0]!.id }, { kind: 'work', id: data.works.find((r) => r.status !== 'draft' && !r.withdrawnAt)!.id },
      { kind: 'evidence', id: data.evidences.find((r) => !r.withdrawnAt)!.id },
    ];
    for (const target of targets) {
      const text = `Comentario ${target.kind}`;
      const thread = await source.addFeedThreadComment(target, text, target.kind);
      const comment = thread.comments.find((r) => r.text === text)!;
      expect(comment).toBeDefined();
      expect(feedThreadCommentCount(target, source.getSnapshot())).toBe(thread.comments.length);
      await source.deleteFeedThreadComment(target, comment.id);
      expect((await source.readFeedThread(target)).comments.some((r) => r.id === comment.id)).toBe(false);
    }
    source.dispose();
  });

  it('mantiene separados los hilos de reto y solución y bloquea nuevos comentarios al cerrar', async () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1'); const subjectId = source.getSnapshot().subjects[0]!.id;
    const id = source.createCodingChallenge({ subjectId, title: 'Acumular', topic: 'Ciclos', difficulty: 'basic', objective: 'Sumar', instructions: 'Acumula elementos', examples: '[1,2] => 3', hints: [], requestId: 'c' });
    source.saveChallengeSolution({ challengeId: id, body: 'sum()', explanation: 'Acumular elementos', expectedVersion: 0, requestId: 's' });
    const solution = source.getSnapshot().challengeSolutions.find((r) => r.challengeId === id)!;
    await source.addFeedThreadComment({ kind: 'challenge', id }, 'Duda del reto', 'a');
    await source.addFeedThreadComment({ kind: 'solution', id: solution.id }, 'Sobre la solución', 'b');
    expect((await source.readFeedThread({ kind: 'challenge', id })).comments.map((r) => r.text)).toEqual(['Duda del reto']);
    expect((await source.readFeedThread({ kind: 'solution', id: solution.id })).comments.map((r) => r.text)).toEqual(['Sobre la solución']);
    source.closeCodingChallenge(id, 'Aprendimos a acumular', 1);
    expect((await source.readFeedThread({ kind: 'solution', id: solution.id })).canComment).toBe(false);
    await expect(source.addFeedThreadComment({ kind: 'challenge', id }, 'Tarde', 'late')).rejects.toThrow('cerrada');
    source.dispose();
  });

  it('rechaza notas privadas, contenido retirado, desconocidos y sesiones dadas de baja', async () => {
    const state = createDemoState(); const source = new DemoDataSource(state, 'demo-1');
    const group = source.getSnapshot().notes.find((r) => r.visibility === 'group')!;
    state.notes.push({ ...group, id: 'private', authorId: 'demo-1', visibility: 'personal' });
    source.setViewer('demo-1');
    await expect(source.readFeedThread({ kind: 'note', id: 'private' })).rejects.toThrow('disponible');
    await expect(source.createFeedShare({ kind: 'note', id: 'private' })).rejects.toThrow('disponible');
    source.withdrawContent('note', group.id, true, group.version, 'Revisión del contenido', true);
    await expect(source.readFeedThread({ kind: 'note', id: group.id })).rejects.toThrow('disponible');
    await expect(source.readFeedThread({ kind: 'guide', id: 'unknown' })).rejects.toThrow('disponible');
    state.members.find((r) => r.id === 'demo-1')!.status = 'removed';
    await expect(source.readFeedThread({ kind: 'assignment', id: state.assignments[0]!.id })).rejects.toThrow();
    source.dispose();
  });

  it('solo el comentario, autor del recurso o administrador pueden borrar', async () => {
    const state = createDemoState(); state.assignments[0]!.createdBy = 'demo-2';
    const source = new DemoDataSource(state, 'demo-3'); const target = { kind: 'assignment', id: state.assignments[0]!.id } as const;
    const added = await source.addFeedThreadComment(target, 'Mi comentario', 'one'); const comment = added.comments[0]!;
    source.setViewer('demo-4'); expect((await source.readFeedThread(target)).comments[0]!.canDelete).toBe(false);
    await expect(source.deleteFeedThreadComment(target, comment.id)).rejects.toThrow('No puedes');
    source.setViewer('demo-2'); await source.deleteFeedThreadComment(target, comment.id);
    expect((await source.readFeedThread(target)).comments).toEqual([]); source.dispose();
  });

  it('separa conversación general de observaciones de código y mensajes de salas', async () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1'); const subjectId = source.getSnapshot().subjects[0]!.id;
    const reviewId = source.createCodeReview({ subjectId, title: 'Revisar un ciclo', language: 'js', code: 'for (;;) {}', repositoryUrl: '', summary: 'Busco nombres claros', requestId: 'review' });
    source.addCodeReviewComment({ reviewId, versionNumber: 1, lineStart: 0, lineEnd: 0, kind: 'suggestion', body: 'Observación estructurada', requestId: 'observation' });
    const observation = source.getSnapshot().codeReviewComments.find((r) => r.reviewId === reviewId)!;
    await source.addFeedThreadComment({kind: 'review', id: reviewId}, 'Conversación de la revisión', 'general-review');
    await source.addFeedThreadComment({kind: 'review-comment', id: observation.id}, 'Conversación de la observación', 'general-observation');
    expect(source.getSnapshot().codeReviewComments.filter((r) => r.reviewId === reviewId).map((r) => r.body)).toEqual(['Observación estructurada']);
    expect((await source.readFeedThread({kind: 'review', id: reviewId})).comments.map((r) => r.text)).toEqual(['Conversación de la revisión']);
    expect((await source.readFeedThread({kind: 'review-comment', id: observation.id})).comments.map((r) => r.text)).toEqual(['Conversación de la observación']);
    source.closeCodeReview(reviewId, 1);
    expect((await source.readFeedThread({kind: 'review-comment', id: observation.id})).canComment).toBe(false);
    const startsAt = new Date(Date.now() + 3_600_000); const endsAt = new Date(startsAt.getTime() + 3_600_000);
    const roomId = source.createStudyRoom({ title: 'Sala de repaso', topic: 'Ciclos', objective: 'Compartir dudas', subjectId, visibility: 'group', startsAt, endsAt, requestId: 'room' });
    const entries = source.getSnapshot().roomEntries.length;
    await source.addFeedThreadComment({kind: 'room', id: roomId}, 'Conversación pública', 'room-comment');
    expect(source.getSnapshot().roomEntries).toHaveLength(entries);
    source.setStudyRoomStatus(roomId, 'active', 1);
    source.setStudyRoomStatus(roomId, 'completed', 2);
    expect((await source.readFeedThread({kind: 'room', id: roomId})).canComment).toBe(false);
    source.dispose();
  });

  it('acota metadatos y elimina código, enlaces y referencias de archivos en previews', async () => {
    const state = createDemoState(); state.assignments[0]!.title = 'T'.repeat(200); state.assignments[0]!.instructions = '```secret()``` ![Privado](resource:8) https://privado.invalid ' + 'Contenido '.repeat(100);
    const source = new DemoDataSource(state, 'demo-1'); const result = await source.createFeedShare({ kind: 'assignment', id: state.assignments[0]!.id });
    expect(result.preview.title).toHaveLength(200); expect(result.preview.description.length).toBeLessThanOrEqual(160);
    expect(result.preview.description).not.toMatch(/secret|resource:|https:/); source.dispose();
  });

  it('genera solo enlaces locales de prueba y permite listar y revocar entre sesiones', async () => {
    const state = createDemoState(); const a = new DemoDataSource(state, 'demo-3'); const b = new DemoDataSource(state, 'demo-4');
    const target = { kind: 'assignment', id: state.assignments[0]!.id } as const;
    const result = await a.createFeedShare(target);
    expect(result.url).toBe(`#${result.preview.path}`); expect(result.url).not.toContain('api.b20.mx');
    expect(result.preview.title).toBe(state.assignments[0]!.title);
    expect((await b.listFeedShares(target)).find((r) => r.id === result.id)).toMatchObject({ active: true, canRevoke: false });
    await expect(b.revokeFeedShare(result.id)).rejects.toThrow('No puedes');
    await a.revokeFeedShare(result.id);
    expect((await b.listFeedShares(target)).find((r) => r.id === result.id)?.active).toBe(false);
    a.dispose(); b.dispose();
  });

  it('permite revocar enlaces propios aunque se haya retirado la nota', async () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1'); const note = source.getSnapshot().notes.find((r) => r.visibility === 'group')!;
    const target = { kind: 'note', id: note.id } as const; const created = await source.createFeedShare(target);
    source.withdrawContent('note', note.id, true, note.version, 'Contenido en revisión', true);
    expect((await source.listFeedShares(target)).find((r) => r.id === created.id)?.canRevoke).toBe(true);
    await source.revokeFeedShare(created.id); expect((await source.listFeedShares(target)).find((r) => r.id === created.id)?.active).toBe(false); source.dispose();
  });
});
