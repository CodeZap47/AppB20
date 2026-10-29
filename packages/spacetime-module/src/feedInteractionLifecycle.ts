import type { Ctx } from './moduleContext';
import { verifiedRanking } from './feedRankingAdapter';

const sourceKind: Record<string, string> = { tarea: 'assignment', actividad: 'activity', trabajo: 'work', nota: 'note', pregunta: 'question', respuesta: 'answer', guia: 'guide', evidencia: 'evidence', spaced_collection: 'spaced' };
/** References only. Never copies source text or personal preparation into a share. */
export function examShareDependencies(ctx: Ctx, examId: string): Set<string> {
  const keys = new Set<string>(); const exam = ctx.db.studyExam.id.find(examId);
  if (!exam?.readyVersion) return keys;
  const version = ctx.db.examVersion.key.find(`${examId}:${exam.readyVersion}`);
  if (!version) return keys;
  try {
    const value = JSON.parse(version.json) as { preparation?: { sources?: { kind: string; refId: string; origins?: { kind: string; refId: string }[] }[]; fragments?: { origins?: { kind: string; refId: string }[] }[] } };
    const add = (ref: { kind: string; refId: string }) => {
      const kind = sourceKind[ref.kind] ?? ref.kind; keys.add(`${kind}:${ref.refId}`);
      if (kind === 'answer') { const answer = ctx.db.answer.id.find(BigInt(ref.refId)); if (answer) keys.add(`question:${answer.questionId}`); }
      if (kind === 'work') { const work = ctx.db.work.id.find(BigInt(ref.refId)); if (work) keys.add(`assignment:${work.assignmentId}`); }
      if (kind === 'evidence') { const evidence = ctx.db.evidence.id.find(BigInt(ref.refId)); if (evidence) keys.add(`activity:${evidence.activityId}`); }
      if (kind === 'spaced_card') { const card = ctx.db.spacedCard.id.find(BigInt(ref.refId)); if (card) keys.add(`spaced:${card.collectionId}`); }
    };
    for (const source of value.preparation?.sources ?? []) { add(source); for (const origin of source.origins ?? []) add(origin); }
    for (const fragment of value.preparation?.fragments ?? []) for (const origin of fragment.origins ?? []) add(origin);
  } catch { /* A malformed or unavailable version cannot produce a public preview. */ }
  return keys;
}

/** Called in the same transaction as withdrawal/privacy/deletion. Restoration never clears this tombstone. */
export function invalidateFeedShares(ctx: Ctx, kind: string, id: string | bigint) {
  const canonical = kind === 'feed_post' ? 'post' : kind === 'help_post' ? 'help' : kind;
  const target = `${canonical}:${id}`;
  // Optional access keeps old database-only maintenance/test adapters compatible.
  if (!ctx.db.feedShare) return;
  for (const share of ctx.db.feedShare.iter()) {
    if (share.invalidatedAt || share.revokedAt) continue;
    let affected = share.target === target;
    if (!affected && canonical === 'question' && share.targetKind === 'answer') affected = ctx.db.answer.id.find(BigInt(share.targetId))?.questionId.toString() === String(id);
    if (!affected && canonical === 'assignment' && share.targetKind === 'work') affected = ctx.db.work.id.find(BigInt(share.targetId))?.assignmentId.toString() === String(id);
    if (!affected && canonical === 'activity' && share.targetKind === 'evidence') affected = ctx.db.evidence.id.find(BigInt(share.targetId))?.activityId.toString() === String(id);
    if (!affected && canonical === 'challenge' && share.targetKind === 'solution') affected = ctx.db.challengeSolution.id.find(BigInt(share.targetId))?.challengeId.toString() === String(id);
    if (!affected && canonical === 'review' && share.targetKind === 'review-comment') affected = ctx.db.codeReviewComment.id.find(BigInt(share.targetId))?.reviewId.toString() === String(id);
    if (!affected && share.targetKind === 'exam') affected = examShareDependencies(ctx, share.targetId).has(target);
    if (!affected && share.targetKind === 'ranking') {
      const viewer = [...ctx.db.member.iter()].find((person) => person.status === 'active')?.identity;
      affected = !viewer || !verifiedRanking(ctx, share.targetId, viewer);
    }
    if (affected) ctx.db.feedShare.id.update({ ...share, invalidatedAt: ctx.timestamp });
  }
}

/** Purging a target also removes its general discussion; receipts retain only hashes/ids. */
export function purgeFeedThread(ctx: Ctx, kind: string, id: string | bigint) {
  invalidateFeedShares(ctx, kind, id);
  const target = `${kind === 'feed_post' ? 'post' : kind}:${id}`;
  if (ctx.db.feedThreadComment) for (const row of [...ctx.db.feedThreadComment.target.filter(target)]) ctx.db.feedThreadComment.id.delete(row.id);
}
