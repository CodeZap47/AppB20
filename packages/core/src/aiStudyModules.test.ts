import { describe, expect, it } from 'vitest';
import { buildAiPreparation, validateAiPrepareInput, type AiGenerationConfig } from './ai';
import { validateAiModuleDraft } from './aiStudyModules';
const config: AiGenerationConfig = { purpose: 'teaching_questions', questionCount: 3, types: ['single'], difficulty: 'basic' };
const teaching = () => buildAiPreparation({ subjectId: '1', topics: ['Ciclos'], sources: [{ kind: 'teaching', refId: '10', topics: ['Ciclos'], includeUnplaced: true }], config },
  [{ kind: 'teaching', refId: '10', subjectId: '1', version: 2, title: 'Ciclos', visibility: 'personal', fields: [{ name: 'Concepto guardado', text: 'Un ciclo repite instrucciones.' }] }], { id: crypto.randomUUID(), now: 1000, model: 'fake' });
const spaced = () => buildAiPreparation({ subjectId: '1', topics: ['Ciclos'], sources: [{ kind: 'note', refId: '20', topics: ['Ciclos'], includeUnplaced: true }], config: { ...config, purpose: 'spaced_cards' } },
  [{ kind: 'note', refId: '20', subjectId: '1', version: 4, title: 'Ciclos', visibility: 'personal', fields: [{ name: 'Contenido', text: 'Un ciclo se repite hasta que su condición deja de cumplirse.' }] }], { id: crypto.randomUUID(), now: 1000, model: 'fake' });
describe('borradores Gemini de Aprende enseñando y Repaso', () => {
  it('limita la explicación guardada al propósito de preguntas clarificadoras', () => {
    const prep = teaching(); expect(prep.sources[0]).toMatchObject({ kind: 'teaching', version: 2, visibility: 'personal' });
    expect(() => validateAiPrepareInput({ subjectId: '1', topics: ['Ciclos'], sources: [{ kind: 'teaching', refId: '10', topics: ['Ciclos'], includeUnplaced: true }], config: { ...config, purpose: 'guide' } })).toThrow('explicación privada');
  });
  it('impide usar respuestas, historial o tareas como fuentes de tarjetas', () => {
    for (const kind of ['activity', 'work', 'assignment', 'teaching', 'chat', 'review']) expect(() => validateAiPrepareInput({ subjectId: '1', topics: ['Ciclos'], sources: [{ kind, refId: '10', topics: ['Ciclos'], includeUnplaced: true }], config: { ...config, purpose: 'spaced_cards' } })).toThrow();
  });
  it('valida preguntas clarificadoras sin respuestas, con citas de la explicación concreta', () => {
    const prep = teaching(); const result = validateAiModuleDraft({ purpose: 'teaching_questions', questions: [{ text: '¿Cuándo deja de repetirse?', citations: [prep.fragments[0]!.id], answer: 'No copiar esta respuesta' }] }, prep, config);
    expect(result).toEqual({ purpose: 'teaching_questions', questions: [{ text: '¿Cuándo deja de repetirse?', citations: [prep.fragments[0]!.id] }] });
    expect(JSON.stringify(result)).not.toContain('answer');
    expect(() => validateAiModuleDraft({ purpose: 'teaching_questions', questions: [{ text: '¿Por qué?', citations: ['inexistente'] }] }, prep, config)).toThrow('referencias');
  });
  it('rechaza preguntas repetidas y respuestas con más elementos de los solicitados', () => {
    const prep = teaching(); const question = { text: '¿Por qué?', citations: [prep.fragments[0]!.id] };
    expect(() => validateAiModuleDraft({ purpose: 'teaching_questions', questions: [question, question] }, prep, config)).toThrow();
    expect(() => validateAiModuleDraft({ purpose: 'teaching_questions', questions: [question, { ...question, text: '¿Cuándo?' }] }, prep, { ...config, questionCount: 1 })).toThrow();
  });
  it('valida tarjetas con pregunta, explicación, pista y citas sin programación del proveedor', () => {
    const prep = spaced(); const card = { question: '¿Cuándo termina un ciclo?', explanation: 'Cuando su condición deja de cumplirse.', hint: 'Piensa en la condición.', citations: [prep.fragments[0]!.id], interval: 999 };
    const result = validateAiModuleDraft({ purpose: 'spaced_cards', title: 'Ciclos', cards: [card] }, prep, prep.config);
    expect(result).toMatchObject({ cards: [{ question: card.question, hint: card.hint }] }); expect(JSON.stringify(result)).not.toContain('interval');
    expect(() => validateAiModuleDraft({ purpose: 'spaced_cards', title: 'Ciclos', cards: [{ ...card, hint: 'x'.repeat(2001) }] }, prep, prep.config)).toThrow();
  });
  it('rechaza tarjetas con atribución a varias fuentes o versiones', () => {
    const prep = spaced(); prep.fragments[0]!.origins.push({ kind: 'guide', refId: '30', version: 1, field: 'Texto', startLine: 1, endLine: 1 });
    expect(() => validateAiModuleDraft({ purpose: 'spaced_cards', title: 'Ciclos', cards: [{ question: '¿Por qué?', explanation: 'Por la condición.', hint: '', citations: [prep.fragments[0]!.id] }] }, prep, prep.config)).toThrow();
  });
});
