import { AiError, aiRecord, type AiGenerationConfig, type AiPreparation } from './ai';

export interface AiQuestion {
  id: string; type: 'single' | 'boolean'; text: string; options: { id: string; text: string }[];
  correctOptionId: string; explanation: string; topic: string; citations: string[];
}
export interface AiQuestionDraft { questions: AiQuestion[] }
export const AI_QUESTION_SCHEMA = { type: 'object', additionalProperties: false, required: ['questions'], properties: {
  questions: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', additionalProperties: false,
    required: ['id', 'type', 'text', 'options', 'correctOptionId', 'explanation', 'topic', 'citations'], properties: {
      id: { type: 'string' }, type: { type: 'string', enum: ['single', 'boolean'] }, text: { type: 'string' },
      options: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: { type: 'string' }, text: { type: 'string' } } } },
      correctOptionId: { type: 'string' }, explanation: { type: 'string' }, topic: { type: 'string' },
      citations: { type: 'array', items: { type: 'string' } },
    } } },
} };
export function validateAiQuestionDraft(value: unknown, preparation: AiPreparation, config: AiGenerationConfig): AiQuestionDraft {
  const invalid = () => new AiError('provider', 'La IA devolvió preguntas inválidas o sin referencias suficientes.');
  if (!aiRecord(value) || !Array.isArray(value.questions) || value.questions.length !== config.questionCount) throw invalid();
  const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
  const ids = new Set<string>();
  const questions = value.questions.map((q): AiQuestion => {
    if (!aiRecord(q) || !text(q.id, 80) || ids.has(q.id) || (q.type !== 'single' && q.type !== 'boolean') || !config.types.includes(q.type) ||
      !text(q.text, 4000) || !text(q.explanation, 4000) || !text(q.topic, 120) || !preparation.topics.includes(q.topic) ||
      !Array.isArray(q.options) || q.options.length !== (q.type === 'single' ? 4 : 2) ||
      !Array.isArray(q.citations) || !q.citations.length || q.citations.length > 10 ||
      q.citations.some((id) => typeof id !== 'string' || !preparation.fragments.some((f) => f.id === id))) throw invalid();
    const optionIds = new Set<string>(); const optionTexts = new Set<string>();
    const options = q.options.map((o) => {
      if (!aiRecord(o) || !text(o.id, 80) || optionIds.has(o.id) || !text(o.text, 1500) || optionTexts.has(o.text.trim().toLocaleLowerCase('es'))) throw invalid();
      optionIds.add(o.id); optionTexts.add(o.text.trim().toLocaleLowerCase('es')); return { id: o.id, text: o.text };
    });
    if (typeof q.correctOptionId !== 'string' || !optionIds.has(q.correctOptionId)) throw invalid();
    ids.add(q.id);
    return { id: q.id, type: q.type, text: q.text, options, correctOptionId: q.correctOptionId,
      explanation: q.explanation, topic: q.topic, citations: [...new Set(q.citations as string[])] };
  });
  return { questions };
}
