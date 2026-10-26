import { AiError, aiRecord, aiTopicDistribution, type AiGenerationConfig, type AiPreparation } from './ai';

export interface AiQuestion {
  id: string; type: 'single' | 'boolean' | 'open'; text: string; options: { id: string; text: string }[];
  correctOptionId: string; explanation: string; topic: string; citations: string[];
  difficulty?: 'basic' | 'intermediate' | 'advanced'; referenceAnswer?: string; rubric?: ExamRubric;
}
export interface ExamRubric { version: number; criteria: { id: string; description: string; maxPoints: number }[] }
export interface AiQuestionDraft { questions: AiQuestion[] }
export const AI_QUESTION_SCHEMA = { type: 'object', additionalProperties: false, required: ['questions'], properties: {
  questions: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', additionalProperties: false,
    required: ['id', 'type', 'text', 'options', 'correctOptionId', 'explanation', 'topic', 'citations'], properties: {
      id: { type: 'string' }, type: { type: 'string', enum: ['single', 'boolean', 'open'] }, text: { type: 'string' },
      options: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: { type: 'string' }, text: { type: 'string' } } } },
      correctOptionId: { type: 'string' }, explanation: { type: 'string' }, topic: { type: 'string' },
      citations: { type: 'array', items: { type: 'string' } },
      referenceAnswer: { type: 'string' }, rubric: { type: 'object', additionalProperties: false, required: ['version', 'criteria'], properties: { version: { type: 'integer', minimum: 1 }, criteria: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['id', 'description', 'maxPoints'], properties: { id: { type: 'string' }, description: { type: 'string' }, maxPoints: { type: 'number', minimum: 0.5, maximum: 100 } } } } } },
    } } },
} };
export function validateAiQuestionDraft(value: unknown, preparation: AiPreparation, config: AiGenerationConfig): AiQuestionDraft {
  const invalid = () => new AiError('provider', 'La IA devolvió preguntas inválidas o sin referencias suficientes.');
  if (!aiRecord(value) || !Array.isArray(value.questions) || value.questions.length !== config.questionCount) throw invalid();
  const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
  const ids = new Set<string>();
  const questions = value.questions.map((q): AiQuestion => {
    if (!aiRecord(q) || !text(q.id, 80) || ids.has(q.id) || (q.type !== 'single' && q.type !== 'boolean' && q.type !== 'open') || !config.types.includes(q.type) ||
      !text(q.text, 4000) || !text(q.explanation, 4000) || !text(q.topic, 120) || !preparation.topics.includes(q.topic) ||
      !Array.isArray(q.options) || q.options.length !== (q.type === 'open' ? 0 : q.type === 'single' ? 4 : 2) ||
      !Array.isArray(q.citations) || !q.citations.length || q.citations.length > 10 ||
      q.citations.some((id) => typeof id !== 'string' || !preparation.fragments.some((f) => f.id === id))) throw invalid();
    const optionIds = new Set<string>(); const optionTexts = new Set<string>();
    const options = q.options.map((o) => {
      if (!aiRecord(o) || !text(o.id, 80) || optionIds.has(o.id) || !text(o.text, 1500) || optionTexts.has(o.text.trim().toLocaleLowerCase('es'))) throw invalid();
      optionIds.add(o.id); optionTexts.add(o.text.trim().toLocaleLowerCase('es')); return { id: o.id, text: o.text };
    });
    if (q.type === 'boolean' && !(['verdadero', 'falso'].every((label) => optionTexts.has(label)) ||
      ['true', 'false'].every((label) => optionTexts.has(label)))) throw invalid();
    if (q.type !== 'open' && (typeof q.correctOptionId !== 'string' || !optionIds.has(q.correctOptionId))) throw invalid();
    if (q.type === 'open' && (q.correctOptionId !== '' || !text(q.referenceAnswer, 8000))) throw invalid();
    const rubric = q.type === 'open' ? validateExamRubric(q.rubric) : undefined;
    if (q.difficulty !== undefined && !['basic', 'intermediate', 'advanced'].includes(String(q.difficulty))) throw invalid();
    ids.add(q.id);
    return { id: q.id, type: q.type, text: q.text, options, correctOptionId: q.correctOptionId as string,
      explanation: q.explanation, topic: q.topic, citations: [...new Set(q.citations as string[])], ...(q.difficulty ? { difficulty: q.difficulty as AiQuestion['difficulty'] } : {}), ...(q.type === 'open' ? { referenceAnswer: q.referenceAnswer as string, rubric } : {}) };
  });
  if (config.topicWeights && aiTopicDistribution(preparation.topics, config.questionCount, config.topicWeights).some((item) => questions.filter((question) => question.topic === item.topic).length !== item.count)) throw invalid();
  return { questions };
}

export function validateExamRubric(value: unknown): ExamRubric {
  if (!aiRecord(value) || !Number.isInteger(value.version) || Number(value.version) < 1 || !Array.isArray(value.criteria) || !value.criteria.length || value.criteria.length > 10) throw new AiError('invalid', 'La rúbrica requiere versión y entre 1 y 10 criterios.');
  const ids = new Set<string>(); const criteria = value.criteria.map((entry) => {
    if (!aiRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 80 || ids.has(entry.id) || typeof entry.description !== 'string' || !entry.description.trim() || entry.description.length > 2000 || typeof entry.maxPoints !== 'number' || !Number.isFinite(entry.maxPoints) || entry.maxPoints < 0.5 || entry.maxPoints > 100) throw new AiError('invalid', 'Los criterios de la rúbrica no son válidos.');
    ids.add(entry.id); return { id: entry.id, description: entry.description, maxPoints: entry.maxPoints };
  }); return { version: Number(value.version), criteria };
}
