import { t, table, SenderError } from 'spacetimedb/server';
import { sha256 } from '@noble/hashes/sha2.js';
import { cleanHelpPost, helpText, HELP_LIMITS, type HelpPostFields } from '../../core/src/help';
import { activeMember, isActive, log, requireSubject, type Ctx, type ViewDb } from './moduleContext';

export const helpVersion = table({ name: 'help_version' }, { postId: t.u64().primaryKey(), version: t.u32() });
export const helpRevision = table({ name: 'help_revision' }, {
  key: t.string().primaryKey(), postId: t.u64().index('btree'), version: t.u32(), fields: t.string(), status: t.string(), at: t.timestamp(),
});
export const helpIntent = table({ name: 'help_intent' }, {
  key: t.string().primaryKey(), actor: t.identity(), digest: t.string(), postId: t.u64(), version: t.u32(),
});
export const helpVersionTables = { helpVersion, helpRevision, helpIntent };
type Post = NonNullable<ReturnType<Ctx['db']['helpPost']['id']['find']>>;
function fail(message: string): never { throw new SenderError(message); }
function validate<T>(run: () => T): T { try { return run(); } catch (error) { if (error instanceof SenderError) throw error; return fail(error instanceof Error ? error.message : 'La publicación no es válida.'); } }
const hash = (value: string) => Array.from(sha256(new TextEncoder().encode(value)), b => b.toString(16).padStart(2, '0')).join('');
const field = (value: unknown, label: string, max: number, optional = false) => typeof value === 'string' ? helpText(value, label, max, optional) : fail(`${label} no es válido.`);
function id(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value) || BigInt(value) > 18446744073709551615n) fail('La publicación no es válida.');
  return BigInt(value);
}
export function helpPostVersion(db: ViewDb, postId: bigint): number { return db.helpVersion?.postId.find(postId)?.version ?? 1; }
export function assertLegacyHelpEditable(ctx: Ctx, postId: bigint) {
  void ctx; void postId;
  fail('Actualiza la aplicación para comprobar la versión de esta publicación.');
}
/** Se ejecuta alrededor de withTx: un rechazo revierte la transacción antes de traducirse. */
export function helpResponse(run: () => string): string {
  try { return JSON.stringify({ ok: true, data: JSON.parse(run()) }); }
  catch (error) { if (error instanceof SenderError) return JSON.stringify({ ok: false, message: error.message }); throw error; }
}
function version(ctx: Ctx, post: Post, expected: unknown) {
  if (!Number.isSafeInteger(expected) || expected !== helpPostVersion(ctx.db, post.id)) fail('La publicación cambió. Recarga sus datos antes de guardar.');
}
function fields(post: Post): HelpPostFields {
  return { kind: post.kind as HelpPostFields['kind'], subjectId: post.subjectId.toString(), title: post.title, topic: post.topic,
    description: post.description, level: post.level as HelpPostFields['level'], modality: post.modality as HelpPostFields['modality'], availability: post.availability };
}
function capture(ctx: Ctx, post: Post, next: number) {
  const key = `${post.id}:${next}`;
  if (!ctx.db.helpRevision.key.find(key)) ctx.db.helpRevision.insert({ key, postId: post.id, version: next, fields: JSON.stringify(fields(post)), status: post.status, at: post.updatedAt });
  const row = { postId: post.id, version: next };
  if (ctx.db.helpVersion.postId.find(post.id)) ctx.db.helpVersion.postId.update(row); else ctx.db.helpVersion.insert(row);
}
function closePending(ctx: Ctx, postId: bigint, reason: string) {
  for (const contact of ctx.db.helpContactRequest.postId.filter(postId)) if (contact.status === 'pending') {
    ctx.db.helpContactRequest.id.update({ ...contact, status: 'closed', closeReason: reason, closedBy: ctx.sender, updatedAt: ctx.timestamp });
  }
}
/** Una intención conserva su resultado; nunca vuelve a aplicar una edición tras perder su confirmación. */
export function mutateHelp(ctx: Ctx, payload: string): string {
  const me = activeMember(ctx);
  if (payload.length > 12_000) fail('La publicación es demasiado grande.');
  let input: Record<string, unknown>;
  try { const value: unknown = JSON.parse(payload); if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Envío no válido.'); input = value as Record<string, unknown>; }
  catch (error) { if (error instanceof SenderError) throw error; return fail('Envío no válido.'); }
  const requestId = field(input.requestId, 'El identificador de envío', 128);
  if (!['save', 'status', 'withdraw'].includes(String(input.action))) fail('La acción no es válida.');
  const key = `${ctx.sender.toHexString()}:${requestId}`; const digest = hash(payload);
  const prior = ctx.db.helpIntent.key.find(key);
  if (prior) { if (prior.digest !== digest) fail('Este envío ya se utilizó para otro cambio.'); return JSON.stringify({ id: prior.postId.toString(), version: prior.version }); }
  const postId = input.id === undefined ? undefined : id(input.id);
  let post = postId === undefined ? undefined : ctx.db.helpPost.id.find(postId);
  if (postId !== undefined && !post) fail('La publicación no está disponible.');
  if (post) {
    if (post.status === 'withdrawn') fail('La publicación fue retirada.');
    if (!post.author.isEqual(ctx.sender) && (input.action !== 'withdraw' || !me.isCreator)) fail('Solo su autor puede cambiar esta publicación.');
    version(ctx, post, input.expectedVersion);
  }
  if (!post && input.action !== 'save') fail('La publicación no está disponible.');
  const previous = post ? helpPostVersion(ctx.db, post.id) : 0;
  if (post && !ctx.db.helpRevision.key.find(`${post.id}:${previous}`)) capture(ctx, post, previous);
  if (input.action === 'save') {
    const raw = input.fields;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('La publicación no es válida.');
    const data = raw as Record<string, unknown>;
    const clean = validate(() => cleanHelpPost({ kind: field(data.kind, 'El tipo', 20) as HelpPostFields['kind'], subjectId: field(data.subjectId, 'La materia', 20),
      title: field(data.title, 'El título', HELP_LIMITS.title), topic: field(data.topic, 'El tema', HELP_LIMITS.topic),
      description: field(data.description, 'La descripción', HELP_LIMITS.description), level: field(data.level, 'El nivel', 20) as HelpPostFields['level'],
      modality: field(data.modality, 'La modalidad', 20) as HelpPostFields['modality'], availability: field(data.availability, 'La disponibilidad', HELP_LIMITS.availability, true) }));
    const subjectId = id(clean.subjectId); requireSubject(ctx, subjectId);
    if (post && post.kind !== clean.kind) fail('El tipo de una publicación no cambia.');
    post = post ? { ...post, ...clean, subjectId, updatedAt: ctx.timestamp } : {
      id: 0n, ...clean, subjectId, status: 'open', author: ctx.sender, createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
      withdrawnBy: undefined, withdrawalReason: undefined,
    };
    if (postId === undefined) post = ctx.db.helpPost.insert(post); else ctx.db.helpPost.id.update(post);
  } else if (input.action === 'status') {
    if (input.status !== 'open' && input.status !== 'closed') fail('El estado no es válido.');
    post = { ...post!, status: input.status, updatedAt: ctx.timestamp }; ctx.db.helpPost.id.update(post);
    if (post.status === 'closed') closePending(ctx, post.id, 'post_closed');
  } else {
    const reason = field(input.reason, 'El motivo', HELP_LIMITS.reason, post!.author.isEqual(ctx.sender));
    post = { ...post!, status: 'withdrawn', withdrawnBy: ctx.sender, withdrawalReason: reason || undefined, updatedAt: ctx.timestamp };
    ctx.db.helpPost.id.update(post); closePending(ctx, post.id, 'post_withdrawn');
  }
  capture(ctx, post!, previous + 1);
  ctx.db.helpIntent.insert({ key, actor: ctx.sender, digest, postId: post!.id, version: previous + 1 });
  log(ctx, input.action === 'withdraw' ? 'withdraw' : postId === undefined ? 'create' : 'update', 'help_post', post!.id);
  return JSON.stringify({ id: post!.id.toString(), version: previous + 1 });
}
export function readHelpHistory(ctx: Ctx, postId: bigint): string {
  activeMember(ctx); const post = ctx.db.helpPost.id.find(postId);
  if (!post || !post.author.isEqual(ctx.sender)) fail('Solo el autor consulta las versiones de su publicación.');
  const rows = [...ctx.db.helpRevision.postId.filter(postId)].sort((a, b) => b.version - a.version).slice(0, 30);
  return JSON.stringify(rows.map(row => ({ version: row.version, status: row.status, fields: JSON.parse(row.fields), at: Number(row.at.microsSinceUnixEpoch / 1000n) })));
}
export function visibleHelpVersions(db: ViewDb, sender: Ctx['sender']) {
  if (!isActive(db, sender)) return [];
  return [...db.helpVersion.iter()].filter(row => { const post = db.helpPost.id.find(row.postId); return !!post && (post.author.isEqual(sender) || post.status !== 'withdrawn' && isActive(db, post.author)); });
}
