import { describe, expect, it } from 'vitest';
import {
  emptyPresentationObservations, normalizePresentationAnswer, normalizePresentationBody,
  normalizePresentationConfiguration, normalizePresentationFeedback, normalizePresentationNextSteps,
  normalizePresentationObservations, normalizePresentationQuestion, PRESENTATION_LIMITS,
  presentationGuidingQuestions, presentationTextEstimate,
} from './presentations';

const configuration = { title: ' Redes ', topic: ' TCP ', audience: ' compañeros ', targetMinutes: 5,
  keyPoints: [' Conexión ', 'Fiabilidad', 'Conexión', ''] };

describe('exposiciones por texto', () => {
  it('normaliza configuración sin inventar puntos y conserva el orden', () => {
    expect(normalizePresentationConfiguration(configuration)).toEqual({ title: 'Redes', topic: 'TCP',
      audience: 'compañeros', targetMinutes: 5, keyPoints: ['Conexión', 'Fiabilidad'] });
  });
  it.each([0, -1, 121, 1.5, NaN, Infinity])('rechaza duración inválida %s', (targetMinutes) => {
    expect(() => normalizePresentationConfiguration({ ...configuration, targetMinutes })).toThrow('duración');
  });
  it.each(['title', 'topic', 'audience'] as const)('exige %s', (field) => {
    expect(() => normalizePresentationConfiguration({ ...configuration, [field]: ' \n ' })).toThrow('obligatorio');
  });
  it('exige puntos y limita el contenido que persistirá el servidor', () => {
    expect(() => normalizePresentationConfiguration({ ...configuration, keyPoints: [' ', ''] })).toThrow('al menos');
    expect(() => normalizePresentationConfiguration({ ...configuration, keyPoints: Array(13).fill('punto') })).toThrow('12');
    expect(() => normalizePresentationConfiguration({ ...configuration, keyPoints: ['a'.repeat(301)] })).toThrow('300');
    expect(() => normalizePresentationConfiguration({ ...configuration, title: 'a'.repeat(161) })).toThrow('160');
  });
  it('diferencia el borrador vacío de un ensayo concluido', () => {
    expect(normalizePresentationBody('   ')).toBe('');
    expect(() => normalizePresentationBody('   ', true)).toThrow('obligatorio');
    expect(normalizePresentationBody(' explicación ', true)).toBe('explicación');
    expect(() => normalizePresentationBody('a'.repeat(PRESENTATION_LIMITS.body + 1))).toThrow('30000');
  });
  it('mantiene autoobservaciones opcionales, acotadas y separadas de siguientes pasos', () => {
    const empty = emptyPresentationObservations();
    expect(normalizePresentationObservations(empty)).toEqual(empty);
    expect(normalizePresentationObservations({ ...empty, clarity: ' Ordenar la introducción ' }).clarity).toBe('Ordenar la introducción');
    expect(() => normalizePresentationObservations({ ...empty, decisions: 'a'.repeat(3001) })).toThrow('3000');
    expect(normalizePresentationNextSteps(' Añadir un ejemplo ')).toBe('Añadir un ejemplo');
    expect(() => normalizePresentationNextSteps('a'.repeat(4001))).toThrow('4000');
  });
  it('exige preguntas, respuestas y al menos una observación de revisión', () => {
    expect(() => normalizePresentationQuestion(' ')).toThrow('obligatorio');
    expect(() => normalizePresentationAnswer(' ')).toThrow('obligatorio');
    expect(() => normalizePresentationQuestion('a'.repeat(1001))).toThrow('1000');
    expect(() => normalizePresentationAnswer('a'.repeat(6001))).toThrow('6000');
    expect(() => normalizePresentationFeedback({ ...emptyPresentationObservations(), comment: ' ' })).toThrow('al menos');
    expect(normalizePresentationFeedback({ ...emptyPresentationObservations(), examples: ' Añadir un caso ', comment: '' }).examples).toBe('Añadir un caso');
  });
  it('crea preguntas locales pertinentes a la configuración que se conserva por intento', () => {
    const questions = presentationGuidingQuestions(configuration);
    expect(questions).toHaveLength(5);
    expect(new Set(questions).size).toBe(5);
    expect(questions[0]).toContain('TCP');
    expect(questions[0]).toContain('compañeros');
    expect(questions[1]).toContain('Conexión');
    expect(questions[4]).toContain('Fiabilidad');
    expect(questions.every((question) => question.length <= PRESENTATION_LIMITS.question)).toBe(true);
    expect(presentationGuidingQuestions({ ...configuration, keyPoints: ['Conexión'] })[4]).toContain('tema principal');
  });
  it('muestra una estimación reproducible del texto, no una duración medida ni una nota', () => {
    expect(presentationTextEstimate(' \n ')).toEqual({ words: 0, minutes: 0 });
    expect(presentationTextEstimate(Array(120).fill('palabra').join(' '))).toEqual({ words: 120, minutes: 1 });
    expect(presentationTextEstimate('una\n\tdos   tres')).toEqual({ words: 3, minutes: 0 });
  });
});
