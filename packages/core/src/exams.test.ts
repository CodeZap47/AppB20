import { describe, expect, it } from 'vitest';
import { aiQuestionPayload, buildAiPreparation, estimateAiQuestionTokens, validateAiGenerationConfig } from './ai';
import { examAttemptOrder, examPreparedSourceKey, examTopicDistribution, scoreExam, scoreOpenExam, selectExamVariant } from './exams';
import { validateAiQuestionDraft, type AiQuestion } from './exam';

const questions: AiQuestion[] = [
  { id: 'q1', type: 'single', text: 'Elige', topic: 'Ciclos', options: [{ id: 'a', text: 'Uno' }, { id: 'b', text: 'Dos' }, { id: 'c', text: 'Tres' }, { id: 'd', text: 'Cuatro' }], correctOptionId: 'b', explanation: 'Porque sí', citations: ['fragment'] },
  { id: 'q2', type: 'boolean', text: 'Es verdadero', topic: 'Funciones', options: [{ id: 'v', text: 'Verdadero' }, { id: 'f', text: 'Falso' }], correctOptionId: 'v', explanation: 'Por definición', citations: ['fragment'] },
];
describe('EX-2: plano, orden y corrección deterministas', () => {
  it('conserva el propósito de Gemini junto con los pesos sin cambiar la configuración heredada', () => {
    const base = { questionCount: 2, types: ['single'], difficulty: 'basic' };
    expect(validateAiGenerationConfig(base)).toEqual(base);
    for (const purpose of ['questions', 'guide', 'explanation']) expect(validateAiGenerationConfig({ ...base, purpose, topicWeights: [{ topic: 'Ciclos', weight: 1 }] })).toEqual({ ...base, purpose, topicWeights: [{ topic: 'Ciclos', weight: 1 }] });
    expect(() => validateAiGenerationConfig({ ...base, purpose: 'other' })).toThrow('borrador');
  });
  it('distribuye pesos por restos mayores, incluye ceros y conserva el orden en empates', () => {
    expect(examTopicDistribution(['A', 'B', 'C'], 7, [{ topic: 'A', weight: 2 }, { topic: 'B', weight: 1 }, { topic: 'C', weight: 0 }])).toEqual([{ topic: 'A', count: 5 }, { topic: 'B', count: 2 }, { topic: 'C', count: 0 }]);
    expect(examTopicDistribution(['A', 'B', 'C'], 2)).toEqual([{ topic: 'A', count: 1 }, { topic: 'B', count: 1 }, { topic: 'C', count: 0 }]);
    expect(() => examTopicDistribution(['A', 'B'], 2, [{ topic: 'A', weight: 0 }, { topic: 'B', weight: 0 }])).toThrow('positivo');
    expect(() => examTopicDistribution(['A', 'B'], 2, [{ topic: 'A', weight: 1 }])).toThrow('cada tema');
  });
  it('corrige por ID estable, con un punto por pregunta y sin responder cuenta como incorrecta', () => {
    expect(scoreExam(questions, { q1: 'b' })).toEqual({ correct: 1, total: 2, percentage: 50, topics: [{ topic: 'Ciclos', correct: 1, total: 1 }, { topic: 'Funciones', correct: 0, total: 1 }] });
    expect(scoreExam([...questions].reverse(), { q1: 'b', q2: 'v' }).percentage).toBe(100);
    expect(scoreExam(questions, { q1: 'Dos' }).correct).toBe(0);
  });
  it('el orden permanece idéntico al recargar y no cambia identidades de preguntas u opciones', () => {
    const order = examAttemptOrder(questions, 'attempt-1'); expect(examAttemptOrder(questions, 'attempt-1')).toEqual(order);
    expect(new Set(order.map((item) => item.questionId))).toEqual(new Set(['q1', 'q2']));
    for (const item of order) expect(new Set(item.optionIds)).toEqual(new Set(questions.find((question) => question.id === item.questionId)!.options.map((option) => option.id)));
  });
  it('pesos opcionales conservan EX-1 y exigen distribución exacta al estar presentes', () => {
    const prep = buildAiPreparation({ subjectId: '1', topics: ['Ciclos', 'Funciones'], sources: [{ kind: 'note', refId: '1', topics: ['Ciclos', 'Funciones'], includeUnplaced: true }], config: { questionCount: 2, types: ['single', 'boolean'], difficulty: 'basic' } },
      [{ kind: 'note', refId: '1', subjectId: '1', title: 'Nota', version: 1, visibility: 'group', fields: [{ name: 'body', text: 'Texto para ambos temas' }] }], { id: '10000000-0000-4000-8000-000000000001', model: 'test', now: 1 });
    const valid = questions.map((question) => ({ ...question, citations: [prep.fragments[0]!.id] }));
    expect(validateAiQuestionDraft({ questions: valid }, prep, prep.config).questions).toHaveLength(2);
    const weighted = validateAiGenerationConfig({ ...prep.config, topicWeights: [{ topic: 'Ciclos', weight: 1 }, { topic: 'Funciones', weight: 0 }] });
    expect(() => validateAiQuestionDraft({ questions: valid }, prep, weighted)).toThrow('inválidas');
    expect(aiQuestionPayload(prep, weighted)).toHaveProperty('topicDistribution', [{ topic: 'Ciclos', count: 2 }, { topic: 'Funciones', count: 0 }]);
    expect(estimateAiQuestionTokens(prep, weighted)).toBeGreaterThan(8000 + 1024);
    const selective = buildAiPreparation({ subjectId: '1', topics: ['Ciclos', 'Funciones'], sources: [{ kind: 'note', refId: '1', topics: ['Ciclos'], includeUnplaced: true }], config: weighted },
      [{ kind: 'note', refId: '1', subjectId: '1', title: 'Ciclos', version: 1, visibility: 'group', fields: [{ name: 'body', text: 'Material solo sobre ciclos' }] }], { id: '10000000-0000-4000-8000-000000000002', model: 'test', now: 1 });
    expect(selective.coverage.find((item) => item.topic === 'Funciones')!.sourceIds).toEqual([]); expect(selective.canGenerate).toBe(true);
  });
});

describe('EX-3: abiertas y variantes', () => {
  it('valida la rúbrica y no cuenta pendientes como cero ni como preguntas cerradas', () => {
    const open: AiQuestion = { ...questions[0]!, type: 'open', options: [], correctOptionId: '', referenceAnswer: 'Referencia', rubric: { version: 1, criteria: [{ id: 'a', description: 'Argumento', maxPoints: 4 }] } };
    expect(scoreExam([open, questions[1]!], {})).toMatchObject({ total: 1, correct: 0 }); expect(scoreOpenExam([open], [])).toEqual({ pending: 1, evaluated: 0, points: 0, maxPoints: 0 });
    expect(scoreOpenExam([open], [{ questionId: open.id, confirmed: true, evaluation: { rubricVersion: 1, evaluatedAt: 1, origin: 'manual', feedback: '', criteria: [{ criterionId: 'a', points: 2, feedback: '' }] } }])).toMatchObject({ pending: 0, evaluated: 1, points: 2, maxPoints: 4, percentage: 50 });
  });
  it('selecciona miembros reproducibles sin duplicados y muestra déficit por tema', () => {
    const candidates = ['a', 'b', 'c'].map((id) => ({ id, version: 1, ownerId: 'owner', visibility: 'group' as const, subjectId: '1', topic: 'A', type: 'single' as const, difficulty: 'basic' as const, text: id, updatedAt: 1, canEdit: false, sourceIssues: [] })); const plan = { subjectId: '1', topics: ['A', 'B'], questionCount: 4, types: ['single' as const], difficulty: 'basic' as const, seed: 'fija' };
    const first = selectExamVariant([...candidates, candidates[0]!], plan); expect(selectExamVariant([...candidates].reverse(), plan)).toEqual(first); expect(first.selected).toHaveLength(2); expect(new Set(first.selected.map((row) => row.id)).size).toBe(2); expect(first.deficits).toEqual([{ topic: 'B', requested: 2, available: 0 }]); const copied = { ...candidates[0]!, id: 'copy', text: '  A  ' }; const normalized = selectExamVariant([...candidates, copied], { ...plan, topics: ['A'], questionCount: 4 }); expect(normalized.selected).toHaveLength(3); expect(normalized.deficits).toEqual([{ topic: 'A', requested: 4, available: 3 }]);
  });
});


describe('Selecciones de procedencia del banco', () => {
  it('solo agrupa snapshots y selecciones idénticos, incluidas páginas documentales', () => {
    const source = buildAiPreparation({ subjectId: '1', topics: ['Tema'], sources: [{ kind: 'note', refId: '1', topics: ['Tema'], includeUnplaced: true }] }, [{ kind: 'note', refId: '1', version: 1, subjectId: '1', title: 'Texto', visibility: 'group', fields: [{ name: 'Texto', text: 'Material de estudio.' }] }], { id: '20000000-0000-4000-8000-000000000001', model: 'test', now: 1 }).sources[0]!;
    const base = examPreparedSourceKey(source);
    expect(examPreparedSourceKey(structuredClone(source))).toBe(base);
    for (const selection of [ { fingerprint: 'otra-instantanea' }, { answerIds: ['2'] }, { transcriptionIds: ['20000000-0000-4000-8000-000000000002'] }, { segmentIds: ['page-2'] } ]) expect(examPreparedSourceKey({ ...source, ...selection })).not.toBe(base);
    expect(examPreparedSourceKey({ ...source, segmentIds: ['page-1'] })).not.toBe(examPreparedSourceKey({ ...source, segmentIds: ['page-2'] }));
  });
});
