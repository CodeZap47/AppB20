import { AiError, aiRecord, type AiGenerationConfig, type AiPreparation } from './ai';

export interface AiTeachingQuestion { text: string; citations: string[] }
export interface AiTeachingDraft { purpose: 'teaching_questions'; questions: AiTeachingQuestion[] }
export interface AiSpacedCard { question: string; explanation: string; hint: string; citations: string[] }
export interface AiSpacedDraft { purpose: 'spaced_cards'; title: string; cards: AiSpacedCard[] }
export type AiModuleDraft = AiTeachingDraft | AiSpacedDraft;
const citationsSchema = { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } };
export const AI_TEACHING_SCHEMA = { type: 'object', additionalProperties: false, required: ['purpose', 'questions'], properties: {
  purpose: { type: 'string', enum: ['teaching_questions'] }, questions: { type: 'array', minItems: 1, maxItems: 20,
    items: { type: 'object', additionalProperties: false, required: ['text', 'citations'], properties: {
      text: { type: 'string' }, citations: citationsSchema,
    } } },
} };
export const AI_SPACED_SCHEMA = { type: 'object', additionalProperties: false, required: ['purpose', 'title', 'cards'], properties: {
  purpose: { type: 'string', enum: ['spaced_cards'] }, title: { type: 'string' }, cards: { type: 'array', minItems: 1, maxItems: 20,
    items: { type: 'object', additionalProperties: false, required: ['question', 'explanation', 'hint', 'citations'], properties: {
      question: { type: 'string' }, explanation: { type: 'string' }, hint: { type: 'string' }, citations: citationsSchema,
    } } },
} };
export function validateAiModuleDraft(value: unknown, preparation: AiPreparation, config: AiGenerationConfig): AiModuleDraft {
  const invalid = () => new AiError('provider', 'El borrador de estudio no tiene una estructura o referencias válidas.');
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
  const citations = (value: unknown): string[] => {
    if (!Array.isArray(value) || !value.length || value.length > 20 || value.some((id) => typeof id !== 'string'
      || !preparation.fragments.some((fragment) => fragment.id === id))) throw invalid();
    return [...new Set(value as string[])];
  };
  if (!aiRecord(value) || value.purpose !== config.purpose) throw invalid();
  if (value.purpose === 'teaching_questions') {
    if (!Array.isArray(value.questions) || !value.questions.length || value.questions.length > config.questionCount) throw invalid();
    const questions = value.questions.map((question): AiTeachingQuestion => {
      if (!aiRecord(question) || !text(question.text, 4000)) throw invalid();
      const refs = citations(question.citations);
      if (!refs.some((id) => preparation.fragments.find((fragment) => fragment.id === id)!.origins.some((origin) => origin.kind === 'teaching'))) throw invalid();
      return { text: question.text.trim(), citations: refs };
    });
    if (new Set(questions.map((question) => question.text.toLocaleLowerCase('es'))).size !== questions.length) throw invalid();
    return { purpose: 'teaching_questions', questions };
  }
  if (value.purpose !== 'spaced_cards' || !text(value.title, 200) || !Array.isArray(value.cards) || !value.cards.length || value.cards.length > config.questionCount) throw invalid();
  const cards = value.cards.map((card): AiSpacedCard => {
    if (!aiRecord(card) || !text(card.question, 1000) || !text(card.explanation, 18_000) || typeof card.hint !== 'string' || card.hint.length > 2000) throw invalid();
    const refs = citations(card.citations);
    const origins = refs.flatMap((id) => preparation.fragments.find((fragment) => fragment.id === id)!.origins);
    // Each card retains one concrete source/version; a mixed source answer cannot be misattributed.
    if (origins.some((origin) => !['note', 'guide'].includes(origin.kind))
      || new Set(origins.map((origin) => `${origin.kind}:${origin.refId}:${origin.version}`)).size !== 1) throw invalid();
    return { question: card.question.trim(), explanation: card.explanation.trim(), hint: card.hint.trim(), citations: refs };
  });
  if (new Set(cards.map((card) => card.question.toLocaleLowerCase('es'))).size !== cards.length
    || cards.reduce((total, card) => total + card.explanation.length, 0) > 70_000) throw invalid();
  return { purpose: 'spaced_cards', title: value.title.trim(), cards };
}
