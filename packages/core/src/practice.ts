export type ChallengeDifficulty = 'basic' | 'intermediate' | 'advanced';
export type CodeReviewCommentKind = 'error' | 'suggestion' | 'question';
export type CodeReviewResolution = 'pending' | 'applied' | 'dismissed';
export const PRACTICE_LIMITS = { title: 160, topic: 240, objective: 2_000, instructions: 20_000, examples: 10_000, hints: 8, hint: 3_000, code: 60_000, explanation: 12_000, comment: 4_000, requestId: 128 } as const;
export interface ChallengeInput { requestId: string; subjectId: string; title: string; topic: string; difficulty: ChallengeDifficulty; objective: string; instructions: string; examples: string; hints: string[]; }
export interface ChallengeSolutionInput { challengeId: string; body: string; explanation: string; expectedVersion: number; requestId: string; }
export interface ChallengeCommentInput { challengeId: string; solutionId?: string; body: string; requestId: string; }
export interface CodeReviewInput { requestId: string; subjectId: string; title: string; language: string; summary: string; code: string; repositoryUrl: string; }
export interface CodeReviewVersionInput { reviewId: string; code: string; repositoryUrl: string; summary: string; expectedVersion: number; requestId: string; }
export interface CodeReviewCommentInput { reviewId: string; versionNumber: number; lineStart: number; lineEnd: number; kind: CodeReviewCommentKind; body: string; requestId: string; }
export function practiceText(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string') throw new Error(`${label} no es válido.`);
  const text = value.trim(); if (required && !text) throw new Error(`${label} es obligatorio.`);
  if (text.length > max) throw new Error(`${label} admite hasta ${max} caracteres.`); return text;
}
export function practiceRequest(value: unknown) { return practiceText(value, 'El identificador de envío', PRACTICE_LIMITS.requestId); }
export function practiceId(value: unknown): string { const text = practiceText(value, 'El identificador', 20); if (!/^[1-9]\d{0,19}$/.test(text) || BigInt(text) > 18446744073709551615n) throw new Error('El identificador no es válido.'); return text; }
export function normalizeChallenge(input: ChallengeInput): ChallengeInput {
  if (!['basic', 'intermediate', 'advanced'].includes(input.difficulty)) throw new Error('La dificultad no es válida.');
  if (!Array.isArray(input.hints) || input.hints.length > PRACTICE_LIMITS.hints) throw new Error('Puedes añadir hasta ocho pistas.');
  return { requestId: practiceRequest(input.requestId), subjectId: practiceText(input.subjectId, 'La materia', 80), title: practiceText(input.title, 'El título', PRACTICE_LIMITS.title), topic: practiceText(input.topic, 'El tema', PRACTICE_LIMITS.topic), difficulty: input.difficulty,
    objective: practiceText(input.objective, 'El objetivo', PRACTICE_LIMITS.objective), instructions: practiceText(input.instructions, 'Las instrucciones', PRACTICE_LIMITS.instructions), examples: practiceText(input.examples, 'Los ejemplos', PRACTICE_LIMITS.examples), hints: input.hints.map((hint) => practiceText(hint, 'Cada pista', PRACTICE_LIMITS.hint)) };
}
/** Un enlace es una referencia: nunca se descarga ni ejecuta desde el servidor. */
export function normalizeCodeSource(code: unknown, repositoryUrl: unknown): { code: string; repositoryUrl: string } {
  if (typeof code !== 'string' || code.length > PRACTICE_LIMITS.code) throw new Error('El código admite hasta 60000 caracteres.');
  const text = code.trim() ? code.replace(/\r\n?/g, '\n') : '';
  const url = practiceText(repositoryUrl, 'El enlace', 2_000, false);
  if (!text && !url) throw new Error('Pega código o añade un enlace HTTPS al repositorio.');
  if (url && (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.test(url) || /[@\\\u0000-\u0020]/.test(url))) throw new Error('Usa un enlace HTTPS sin credenciales.');
  return { code: text, repositoryUrl: url };
}
export function normalizeCodeReview(input: CodeReviewInput): CodeReviewInput { return { requestId: practiceRequest(input.requestId), subjectId: practiceText(input.subjectId, 'La materia', 80), title: practiceText(input.title, 'El título', PRACTICE_LIMITS.title), language: practiceText(input.language, 'El lenguaje', 80), summary: practiceText(input.summary, 'El contexto', PRACTICE_LIMITS.explanation), ...normalizeCodeSource(input.code, input.repositoryUrl) }; }
export function validateCodeLines(code: string, start: number, end: number) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || (start === 0 && end !== 0) || (start > 0 && (!code || end > code.split('\n').length))) throw new Error('Selecciona líneas existentes de esta versión, o 0 para un comentario general.');
}
export function normalizeReviewKind(value: unknown): CodeReviewCommentKind { if (!['error', 'suggestion', 'question'].includes(value as string)) throw new Error('El tipo de comentario no es válido.'); return value as CodeReviewCommentKind; }
export function normalizeReviewResolution(value: unknown): CodeReviewResolution { if (!['pending', 'applied', 'dismissed'].includes(value as string)) throw new Error('El estado no es válido.'); return value as CodeReviewResolution; }
export function emptyPracticeSnapshot() { return { codingChallenges: [], challengeHints: [], challengeProgress: [], challengeSolutions: [], challengeComments: [], codeReviews: [], codeReviewVersions: [], codeReviewComments: [] }; }
