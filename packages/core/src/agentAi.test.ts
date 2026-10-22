import { describe, expect, it } from 'vitest';
import { agentAiSystemInstruction, buildAgentAiPayload, enabledAgentAiSteps, estimateAgentAiTokens, validateAgentAiResult } from './agentAi';
import { describeStyle, styleFeatures } from './agentStyle';

const features = (() => { const f = styleFeatures(['Primero leí la consigna. Después hice una tabla con los casos.']); return { ...f, ...describeStyle(f) }; })();
const base = { owner: 'Ana', bot: 'Ana_BOT', style: { features, examples: ['Primero leí la consigna.'] }, assignment: { title: 'Pilas', instructions: 'Explica qué es una pila.' } };
const draft = 'Una pila guarda elementos en orden. El último que entra es el primero que sale, como una torre de platos.';

describe('interruptores de los pasos del agente con Gemini', () => {
  it('empiezan apagados y solo se activan los pasos nombrados', () => {
    expect(enabledAgentAiSteps(undefined).size).toBe(0);
    expect(enabledAgentAiSteps('').size).toBe(0);
    expect([...enabledAgentAiSteps(' Style , plan,desconocido,plan')]).toEqual(['style', 'plan']);
  });
});

describe('payload del agente', () => {
  it('envía solo lo que necesita cada paso', () => {
    expect(buildAgentAiPayload('style', base)).not.toHaveProperty('assignment');
    expect(buildAgentAiPayload('plan', { ...base, draft })).not.toHaveProperty('draft');
    expect(buildAgentAiPayload('review', { ...base, draft }).draft).toBe(draft);
    expect(() => buildAgentAiPayload('review', base)).toThrow('borrador');
    expect(() => buildAgentAiPayload('style', { ...base, style: undefined })).toThrow('Entrena');
    expect(() => buildAgentAiPayload('originality', { ...base, draft, matches: [] })).toThrow('coincidencias');
  });
  it('retira credenciales de los textos y estima el consumo', () => {
    const payload = buildAgentAiPayload('review', { ...base, draft: `${draft} api_key=AIzaSyA1234567890123456789012` });
    expect(payload.draft).not.toContain('AIza');
    expect(estimateAgentAiTokens(payload)).toBeGreaterThan(2_000);
  });
  it('la instrucción de sistema repite las premisas con el nombre real', () => {
    const system = agentAiSystemInstruction({ step: 'review', owner: 'Ana', bot: 'Ana_BOT' });
    expect(system).toContain('Soy Ana_BOT, el agente personal de Ana.');
    expect(system).toContain('No entrego, publico ni subo tareas por mi cuenta.');
    expect(system).not.toContain('NOMBRE');
  });
});

describe('validación de las respuestas', () => {
  it('acepta sugerencias puntuales sobre el borrador y rechaza texto nuevo o ajeno', () => {
    const payload = buildAgentAiPayload('review', { ...base, draft });
    expect(validateAgentAiResult('review', { suggestions: [{ reason: 'Más claro', original: 'en orden', replacement: 'una sobre otra' }, { reason: 'Agrega un ejemplo tuyo', original: '', replacement: '' }] }, payload))
      .toEqual({ suggestions: [{ reason: 'Más claro', original: 'en orden', replacement: 'una sobre otra' }, { reason: 'Agrega un ejemplo tuyo', original: '', replacement: '' }] });
    expect(() => validateAgentAiResult('review', { suggestions: [{ reason: 'x', original: 'no está', replacement: 'y' }] }, payload)).toThrow('no corresponde');
    expect(() => validateAgentAiResult('review', { suggestions: [{ reason: 'x', original: 'pila', replacement: 'pila '.repeat(60) }] }, payload)).toThrow('demasiado texto');
    expect(() => validateAgentAiResult('review', { suggestions: [{ reason: 'x', original: '', replacement: 'Párrafo nuevo' }] }, payload)).toThrow('general');
  });
  it('rechaza una explicación de parecido que reescribe el fragmento propio', () => {
    const mine = 'El último elemento que entra a la pila es el primero que sale de ella siempre.';
    const payload = buildAgentAiPayload('originality', { ...base, draft: mine, matches: [{ refKey: 'work:9', title: 'Trabajo', score: 80, pairs: [{ mine, theirs: mine, ratio: 1 }] }] });
    expect(validateAgentAiResult('originality', { notes: [{ refKey: 'work:9', why: 'Ambos usan la definición del libro.', question: '¿Qué ejemplo de tu vida usarías?' }] }, payload)).toMatchObject({ notes: [{ refKey: 'work:9' }] });
    expect(() => validateAgentAiResult('originality', { notes: [{ refKey: 'work:9', why: 'Se parecen.', question: `Prueba: ${mine}` }] }, payload)).toThrow('reescribe');
    expect(() => validateAgentAiResult('originality', { notes: [{ refKey: 'work:1', why: 'a', question: 'b' }] }, payload)).toThrow('no corresponde');
  });
  it('exige el formato de cada paso', () => {
    const payload = buildAgentAiPayload('plan', base);
    expect(validateAgentAiResult('plan', { explanation: 'Pide definir una pila.', approach: ['Define'], outline: ['Idea'], questions: ['¿Qué ejemplo?'] }, payload)).toHaveProperty('outline');
    expect(() => validateAgentAiResult('plan', { explanation: '', approach: [], outline: [], questions: [] }, payload)).toThrow();
    expect(() => validateAgentAiResult('style', { summary: 'Escribe en pasos.', traits: Array(9).fill('a') }, buildAgentAiPayload('style', base))).toThrow();
  });
});
