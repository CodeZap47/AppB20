import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGuideAiPreparation } from '@b20/core';
import { createGuideProvider } from './guideProvider.ts';
const preparation = buildGuideAiPreparation({ purpose: 'study_guide', subjectId: '1', title: 'Guía', topics: ['Tema'], maxOutputTokens: 1500,
  sources: [{ kind: 'note', refId: '2', topics: ['Tema'], includeUnplaced: true }] }, [{ kind: 'note', refId: '2', subjectId: '1', title: 'Nota', version: 1, visibility: 'group', fields: [{ name: 'texto', text: 'Material académico compartido.' }] }],
  { id: '00000000-0000-4000-8000-000000000001', now: 1, model: 'gemini-3.8-flash' });
const input = { apiKey: 'fixture-no-real-api-key', model: preparation.model, preparation,
  step: { id: 'direct', kind: 'direct' as const, state: 'running' as const }, fragments: preparation.fragments, summaries: [] };
afterEach(() => vi.unstubAllGlobals());
describe('Proveedor Gemini para Guías', () => {
  it('envía exclusivamente texto preparado con el modelo y salida confirmados, una sola llamada', async () => {
    let body: Record<string, unknown> = {};
    const transport = vi.fn(async (_url, init) => { body = JSON.parse(String(init?.body)); return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: '{"title":"Guía","sections":[]}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, totalTokenCount: 160 } }); });
    vi.stubGlobal('fetch', transport); const result = await createGuideProvider().generate(input);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 60 }); expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0]![0])).toContain('gemini-3.8-flash:generateContent');
    expect(body.generationConfig).toMatchObject({ maxOutputTokens: 1500, responseMimeType: 'application/json' });
    expect(JSON.stringify(body)).toContain('Material académico'); expect(JSON.stringify(body)).not.toContain(input.apiKey); expect(JSON.stringify(body)).not.toContain('inlineData');
  });
  it('la síntesis solo envía resúmenes y referencias originales', async () => {
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { body = String(init?.body); return Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] }); }));
    await createGuideProvider().generate({ ...input, step: { ...input.step, kind: 'synthesis' }, summaries: [{ paragraphs: [{ text: 'Resumen fiel.', citations: [input.fragments[0]!.id] }] }] });
    expect(body).toContain('Resumen fiel.'); expect(body).not.toContain('Material académico compartido.'); expect(body).toContain(input.fragments[0]!.id);
  });
  it('diagnostica el temario con esquema propio y distingue las aclaraciones del alumno al generar', async () => {
    let body: Record<string, unknown> = {};
    const transport = vi.fn(async (_url, init) => { body = JSON.parse(String(init?.body)); return Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] }); });
    vi.stubGlobal('fetch', transport);
    const clarified = { ...preparation, input: { ...preparation.input, guideType: 'quarter' as const, period: '8', clarifications: [{ questionId: 'q1', topic: 'Tema', question: '¿Qué ejemplo?', answer: 'El ciclo while visto en clase.' }] } };
    await createGuideProvider().generate({ ...input, preparation: clarified, step: { ...input.step, kind: 'assessment' } });
    expect(body.generationConfig).toMatchObject({ responseJsonSchema: { required: ['topics', 'questions'] } });
    expect(JSON.stringify(body.contents)).toContain('Material académico compartido.'); expect(JSON.stringify(body.contents)).not.toContain('El ciclo while visto en clase.');
    expect(JSON.stringify(body.systemInstruction)).toContain('frecuencia');
    await createGuideProvider().generate({ ...input, preparation: clarified });
    expect(JSON.stringify(body.contents)).toContain('studentClarifications'); expect(JSON.stringify(body.contents)).toContain('El ciclo while visto en clase.');
    expect(JSON.stringify(body.systemInstruction)).toContain('no las atribuyas a los archivos'); expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each([401,429,503])('errores %s no se reintentan y no revelan el cuerpo', async (status) => {
    const transport = vi.fn(async () => Response.json({ error: { code: status, message: 'fixture-secret-detail', status: 'TEST' } }, { status })); vi.stubGlobal('fetch', transport);
    await expect(createGuideProvider().generate(input)).rejects.not.toThrow('fixture-secret-detail'); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('timeout deja resultado incierto sin envío automático adicional', async () => {
    const transport = vi.fn(async () => { throw new DOMException('private details', 'TimeoutError'); }); vi.stubGlobal('fetch', transport);
    await expect(createGuideProvider().generate(input)).rejects.toMatchObject({ code: 'unknown', uncertain: true }); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rechaza respuestas excesivas y bloqueadas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(300_000)))); await expect(createGuideProvider().generate(input)).rejects.toMatchObject({ code: 'invalid_output' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ candidates: [{ finishReason: 'SAFETY' }] }))); await expect(createGuideProvider().generate(input)).rejects.toMatchObject({ code: 'rejected_output' });
  });
});
