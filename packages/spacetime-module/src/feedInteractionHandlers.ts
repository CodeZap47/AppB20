import { SenderError } from 'spacetimedb/server';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Identity, Timestamp } from 'spacetimedb';
import { cleanFeedResource, feedPreviewText, feedResourceKey, type CreatedFeedShare, type FeedResourceRef,
  type FeedSharePreview, type FeedShareRecord, type FeedThread, type FeedThreadComment } from '../../core/src/feedInteractions';
import type { AiPreparation } from '../../core/src/ai';
import { activeMember, isActive, log, type Ctx } from './moduleContext';
import { memberIdentityFor } from './authIdentity';
import { withdrawn } from './delivery2Handlers';
import { retentionBlocksRead } from './trashHandlers';
import { verifiedRanking } from './feedRankingAdapter';
import { deleteFeedComment } from './feedHandlers';
import { invalidateFeedShares } from './feedInteractionLifecycle';

const unavailable = () => new SenderError('Ese contenido ya no está disponible.');
const invalid = () => new SenderError('Datos de interacción no válidos.');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function payload(value: string) { if (value.length > 20_000) throw invalid(); try { return record(JSON.parse(value)); } catch { throw invalid(); } }
function ref(value: unknown) { try { return cleanFeedResource(value); } catch { throw invalid(); } }
function numeric(value: unknown): bigint { if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value) || BigInt(value) > 18446744073709551615n) throw invalid(); return BigInt(value); }
function text(value: unknown, max: number) { if (typeof value !== 'string') throw invalid(); const result = value.replace(/\r\n?/g, '\n').trim(); if (!result || result.length > max) throw new SenderError(`El comentario debe tener entre 1 y ${max} caracteres.`); return result; }
function request(value: unknown) { if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\u0000-\u001f]/.test(value)) throw invalid(); return value; }
const iso = (at: Timestamp) => at.toDate().toISOString();
const hash = (value: string) => Array.from(sha256(new TextEncoder().encode(value)), (byte) => byte.toString(16).padStart(2, '0')).join('');
const sameHex = (value: string | undefined, identity: Identity) => value?.trim().replace(/^0x/i, '').toLowerCase() === identity.toHexString().toLowerCase();
function exclusiveShareIdentity(ctx: Ctx, identity: Identity): boolean {
  return !identity.isEqual(ctx.identity) && !ctx.db.appConfig.id.find(0)?.owner.isEqual(identity)
    && !ctx.db.member.identity.find(identity) && !ctx.db.authIdentityLink.sessionIdentity.find(identity)
    && ![...ctx.db.authIdentityLink.iter()].some((row) => row.memberIdentity.isEqual(identity))
    && !ctx.db.fileServiceConfig.id.find(0)?.identity.isEqual(identity) && !sameHex(ctx.env.B20_FILE_SERVICE_IDENTITY, identity)
    && !ctx.db.aiServiceConfig.id.find(0)?.identity.isEqual(identity) && !ctx.db.notificationServiceConfig.id.find(0)?.identity.isEqual(identity)
    && !ctx.db.maintenanceService.id.find(0)?.identity.isEqual(identity) && !sameHex(ctx.env.B20_MAINTENANCE_IDENTITY, identity)
    && !sameHex(ctx.env.B20_AUTH_SETUP_IDENTITY, identity) && !sameHex(ctx.env.B20_BOOTSTRAP_OWNER_IDENTITY, identity);
}
export function isFeedShareService(ctx: Ctx): boolean {
  const configured = ctx.db.feedShareServiceConfig?.id.find(0);
  return !!configured?.enabled && configured.identity.isEqual(ctx.sender) && exclusiveShareIdentity(ctx, ctx.sender);
}
/** The reducer entry point additionally requires the actual module owner. */
export function configureFeedShareService(ctx: Ctx, input: { identity: Identity; enabled: boolean }) {
  if (!exclusiveShareIdentity(ctx, input.identity)) throw new SenderError('Las vistas previas necesitan una identidad técnica exclusiva, sin membresía.');
  const row = { id: 0, identity: input.identity, enabled: input.enabled };
  if (ctx.db.feedShareServiceConfig.id.find(0)) ctx.db.feedShareServiceConfig.id.update(row); else ctx.db.feedShareServiceConfig.insert(row);
  log(ctx, 'configure', 'feed_share_service', '0');
}
interface Resource {
  owner?: Identity; coauthors?: Identity[]; subjectId?: bigint; title: string; description: string; path: string;
  kindLabel: string; canComment: boolean; maxLength: number; reason?: string;
}
const labels: Record<FeedResourceRef['kind'], string> = {
  assignment: 'Tarea', activity: 'Actividad', work: 'Trabajo', evidence: 'Evidencia', note: 'Nota de clase', question: 'Pregunta', answer: 'Respuesta',
  guide: 'Guía de estudio', poll: 'Votación', help: 'Ayuda', spaced: 'Repaso espaciado', post: 'Publicación', challenge: 'Reto', solution: 'Solución',
  review: 'Revisión de código', 'review-comment': 'Observación de código', opportunity: 'Oportunidad', room: 'Sala de estudio', exam: 'Examen', ranking: 'Ranking',
};
/** Checks source identity/visibility only. Public previews never read attachments or extracted documents. */
function publicExamSource(ctx: Ctx, source: { kind: string; refId: string }, depth = 0): boolean {
  if (depth > 5 || !/^[1-9]\d{0,19}$/.test(source.refId)) return false;
  if (source.kind === 'spaced_card') {
    const card = ctx.db.spacedCard.id.find(BigInt(source.refId)); const collection = card && ctx.db.spacedCollection.id.find(card.collectionId);
    return !!card && !card.archived && !!collection && !collection.archived && collection.visibility === 'group'
      && ['note', 'guide'].includes(card.sourceKind) && publicExamSource(ctx, { kind: card.sourceKind, refId: String(card.sourceId) }, depth + 1);
  }
  if (!['assignment', 'activity', 'work', 'evidence', 'note', 'question', 'answer', 'guide'].includes(source.kind)) return false;
  return !!resolveFeedResource(ctx, ref({ kind: source.kind, id: source.refId }));
}
function examMetadata(ctx: Ctx, id: string): Resource | undefined {
  const exam = ctx.db.studyExam.id.find(id);
  if (!exam || exam.visibility !== 'group' || exam.archived || !exam.readyVersion) return;
  const version = ctx.db.examVersion.key.find(`${id}:${exam.readyVersion}`);
  if (!version || version.state !== 'ready') return;
  try {
    const value = JSON.parse(version.json) as { title: string; hasPersonalSources: boolean; preparation: AiPreparation };
    if (value.hasPersonalSources || !value.preparation || !Array.isArray(value.preparation.sources)) return;
    for (const source of value.preparation.sources) {
      if (source.visibility !== 'group' || source.status === 'unauthorized' || !publicExamSource(ctx, source)) return;
      for (const origin of source.origins ?? []) if (!publicExamSource(ctx, origin)) return;
    }
    for (const fragment of value.preparation.fragments ?? []) for (const origin of fragment.origins) {
      if (!publicExamSource(ctx, origin)) return;
    }
    return { owner: exam.owner, subjectId: exam.subjectId, title: value.title || exam.title,
      description: value.preparation.topics.join(' · '), path: `/m/examenes/${encodeURIComponent(id)}`, kindLabel: labels.exam, canComment: true, maxLength: 2000 };
  } catch { return; }
}

/** Resolves current group-visible metadata only; owner access never turns a private object public. */
export function resolveFeedResource(ctx: Ctx, target: FeedResourceRef): Resource | undefined {
  const { kind, id } = target;
  if (kind === 'exam') return examMetadata(ctx, id);
  if (kind === 'ranking') {
    const viewer = [...ctx.db.member.iter()].find((person) => isActive(ctx.db, person.identity))?.identity;
    const ranking = viewer && verifiedRanking(ctx, id, viewer); if (!ranking) return;
    return { owner: [...ctx.db.member.iter()].find((person) => person.identity.toHexString() === ranking.memberId)?.identity,
      title: `Primer lugar · ${ranking.periodLabel}`, description: `${ranking.points} puntos de aportes al grupo.`, path: `/m/leaderboard?aviso=${encodeURIComponent(id)}`,
      kindLabel: labels.ranking, canComment: true, maxLength: 2000 };
  }
  const key = BigInt(id); const statusKind = kind === 'post' ? 'feed_post' : kind;
  if (withdrawn(ctx.db, statusKind, key) || retentionBlocksRead(ctx.db, statusKind, key)) return;
  const base = { kindLabel: labels[kind], canComment: true, maxLength: 2000 };
  switch (kind) {
    case 'assignment': { const row = ctx.db.assignment.id.find(key); if (!row) return; return { ...base, owner: row.createdBy, subjectId: row.subjectId, title: row.title, description: row.instructions, path: `/m/tareas/${id}` }; }
    case 'activity': { const row = ctx.db.activity.id.find(key); if (!row) return; return { ...base, owner: row.createdBy, subjectId: row.subjectId, title: row.title, description: row.objective, path: `/m/actividades/${id}` }; }
    case 'work': {
      const row = ctx.db.work.id.find(key); const parent = row && ctx.db.assignment.id.find(row.assignmentId);
      if (!row || !parent || withdrawn(ctx.db, 'assignment', parent.id) || ctx.db.workDetail.workId.find(key)?.status === 'draft') return;
      return { ...base, owner: row.createdBy, coauthors: [...ctx.db.workAuthor.workId.filter(key)].map((person) => person.author), subjectId: parent.subjectId,
        title: row.title || parent.title, description: row.description, path: `/m/tareas/${row.assignmentId}?trabajo=${id}` };
    }
    case 'evidence': { const row = ctx.db.evidence.id.find(key); const parent = row && ctx.db.activity.id.find(row.activityId); if (!row || !parent || withdrawn(ctx.db, 'activity', parent.id)) return;
      return { ...base, owner: row.author, subjectId: parent.subjectId, title: `Evidencia · ${parent.title}`, description: row.content, path: `/m/actividades/${row.activityId}?evidencia=${id}` }; }
    case 'note': { const row = ctx.db.note.id.find(key); if (!row || row.visibility !== 'group') return; return { ...base, maxLength: 4000, owner: row.author, subjectId: row.subjectId, title: row.title, description: `${row.topic} ${row.body}`, path: `/m/notas/${id}` }; }
    case 'question': { const row = ctx.db.question.id.find(key); if (!row) return; return { ...base, owner: row.author, subjectId: row.subjectId, title: row.title, description: row.body, path: `/m/preguntas/${id}` }; }
    case 'answer': { const row = ctx.db.answer.id.find(key); const parent = row && ctx.db.question.id.find(row.questionId); if (!row || !parent || withdrawn(ctx.db, 'question', parent.id) || retentionBlocksRead(ctx.db, 'question', parent.id)) return;
      return { ...base, owner: row.author, subjectId: parent.subjectId, title: `Respuesta · ${parent.title}`, description: row.body, path: `/m/preguntas/${row.questionId}?respuesta=${id}` }; }
    case 'guide': { const row = ctx.db.studyGuide.id.find(key); if (!row) return; return { ...base, owner: row.createdBy, subjectId: row.subjectId, title: row.title, description: row.topics.join(' · '), path: `/m/guias/${id}` }; }
    case 'poll': { const row = ctx.db.poll.id.find(key); if (!row || row.cancelledAt) return; return { ...base, owner: row.createdBy, title: row.title, description: row.description, path: `/m/votaciones/${id}`, canComment: row.closesAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch, reason: 'La votación está cerrada.' }; }
    case 'help': { const row = ctx.db.helpPost.id.find(key); if (!row || row.status === 'withdrawn') return; return { ...base, owner: row.author, subjectId: row.subjectId, title: row.title, description: row.topic, path: `/m/ayuda/${id}`, canComment: row.status === 'open', reason: 'La publicación de Ayuda está cerrada.' }; }
    case 'spaced': { const row = ctx.db.spacedCollection.id.find(key); if (!row || row.visibility !== 'group' || row.archived) return; return { ...base, owner: row.ownerId, subjectId: row.subjectId, title: row.title, description: 'Colección compartida de repaso espaciado.', path: `/m/repaso/colecciones/${id}` }; }
    case 'post': { const row = ctx.db.feedPost.id.find(key); if (!row || row.deletedAt) return; return { ...base, maxLength: 500, owner: row.author, subjectId: row.subjectId, title: feedPreviewText(row.text, 80) || 'Publicación del grupo', description: row.text, path: `/m/inicio?vista=feed&publicacion=${id}` }; }
    case 'challenge': { const row = ctx.db.codingChallenge.id.find(key); if (!row) return; return { ...base, maxLength: 4000, owner: row.author, subjectId: row.subjectId, title: row.title, description: row.objective, path: `/m/retos/${id}`, canComment: !row.closed, reason: 'Esta discusión está cerrada.' }; }
    case 'solution': { const row = ctx.db.challengeSolution.id.find(key); const parent = row && ctx.db.codingChallenge.id.find(row.challengeId); if (!row || !parent || withdrawn(ctx.db, 'challenge', parent.id)) return; return { ...base, maxLength: 4000, owner: row.author, subjectId: parent.subjectId, title: `Solución · ${parent.title}`, description: row.explanation, path: `/m/retos/${parent.id}?solucion=${id}`, canComment: !parent.closed, reason: 'Esta discusión está cerrada.' }; }
    case 'review': { const row = ctx.db.codeReview.id.find(key); if (!row) return; const version = ctx.db.codeReviewVersion.key.find(`${id}:${row.currentVersion}`); return { ...base, owner: row.author, subjectId: row.subjectId, title: row.title, description: version?.summary ?? row.language, path: `/m/revision-codigo/${id}`, canComment: !row.closed, reason: 'Esta discusión está cerrada.' }; }
    case 'review-comment': { const row = ctx.db.codeReviewComment.id.find(key); const parent = row && ctx.db.codeReview.id.find(row.reviewId); if (!row || !parent || withdrawn(ctx.db, 'review', parent.id)) return; return { ...base, owner: row.author, subjectId: parent.subjectId, title: `Observación · ${parent.title}`, description: row.body, path: `/m/revision-codigo/${parent.id}?observacion=${id}`, canComment: !parent.closed, reason: 'Esta discusión está cerrada.' }; }
    case 'opportunity': { const row = ctx.db.opportunity.id.find(key); if (!row || row.withdrawn) return; try { const fields = JSON.parse(row.fields) as { title: string; topic: string; requirements: string }; return { ...base, owner: row.author, title: fields.title, description: fields.requirements, path: `/m/oportunidades?oportunidad=${id}` }; } catch { return; } }
    case 'room': { const row = ctx.db.studyRoom.id.find(key); if (!row || row.visibility !== 'group' || row.status === 'cancelled') return; return { ...base, owner: row.organizer, subjectId: row.subjectId, title: row.title, description: row.objective, path: `/m/salas/${id}`, canComment: ['scheduled', 'active'].includes(row.status), reason: 'La sala ha finalizado.' }; }
  }
}

function preview(ctx: Ctx, resource: Resource): FeedSharePreview {
  const subject = resource.subjectId === undefined ? undefined : ctx.db.subject.id.find(resource.subjectId)?.name;
  return { title: feedPreviewText(resource.title, 200) || resource.kindLabel, description: feedPreviewText(resource.description, 160),
    ...(subject ? { subject: feedPreviewText(subject, 100) } : {}), kindLabel: resource.kindLabel, path: resource.path };
}
function canManage(ctx: Ctx, resource: Pick<Resource, 'owner' | 'coauthors'> | undefined, author: Identity) {
  const actor = memberIdentityFor(ctx);
  return author.isEqual(actor) || resource?.owner?.isEqual(actor) === true || resource?.coauthors?.some((person) => person.isEqual(actor)) === true || ctx.db.member.identity.find(actor)?.isCreator === true;
}
/** Ownership remains usable for revocation after withdrawal/privacy, without exposing metadata. */
function resourceOwnership(ctx: Ctx, target: FeedResourceRef): Pick<Resource, 'owner' | 'coauthors'> {
  if (target.kind === 'exam') return { owner: ctx.db.studyExam.id.find(target.id)?.owner };
  if (target.kind === 'ranking') return { owner: [...ctx.db.member.iter()].find((person) => person.identity.toHexString() === target.id.split('|')[1])?.identity };
  const id = BigInt(target.id);
  switch (target.kind) {
    case 'assignment': return { owner: ctx.db.assignment.id.find(id)?.createdBy };
    case 'activity': return { owner: ctx.db.activity.id.find(id)?.createdBy };
    case 'work': return { owner: ctx.db.work.id.find(id)?.createdBy, coauthors: [...ctx.db.workAuthor.workId.filter(id)].map((row) => row.author) };
    case 'evidence': return { owner: ctx.db.evidence.id.find(id)?.author };
    case 'note': return { owner: ctx.db.note.id.find(id)?.author };
    case 'question': return { owner: ctx.db.question.id.find(id)?.author };
    case 'answer': return { owner: ctx.db.answer.id.find(id)?.author };
    case 'guide': return { owner: ctx.db.studyGuide.id.find(id)?.createdBy };
    case 'poll': return { owner: ctx.db.poll.id.find(id)?.createdBy };
    case 'help': return { owner: ctx.db.helpPost.id.find(id)?.author };
    case 'spaced': return { owner: ctx.db.spacedCollection.id.find(id)?.ownerId };
    case 'post': return { owner: ctx.db.feedPost.id.find(id)?.author };
    case 'challenge': return { owner: ctx.db.codingChallenge.id.find(id)?.author };
    case 'solution': return { owner: ctx.db.challengeSolution.id.find(id)?.author };
    case 'review': return { owner: ctx.db.codeReview.id.find(id)?.author };
    case 'review-comment': return { owner: ctx.db.codeReviewComment.id.find(id)?.author };
    case 'opportunity': return { owner: ctx.db.opportunity.id.find(id)?.author };
    case 'room': return { owner: ctx.db.studyRoom.id.find(id)?.organizer };
  }
}
interface Comment { id: bigint; author: Identity; text: string; createdAt: Timestamp }
function comments(ctx: Ctx, target: FeedResourceRef): Comment[] {
  const key = feedResourceKey(target); const id = target.kind === 'exam' || target.kind === 'ranking' ? undefined : BigInt(target.id);
  switch (target.kind) {
    case 'post': return [...ctx.db.feedComment.postId.filter(id!)].filter((row) => !row.deletedAt && !withdrawn(ctx.db, 'feed_comment', row.id));
    case 'note': return [...ctx.db.noteComment.noteId.filter(id!)];
    case 'work': case 'evidence': return [...ctx.db.academicComment.targetId.filter(id!)].filter((row) => row.targetKind === target.kind);
    case 'question': return [...ctx.db.questionComment.questionId.filter(id!)].filter((row) => row.answerId === undefined);
    case 'answer': { const answer = ctx.db.answer.id.find(id!); return answer ? [...ctx.db.questionComment.questionId.filter(answer.questionId)].filter((row) => row.answerId === id) : []; }
    case 'challenge': return [...ctx.db.challengeComment.challengeId.filter(id!)].filter((row) => row.solutionId === undefined).map((row) => ({ ...row, text: row.body }));
    case 'solution': { const solution = ctx.db.challengeSolution.id.find(id!); return solution ? [...ctx.db.challengeComment.challengeId.filter(solution.challengeId)].filter((row) => row.solutionId === id).map((row) => ({ ...row, text: row.body })) : []; }
    default: return [...ctx.db.feedThreadComment.target.filter(key)];
  }
}
function thread(ctx: Ctx, target: FeedResourceRef, resource: Resource): FeedThread {
  const list = comments(ctx, target).sort((a, b) => a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? -1 : a.createdAt.microsSinceUnixEpoch > b.createdAt.microsSinceUnixEpoch ? 1 : a.id < b.id ? -1 : 1);
  return { target, comments: list.map<FeedThreadComment>((row) => ({ id: row.id.toString(), authorId: row.author.toHexString(), text: row.text, createdAt: iso(row.createdAt), canDelete: canManage(ctx, resource, row.author) })),
    canComment: resource.canComment, maxLength: resource.maxLength, ...(!resource.canComment && resource.reason ? { reason: resource.reason } : {}) };
}
function insertComment(ctx: Ctx, target: FeedResourceRef, body: string, requestId: string): string {
  const author = memberIdentityFor(ctx); const createdAt = ctx.timestamp; const id = target.kind === 'exam' || target.kind === 'ranking' ? undefined : BigInt(target.id);
  switch (target.kind) {
    case 'post': return ctx.db.feedComment.insert({ id: 0n, postId: id!, author, text: body, requestId, createdAt, deletedAt: undefined, deletedBy: undefined }).id.toString();
    case 'note': return ctx.db.noteComment.insert({ id: 0n, noteId: id!, author, text: body, createdAt }).id.toString();
    case 'work': case 'evidence': return ctx.db.academicComment.insert({ id: 0n, targetKind: target.kind, targetId: id!, author, text: body, createdAt }).id.toString();
    case 'question': case 'answer': { const questionId = target.kind === 'question' ? id! : ctx.db.answer.id.find(id!)!.questionId; return ctx.db.questionComment.insert({ id: 0n, questionId, answerId: target.kind === 'answer' ? id : undefined, author, text: body, createdAt }).id.toString(); }
    case 'challenge': case 'solution': { const challengeId = target.kind === 'challenge' ? id! : ctx.db.challengeSolution.id.find(id!)!.challengeId; return ctx.db.challengeComment.insert({ id: 0n, challengeId, solutionId: target.kind === 'solution' ? id : undefined, author, body, requestId, createdAt }).id.toString(); }
    default: return ctx.db.feedThreadComment.insert({ id: 0n, target: feedResourceKey(target), author, text: body, createdAt }).id.toString();
  }
}
function removeComment(ctx: Ctx, target: FeedResourceRef, id: bigint) {
  switch (target.kind) {
    case 'post': deleteFeedComment(ctx, { commentId: id }); break;
    case 'note': ctx.db.noteComment.id.delete(id); invalidateFeedShares(ctx, 'note-comment', id); break;
    case 'work': case 'evidence': ctx.db.academicComment.id.delete(id); break;
    case 'question': case 'answer': ctx.db.questionComment.id.delete(id); break;
    case 'challenge': case 'solution': ctx.db.challengeComment.id.delete(id); break;
    default: ctx.db.feedThreadComment.id.delete(id);
  }
}

export function feedThread(ctx: Ctx, rawPayload: string): string {
  activeMember(ctx); const input = payload(rawPayload); const target = ref(input.target); const resource = resolveFeedResource(ctx, target);
  if (!resource) throw unavailable();
  if (input.action === 'comment') {
    const body = text(input.text, resource.maxLength); const requestId = request(input.requestId);
    const actor = memberIdentityFor(ctx); const key = JSON.stringify([actor.toHexString(), feedResourceKey(target), requestId]); const requestHash = hash(body);
    const receipt = ctx.db.feedThreadReceipt.key.find(key);
    if (receipt) { if (receipt.requestHash !== requestHash) throw new SenderError('Este envío ya se utilizó para otro comentario.'); }
    else {
      // Existing post/challenge callers use the same request IDs. Reusing one must not fork a conversation.
      const prior = (target.kind === 'post' ? [...ctx.db.feedComment.postId.filter(BigInt(target.id))]
        : target.kind === 'challenge' || target.kind === 'solution' ? [...ctx.db.challengeComment.challengeId.filter(target.kind === 'challenge' ? BigInt(target.id) : ctx.db.challengeSolution.id.find(BigInt(target.id))!.challengeId)] : [])
        .find((row) => row.author.isEqual(actor) && row.requestId === requestId);
      if (prior && (('text' in prior ? prior.text : prior.body) !== body && !('deletedAt' in prior && prior.deletedAt) || 'solutionId' in prior && prior.solutionId !== (target.kind === 'solution' ? BigInt(target.id) : undefined))) throw new SenderError('Este envío ya se utilizó para otro comentario.');
      if (!prior && !resource.canComment) throw new SenderError(resource.reason ?? 'Esta discusión está cerrada.');
      const commentId = prior?.id.toString() ?? insertComment(ctx, target, body, requestId);
      ctx.db.feedThreadReceipt.insert({ key, target: feedResourceKey(target), actor, requestHash, commentId, createdAt: ctx.timestamp });
    }
  } else if (input.action === 'delete') {
    const id = numeric(input.commentId); const row = comments(ctx, target).find((comment) => comment.id === id);
    if (!row) throw new SenderError('El comentario ya no está disponible.');
    if (!canManage(ctx, resource, row.author)) throw new SenderError('No puedes eliminar este comentario.');
    removeComment(ctx, target, id);
  } else if (input.action !== 'read') throw invalid();
  return JSON.stringify(thread(ctx, target, resource));
}

export function feedShareAction(ctx: Ctx, rawPayload: string): string {
  activeMember(ctx); const input = payload(rawPayload);
  if (input.action === 'revoke') {
    const share = ctx.db.feedShare.id.find(numeric(input.id)); if (!share) throw unavailable();
    const target = ref({ kind: share.targetKind, id: share.targetId }); const resource = resourceOwnership(ctx, target);
    if (!canManage(ctx, resource, share.createdBy)) throw new SenderError('No puedes revocar este enlace.');
    if (!share.revokedAt) ctx.db.feedShare.id.update({ ...share, revokedAt: ctx.timestamp });
    return JSON.stringify({ ok: true });
  }
  const target = ref(input.target); const resource = resolveFeedResource(ctx, target);
  if (input.action === 'list') {
    const ownership = resource ?? resourceOwnership(ctx, target);
    if (!resource) for (const row of ctx.db.feedShare.target.filter(feedResourceKey(target))) {
      if (!row.invalidatedAt) ctx.db.feedShare.id.update({ ...row, invalidatedAt: ctx.timestamp });
    }
    const rows: FeedShareRecord[] = [...ctx.db.feedShare.target.filter(feedResourceKey(target))]
      .filter((row) => resource || canManage(ctx, ownership, row.createdBy))
      .map((row) => ({ id: row.id.toString(), target, createdBy: row.createdBy.toHexString(), createdAt: iso(row.createdAt),
        active: !!resource && !row.revokedAt && !row.invalidatedAt, canRevoke: canManage(ctx, ownership, row.createdBy) }));
    return JSON.stringify(rows);
  }
  if (!resource) throw unavailable();
  if (input.action !== 'create' || typeof input.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.tokenHash)) throw invalid();
  const existing = ctx.db.feedShare.tokenHash.find(input.tokenHash);
  if (existing) {
    if (!existing.createdBy.isEqual(memberIdentityFor(ctx)) || existing.target !== feedResourceKey(target) || existing.revokedAt || existing.invalidatedAt) throw new SenderError('Este enlace ya se utilizó.');
    return JSON.stringify({ id: existing.id.toString(), preview: preview(ctx, resource) } satisfies CreatedFeedShare);
  }
  const share = ctx.db.feedShare.insert({ id: 0n, tokenHash: input.tokenHash, target: feedResourceKey(target), targetKind: target.kind, targetId: target.id,
    createdBy: memberIdentityFor(ctx), createdAt: ctx.timestamp, revokedAt: undefined, invalidatedAt: undefined });
  return JSON.stringify({ id: share.id.toString(), preview: preview(ctx, resource) } satisfies CreatedFeedShare);
}

/** Dedicated projection service only. The Worker exposes the sanitized result to anonymous link visitors. */
export function feedSharePreview(ctx: Ctx, tokenHash: string): string {
  if (!isFeedShareService(ctx)) throw new SenderError('Solo el servicio de vistas previas puede consultar este enlace.');
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) return 'null';
  const share = ctx.db.feedShare.tokenHash.find(tokenHash);
  if (!share || share.revokedAt || share.invalidatedAt) return 'null';
  const target = ref({ kind: share.targetKind, id: share.targetId }); const resource = resolveFeedResource(ctx, target);
  if (!resource) { ctx.db.feedShare.id.update({ ...share, invalidatedAt: ctx.timestamp }); return 'null'; }
  return JSON.stringify(preview(ctx, resource));
}
