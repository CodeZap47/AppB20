import { cleanFeedComment, cleanFeedPost, cleanFeedReaction, type FeedTargetKind } from '@b20/core';
import type { Member, Note, Snapshot, Subject } from './types';
import { emptyFeed, type FeedActions, type FeedPost, type FeedSnapshot } from './feedTypes';
interface DemoState { members: Member[]; notes: Note[]; subjects: Subject[]; }
interface Context { state(): DemoState; active(): Member; current(): Snapshot; id(): string; now(): Date; emit(): void; available?(kind: string, id: string): boolean; }
interface Store extends FeedSnapshot { postRequests: Map<string, string>; commentRequests: Map<string, string>; versions: Map<string, number>; }
const stores = new WeakMap<object, Store>();
const token = (value: string) => { if (!value.trim() || value.trim().length > 128) throw new Error('La solicitud no es válida.'); return value.trim(); };

/** Lo mismo que el servidor deja ver: nada retirado, cancelado ni personal ajeno. */
export function feedTargetReadable(base: Snapshot, posts: FeedPost[], kind: FeedTargetKind, id: string): boolean {
  switch (kind) {
    case 'post': return posts.some((r) => r.id === id);
    case 'assignment': return base.assignments.some((r) => r.id === id);
    case 'activity': return base.activities.some((r) => r.id === id);
    case 'work': return base.works.some((r) => r.id === id && !r.withdrawnAt);
    case 'note': return base.notes.some((r) => r.id === id && !r.withdrawnAt);
    case 'evidence': return base.evidences.some((r) => r.id === id && !r.withdrawnAt);
    case 'question': return base.questions.some((r) => r.id === id && !r.withdrawnAt);
    case 'answer': return base.answers.some((r) => r.id === id && !r.withdrawnAt);
    case 'guide': return base.guides.some((r) => r.id === id && !r.withdrawnAt);
    case 'poll': return base.polls.some((r) => r.id === id && !r.cancelledAt);
    case 'help': return base.helpPosts.some((r) => r.id === id && r.status !== 'withdrawn');
    case 'spaced': return base.spacedCollections.some((r) => r.id === id && r.visibility === 'group' && !r.archived);
  }
}

export class DemoFeedStore implements FeedActions {
  constructor(private ctx: Context) {}
  private get shared() {
    let result = stores.get(this.ctx.state());
    if (!result) { result = this.seed(); stores.set(this.ctx.state(), result); }
    return result;
  }
  /** Unas cuantas publicaciones y reacciones para que el feed de prueba no arranque vacío. */
  private seed(): Store {
    const { members, notes, subjects } = this.ctx.state(); const now = this.ctx.now().getTime();
    const ago = (minutes: number) => new Date(now - minutes * 60_000);
    const store: Store = { ...emptyFeed(), postRequests: new Map(), commentRequests: new Map(), versions: new Map() };
    if (members.length < 4) return store;
    const [a, b, c, d] = members.map((m) => m.id) as [string, string, string, string];
    store.feedPosts.push(
      { id: 'fp1', authorId: c, text: '¿Alguien se apunta a repasar tablas de verdad mañana antes de clase? Llevo café ☕', subjectId: subjects[0]?.id, createdAt: ago(45) },
      { id: 'fp2', authorId: b, text: 'Ya quedó el resumen del parcial en Notas. Si ven algún error díganme y lo corrijo.', createdAt: ago(60 * 26) },
    );
    store.feedComments.push(
      { id: 'fc1', postId: 'fp1', authorId: d, text: 'Yo voy, ¿en la biblioteca?', createdAt: ago(30) },
      { id: 'fc2', postId: 'fp1', authorId: a, text: 'Cuenten conmigo 🙌', createdAt: ago(20) },
    );
    store.feedReactions.push(
      { targetKind: 'post', targetId: 'fp1', memberId: d, emoji: '👍' },
      { targetKind: 'post', targetId: 'fp1', memberId: a, emoji: '🎉' },
      { targetKind: 'post', targetId: 'fp2', memberId: c, emoji: '❤️' },
      { targetKind: 'post', targetId: 'fp2', memberId: d, emoji: '🙏' },
    );
    const note = notes.find((n) => n.visibility === 'group');
    if (note) store.feedReactions.push({ targetKind: 'note', targetId: note.id, memberId: c, emoji: '🙏' }, { targetKind: 'note', targetId: note.id, memberId: d, emoji: '👍' });
    return store;
  }
  snapshot(base: Snapshot): FeedSnapshot {
    if (base.me?.status !== 'active') return emptyFeed();
    const active = new Set(base.members.filter((m) => m.status === 'active').map((m) => m.id));
    const feedPosts = this.shared.feedPosts.filter((r) => this.ctx.available?.('feed_post', r.id) !== false);
    const posts = new Set(feedPosts.map((r) => r.id));
    return structuredClone({ feedPosts,
      feedReactions: this.shared.feedReactions.filter((r) => active.has(r.memberId) && feedTargetReadable(base, feedPosts, r.targetKind, r.targetId)),
      feedComments: this.shared.feedComments.filter((r) => posts.has(r.postId) && this.ctx.available?.('feed_comment', r.id) !== false) });
  }
  raw(): FeedSnapshot { return this.shared; }
  versionOf(kind: string, id: string) { return this.shared.versions.get(`${kind}:${id}`) ?? 1; }
  bump(kind: string, id: string) { this.shared.versions.set(`${kind}:${id}`, this.versionOf(kind, id) + 1); }
  purgeManaged(targets: ReadonlySet<string>) {
    const posts = new Set(this.shared.feedPosts.filter((row) => targets.has(`feed_post:${row.id}`)).map((row) => row.id));
    this.shared.feedPosts = this.shared.feedPosts.filter((row) => !posts.has(row.id));
    this.shared.feedComments = this.shared.feedComments.filter((row) => !posts.has(row.postId) && !targets.has(`feed_comment:${row.id}`));
    this.shared.feedReactions = this.shared.feedReactions.filter((row) => row.targetKind !== 'post' || !posts.has(row.targetId));
  }
  private post(id: string) { const row = this.shared.feedPosts.find((r) => r.id === id); if (!row || this.ctx.available?.('feed_post', id) === false) throw new Error('La publicación ya no está disponible.'); return row; }
  toggleFeedReaction(input: Parameters<FeedActions['toggleFeedReaction']>[0]) {
    const me = this.ctx.active(); const { kind, emoji } = cleanFeedReaction(input.targetKind, input.emoji);
    if (!feedTargetReadable(this.ctx.current(), this.shared.feedPosts.filter((row) => this.ctx.available?.('feed_post', row.id) !== false), kind, input.targetId)) throw new Error('Ese contenido ya no está disponible.');
    const mine = (r: FeedSnapshot['feedReactions'][number]) => r.targetKind === kind && r.targetId === input.targetId && r.memberId === me.id;
    const current = this.shared.feedReactions.find(mine);
    this.shared.feedReactions = this.shared.feedReactions.filter((r) => !mine(r));
    if (current?.emoji !== emoji) this.shared.feedReactions.push({ targetKind: kind, targetId: input.targetId, memberId: me.id, emoji });
    this.ctx.emit();
  }
  createFeedPost(input: Parameters<FeedActions['createFeedPost']>[0]) {
    const me = this.ctx.active(); const key = `${me.id}:${token(input.requestId)}`; const text = cleanFeedPost(input.text);
    const prior = this.shared.postRequests.get(key);
    if (prior) { if (this.shared.feedPosts.find((r) => r.id === prior)?.text !== text) throw new Error('Este envío ya se utilizó para otro contenido.'); return; }
    if (input.subjectId && !this.ctx.current().subjects.some((s) => s.id === input.subjectId)) throw new Error('La materia no existe.');
    const id = this.ctx.id(); this.shared.postRequests.set(key, id);
    this.shared.feedPosts.push({ id, authorId: me.id, text, subjectId: input.subjectId || undefined, createdAt: this.ctx.now() });
    this.ctx.emit();
  }
  editFeedPost(input: Parameters<FeedActions['editFeedPost']>[0]) {
    const me = this.ctx.active(); const post = this.post(input.postId);
    if (post.authorId !== me.id) throw new Error('Solo quien publicó puede editarla.');
    const text = cleanFeedPost(input.text);
    if (text !== post.text) { post.text = text; post.editedAt = this.ctx.now(); this.bump('feed_post', post.id); this.ctx.emit(); }
  }
  deleteFeedPost(input: Parameters<FeedActions['deleteFeedPost']>[0]) {
    const me = this.ctx.active(); const post = this.post(input.postId);
    if (post.authorId !== me.id && !me.isCreator) throw new Error('Solo quien publicó o un administrador puede eliminarla.');
    this.shared.feedPosts = this.shared.feedPosts.filter((r) => r.id !== post.id);
    this.shared.feedComments = this.shared.feedComments.filter((r) => r.postId !== post.id);
    this.shared.feedReactions = this.shared.feedReactions.filter((r) => !(r.targetKind === 'post' && r.targetId === post.id));
    this.ctx.emit();
  }
  commentFeedPost(input: Parameters<FeedActions['commentFeedPost']>[0]) {
    const me = this.ctx.active(); const post = this.post(input.postId); const text = cleanFeedComment(input.text);
    const key = `${me.id}:${post.id}:${token(input.requestId)}`; const prior = this.shared.commentRequests.get(key);
    if (prior) { if (this.shared.feedComments.find((r) => r.id === prior)?.text !== text) throw new Error('Este envío ya se utilizó para otro contenido.'); return; }
    const id = this.ctx.id(); this.shared.commentRequests.set(key, id);
    this.shared.feedComments.push({ id, postId: post.id, authorId: me.id, text, createdAt: this.ctx.now() });
    this.ctx.emit();
  }
  deleteFeedComment(input: Parameters<FeedActions['deleteFeedComment']>[0]) {
    const me = this.ctx.active(); const comment = this.shared.feedComments.find((r) => r.id === input.commentId);
    if (!comment || this.ctx.available?.('feed_comment', comment.id) === false) throw new Error('El comentario ya no está disponible.');
    const post = this.post(comment.postId);
    if (comment.authorId !== me.id && post?.authorId !== me.id && !me.isCreator) throw new Error('No puedes eliminar este comentario.');
    this.shared.feedComments = this.shared.feedComments.filter((r) => r.id !== comment.id);
    this.ctx.emit();
  }
}
