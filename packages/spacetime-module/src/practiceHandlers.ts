import { SenderError } from 'spacetimedb/server';
import { activeMember, expectVersion, isActive, log, requireSubject, type Ctx, type ViewDb } from './moduleContext';
import { normalizeChallenge, normalizeCodeReview, normalizeCodeSource, normalizeReviewKind, normalizeReviewResolution, practiceId, practiceRequest, practiceText, validateCodeLines, PRACTICE_LIMITS, type ChallengeInput, type ChallengeSolutionInput, type ChallengeCommentInput, type CodeReviewInput, type CodeReviewVersionInput, type CodeReviewCommentInput } from '../../core/src/practice';

function checked<T>(fn: () => T): T { try { return fn(); } catch (error) { throw new SenderError(error instanceof Error ? error.message : 'El envío no es válido.'); } }
export function decodePractice<T>(payload: string): T { return checked(() => { if (typeof payload !== 'string' || payload.length > 100_000) throw new Error('El envío es demasiado grande.'); const parsed: unknown = JSON.parse(payload); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('El envío no es válido.'); return parsed as T; }); }
const id = (value: unknown) => checked(() => BigInt(practiceId(value)));
const request = (value: unknown) => checked(() => practiceRequest(value));
const text = (value: unknown, label: string, max: number, required = true) => checked(() => practiceText(value, label, max, required));
function challenge(ctx: Ctx, challengeId: bigint) { activeMember(ctx); const row = ctx.db.codingChallenge.id.find(challengeId); if (!row) throw new SenderError('El reto no está disponible.'); return row; }
function review(ctx: Ctx, reviewId: bigint) { activeMember(ctx); const row = ctx.db.codeReview.id.find(reviewId); if (!row) throw new SenderError('La revisión no está disponible.'); return row; }
function ongoing(closed: boolean) { if (closed) throw new SenderError('Esta discusión está cerrada.'); }
function author(ctx: Ctx, value: Ctx['sender']) { if (!ctx.sender.isEqual(value)) throw new SenderError('Solo el autor puede hacer este cambio.'); }
function replay(same: boolean) { if (!same) throw new SenderError('Este identificador de envío ya se usó para otro contenido. Inicia un nuevo envío.'); }

export function createChallenge(ctx: Ctx, raw: ChallengeInput) {
  activeMember(ctx); const input = checked(() => normalizeChallenge(raw));
  const old = [...ctx.db.codingChallenge.author.filter(ctx.sender)].find((row) => row.requestId === input.requestId);
  if (old) { const hints = [...ctx.db.challengeHint.challengeId.filter(old.id)].sort((a, b) => a.number - b.number).map((hint) => hint.body); replay(old.subjectId === id(input.subjectId) && old.title === input.title && old.topic === input.topic && old.difficulty === input.difficulty && old.objective === input.objective && old.instructions === input.instructions && old.examples === input.examples && JSON.stringify(hints) === JSON.stringify(input.hints)); return; }
  requireSubject(ctx, id(input.subjectId));
  const { hints, subjectId, ...fields } = input;
  const row = ctx.db.codingChallenge.insert({ id: 0n, author: ctx.sender, ...fields, subjectId: id(subjectId), hintCount: hints.length, closed: false, closure: '', version: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
  hints.forEach((body, index) => ctx.db.challengeHint.insert({ key: `${row.id}:${index + 1}`, challengeId: row.id, number: index + 1, body })); log(ctx, 'create', 'challenge', row.id);
}
export function unlockChallengeHint(ctx: Ctx, input: { challengeId: string; expectedUnlocked: number }) {
  const row = challenge(ctx, id(input.challengeId)); const key = `${row.id}:${ctx.sender.toHexString()}`; const old = ctx.db.challengeProgress.key.find(key); const unlocked = old?.unlockedHints ?? 0;
  // A repeated click for the same step is idempotent and cannot reveal a second hint.
  if (input.expectedUnlocked + 1 === unlocked) return;
  expectVersion(unlocked, input.expectedUnlocked); if (unlocked >= row.hintCount) throw new SenderError('No quedan pistas por descubrir.');
  const next = { key, challengeId: row.id, memberId: ctx.sender, unlockedHints: unlocked + 1, updatedAt: ctx.timestamp };
  if (old) ctx.db.challengeProgress.key.update(next); else ctx.db.challengeProgress.insert(next);
}
export function saveChallengeSolution(ctx: Ctx, input: ChallengeSolutionInput) {
  const row = challenge(ctx, id(input.challengeId)); const requestId = request(input.requestId);
  const own = [...ctx.db.challengeSolution.challengeId.filter(row.id)].find((entry) => entry.author.isEqual(ctx.sender));
  if (own?.requestId === requestId) { replay(own.body === text(input.body, 'La solución', PRACTICE_LIMITS.code) && own.explanation === text(input.explanation, 'La explicación', PRACTICE_LIMITS.explanation) && own.version === input.expectedVersion + 1); return; }
  ongoing(row.closed); expectVersion(own?.version ?? 0, input.expectedVersion);
  const fields = { body: text(input.body, 'La solución', PRACTICE_LIMITS.code), explanation: text(input.explanation, 'La explicación', PRACTICE_LIMITS.explanation), requestId, updatedAt: ctx.timestamp };
  if (own) ctx.db.challengeSolution.id.update({ ...own, ...fields, version: own.version + 1 });
  else ctx.db.challengeSolution.insert({ id: 0n, challengeId: row.id, author: ctx.sender, ...fields, version: 1, createdAt: ctx.timestamp });
}
export function addChallengeComment(ctx: Ctx, input: ChallengeCommentInput) {
  const row = challenge(ctx, id(input.challengeId)); const requestId = request(input.requestId);
  const old = [...ctx.db.challengeComment.challengeId.filter(row.id)].find((entry) => entry.author.isEqual(ctx.sender) && entry.requestId === requestId);
  if (old) { replay(old.solutionId === (input.solutionId === undefined ? undefined : id(input.solutionId)) && old.body === text(input.body, 'El comentario', PRACTICE_LIMITS.comment)); return; }
  ongoing(row.closed); const solutionId = input.solutionId === undefined ? undefined : id(input.solutionId);
  if (solutionId !== undefined && ctx.db.challengeSolution.id.find(solutionId)?.challengeId !== row.id) throw new SenderError('La solución no pertenece a este reto.');
  ctx.db.challengeComment.insert({ id: 0n, challengeId: row.id, solutionId, author: ctx.sender, body: text(input.body, 'El comentario', PRACTICE_LIMITS.comment), requestId, createdAt: ctx.timestamp });
}
export function closeChallenge(ctx: Ctx, input: { challengeId: string; closure: string; expectedVersion: number }) {
  const row = challenge(ctx, id(input.challengeId)); author(ctx, row.author); const closure = text(input.closure, 'La conclusión del reto', PRACTICE_LIMITS.explanation); if (row.closed && row.closure === closure) return; expectVersion(row.version, input.expectedVersion);
  ctx.db.codingChallenge.id.update({ ...row, closed: true, closure, version: row.version + 1, updatedAt: ctx.timestamp }); log(ctx, 'close', 'challenge', row.id);
}
export function createCodeReview(ctx: Ctx, raw: CodeReviewInput) {
  activeMember(ctx); const input = checked(() => normalizeCodeReview(raw)); const requestId = input.requestId; const old = [...ctx.db.codeReview.author.filter(ctx.sender)].find((row) => row.requestId === requestId);
  if (old) { const first = ctx.db.codeReviewVersion.key.find(`${old.id}:1`); replay(old.subjectId === id(input.subjectId) && old.title === input.title && old.language === input.language && first?.code === input.code && first.repositoryUrl === input.repositoryUrl && first.summary === input.summary); return; }
  requireSubject(ctx, id(input.subjectId)); const { code, repositoryUrl, summary, subjectId, ...fields } = input;
  const row = ctx.db.codeReview.insert({ id: 0n, author: ctx.sender, ...fields, subjectId: id(subjectId), currentVersion: 1, closed: false, version: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
  ctx.db.codeReviewVersion.insert({ key: `${row.id}:1`, reviewId: row.id, number: 1, code, repositoryUrl, summary, requestId, createdAt: ctx.timestamp }); log(ctx, 'create', 'code_review', row.id);
}
export function addCodeReviewVersion(ctx: Ctx, input: CodeReviewVersionInput) {
  const row = review(ctx, id(input.reviewId)); author(ctx, row.author); const requestId = request(input.requestId);
  const source = checked(() => normalizeCodeSource(input.code, input.repositoryUrl)); const summary = text(input.summary, 'El contexto', PRACTICE_LIMITS.explanation);
  const old = [...ctx.db.codeReviewVersion.reviewId.filter(row.id)].find((entry) => entry.requestId === requestId);
  if (old) { replay(old.code === source.code && old.repositoryUrl === source.repositoryUrl && old.summary === summary && old.number === input.expectedVersion + 1); return; }
  ongoing(row.closed); expectVersion(row.version, input.expectedVersion);
  const number = row.currentVersion + 1;
  ctx.db.codeReviewVersion.insert({ key: `${row.id}:${number}`, reviewId: row.id, number, ...source, summary, requestId, createdAt: ctx.timestamp });
  ctx.db.codeReview.id.update({ ...row, currentVersion: number, version: row.version + 1, updatedAt: ctx.timestamp });
}
export function addCodeReviewComment(ctx: Ctx, input: CodeReviewCommentInput) {
  const row = review(ctx, id(input.reviewId)); const requestId = request(input.requestId);
  const old = [...ctx.db.codeReviewComment.reviewId.filter(row.id)].find((entry) => entry.author.isEqual(ctx.sender) && entry.requestId === requestId);
  if (old) { replay(old.versionNumber === input.versionNumber && old.lineStart === input.lineStart && old.lineEnd === input.lineEnd && old.kind === input.kind && old.body === text(input.body, 'El comentario', PRACTICE_LIMITS.comment)); return; }
  ongoing(row.closed); const version = ctx.db.codeReviewVersion.key.find(`${row.id}:${input.versionNumber}`); if (!version) throw new SenderError('Esta versión no existe.');
  checked(() => validateCodeLines(version.code, input.lineStart, input.lineEnd)); const kind = checked(() => normalizeReviewKind(input.kind));
  ctx.db.codeReviewComment.insert({ id: 0n, reviewId: row.id, versionNumber: version.number, lineStart: input.lineStart, lineEnd: input.lineEnd, kind, author: ctx.sender, body: text(input.body, 'El comentario', PRACTICE_LIMITS.comment), status: 'pending', resolution: '', version: 1, requestId, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
}
export function resolveCodeReviewComment(ctx: Ctx, input: { commentId: string; status: string; resolution: string; expectedVersion: number }) {
  activeMember(ctx); const comment = ctx.db.codeReviewComment.id.find(id(input.commentId)); if (!comment) throw new SenderError('El comentario no existe.'); const row = review(ctx, comment.reviewId); author(ctx, row.author); ongoing(row.closed);
  const status = checked(() => normalizeReviewResolution(input.status)); const resolution = text(input.resolution, 'La explicación de la decisión', PRACTICE_LIMITS.comment, status !== 'pending');
  if (comment.status === status && comment.resolution === resolution) return; expectVersion(comment.version, input.expectedVersion);
  ctx.db.codeReviewComment.id.update({ ...comment, status, resolution, version: comment.version + 1, updatedAt: ctx.timestamp });
}
export function closeCodeReview(ctx: Ctx, input: { reviewId: string; expectedVersion: number }) {
  const row = review(ctx, id(input.reviewId)); author(ctx, row.author); if (row.closed) return; expectVersion(row.version, input.expectedVersion); ctx.db.codeReview.id.update({ ...row, closed: true, version: row.version + 1, updatedAt: ctx.timestamp });
}
export const practiceVisible = (db: ViewDb, sender: Ctx['sender']) => isActive(db, sender);
export function visibleChallengeHints(db: ViewDb, sender: Ctx['sender']) {
  if (!isActive(db, sender)) return [];
  return [...db.challengeHint.iter()].filter((hint) => { const row = db.codingChallenge.id.find(hint.challengeId); return !!row && (row.author.isEqual(sender) || hint.number <= (db.challengeProgress.key.find(`${row.id}:${sender.toHexString()}`)?.unlockedHints ?? 0)); });
}
export function visibleChallengeProgress(db: ViewDb, sender: Ctx['sender']) { return isActive(db, sender) ? [...db.challengeProgress.iter()].filter((row) => row.memberId.isEqual(sender)) : []; }
