/** Ensayos por texto. Las preguntas de apoyo son plantillas locales, no respuestas de IA. */
export type PresentationStatus = 'draft' | 'completed';
export type PresentationSourceKind = 'note' | 'guide';
export type PresentationQuestionKind = 'guided' | 'personal' | 'peer';
export interface PresentationObservations {
  clarity: string;
  examples: string;
  decisions: string;
  limitations: string;
}
export const PRESENTATION_LIMITS = {
  title: 160, topic: 240, audience: 240, keyPoints: 12, keyPoint: 300,
  body: 30_000, observation: 3_000, nextSteps: 4_000, question: 1_000, answer: 6_000,
  maxMinutes: 120,
} as const;
export const PRESENTATION_RUBRIC = [
  { key: 'clarity', label: 'Claridad', prompt: '¿Se entiende la idea principal y el orden de la explicación?' },
  { key: 'examples', label: 'Ejemplos', prompt: '¿Hay un ejemplo concreto que ayude a entender el tema?' },
  { key: 'decisions', label: 'Justificación de decisiones', prompt: '¿Se explica por qué se eligió este enfoque?' },
  { key: 'limitations', label: 'Limitaciones', prompt: '¿Se reconocen límites, supuestos y dudas pendientes?' },
] as const;
export const emptyPresentationObservations = (): PresentationObservations => ({ clarity: '', examples: '', decisions: '', limitations: '' });
export interface PresentationConfiguration {
  title: string; topic: string; audience: string; targetMinutes: number; keyPoints: string[];
}
function text(value: string, label: string, max: number, required = false): string {
  if (typeof value !== 'string') throw new Error(`${label} no es válido.`);
  const clean = value.trim();
  if (required && !clean) throw new Error(`${label} es obligatorio.`);
  if (clean.length > max) throw new Error(`${label} admite hasta ${max} caracteres.`);
  return clean;
}
export function normalizePresentationConfiguration(input: PresentationConfiguration): PresentationConfiguration {
  if (!Number.isInteger(input.targetMinutes) || input.targetMinutes < 1 || input.targetMinutes > PRESENTATION_LIMITS.maxMinutes) {
    throw new Error('La duración debe ser un número entero entre 1 y 120 minutos.');
  }
  if (!Array.isArray(input.keyPoints) || input.keyPoints.length > PRESENTATION_LIMITS.keyPoints) throw new Error('Puedes indicar hasta 12 puntos a cubrir.');
  const keyPoints = input.keyPoints.map((point) => text(point, 'Cada punto', PRESENTATION_LIMITS.keyPoint)).filter(Boolean);
  if (!keyPoints.length) throw new Error('Indica al menos un punto a cubrir.');
  return { title: text(input.title, 'El título', PRESENTATION_LIMITS.title, true),
    topic: text(input.topic, 'El tema', PRESENTATION_LIMITS.topic, true),
    audience: text(input.audience, 'El público', PRESENTATION_LIMITS.audience, true),
    targetMinutes: input.targetMinutes, keyPoints: [...new Set(keyPoints)] };
}
export function normalizePresentationObservations(input: PresentationObservations): PresentationObservations {
  return Object.fromEntries(PRESENTATION_RUBRIC.map(({ key, label }) => [key, text(input[key], label, PRESENTATION_LIMITS.observation)])) as unknown as PresentationObservations;
}
export function normalizePresentationBody(body: string, completing = false): string {
  return text(body, 'La explicación', PRESENTATION_LIMITS.body, completing);
}
export function normalizePresentationNextSteps(value: string): string { return text(value, 'Los siguientes pasos', PRESENTATION_LIMITS.nextSteps); }
export function normalizePresentationQuestion(value: string): string { return text(value, 'La pregunta', PRESENTATION_LIMITS.question, true); }
export function normalizePresentationAnswer(value: string): string { return text(value, 'La respuesta', PRESENTATION_LIMITS.answer, true); }
export function normalizePresentationFeedback(input: PresentationObservations & { comment: string }): PresentationObservations & { comment: string } {
  const result = { ...normalizePresentationObservations(input), comment: text(input.comment, 'El comentario', PRESENTATION_LIMITS.observation) };
  if (!Object.values(result).some(Boolean)) throw new Error('Escribe al menos una observación.');
  return result;
}
export function presentationGuidingQuestions(input: PresentationConfiguration): string[] {
  const { topic, audience, keyPoints } = normalizePresentationConfiguration(input);
  return [
    `¿Cómo explicarías la idea principal de «${topic}» a ${audience}?`,
    `¿Puedes dar un ejemplo concreto de «${keyPoints[0]}»?`,
    '¿Por qué elegiste ese enfoque y qué alternativa consideraste?',
    '¿Qué limitaciones, supuestos o dudas pendientes tiene tu explicación?',
    `¿Cómo relacionas ${keyPoints.length > 1 ? `«${keyPoints[0]}» con «${keyPoints[1]}»` : `«${keyPoints[0]}» con el tema principal`}?`,
  ];
}
/** Referencia orientativa de 120 palabras/minuto; no mide una exposición oral real. */
export function presentationTextEstimate(body: string): { words: number; minutes: number } {
  const words = body.trim() ? body.trim().split(/\s+/u).length : 0;
  return { words, minutes: Math.round(words / 120 * 10) / 10 };
}
