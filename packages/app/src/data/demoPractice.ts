import { normalizeChallenge, normalizeCodeReview, normalizeCodeSource, normalizeReviewKind, normalizeReviewResolution, practiceRequest, practiceText, validateCodeLines, PRACTICE_LIMITS } from '../../../core/src/practice';
import type { Member } from './types';
import { emptyPractice, type PracticeActions, type PracticeSnapshot, type ChallengeInput, type ChallengeSolutionInput, type ChallengeCommentInput, type CodeReviewInput, type CodeReviewVersionInput, type CodeReviewCommentInput } from './practiceTypes';
interface Context { state(): object; active(): Member; now(): Date; id(): string; emit(): void; }
interface Store extends PracticeSnapshot { progress: Map<string, number>; }
const stores = new WeakMap<object, Store>();
const clone = <T,>(value: T): T => structuredClone(value);
function expect(actual: number, expected: number) { if (actual !== expected) throw new Error('El contenido cambió. Actualiza antes de guardar.'); }
function open(closed: boolean) { if (closed) throw new Error('Esta discusión está cerrada.'); }
function replay(same: boolean) { if (!same) throw new Error('Este identificador de envío ya se usó para otro contenido. Inicia un nuevo envío.'); }
/** Estado compartido entre sesiones demo; pistas y progreso se filtran antes de crear el snapshot. */
export class DemoPracticeStore implements PracticeActions {
  constructor(private ctx: Context) {}
  private get data() { const key = this.ctx.state(); let data = stores.get(key); if (!data) { data = { ...emptyPractice(), progress: new Map() }; stores.set(key, data); } return data; }
  private challenge(id: string) { this.ctx.active(); const row = this.data.codingChallenges.find((entry) => entry.id === id); if (!row) throw new Error('El reto no está disponible.'); return row; }
  private review(id: string) { this.ctx.active(); const row = this.data.codeReviews.find((entry) => entry.id === id); if (!row) throw new Error('La revisión no está disponible.'); return row; }
  private own(authorId: string) { if (this.ctx.active().id !== authorId) throw new Error('Solo el autor puede hacer este cambio.'); }
  private subject(subjectId: string) { const state = this.ctx.state() as { subjects?: { id: string }[] }; if (!state.subjects?.some((subject) => subject.id === subjectId)) throw new Error('La materia no existe.'); }
  snapshot(): PracticeSnapshot {
    const me = this.ctx.active(); const data = this.data;
    return clone({ codingChallenges: data.codingChallenges, challengeHints: data.challengeHints.filter((hint) => this.challenge(hint.challengeId).authorId === me.id || hint.number <= (data.progress.get(`${hint.challengeId}:${me.id}`) ?? 0)),
      challengeProgress: data.codingChallenges.map((row) => ({ challengeId: row.id, unlockedHints: data.progress.get(`${row.id}:${me.id}`) ?? 0 })), challengeSolutions: data.challengeSolutions, challengeComments: data.challengeComments, codeReviews: data.codeReviews, codeReviewVersions: data.codeReviewVersions, codeReviewComments: data.codeReviewComments });
  }
  createCodingChallenge(raw: ChallengeInput) {
    const me = this.ctx.active(); const input = normalizeChallenge(raw); const old = this.data.codingChallenges.find((row) => row.authorId === me.id && row.requestId === input.requestId);
    if (old) { const hints = this.data.challengeHints.filter((hint) => hint.challengeId === old.id).sort((a, b) => a.number - b.number).map((hint) => hint.body); replay(old.subjectId === input.subjectId && old.title === input.title && old.topic === input.topic && old.difficulty === input.difficulty && old.objective === input.objective && old.instructions === input.instructions && old.examples === input.examples && JSON.stringify(hints) === JSON.stringify(input.hints)); return old.id; }
    this.subject(input.subjectId); const { hints, ...fields } = input; const id = this.ctx.id(); const at = this.ctx.now();
    this.data.codingChallenges.push({ ...fields, id, authorId: me.id, hintCount: hints.length, closed: false, closure: '', version: 1, createdAt: at, updatedAt: at });
    hints.forEach((body, index) => this.data.challengeHints.push({ challengeId: id, number: index + 1, body })); this.ctx.emit(); return id;
  }
  unlockChallengeHint(challengeId: string, expectedUnlocked: number) {
    const row = this.challenge(challengeId); const key = `${row.id}:${this.ctx.active().id}`; const unlocked = this.data.progress.get(key) ?? 0; if (expectedUnlocked + 1 === unlocked) return; expect(unlocked, expectedUnlocked); if (unlocked >= row.hintCount) throw new Error('No quedan pistas por descubrir.'); this.data.progress.set(key, unlocked + 1); this.ctx.emit();
  }
  saveChallengeSolution(input: ChallengeSolutionInput) {
    const row = this.challenge(input.challengeId); const me = this.ctx.active(); const requestId = practiceRequest(input.requestId); const own = this.data.challengeSolutions.find((entry) => entry.challengeId === row.id && entry.authorId === me.id); if (own?.requestId === requestId) { replay(own.body === practiceText(input.body, 'La solución', PRACTICE_LIMITS.code) && own.explanation === practiceText(input.explanation, 'La explicación', PRACTICE_LIMITS.explanation) && own.version === input.expectedVersion + 1); return; }
    open(row.closed); expect(own?.version ?? 0, input.expectedVersion); const at = this.ctx.now();
    const fields = { body: practiceText(input.body, 'La solución', PRACTICE_LIMITS.code), explanation: practiceText(input.explanation, 'La explicación', PRACTICE_LIMITS.explanation), requestId, updatedAt: at };
    if (own) Object.assign(own, fields, { version: own.version + 1 }); else this.data.challengeSolutions.push({ id: this.ctx.id(), challengeId: row.id, authorId: me.id, ...fields, version: 1, createdAt: at }); this.ctx.emit();
  }
  addChallengeComment(input: ChallengeCommentInput) {
    const row = this.challenge(input.challengeId); const me = this.ctx.active(); const requestId = practiceRequest(input.requestId); const old = this.data.challengeComments.find((entry) => entry.challengeId === row.id && entry.authorId === me.id && entry.requestId === requestId); if (old) { replay(old.solutionId === input.solutionId && old.body === practiceText(input.body, 'El comentario', PRACTICE_LIMITS.comment)); return; }
    open(row.closed); if (input.solutionId && !this.data.challengeSolutions.some((entry) => entry.id === input.solutionId && entry.challengeId === row.id)) throw new Error('La solución no pertenece a este reto.'); this.data.challengeComments.push({ ...input, id: this.ctx.id(), authorId: me.id, requestId, body: practiceText(input.body, 'El comentario', PRACTICE_LIMITS.comment), createdAt: this.ctx.now() }); this.ctx.emit();
  }
  closeCodingChallenge(challengeId: string, closure: string, expectedVersion: number) {
    const row = this.challenge(challengeId); this.own(row.authorId); const clean = practiceText(closure, 'La conclusión del reto', PRACTICE_LIMITS.explanation); if (row.closed && row.closure === clean) return; expect(row.version, expectedVersion); Object.assign(row, { closed: true, closure: clean, version: row.version + 1, updatedAt: this.ctx.now() }); this.ctx.emit();
  }
  createCodeReview(raw: CodeReviewInput) {
    const me = this.ctx.active(); const input = normalizeCodeReview(raw); const requestId = input.requestId; const old = this.data.codeReviews.find((row) => row.authorId === me.id && row.requestId === requestId); if (old) { const first = this.data.codeReviewVersions.find((version) => version.reviewId === old.id && version.number === 1); replay(old.subjectId === input.subjectId && old.title === input.title && old.language === input.language && first?.code === input.code && first.repositoryUrl === input.repositoryUrl && first.summary === input.summary); return old.id; }
    this.subject(input.subjectId); const { code, repositoryUrl, summary, ...fields } = input; const id = this.ctx.id(); const at = this.ctx.now(); this.data.codeReviews.push({ ...fields, id, authorId: me.id, currentVersion: 1, closed: false, version: 1, createdAt: at, updatedAt: at }); this.data.codeReviewVersions.push({ reviewId: id, number: 1, code, repositoryUrl, summary, requestId, createdAt: at }); this.ctx.emit(); return id;
  }
  addCodeReviewVersion(input: CodeReviewVersionInput) {
    const row = this.review(input.reviewId); this.own(row.authorId); const requestId = practiceRequest(input.requestId); const source = normalizeCodeSource(input.code, input.repositoryUrl); const summary = practiceText(input.summary, 'El contexto', PRACTICE_LIMITS.explanation); const old = this.data.codeReviewVersions.find((entry) => entry.reviewId === row.id && entry.requestId === requestId); if (old) { replay(old.code === source.code && old.repositoryUrl === source.repositoryUrl && old.summary === summary && old.number === input.expectedVersion + 1); return; } open(row.closed); expect(row.version, input.expectedVersion); const number = row.currentVersion + 1; const at = this.ctx.now();
    this.data.codeReviewVersions.push({ reviewId: row.id, number, ...source, summary, requestId, createdAt: at }); Object.assign(row, { currentVersion: number, version: row.version + 1, updatedAt: at }); this.ctx.emit();
  }
  addCodeReviewComment(input: CodeReviewCommentInput) {
    const row = this.review(input.reviewId); const me = this.ctx.active(); const requestId = practiceRequest(input.requestId); const old = this.data.codeReviewComments.find((entry) => entry.reviewId === row.id && entry.authorId === me.id && entry.requestId === requestId); if (old) { replay(old.versionNumber === input.versionNumber && old.lineStart === input.lineStart && old.lineEnd === input.lineEnd && old.kind === input.kind && old.body === practiceText(input.body, 'El comentario', PRACTICE_LIMITS.comment)); return; } open(row.closed); const version = this.data.codeReviewVersions.find((entry) => entry.reviewId === row.id && entry.number === input.versionNumber); if (!version) throw new Error('Esta versión no existe.'); validateCodeLines(version.code, input.lineStart, input.lineEnd);
    const at = this.ctx.now(); this.data.codeReviewComments.push({ ...input, kind: normalizeReviewKind(input.kind), id: this.ctx.id(), authorId: me.id, requestId, body: practiceText(input.body, 'El comentario', PRACTICE_LIMITS.comment), status: 'pending', resolution: '', version: 1, createdAt: at, updatedAt: at }); this.ctx.emit();
  }
  resolveCodeReviewComment(commentId: string, status: 'pending' | 'applied' | 'dismissed', resolution: string, expectedVersion: number) {
    const comment = this.data.codeReviewComments.find((entry) => entry.id === commentId); if (!comment) throw new Error('El comentario no existe.'); const row = this.review(comment.reviewId); this.own(row.authorId); open(row.closed); normalizeReviewResolution(status); const clean = practiceText(resolution, 'La explicación de la decisión', PRACTICE_LIMITS.comment, status !== 'pending'); if (comment.status === status && comment.resolution === clean) return; expect(comment.version, expectedVersion); Object.assign(comment, { status, resolution: clean, version: comment.version + 1, updatedAt: this.ctx.now() }); this.ctx.emit();
  }
  closeCodeReview(reviewId: string, expectedVersion: number) { const row = this.review(reviewId); this.own(row.authorId); if (row.closed) return; expect(row.version, expectedVersion); Object.assign(row, { closed: true, version: row.version + 1, updatedAt: this.ctx.now() }); this.ctx.emit(); }
}
