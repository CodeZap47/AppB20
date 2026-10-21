import { describe, expect, it } from 'vitest';
import { GUIDE_SECTIONS } from './guides';
import { buildGuideAiPreparation, buildGuideAiProviderPayload, estimateGuideAiCallTokens, validateGuideAiPrepareInput, validateGuideAiResult, validateGuideAiSummary, type GuideAiPrepareInput, type GuideAiSnapshot } from './guideAi';
const id = '00000000-0000-4000-8000-000000000001';
const options = { id, model: 'gemini-3.8-flash', now: 1_000_000 };
const input: GuideAiPrepareInput = { purpose: 'study_guide', subjectId: '1', termId: '2', title: 'Guía', topics: ['Tema'], maxOutputTokens: 1500,
  sources: [{ kind: 'note', refId: '3', topics: ['Tema'], includeUnplaced: false }] };
const source: GuideAiSnapshot = { kind: 'note', refId: '3', subjectId: '1', termId: '2', version: 1, title: 'Apunte', visibility: 'group', fields: [{ name: 'contenido', text: 'Un texto académico.' }] };
const prepare = () => buildGuideAiPreparation(input, [source], options);
const result = () => ({ title: 'Guía', sections: GUIDE_SECTIONS.map((s) => ({ id: s.id, content: 'Explicación con sustento.', citations: [prepare().fragments[0]!.id] })) });
describe('Contratos y preparación de Guías con IA', () => {
  it('una selección pequeña se envía directamente con límite de salida confirmado', () => { const p = prepare(); expect(p.estimatedCalls).toBe(1); expect(p.estimatedOutputTokens).toBe(1500); expect(p.canGenerate).toBe(true); expect(p.batches[0]!.characters).toBe(19); });
  it('rechaza notas personales aunque las pueda leer el preparador', () => expect(() => buildGuideAiPreparation(input, [{ ...source, visibility: 'personal' }], options)).toThrow('compartido'));
  it('sin parcial requiere inclusión expresa', () => { const p = buildGuideAiPreparation(input, [{ ...source, termId: undefined }], options); expect(p.canGenerate).toBe(false); expect(p.sources[0]!.reason).toContain('expresamente'); });
  it('rechaza reclasificación y fuentes fuera de materia', () => { expect(() => buildGuideAiPreparation(input, [{ ...source, subjectId: '9' }], options)).toThrow('clasificación'); expect(() => buildGuideAiPreparation(input, [{ ...source, termId: '9' }], options)).toThrow('clasificación'); });
  it('la huella cambia al modificar versión o clasificación del padre', () => { expect(buildGuideAiPreparation(input, [{ ...source, context: 'parent-v2' }], options).fingerprint).not.toBe(prepare().fingerprint); expect(buildGuideAiPreparation(input, [{ ...source, version: 2 }], options).fingerprint).not.toBe(prepare().fingerprint); });
  it('redacta credenciales y no trunca líneas largas', () => { const text = 'x'.repeat(7000); const p = buildGuideAiPreparation(input, [{ ...source, fields: [{ name: 'código', text: `${text}\npassword=secret\na@b.test` }] }], options); expect(p.fragments.map((f) => f.text).join('')).toContain(text); expect(p.fragments.map((f) => f.text).join('')).not.toContain('password=secret'); expect(p.fragments.every((f) => f.text.length <= 4000)).toBe(true); });
  it('deduplica texto exacto conservando procedencias', () => { const p = buildGuideAiPreparation({ ...input, sources: [...input.sources, { ...input.sources[0]!, refId: '4' }] }, [source, { ...source, refId: '4' }], options); expect(p.fragments).toHaveLength(1); expect(p.fragments[0]!.origins).toHaveLength(2); });
  it('divide más de 10 fuentes en resúmenes y una síntesis', () => { const refs = Array.from({ length: 11 }, (_, i) => ({ ...input.sources[0]!, refId: String(i + 1) })); const p = buildGuideAiPreparation({ ...input, sources: refs }, refs.map((r) => ({ ...source, refId: r.refId, fields: [{ name: 'texto', text: `Fuente ${r.refId}` }] })), options); expect(p.batches).toHaveLength(2); expect(p.estimatedCalls).toBe(3); expect(p.batches.every((b) => b.sourceIds.length <= 10 && b.characters <= 40_000)).toBe(true); });
  it('divide más de 40k caracteres sin perder contenido', () => { const text = Array.from({ length: 9000 }, (_, i) => `texto-${i};`).join(''); const p = buildGuideAiPreparation(input, [{ ...source, fields: [{ name: 'texto', text }] }], options); expect(p.batches.length).toBeGreaterThan(1); expect(p.fragments.reduce((n, f) => n + f.text.length, 0)).toBeLessThanOrEqual(text.length); expect(p.batches.every((b) => b.characters <= 40_000)).toBe(true); });
  it('rechaza límites totales, tipos extra y salida excesiva', () => { expect(() => validateGuideAiPrepareInput({ ...input, maxOutputTokens: 8001 })).toThrow(); expect(() => validateGuideAiPrepareInput({ ...input, sources: [{ ...input.sources[0], kind: 'chat' }] })).toThrow(); expect(() => buildGuideAiPreparation(input, [{ ...source, fields: Array.from({ length: 31 }, (_, i) => ({ name: String(i), text: String(i).repeat(5000) })) }], options)).toThrow('120 000'); });
  it('valida ocho secciones únicas con citas existentes', () => { expect(validateGuideAiResult(result(), prepare()).sections).toHaveLength(8); expect(() => validateGuideAiResult({ ...result(), sections: result().sections.slice(1) }, prepare())).toThrow('ocho'); const bad = result(); bad.sections[0]!.citations = ['inventada']; expect(() => validateGuideAiResult(bad, prepare())).toThrow('citas'); });
  it('valida citas de resúmenes contra el lote enviado', () => { const fragments = prepare().fragments; expect(validateGuideAiSummary({ paragraphs: [{ text: 'Resumen', citations: [fragments[0]!.id] }] }, fragments).paragraphs).toHaveLength(1); expect(() => validateGuideAiSummary({ paragraphs: [{ text: 'Resumen', citations: ['inventada'] }] }, fragments)).toThrow('citas'); });
});

it('la reserva incluye el sobre JSON, identificadores y temario de muchos fragmentos cortos', () => {
  const fragments = Array.from({length: 500}, (_, index) => ({ id: `guide-fragment-${String(index).padStart(24, '0')}`, text: 'x', origins: [] }));
  const payload = buildGuideAiProviderPayload(input, 'direct', fragments, []);
  const estimated = estimateGuideAiCallTokens(input, 'direct', fragments, []);
  expect(estimated).toBe(Math.ceil(new TextEncoder().encode(JSON.stringify(payload)).length / 3) + 1024 + 1500);
  expect(estimated).toBeGreaterThan(10_000);
});
