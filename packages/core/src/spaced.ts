/** Programación manual y explícita del repaso; no utiliza respuestas escritas ni IA. */
export const SPACED_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60, 120] as const;
export const SPACED_DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_SPACED_TITLE_LENGTH = 200;
export const MAX_SPACED_QUESTION_LENGTH = 1000;
export const MAX_SPACED_EXPLANATION_LENGTH = 20_000;
export const MAX_SPACED_HINT_LENGTH = 2000;
export type SpacedRating = 'remembered' | 'hint' | 'again';
export type SpacedSourceKind = 'note' | 'guide';
export type SpacedVisibility = 'personal' | 'group';

export const SPACED_RATING_LABEL: Record<SpacedRating, string> = {
  remembered: 'Lo recordé', hint: 'Necesité una pista', again: 'Debo repasarlo',
};

export function isSpacedRating(value: string): value is SpacedRating {
  return value === 'remembered' || value === 'hint' || value === 'again';
}

export function isSpacedSourceKind(value: string): value is SpacedSourceKind {
  return value === 'note' || value === 'guide';
}

/** step cuenta aciertos consecutivos hasta el límite; now siempre lo determina el servidor. */
export function nextSpacedSchedule(step: number, rating: SpacedRating, now: number) {
  if (!Number.isInteger(step) || step < 0 || step > SPACED_INTERVAL_DAYS.length) {
    throw new Error('El avance de repaso no es válido.');
  }
  if (!Number.isFinite(now) || !isSpacedRating(rating)) throw new Error('La revisión no es válida.');
  if (rating === 'again') return { step: 0, dueAt: now + 10 * 60 * 1000 };
  if (rating === 'hint') return { step, dueAt: now + SPACED_DAY_MS };
  const nextStep = Math.min(step + 1, SPACED_INTERVAL_DAYS.length);
  return { step: nextStep, dueAt: now + SPACED_INTERVAL_DAYS[nextStep - 1]! * SPACED_DAY_MS };
}

export function spacedCardError(fields: { question: string; explanation: string; hint: string }): string | undefined {
  for (const [key, label, max, required] of [
    ['question', 'La pregunta', MAX_SPACED_QUESTION_LENGTH, true],
    ['explanation', 'La explicación', MAX_SPACED_EXPLANATION_LENGTH, true],
    ['hint', 'La pista', MAX_SPACED_HINT_LENGTH, false],
  ] as const) {
    const text = fields[key].trim();
    if (required && !text) return `${label} no puede estar vacía.`;
    if (text.length > max) return `${label} excede ${max} caracteres.`;
  }
  return undefined;
}
