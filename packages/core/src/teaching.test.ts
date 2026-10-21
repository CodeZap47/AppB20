import { describe, expect, it } from 'vitest';
import {
  EMPTY_TEACHING_EXPLANATION, MAX_TEACHING_TEXT_LENGTH, normalizeTeachingExplanation,
  teachingCompletionError, teachingExplanationError, teachingNoteBody, TEACHING_PROMPTS,
} from './teaching';

const explanation = { concept: 'Una variable guarda un valor.', example: 'let saldo = 10;', limits: 'No siempre permite reasignación.' };

describe('prácticas de Aprende enseñando', () => {
  it('permite borradores incompletos y exige las tres partes al comenzar', () => {
    expect(teachingExplanationError(EMPTY_TEACHING_EXPLANATION)).toBeUndefined();
    expect(teachingExplanationError(EMPTY_TEACHING_EXPLANATION, true)).toBeTruthy();
    expect(teachingExplanationError({ ...explanation, limits: '  ' }, true)).toBeTruthy();
    expect(teachingExplanationError(explanation, true)).toBeUndefined();
  });

  it('rechaza texto excesivo y conserva bloques de código al normalizar', () => {
    expect(teachingExplanationError({ ...explanation, concept: 'x'.repeat(MAX_TEACHING_TEXT_LENGTH + 1) })).toBeTruthy();
    expect(normalizeTeachingExplanation({ ...explanation, example: '  ```js\nlet saldo = 10;\n```\n' }).example)
      .toBe('```js\nlet saldo = 10;\n```');
  });

  it('requiere revisión completa, reflexión y una respuesta para completar', () => {
    expect(teachingCompletionError(explanation, '', 1)).toMatch(/reflexión/);
    expect(teachingCompletionError(explanation, 'Necesito otro ejemplo.', 0)).toMatch(/pregunta/);
    expect(teachingCompletionError({ ...explanation, example: '' }, 'Necesito otro ejemplo.', 1)).toBeTruthy();
    expect(teachingCompletionError(explanation, 'Necesito otro ejemplo.', 1)).toBeUndefined();
    expect(TEACHING_PROMPTS).toHaveLength(3);
  });

  it('publica exclusivamente el concepto, el ejemplo y los límites revisados', () => {
    const privatePractice = { ...explanation, reflection: 'Mi reflexión secreta', sourceId: 'nota-secreta', answer: 'Mi respuesta privada' };
    const body = teachingNoteBody(privatePractice);
    expect(body).toBe(`Concepto\n${explanation.concept}\n\nEjemplo\n${explanation.example}\n\nDónde aplica y dónde no\n${explanation.limits}`);
    expect(body).not.toMatch(/secreta|privada/);
    expect(body.length).toBeLessThan(50_000);
  });
});
