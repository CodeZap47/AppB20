import { feedPreviewText, feedResourceKey, leaderChanges, rankingFeedId, type FeedResourceRef, type FeedShareLink, type FeedSharePreview, type FeedShareRecord, type FeedThread, type FeedThreadComment } from '@b20/core';
import type { DataSource, Member, Snapshot } from './types';
import type { FeedInteractionActions } from './feedInteractionTypes';

interface StoredComment { id: string; authorId: string; text: string; createdAt: string }
interface Shared { comments: Map<string, StoredComment[]>; removed: Set<string>; requests: Map<string, string>; shares: FeedShareRecord[] }
const stores = new WeakMap<object, Shared>();
interface Context { state(): object; source(): DataSource; active(): Member; now(): Date; id(): string; emit(): void; available(kind: string, id: string): boolean }
interface Resource { owners: string[]; maxLength: number; canComment: boolean; preview: FeedSharePreview }
const nativeKinds = new Set<FeedResourceRef['kind']>(['post', 'note', 'work', 'evidence', 'question', 'answer', 'challenge', 'solution']);
const managedKind: Partial<Record<FeedResourceRef['kind'], string>> = { post: 'feed_post' };
const unavailable = () => { throw new Error('Este contenido no está disponible para la conversación.'); };

/** La simulación comparte los hilos por estado, sin crear publicaciones paralelas. */
export class DemoFeedInteractionStore implements FeedInteractionActions {
  constructor(private ctx: Context) {}
  private sameActor(actor: Member) { if (this.ctx.active().id !== actor.id) throw new Error('La sesión cambió. Vuelve a abrir la conversación.'); }
  private get shared(): Shared {
    let value = stores.get(this.ctx.state());
    if (!value) { value = { comments: new Map(), removed: new Set(), requests: new Map(), shares: [] }; stores.set(this.ctx.state(), value); }
    return value;
  }
  filterSnapshot(snapshot: Snapshot): Snapshot {
    const hidden = this.shared.removed;
    if (!hidden.size) return snapshot;
    return { ...snapshot,
      noteComments: snapshot.noteComments.filter((row) => !hidden.has(`note:${row.id}`)),
      academicComments: snapshot.academicComments.filter((row) => !hidden.has(`academic:${row.id}`)),
      questionComments: snapshot.questionComments.filter((row) => !hidden.has(`question:${row.id}`)),
      challengeComments: snapshot.challengeComments.filter((row) => !hidden.has(`challenge:${row.id}`)),
    };
  }
  private async resource(target: FeedResourceRef): Promise<Resource> {
    this.ctx.active();
    if (!target.id || !this.ctx.available(managedKind[target.kind] ?? target.kind, target.id)) return unavailable();
    const data = this.ctx.source().getSnapshot();
    const make = (owners: string[], title: string, description: string, path: string, kindLabel: string, subjectId?: string, canComment = true, maxLength = 2000): Resource => ({ owners, maxLength, canComment, preview: {
      title: feedPreviewText(title, 200), description: feedPreviewText(description, 160), path, kindLabel,
      ...(subjectId ? { subject: data.subjects.find((row) => row.id === subjectId)?.name } : {}),
    } });
    switch (target.kind) {
      case 'assignment': { const row = data.assignments.find((r) => r.id === target.id); if (!row) return unavailable(); return make([row.createdBy], row.title, row.instructions, `/m/tareas/${row.id}`, 'Tarea', row.subjectId); }
      case 'activity': { const row = data.activities.find((r) => r.id === target.id); if (!row) return unavailable(); return make([row.createdBy], row.title, row.objective || row.instructions, `/m/actividades/${row.id}`, 'Actividad', row.subjectId); }
      case 'post': { const row = data.feedPosts.find((r) => r.id === target.id); if (!row) return unavailable(); return make([row.authorId], feedPreviewText(row.text, 80) || 'Publicación del grupo', row.text, `/m/inicio?vista=feed&publicacion=${row.id}`, 'Publicación', row.subjectId, true, 500); }
      case 'note': { const row = data.notes.find((r) => r.id === target.id && r.visibility === 'group' && !r.withdrawnAt); if (!row) return unavailable(); return make([row.authorId], row.title, `${row.topic} ${row.body}`, `/m/notas/${row.id}`, 'Nota de clase', row.subjectId, true, 4000); }
      case 'work': { const row = data.works.find((r) => r.id === target.id && !r.withdrawnAt && r.status !== 'draft'); const parent = data.assignments.find((r) => r.id === row?.assignmentId); if (!row || !parent) return unavailable(); return make(row.authorIds, row.title || parent.title, row.description, `/m/tareas/${parent.id}?trabajo=${row.id}`, 'Trabajo', parent.subjectId, true, 2000); }
      case 'evidence': { const row = data.evidences.find((r) => r.id === target.id && !r.withdrawnAt); const parent = data.activities.find((r) => r.id === row?.activityId); if (!row || !parent) return unavailable(); return make([row.authorId], parent.title, row.content, `/m/actividades/${parent.id}?evidencia=${row.id}`, 'Evidencia', parent.subjectId); }
      case 'question': { const row = data.questions.find((r) => r.id === target.id && !r.withdrawnAt); if (!row) return unavailable(); return make([row.authorId], row.title, row.body, `/m/preguntas/${row.id}`, 'Pregunta', row.subjectId); }
      case 'answer': { const row = data.answers.find((r) => r.id === target.id && !r.withdrawnAt); const parent = data.questions.find((r) => r.id === row?.questionId && !r.withdrawnAt); if (!row || !parent) return unavailable(); return make([row.authorId], `Respuesta: ${parent.title}`, row.body, `/m/preguntas/${parent.id}?respuesta=${row.id}`, 'Respuesta', parent.subjectId); }
      case 'guide': { const row = data.guides.find((r) => r.id === target.id && !r.withdrawnAt); if (!row) return unavailable(); return make([row.createdBy], row.title, row.topics.join(' · '), `/m/guias/${row.id}`, 'Guía de estudio', row.subjectId); }
      case 'poll': { const row = data.polls.find((r) => r.id === target.id && !r.cancelledAt); if (!row) return unavailable(); return make([row.createdBy], row.title, row.description, `/m/votaciones/${row.id}`, 'Votación', undefined, row.closesAt > this.ctx.now()); }
      case 'help': { const row = data.helpPosts.find((r) => r.id === target.id && r.status !== 'withdrawn'); if (!row) return unavailable(); return make([row.authorId], row.title, row.description, `/m/ayuda/${row.id}`, 'Ayuda entre compañeros', row.subjectId, row.status === 'open'); }
      case 'spaced': { const row = data.spacedCollections.find((r) => r.id === target.id && r.visibility === 'group' && !r.archived); if (!row) return unavailable(); return make([row.ownerId], row.title, 'Colección de repaso compartida con el grupo.', `/m/repaso/colecciones/${row.id}`, 'Repaso', row.subjectId); }
      case 'challenge': { const row = data.codingChallenges.find((r) => r.id === target.id); if (!row) return unavailable(); return make([row.authorId], row.title, row.objective, `/m/retos/${row.id}`, 'Reto de programación', row.subjectId, !row.closed, 4000); }
      case 'solution': { const row = data.challengeSolutions.find((r) => r.id === target.id); const parent = data.codingChallenges.find((r) => r.id === row?.challengeId); if (!row || !parent) return unavailable(); return make([row.authorId], `Solución: ${parent.title}`, row.explanation, `/m/retos/${parent.id}?solucion=${row.id}`, 'Solución de reto', parent.subjectId, !parent.closed, 4000); }
      case 'review': { const row = data.codeReviews.find((r) => r.id === target.id); if (!row) return unavailable(); const version = data.codeReviewVersions.find((r) => r.reviewId === row.id && r.number === row.currentVersion); return make([row.authorId], row.title, version?.summary || row.language, `/m/revision-codigo/${row.id}`, 'Revisión de código', row.subjectId, !row.closed); }
      case 'review-comment': { const row = data.codeReviewComments.find((r) => r.id === target.id); const parent = data.codeReviews.find((r) => r.id === row?.reviewId); if (!row || !parent) return unavailable(); return make([row.authorId], `Observación: ${parent.title}`, row.body, `/m/revision-codigo/${parent.id}?observacion=${row.id}`, 'Observación de código', parent.subjectId, !parent.closed); }
      case 'opportunity': { const row = data.opportunities.find((r) => r.id === target.id && !r.withdrawn); if (!row) return unavailable(); return make([row.authorId], row.title, row.requirements, `/m/oportunidades?oportunidad=${encodeURIComponent(row.id)}`, 'Oportunidad'); }
      case 'room': { const row = data.studyRooms.find((r) => r.id === target.id && r.visibility === 'group' && r.status !== 'cancelled'); if (!row) return unavailable(); return make([row.organizerId], row.title, row.objective, `/m/salas/${row.id}`, 'Sala de estudio', row.subjectId, row.status !== 'completed'); }
      case 'exam': { const rows = await this.ctx.source().examAction({ action: 'listExams', sharedOnly: true }); const row = rows.find((r) => r.id === target.id && r.visibility === 'group' && !r.archived && r.readyVersion && !r.sourceIssues.some((issue) => issue.state === 'unavailable')); if (!row) return unavailable(); return make([row.ownerId], row.title, row.topics.join(' · '), `/m/examenes/${encodeURIComponent(row.id)}`, 'Examen de estudio', row.subjectId); }
      case 'ranking': { const row = leaderChanges(data, this.ctx.now()).find((r) => rankingFeedId(r) === target.id); if (!row) return unavailable(); return make([row.memberId], `Primer lugar · ${row.periodLabel}`, `${row.points} puntos de aportes al grupo.`, `/m/leaderboard?aviso=${encodeURIComponent(target.id)}`, 'Ranking'); }
      default: return unavailable();
    }
  }
  private native(target: FeedResourceRef, data: Snapshot): StoredComment[] {
    switch (target.kind) {
      case 'post': return data.feedComments.filter((r) => r.postId === target.id).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
      case 'note': return data.noteComments.filter((r) => r.noteId === target.id).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
      case 'work': case 'evidence': return data.academicComments.filter((r) => r.targetKind === target.kind && r.targetId === target.id).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
      case 'question': case 'answer': return data.questionComments.filter((r) => target.kind === 'answer' ? r.answerId === target.id : r.questionId === target.id && !r.answerId).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
      case 'challenge': case 'solution': return data.challengeComments.filter((r) => target.kind === 'solution' ? r.solutionId === target.id : r.challengeId === target.id && !r.solutionId).map((r) => ({ id: r.id, authorId: r.authorId, text: r.body, createdAt: r.createdAt.toISOString() }));
      default: return this.shared.comments.get(feedResourceKey(target)) ?? [];
    }
  }
  async readFeedThread(target: FeedResourceRef): Promise<FeedThread> {
    const actor = this.ctx.active(); const resource = await this.resource(target);
    this.sameActor(actor);
    const comments: FeedThreadComment[] = this.native(target, this.ctx.source().getSnapshot()).map((row) => ({ id: row.id, authorId: row.authorId, text: row.text, createdAt: row.createdAt, canDelete: row.authorId === actor.id || resource.owners.includes(actor.id) || Boolean(actor.isCreator) })).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return { target: { ...target }, comments, canComment: resource.canComment, maxLength: resource.maxLength, ...(!resource.canComment ? { reason: 'Esta conversación está cerrada.' } : {}) };
  }
  async addFeedThreadComment(target: FeedResourceRef, text: string, requestId: string): Promise<FeedThread> {
    const actor = this.ctx.active(); const resource = await this.resource(target); const clean = text.trim();
    this.sameActor(actor);
    if (!clean || clean.length > resource.maxLength) throw new Error(`Escribe un comentario de hasta ${resource.maxLength} caracteres.`);
    if (!requestId.trim() || requestId.length > 128) throw new Error('La solicitud no es válida.');
    const key = `${actor.id}:${requestId}`; const signature = JSON.stringify([target, clean]); const prior = this.shared.requests.get(key);
    if (prior) { if (prior !== signature) throw new Error('La solicitud pertenece a otro comentario.'); return this.readFeedThread(target); }
    if (!resource.canComment) throw new Error('Esta conversación está cerrada.');
    const source = this.ctx.source();
    this.shared.requests.set(key, signature);
    try {
    switch (target.kind) {
      case 'post': await source.commentFeedPost({ postId: target.id, text: clean, requestId }); break;
      case 'note': await source.commentNote(target.id, clean); break;
      case 'work': case 'evidence': await source.commentAcademic(target.kind, target.id, clean); break;
      case 'question': await source.commentQuestion(target.id, clean); break;
      case 'answer': { const row = source.getSnapshot().answers.find((r) => r.id === target.id)!; await source.commentQuestion(row.questionId, clean, row.id); break; }
      case 'challenge': await source.addChallengeComment({ challengeId: target.id, body: clean, requestId }); break;
      case 'solution': { const row = source.getSnapshot().challengeSolutions.find((r) => r.id === target.id)!; await source.addChallengeComment({ challengeId: row.challengeId, solutionId: row.id, body: clean, requestId }); break; }
      default: this.shared.comments.set(feedResourceKey(target), [...this.native(target, source.getSnapshot()), { id: this.ctx.id(), authorId: actor.id, text: clean, createdAt: this.ctx.now().toISOString() }]);
    }
    } catch (cause) { this.shared.requests.delete(key); throw cause; }
    this.ctx.emit(); return this.readFeedThread(target);
  }
  async deleteFeedThreadComment(target: FeedResourceRef, commentId: string): Promise<FeedThread> {
    const actor = this.ctx.active();
    const thread = await this.readFeedThread(target); const comment = thread.comments.find((r) => r.id === commentId);
    this.sameActor(actor);
    if (!comment) return thread;
    if (!comment.canDelete) throw new Error('No puedes eliminar este comentario.');
    if (target.kind === 'post') await this.ctx.source().deleteFeedComment({ commentId });
    else if (nativeKinds.has(target.kind)) this.shared.removed.add(`${target.kind === 'work' || target.kind === 'evidence' ? 'academic' : target.kind === 'answer' ? 'question' : target.kind === 'solution' ? 'challenge' : target.kind}:${commentId}`);
    else this.shared.comments.set(feedResourceKey(target), this.native(target, this.ctx.source().getSnapshot()).filter((row) => row.id !== commentId));
    this.ctx.emit(); return this.readFeedThread(target);
  }
  async createFeedShare(target: FeedResourceRef): Promise<FeedShareLink> {
    const actor = this.ctx.active(); const { preview } = await this.resource(target);
    this.sameActor(actor);
    const id = `demo-${this.ctx.id()}`;
    this.shared.shares.push({ id, target: { ...target }, createdBy: actor.id, createdAt: this.ctx.now().toISOString(), active: true, canRevoke: true });
    this.ctx.emit();
    // En demo el enlace solo abre la ruta local: no simula un token público real.
    return { id, preview, url: `#${preview.path}` };
  }
  async listFeedShares(target: FeedResourceRef): Promise<FeedShareRecord[]> {
    const actor = this.ctx.active(); let resource: Resource | undefined;
    try { resource = await this.resource(target); } catch { /* Los enlaces propios siguen siendo revocables al retirar el recurso. */ }
    this.sameActor(actor);
    return this.shared.shares.filter((r) => feedResourceKey(r.target) === feedResourceKey(target) && (resource || r.createdBy === actor.id || actor.isCreator)).map((r) => ({ ...r, target: { ...r.target }, canRevoke: r.createdBy === actor.id || Boolean(resource?.owners.includes(actor.id)) || Boolean(actor.isCreator) }));
  }
  async revokeFeedShare(id: string): Promise<void> {
    const actor = this.ctx.active(); const row = this.shared.shares.find((r) => r.id === id);
    if (!row) throw new Error('El enlace no está disponible.');
    if (row.createdBy !== actor.id && !actor.isCreator) {
      const resource = await this.resource(row.target);
      this.sameActor(actor);
      if (!resource.owners.includes(actor.id)) throw new Error('No puedes revocar este enlace.');
    }
    row.active = false; this.ctx.emit();
  }
}
