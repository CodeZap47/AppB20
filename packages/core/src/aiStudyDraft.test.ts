import { describe, expect, it } from 'vitest';
import { buildAiPreparation } from './ai';
import { GUIDE_SECTIONS } from './guides';
import { validateAiStudyDraft } from './aiStudyDraft';

const config = { purpose: 'guide' as const, questionCount: 1, types: ['single' as const], difficulty: 'basic' as const };
const prep = buildAiPreparation({ subjectId: '1', topics: ['Tema'], config, sources: [{ kind: 'note', refId: '1', topics: ['Tema'], includeUnplaced: true }] },
  [{ kind: 'note', refId: '1', subjectId: '1', version: 2, title: 'Fuente', visibility: 'group', fields: [{ name: 'Texto', text: 'Contenido autorizado' }] }],
  { id: '10000000-0000-4000-8000-000000000001', model: 'fake', now: 1 });
const draft = () => ({ purpose: 'guide', title: 'Guía', sections: GUIDE_SECTIONS.map((section) => ({ heading: section.title, text: 'Texto explicado', citations: [prep.fragments[0]!.id] })) });
describe('borradores académicos citados', () => {
  it('exige las ocho secciones de una guía en orden y referencias a fragmentos realmente preparados', () => {
    expect(validateAiStudyDraft(draft(), prep, config).sections).toHaveLength(8);
    const missing = draft(); missing.sections.pop(); expect(() => validateAiStudyDraft(missing, prep, config)).toThrow('estructura');
    const fabricated = draft(); fabricated.sections[0]!.citations = ['inventada']; expect(() => validateAiStudyDraft(fabricated, prep, config)).toThrow('referencias');
  });
  it('permite una explicación citada y no acepta cambiar el propósito confirmado', () => {
    const explanation = { purpose: 'explanation', title: 'Explicación', sections: [{ heading: 'Concepto', text: 'Razonamiento', citations: [prep.fragments[0]!.id] }] };
    expect(validateAiStudyDraft(explanation, prep, { ...config, purpose: 'explanation' }).purpose).toBe('explanation');
    expect(() => validateAiStudyDraft(explanation, prep, config)).toThrow('estructura');
  });
});
