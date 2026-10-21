/** Práctica personal de explicar un concepto, con preguntas de IA opcionales y revisadas. */
export type TeachingStatus = 'draft' | 'practicing' | 'completed';
export type TeachingSourceKind = 'note' | 'guide';

export interface TeachingExplanation {
  concept: string;
  example: string;
  limits: string;
}

export const EMPTY_TEACHING_EXPLANATION: Readonly<TeachingExplanation> = {
  concept: '', example: '', limits: '',
};
export const MAX_TEACHING_TOPIC_LENGTH = 120;
export const MAX_TEACHING_TEXT_LENGTH = 12_000;
export const MAX_TEACHING_QUESTION_LENGTH = 4_000;
export const TEACHING_PROMPTS = [
  '¿En qué se diferencia este concepto de otro parecido?',
  '¿Por qué funciona el ejemplo que diste?',
  '¿Puedes describir un caso en el que este concepto no aplica?',
] as const;

export function normalizeTeachingExplanation(value: TeachingExplanation): TeachingExplanation {
  return { concept: value.concept.trim(), example: value.example.trim(), limits: value.limits.trim() };
}

export function teachingExplanationError(value: TeachingExplanation, required = false): string | undefined {
  const labels: Record<keyof TeachingExplanation, string> = {
    concept: 'La explicación', example: 'El ejemplo', limits: 'Los límites del concepto',
  };
  for (const field of ['concept', 'example', 'limits'] as const) {
    if (required && !value[field].trim()) return `${labels[field]} no puede estar vacío.`;
    if (value[field].trim().length > MAX_TEACHING_TEXT_LENGTH) {
      return `${labels[field]} excede ${MAX_TEACHING_TEXT_LENGTH} caracteres.`;
    }
  }
  return undefined;
}

export function teachingCompletionError(
  revised: TeachingExplanation,
  reflection: string,
  answeredCount: number,
): string | undefined {
  const error = teachingExplanationError(revised, true);
  if (error) return error;
  if (!reflection.trim()) return 'Escribe una reflexión personal antes de completar la práctica.';
  if (reflection.trim().length > MAX_TEACHING_TEXT_LENGTH) {
    return `La reflexión excede ${MAX_TEACHING_TEXT_LENGTH} caracteres.`;
  }
  if (answeredCount < 1) return 'Responde al menos una pregunta antes de completar la práctica.';
  return undefined;
}

/** Solo estos tres campos pasan a la nota compartida; no acepta datos personales de la sesión. */
export function teachingNoteBody(value: TeachingExplanation): string {
  const explanation = normalizeTeachingExplanation(value);
  return `Concepto\n${explanation.concept}\n\nEjemplo\n${explanation.example}\n\nDónde aplica y dónde no\n${explanation.limits}`;
}
