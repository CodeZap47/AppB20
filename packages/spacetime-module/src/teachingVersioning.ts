import { SenderError, t, table } from 'spacetimedb/server';
import { aiCanonical, aiHash, aiUuid } from '../../core/src/ai';
import type { TeachingExplanation } from '../../core/src/teaching';
import { activeMember, isActive, type Ctx, type ViewDb } from './moduleContext';

export const teachingHead = table({ name: 'teaching_head' }, { practiceId: t.u64().primaryKey(), version: t.u32() });
export const teachingRevision = table({ name: 'teaching_revision' }, {
  key: t.string().primaryKey(), practiceId: t.u64().index('btree'), version: t.u32(), fields: t.string(), status: t.string(), at: t.timestamp(),
});
export const teachingIntent = table({ name: 'teaching_intent' }, {
  key: t.string().primaryKey(), actor: t.identity(), digest: t.string(), practiceId: t.u64(), version: t.u32(),
});
export const teachingVersionTables = { teachingHead, teachingRevision, teachingIntent };
type Practice = NonNullable<ReturnType<Ctx['db']['teachingPractice']['id']['find']>>;
interface Fields { initial: TeachingExplanation; revised: TeachingExplanation; reflection: string; topicsToReview: string }
function fail(message: string): never { throw new SenderError(message); }
const string = (value: unknown, max: number): string => typeof value === 'string' && value.trim().length <= max ? value.trim() : fail('El texto de la práctica no es válido o excede su límite.');
function explanation(value: unknown): TeachingExplanation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('La explicación no es válida.');
  const input = value as Record<string, unknown>;
  return { concept: string(input.concept, 12_000), example: string(input.example, 12_000), limits: string(input.limits, 12_000) };
}
export function teachingVersion(db: ViewDb, practiceId: bigint) { return db.teachingHead?.practiceId.find(practiceId)?.version ?? 1; }
function fields(ctx: Ctx, row: Practice): Fields {
  const personal = ctx.db.teachingPersonal.practiceId.find(row.id);
  if (!personal) fail('La información personal no está disponible.');
  return { initial: { concept: row.concept, example: row.example, limits: row.limits },
    revised: { concept: row.revisedConcept, example: row.revisedExample, limits: row.revisedLimits }, reflection: personal.reflection, topicsToReview: personal.topicsToReview };
}
function capture(ctx: Ctx, row: Practice, version: number, value: Fields = fields(ctx, row)) {
  const key = `${row.id}:${version}`;
  if (!ctx.db.teachingRevision.key.find(key)) ctx.db.teachingRevision.insert({ key, practiceId: row.id, version, fields: JSON.stringify(value), status: row.status, at: row.updatedAt });
  const head = { practiceId: row.id, version };
  if (ctx.db.teachingHead.practiceId.find(row.id)) ctx.db.teachingHead.practiceId.update(head); else ctx.db.teachingHead.insert(head);
}
/** State transitions invalidate an open explanation editor without discarding its content. */
export function captureTeachingTransition(ctx: Ctx, before: Practice, after: Practice) {
  const current = teachingVersion(ctx.db, before.id);
  capture(ctx, before, current);
  capture(ctx, after, current + 1);
}
export function teachingResponse(run: () => string): string {
  try { return JSON.stringify({ ok: true, data: JSON.parse(run()) }); }
  catch (error) { if (error instanceof SenderError) return JSON.stringify({ ok: false, message: error.message }); throw error; }
}
export function saveTeachingVersion(ctx: Ctx, payload: string): string {
  activeMember(ctx);
  if (new TextEncoder().encode(payload).length > 400_000) fail('La práctica excede el límite de guardado.');
  let input: Record<string, unknown>;
  try { const parsed: unknown = JSON.parse(payload); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('Guardado inválido.'); input = parsed as Record<string, unknown>; }
  catch (error) { if (error instanceof SenderError) throw error; return fail('Guardado inválido.'); }
  if (typeof input.practiceId !== 'string' || !/^[1-9]\d{0,19}$/.test(input.practiceId) || BigInt(input.practiceId) > 18_446_744_073_709_551_615n) fail('La práctica no está disponible.');
  const practiceId = BigInt(input.practiceId);
  const row = ctx.db.teachingPractice.id.find(practiceId);
  if (!row?.owner.isEqual(ctx.sender)) fail('Solo el autor puede guardar esta práctica.');
  if (!Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) < 1 || !aiUuid(input.requestId)) fail('Actualiza la aplicación: indica la versión y el identificador de guardado.');
  const value: Fields = { initial: explanation(input.initial), revised: explanation(input.revised), reflection: string(input.reflection, 12_000), topicsToReview: string(input.topicsToReview, 4000) };
  const digest = aiHash({ practiceId: input.practiceId, expectedVersion: input.expectedVersion, ...value });
  const key = `${ctx.sender.toHexString()}:${input.requestId.toLowerCase()}`;
  const receipt = ctx.db.teachingIntent.key.find(key);
  if (receipt) { if (receipt.digest !== digest) fail('Este identificador ya se utilizó para otro guardado.'); return JSON.stringify({ id: String(receipt.practiceId), version: receipt.version }); }
  const current = teachingVersion(ctx.db, practiceId);
  if (current !== input.expectedVersion) fail('Mi práctica cambió. Recarga la versión actual antes de guardar.');
  if (row.status === 'completed') fail('Reabre la práctica para seguir editando.');
  const before = fields(ctx, row);
  if (row.status !== 'draft' && aiCanonical(before.initial) !== aiCanonical(value.initial)) fail('La explicación inicial se conserva al comenzar la práctica.');
  // Validation has finished: seed the existing value and write every changed field atomically.
  capture(ctx, row, current, before);
  let version = current;
  if (aiCanonical(before) !== aiCanonical(value)) {
    const next = { ...row, concept: value.initial.concept, example: value.initial.example, limits: value.initial.limits,
      revisedConcept: value.revised.concept, revisedExample: value.revised.example, revisedLimits: value.revised.limits, updatedAt: ctx.timestamp };
    const personal = ctx.db.teachingPersonal.practiceId.find(practiceId)!;
    ctx.db.teachingPractice.id.update(next);
    ctx.db.teachingPersonal.practiceId.update({ ...personal, reflection: value.reflection, topicsToReview: value.topicsToReview });
    version++; capture(ctx, next, version, value);
  }
  ctx.db.teachingIntent.insert({ key, actor: ctx.sender, digest, practiceId, version });
  return JSON.stringify({ id: String(practiceId), version });
}
export function readTeachingHistory(ctx: Ctx, practiceId: bigint): string {
  activeMember(ctx); const row = ctx.db.teachingPractice.id.find(practiceId);
  if (!row?.owner.isEqual(ctx.sender)) fail('Solo el autor puede consultar el historial de esta práctica.');
  const current = teachingVersion(ctx.db, practiceId);
  capture(ctx, row, current);
  return JSON.stringify([...ctx.db.teachingRevision.practiceId.filter(practiceId)].sort((a, b) => b.version - a.version).slice(0, 30)
    .map((entry) => ({ version: entry.version, ...JSON.parse(entry.fields), status: entry.status, at: Number(entry.at.microsSinceUnixEpoch / 1000n) })));
}
export function myTeachingVersions(db: ViewDb, sender: Ctx['sender']) {
  if (!isActive(db, sender)) return [];
  return [...db.teachingPractice.owner.filter(sender)].map((row) => ({ practiceId: row.id, version: teachingVersion(db, row.id) }));
}
