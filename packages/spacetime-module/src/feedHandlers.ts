import { SenderError } from 'spacetimedb/server';
import { cleanFeedComment, cleanFeedPost, cleanFeedReaction, feedReactionKey } from '../../core/src/feed';
import { activeMember, isActive, log, requireSubject, requireText, type Ctx, type ViewDb } from './moduleContext';
import { canReadTarget, withdrawn } from './delivery2Handlers';
type Person = Ctx['sender'];
const check = <T>(fn: () => T): T => { try { return fn(); } catch (error) { throw new SenderError(error instanceof Error ? error.message : 'Datos no válidos.'); } };
const token = (value: string) => requireText(value, 'La solicitud', 128);

export function postReadable(db: ViewDb, sender: Person, postId: bigint) {
  const post = db.feedPost.id.find(postId);
  return isActive(db, sender) && !!post && !post.deletedAt && isActive(db, post.author);
}

/** Lo mismo que puede ver quien reacciona en su módulo de origen; nada retirado ni personal ajeno. */
export function feedTargetReadable(db: ViewDb, sender: Person, kind: string, id: bigint): boolean {
  if (!isActive(db, sender)) return false;
  if (kind === 'post') return postReadable(db, sender, id);
  if (kind === 'poll') { const row = db.poll.id.find(id); return !!row && !row.cancelledAt; }
  if (kind === 'help') { const row = db.helpPost.id.find(id); return !!row && row.status !== 'withdrawn'; }
  if (kind === 'spaced') { const row = db.spacedCollection.id.find(id); return !!row && row.visibility === 'group' && !row.archived; }
  return canReadTarget(db, sender, kind, id) && !withdrawn(db, kind, id);
}

/** Pone, cambia o quita (si es la misma) la reacción de quien llama. */
export function toggleFeedReaction(ctx: Ctx, input: { targetKind: string; targetId: bigint; emoji: string }) {
  activeMember(ctx);
  const { kind, emoji } = check(() => cleanFeedReaction(input.targetKind, input.emoji));
  if (!feedTargetReadable(ctx.db, ctx.sender, kind, input.targetId)) throw new SenderError('Ese contenido ya no está disponible.');
  const key = feedReactionKey(kind, input.targetId.toString(), ctx.sender.toHexString());
  const current = ctx.db.feedReaction.key.find(key);
  if (current) ctx.db.feedReaction.key.delete(key);
  if (current?.emoji !== emoji) {
    ctx.db.feedReaction.insert({ key, target: `${kind}:${input.targetId}`, targetKind: kind, targetId: input.targetId, member: ctx.sender, emoji, updatedAt: ctx.timestamp });
  }
}

export function createFeedPost(ctx: Ctx, input: { text: string; subjectId?: bigint; requestId: string }) {
  activeMember(ctx);
  const requestId = token(input.requestId); const text = check(() => cleanFeedPost(input.text));
  const prior = [...ctx.db.feedPost.author.filter(ctx.sender)].find((row) => row.requestId === requestId);
  if (prior) {
    if (prior.subjectId !== input.subjectId || (!prior.editedAt && !prior.deletedAt && prior.text !== text)) throw new SenderError('Este envío ya se utilizó para otro contenido.');
    return;
  }
  if (input.subjectId !== undefined) requireSubject(ctx, input.subjectId);
  ctx.db.feedPost.insert({ id: 0n, author: ctx.sender, text, subjectId: input.subjectId, requestId, createdAt: ctx.timestamp,
    editedAt: undefined, deletedAt: undefined, deletedBy: undefined });
}

function requirePost(ctx: Ctx, postId: bigint) {
  const post = ctx.db.feedPost.id.find(postId);
  if (!post || post.deletedAt) throw new SenderError('La publicación ya no está disponible.');
  return post;
}

/** Solo su autor. */
export function editFeedPost(ctx: Ctx, input: { postId: bigint; text: string }) {
  activeMember(ctx); const post = requirePost(ctx, input.postId);
  if (!post.author.isEqual(ctx.sender)) throw new SenderError('Solo quien publicó puede editarla.');
  const text = check(() => cleanFeedPost(input.text));
  if (text !== post.text) ctx.db.feedPost.id.update({ ...post, text, editedAt: ctx.timestamp });
}

/** Su autor o un administrador; se borra el texto y con él sus reacciones. */
export function deleteFeedPost(ctx: Ctx, input: { postId: bigint }) {
  const me = activeMember(ctx); const post = requirePost(ctx, input.postId);
  const own = post.author.isEqual(ctx.sender);
  if (!own && !me.isCreator) throw new SenderError('Solo quien publicó o un administrador puede eliminarla.');
  ctx.db.feedPost.id.update({ ...post, text: '', deletedAt: ctx.timestamp, deletedBy: ctx.sender });
  for (const reaction of [...ctx.db.feedReaction.target.filter(`post:${post.id}`)]) ctx.db.feedReaction.key.delete(reaction.key);
  if (!own) log(ctx, 'moderate', 'feed_post', post.id);
}

export function commentFeedPost(ctx: Ctx, input: { postId: bigint; text: string; requestId: string }) {
  activeMember(ctx);
  const requestId = token(input.requestId); const text = check(() => cleanFeedComment(input.text));
  if (!postReadable(ctx.db, ctx.sender, input.postId)) throw new SenderError('La publicación ya no está disponible.');
  const prior = [...ctx.db.feedComment.postId.filter(input.postId)].find((row) => row.author.isEqual(ctx.sender) && row.requestId === requestId);
  if (prior) { if (!prior.deletedAt && prior.text !== text) throw new SenderError('Este envío ya se utilizó para otro contenido.'); return; }
  ctx.db.feedComment.insert({ id: 0n, postId: input.postId, author: ctx.sender, text, requestId, createdAt: ctx.timestamp, deletedAt: undefined, deletedBy: undefined });
}

/** Quien comentó, quien publicó o un administrador. */
export function deleteFeedComment(ctx: Ctx, input: { commentId: bigint }) {
  const me = activeMember(ctx); const comment = ctx.db.feedComment.id.find(input.commentId);
  if (!comment || comment.deletedAt) throw new SenderError('El comentario ya no está disponible.');
  const post = ctx.db.feedPost.id.find(comment.postId);
  const own = comment.author.isEqual(ctx.sender);
  if (!own && !post?.author.isEqual(ctx.sender) && !me.isCreator) throw new SenderError('No puedes eliminar este comentario.');
  ctx.db.feedComment.id.update({ ...comment, text: '', deletedAt: ctx.timestamp, deletedBy: ctx.sender });
  if (!own) log(ctx, 'moderate', 'feed_comment', comment.id);
}

export const commentReadable = (db: ViewDb, sender: Person, row: { postId: bigint; deletedAt?: unknown; author: Person }) =>
  !row.deletedAt && isActive(db, row.author) && postReadable(db, sender, row.postId);
