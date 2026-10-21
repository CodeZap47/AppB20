import { AiError, aiRecord, type AiGenerationConfig, type AiPreparation } from './ai';
import { GUIDE_SECTIONS } from './guides';

export interface AiStudySection { heading: string; text: string; citations: string[] }
export interface AiStudyDraft { purpose: 'guide' | 'explanation'; title: string; sections: AiStudySection[] }
export const AI_STUDY_SCHEMA = { type: 'object', additionalProperties: false, required: ['purpose', 'title', 'sections'], properties: {
  purpose: { type: 'string', enum: ['guide', 'explanation'] }, title: { type: 'string' }, sections: { type: 'array', minItems: 1, maxItems: 8,
    items: { type: 'object', additionalProperties: false, required: ['heading', 'text', 'citations'], properties: {
      heading: { type: 'string' }, text: { type: 'string' }, citations: { type: 'array', minItems: 1, items: { type: 'string' } },
    } } },
} };
export function validateAiStudyDraft(value: unknown, preparation: AiPreparation, config: AiGenerationConfig): AiStudyDraft {
  const invalid = () => new AiError('provider', 'El borrador no contiene una estructura o referencias válidas.');
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
  if (!aiRecord(value) || value.purpose !== config.purpose || !['guide', 'explanation'].includes(String(value.purpose)) || !text(value.title, 200)
    || !Array.isArray(value.sections) || !value.sections.length || value.sections.length > 8 || (value.purpose === 'guide' && value.sections.length !== GUIDE_SECTIONS.length)) throw invalid();
  const sections = value.sections.map((section, index): AiStudySection => {
    if (!aiRecord(section) || !text(section.heading, 200) || !text(section.text, 12_000) || !Array.isArray(section.citations) || !section.citations.length
      || section.citations.length > 30 || section.citations.some((id) => typeof id !== 'string' || !preparation.fragments.some((fragment) => fragment.id === id))
      || (value.purpose === 'guide' && section.heading !== GUIDE_SECTIONS[index]?.title)) throw invalid();
    return { heading: section.heading, text: section.text, citations: [...new Set(section.citations as string[])] };
  });
  if (sections.reduce((total, section) => total + section.text.length, 0) > 48_000) throw invalid();
  return { purpose: value.purpose as AiStudyDraft['purpose'], title: value.title, sections };
}
