import { describe, expect, it } from 'vitest';
import { GUIDE_SECTIONS } from './guides';
import { buildGuideAiPreparation, buildGuideAiProviderPayload, estimateGuideAiCallTokens, guideAiSteps, guideAiClarificationsFromReview, validateGuideAiAssessment, validateGuideAiPrepareInput, validateGuideAiResult, validateGuideAiSummary, type GuideAiPrepareInput, type GuideAiSnapshot } from './guideAi';
const id = '00000000-0000-4000-8000-000000000001';
const options = { id, model: 'gemini-3.8-flash', now: 1_000_000 };
const input: GuideAiPrepareInput = { purpose: 'study_guide', subjectId: '1', termId: '2', title: 'Guía', topics: ['Tema'], maxOutputTokens: 1500,
  sources: [{ kind: 'note', refId: '3', topics: ['Tema'], includeUnplaced: false }] };
const source: GuideAiSnapshot = { kind: 'note', refId: '3', subjectId: '1', termId: '2', version: 1, title: 'Apunte', visibility: 'group', fields: [{ name: 'contenido', text: 'Un texto académico.' }] };
const prepare = () => buildGuideAiPreparation(input, [source], options);
const result = () => ({ title: 'Guía', sections: GUIDE_SECTIONS.map((s) => ({ id: s.id, content: 'Explicación con sustento.', citations: [prepare().fragments[0]!.id] })) });
describe('Contratos y preparación de Guías con IA', () => {
  it('una selección pequeña se envía directamente con límite de salida confirmado', () => { const p = prepare(); expect(p.estimatedCalls).toBe(1); expect(p.estimatedOutputTokens).toBe(1500); expect(p.canGenerate).toBe(true); expect(p.batches[0]!.characters).toBe(19); });
  it('conserva la clasificación personal del material autorizado por servidor', () => expect(buildGuideAiPreparation(input, [{ ...source, visibility: 'personal' }], options).sources[0]!.visibility).toBe('personal'));
  it('sin parcial requiere inclusión expresa', () => { const p = buildGuideAiPreparation(input, [{ ...source, termId: undefined }], options); expect(p.canGenerate).toBe(false); expect(p.sources[0]!.reason).toContain('expresamente'); });
  it('rechaza reclasificación y fuentes fuera de materia', () => { expect(() => buildGuideAiPreparation(input, [{ ...source, subjectId: '9' }], options)).toThrow('clasificación'); expect(() => buildGuideAiPreparation(input, [{ ...source, termId: '9' }], options)).toThrow('clasificación'); });
  it('la huella cambia al modificar versión o clasificación del padre', () => { expect(buildGuideAiPreparation(input, [{ ...source, context: 'parent-v2' }], options).fingerprint).not.toBe(prepare().fingerprint); expect(buildGuideAiPreparation(input, [{ ...source, version: 2 }], options).fingerprint).not.toBe(prepare().fingerprint); });
  it('redacta credenciales y no trunca líneas largas', () => { const text = 'x'.repeat(7000); const p = buildGuideAiPreparation(input, [{ ...source, fields: [{ name: 'código', text: `${text}\npassword=secret\na@b.test` }] }], options); expect(p.fragments.map((f) => f.text).join('')).toContain(text); expect(p.fragments.map((f) => f.text).join('')).not.toContain('password=secret'); expect(p.fragments.every((f) => f.text.length <= 4000)).toBe(true); });
  it('deduplica texto exacto conservando procedencias', () => { const p = buildGuideAiPreparation({ ...input, sources: [...input.sources, { ...input.sources[0]!, refId: '4' }] }, [source, { ...source, refId: '4' }], options); expect(p.fragments).toHaveLength(1); expect(p.fragments[0]!.origins).toHaveLength(2); });
  it('divide más de 10 fuentes en resúmenes y una síntesis', () => { const refs = Array.from({ length: 11 }, (_, i) => ({ ...input.sources[0]!, refId: String(i + 1) })); const p = buildGuideAiPreparation({ ...input, sources: refs }, refs.map((r) => ({ ...source, refId: r.refId, fields: [{ name: 'texto', text: `Fuente ${r.refId}` }] })), options); expect(p.batches).toHaveLength(2); expect(p.estimatedCalls).toBe(3); expect(p.batches.every((b) => b.sourceIds.length <= 10 && b.characters <= 40_000)).toBe(true); });
  it('divide más de 40k caracteres sin perder contenido', () => { const text = Array.from({ length: 9000 }, (_, i) => `texto-${i};`).join(''); const p = buildGuideAiPreparation(input, [{ ...source, fields: [{ name: 'texto', text }] }], options); expect(p.batches.length).toBeGreaterThan(1); expect(p.fragments.reduce((n, f) => n + f.text.length, 0)).toBeLessThanOrEqual(text.length); expect(p.batches.every((b) => b.characters <= 40_000)).toBe(true); });
  it('rechaza límites totales, tipos extra y salida excesiva', () => { expect(() => validateGuideAiPrepareInput({ ...input, maxOutputTokens: 8001 })).toThrow(); expect(() => validateGuideAiPrepareInput({ ...input, sources: [{ ...input.sources[0], kind: 'chat' }] })).toThrow(); expect(() => buildGuideAiPreparation(input, [{ ...source, fields: Array.from({ length: 1001 }, (_, i) => ({ name: String(i), text: String(i).padStart(4, '0').repeat(1250) })) }], options)).toThrow('4 000 000'); });
  it('valida ocho secciones únicas con citas existentes', () => { expect(validateGuideAiResult(result(), prepare()).sections).toHaveLength(8); expect(() => validateGuideAiResult({ ...result(), sections: result().sections.slice(1) }, prepare())).toThrow('ocho'); const bad = result(); bad.sections[0]!.citations = ['inventada']; expect(() => validateGuideAiResult(bad, prepare())).toThrow('citas'); });
  it('valida citas de resúmenes contra el lote enviado', () => { const fragments = prepare().fragments; expect(validateGuideAiSummary({ paragraphs: [{ text: 'Resumen', citations: [fragments[0]!.id] }] }, fragments).paragraphs).toHaveLength(1); expect(() => validateGuideAiSummary({ paragraphs: [{ text: 'Resumen', citations: ['inventada'] }] }, fragments)).toThrow('citas'); });
});

describe('diagnóstico y alcance de las nuevas guías', () => {
  it('distingue parcial y cuatrimestre sin modificar la selección heredada', () => {
    expect(validateGuideAiPrepareInput(input).guideType).toBeUndefined();
    expect(validateGuideAiPrepareInput({ ...input, guideType: 'partial', period: '8' })).toMatchObject({ guideType: 'partial', termId: '2', period: '8' });
    expect(() => validateGuideAiPrepareInput({ ...input, guideType: 'quarter', period: '8' })).toThrow('alcance');
    expect(() => validateGuideAiPrepareInput({ ...input, termId: undefined, guideType: 'partial', period: '8' })).toThrow('alcance');
    expect(validateGuideAiPrepareInput({ ...input, termId: undefined, guideType: 'quarter', period: '8' }).guideType).toBe('quarter');
  });
  it('diagnostica temas sin etiquetas de cobertura y cuenta el envío adicional', () => {
    const prepared = buildGuideAiPreparation({ ...input, reviewBeforeGenerate: true, topics: ['Tema', 'Tema ausente'] }, [source], options);
    expect(prepared.canGenerate).toBe(true); expect(prepared.estimatedCalls).toBe(2);
    expect(guideAiSteps(prepared).map((step) => step.kind)).toEqual(['assessment', 'direct']);
    expect(prepared.estimatedInputTokens).toBeGreaterThan(prepare().estimatedInputTokens);
  });
  it('valida todos los temas, citas y preguntas antes de aceptar respuestas', () => {
    const prepared = prepare();
    const assessment = { topics: [{ topic: 'Tema', coverage: 'thin', reason: 'Solo se menciona.', citations: [prepared.fragments[0]!.id] }], questions: [{ id: 'q1', topic: 'Tema', question: '¿Qué procedimiento pidió el docente?' }] };
    expect(validateGuideAiAssessment(assessment, prepared).topics[0]!.coverage).toBe('thin');
    expect(() => validateGuideAiAssessment({ ...assessment, topics: [{ ...assessment.topics[0], citations: ['inventada'] }] }, prepared)).toThrow('citas');
    expect(() => validateGuideAiAssessment({ ...assessment, questions: [] }, prepared)).toThrow('preguntas');
    expect(() => guideAiClarificationsFromReview(assessment as ReturnType<typeof validateGuideAiAssessment>, { answers: [], acknowledgeGaps: false })).toThrow('pendientes');
    expect(guideAiClarificationsFromReview(assessment as ReturnType<typeof validateGuideAiAssessment>, { answers: [], acknowledgeGaps: true })).toEqual([]);
    const clarifications = guideAiClarificationsFromReview(assessment as ReturnType<typeof validateGuideAiAssessment>, { answers: [{ questionId: 'q1', answer: 'Trazar un ciclo paso a paso.' }], acknowledgeGaps: false });
    expect(buildGuideAiProviderPayload({ ...input, clarifications }, 'direct', prepared.fragments, [])).toMatchObject({ studentClarifications: [{ questionId: 'q1', answer: 'Trazar un ciclo paso a paso.' }] });
    expect(buildGuideAiProviderPayload({ ...input, clarifications }, 'assessment', prepared.fragments, [])).not.toHaveProperty('studentClarifications');
    expect(() => guideAiClarificationsFromReview(assessment as ReturnType<typeof validateGuideAiAssessment>, { answers: [{ questionId: 'otra', answer: 'Respuesta' }], acknowledgeGaps: true })).toThrow('diagnóstico');
  });
});

it('la reserva incluye el sobre JSON, identificadores y temario de muchos fragmentos cortos', () => {
  const fragments = Array.from({length: 500}, (_, index) => ({ id: `guide-fragment-${String(index).padStart(24, '0')}`, text: 'x', origins: [] }));
  const payload = buildGuideAiProviderPayload(input, 'direct', fragments, []);
  const estimated = estimateGuideAiCallTokens(input, 'direct', fragments, []);
  expect(estimated).toBe(Math.ceil(new TextEncoder().encode(JSON.stringify(payload)).length / 3) + 1024 + 1500);
  expect(estimated).toBeGreaterThan(10_000);
});


it('admite exámenes UUID, conserva versión y exige elegir otros parciales expresamente', () => {
  const exam = { ...source, kind: 'exam' as const, refId: id, termId: '9' };
  const ref = { kind: 'exam' as const, refId: id, examVersion: 1, includeSolutions: false, topics: ['Tema'], includeUnplaced: false };
  expect(() => buildGuideAiPreparation({ ...input, sources: [ref] }, [exam], options)).toThrow('clasificación');
  const p = buildGuideAiPreparation({ ...input, sources: [{ ...ref, includeOutsideTerm: true }] }, [exam], options);
  expect(p.sources[0]).toMatchObject({ refId: id, examVersion: 1, includeOutsideTerm: true });
  expect(() => validateGuideAiPrepareInput({ ...input, sources: [{ ...ref, refId: '3' }] })).toThrow();
});
it('procesa más de treinta materiales sin recortar y diagnostica después de resumir todos los lotes', () => {
  const refs = Array.from({ length: 41 }, (_, i) => ({ ...input.sources[0]!, refId: String(i + 1) }));
  const snapshots = refs.map((ref, i) => ({ ...source, refId: ref.refId, fields: [{ name: 'contenido', text: `${i}: ` + 'contenido completo '.repeat(250) }] }));
  const p = buildGuideAiPreparation({ ...input, reviewBeforeGenerate: true, sources: refs }, snapshots, options);
  expect(p.sources).toHaveLength(41); expect(p.fragments.reduce((n, f) => n + f.text.length, 0)).toBeGreaterThan(120000);
  const steps = guideAiSteps(p); expect(steps.at(-2)?.kind).toBe('assessment'); expect(steps.at(-1)?.kind).toBe('synthesis'); expect(steps.slice(0, -2).every((step) => step.kind === 'summary')).toBe(true);
  const summaries = [{ paragraphs: [{ text: 'Resumen de todos los lotes', citations: [p.fragments[0]!.id] }] }];
  const payload = buildGuideAiProviderPayload(p.input, 'assessment', p.fragments, summaries);
  expect(payload).toHaveProperty('summaries'); expect(payload).not.toHaveProperty('fragments');
});
