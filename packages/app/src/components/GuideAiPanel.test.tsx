// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { buildGuideAiPreparation, buildGuideAiProviderPayload, guideAiSteps, type GuideAiDraft } from '@b20/core';
import { GuideAiPanel } from './GuideAiPanel';
import { AiClientError } from '../data/aiClient';

let root: Root; let container: HTMLDivElement; let source: DemoDataSource; let subjectId: string;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1'); subjectId = source.getSnapshot().subjects[0]!.id;
  source.saveNote({ subjectId, title: 'Fuente compartida elegida', topic: 'Tema', body: 'Contenido', tags: [], visibility: 'group', source: 'student' });
  source.saveNote({ subjectId, title: 'Nota privada propia disponible', topic: 'Tema', body: 'Privado', tags: [], visibility: 'personal', source: 'student' });
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function show(path = '/m/guias') { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><DataProvider source={source}><GuideAiPanel /></DataProvider></MemoryRouter>)); }
async function fill(label: string, value: string) {
  const field = [...container.querySelectorAll<HTMLLabelElement>('label')].find((entry) => entry.querySelector('span')?.textContent === label);
  expect(field, `Campo: ${label}`).toBeTruthy();
  const control = field!.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')!;
  await change(control, value);
}
async function change(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => { const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
function button(text: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === text || entry.querySelector('strong')?.textContent === text);
  expect(found, `Botón: ${text}`).toBeTruthy(); return found!;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function clickSavedAiDraft(title: string) {
  const draft = [...container.querySelectorAll<HTMLButtonElement>('.guide-wizard__drafts button')].find((entry) => entry.textContent === title)!;
  expect(draft).toBeTruthy(); await act(async () => draft.click());
}
async function chooseSource(title = 'Fuente compartida elegida') {
  const label = [...container.querySelectorAll<HTMLLabelElement>('.ai-source__choice')].find((entry) => entry.textContent?.includes(title));
  expect(label, `Fuente: ${title}`).toBeTruthy();
  const input = label!.querySelector<HTMLInputElement>('input')!;
  if (input.disabled) return;
  await act(async () => input.click());
  const add = container.querySelector<HTMLButtonElement>('.guide-materials__addbar button')!;
  await act(async () => add.click());
}
async function defineGuide(type: 'partial' | 'quarter' = 'partial', temario = 'Tema') {
  if (type === 'quarter') await click('Para el cuatrimestre');
  await fill('Materia de la guía', subjectId);
  if (type === 'partial') await fill('Parcial de la guía', source.getSnapshot().terms.find((entry) => entry.subjectId === subjectId)!.id);
  await fill('Título del borrador privado', 'Mi borrador'); await fill('Temario de la guía, un tema por línea', temario);
  await click('Elegir materiales');
}
async function prepare(type: 'partial' | 'quarter' = 'partial', temario = 'Tema') {
  await defineGuide(type, temario); await chooseSource(); await click('Preparar revisión de temas');
}
async function confirm() { const label = [...container.querySelectorAll<HTMLLabelElement>('label')].find((entry) => entry.textContent?.includes('Revisé la vista previa y confirmo enviar'))!; await act(async () => label.querySelector<HTMLInputElement>('input')!.click()); }
async function analyze() { await confirm(); await click('Analizar temas y hacer preguntas'); }
async function answerQuestions(answer = 'El docente pidió explicar el procedimiento y resolver un ejemplo completo.') {
  const inputs = [...container.querySelectorAll<HTMLTextAreaElement>('.guide-topic-review__question textarea')];
  expect(inputs.length).toBeGreaterThan(0);
  for (const input of inputs) await change(input, answer);
  await click('Guardar respuestas y continuar');
}
async function legacy() {
  const note = source.getSnapshot().notes.find((entry) => entry.title === 'Fuente compartida elegida')!;
  const draft = await source.prepareGuideAiDraft({ id: crypto.randomUUID(), input: { purpose: 'study_guide', subjectId, title: 'Mi borrador', topics: ['Tema'],
    sources: [{ kind: 'note', refId: note.id, topics: ['Tema'], includeUnplaced: true }], maxOutputTokens: 1500 } });
  await show(); await clickSavedAiDraft('Mi borrador'); return draft;
}

function pinnedExamDraft() {
  const examId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', id = crypto.randomUUID();
  const input = { purpose: 'study_guide' as const, subjectId, guideType: 'quarter' as const, period: String(source.getSnapshot().subjects[0]!.period), title: 'Borrador con examen fijado', topics: ['Tema'], sources: [{ kind: 'exam' as const, refId: examId, examVersion: 2, includeSolutions: false, topics: ['Tema'], includeUnplaced: true }], maxOutputTokens: 1500 };
  const preparation = buildGuideAiPreparation({ ...input, subjectId: '1' }, [{ kind: 'exam', refId: examId, version: 2, subjectId: '1', title: 'Examen en su versión elegida', visibility: 'group', fields: [{ name: 'pregunta:uno', text: 'Contenido de la versión elegida 2.' }] }], { id, model: 'simulado', now: Date.now() });
  preparation.input = input; preparation.sources[0]!.subjectId = subjectId;
  const draft: GuideAiDraft = { id, revision: 1, title: input.title, subjectId, guideType: 'quarter', period: input.period, state: 'prepared', preparation, steps: guideAiSteps(preparation), createdAt: Date.now(), updatedAt: Date.now(), completedSteps: 0, totalSteps: preparation.estimatedCalls };
  const { preparation: _preparation, steps: _steps, ...summary } = draft;
  vi.spyOn(source, 'listGuideAiDrafts').mockResolvedValue([summary]); vi.spyOn(source, 'getGuideAiDraft').mockResolvedValue(draft);
  const current = { id: examId, title: 'Examen actual del catálogo', subjectId, version: 4, topics: ['Tema'], ownerId: 'demo-1', visibility: 'group' as const, canIncludeSolutions: true, sourceIssues: [] };
  vi.spyOn(source, 'listGuideExamMaterials').mockResolvedValue([current]);
  return { draft, current };
}

describe('recorrido de Guías con Gemini', () => {
  it('exige elegir el parcial y la guía cuatrimestral permite reunir materiales de varios parciales', async () => {
    const data = source.getSnapshot(); const terms = data.terms.filter((entry) => entry.subjectId === subjectId);
    const input = { subjectId, topic: 'Tema', body: 'Texto del parcial', tags: [], visibility: 'group' as const, source: 'student' as const };
    const first = source.saveNote({ ...input, termId: terms[0]!.id, title: 'Material del primer parcial' });
    const second = source.saveNote({ ...input, termId: terms[1]!.id, title: 'Material del segundo parcial' });
    const prepareDraft = vi.spyOn(source, 'prepareGuideAiDraft');
    await show(); await fill('Materia de la guía', subjectId); await fill('Título del borrador privado', 'Mi borrador'); await fill('Temario de la guía, un tema por línea', 'Tema');
    expect(button('Elegir materiales').disabled).toBe(true);
    await fill('Parcial de la guía', terms[0]!.id); await click('Elegir materiales');
    const choices = () => [...container.querySelectorAll<HTMLLabelElement>('.ai-source__choice')];
    expect(choices().some((entry) => entry.textContent?.includes('Material del primer parcial'))).toBe(true);
    expect(choices().some((entry) => entry.textContent?.includes('Material del segundo parcial'))).toBe(false);
    await chooseSource('Material del primer parcial');
    await click('Volver al alcance'); await click('Para el cuatrimestre'); await click('Elegir materiales');
    expect(choices().some((entry) => entry.textContent?.includes('Material del segundo parcial'))).toBe(true);
    expect(choices().find((entry) => entry.textContent?.includes('Material del primer parcial'))!.querySelector<HTMLInputElement>('input')!.checked).toBe(true);
    await chooseSource('Material del primer parcial'); await chooseSource('Material del segundo parcial'); await click('Preparar revisión de temas');
    expect(prepareDraft).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ guideType: 'quarter', period: String(data.subjects[0]!.period), reviewBeforeGenerate: true,
      sources: expect.arrayContaining([expect.objectContaining({ refId: first }), expect.objectContaining({ refId: second })]) }) }));
    expect(prepareDraft.mock.calls[0]![0].input.termId).toBeUndefined();
    expect(container.textContent).toContain('Guía cuatrimestral · todos los parciales de la materia.');
  });

  it('requiere confirmación después de la vista previa, conserva el borrador y solo publica con acción explícita', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network); const generate = vi.spyOn(source, 'runGuideAiStep'); const publish = vi.spyOn(source, 'publishGuideAiDraft');
    const before = source.getSnapshot().guides.length;
    await show(); await prepare();
    const sent = (await source.getGuideAiDraft((await source.listGuideAiDrafts())[0]!.id)).preparation;
    expect(sent.sources.map((entry) => entry.title)).not.toContain('Nota privada propia disponible');
    expect(sent.fragments.some((entry) => entry.text === 'Privado')).toBe(false);
    expect(container.textContent).toContain('Texto exacto preparado para Gemini'); expect(container.textContent).toContain('2 llamadas previstas');
    expect(generate).not.toHaveBeenCalled(); expect(button('Analizar temas y hacer preguntas').disabled).toBe(true);
    expect([...container.querySelectorAll('button')].some((entry) => entry.textContent === 'Generar borrador privado')).toBe(false);
    await analyze(); expect(generate).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('Preguntas para completar tu guía');
    expect([...container.querySelectorAll('button')].some((entry) => entry.textContent === 'Generar borrador privado')).toBe(false);
    expect(button('Guardar respuestas y continuar').disabled).toBe(true);
    await answerQuestions(); expect(generate).toHaveBeenCalledTimes(1); expect(button('Generar borrador privado').disabled).toBe(true);
    await confirm(); await click('Generar borrador privado'); expect(generate).toHaveBeenCalledTimes(2); expect(publish).not.toHaveBeenCalled(); expect(source.getSnapshot().guides).toHaveLength(before);
    expect(container.textContent).toContain('Revisar y editar el borrador');
    await click('Publicar guía para el grupo'); expect(publish).toHaveBeenCalledTimes(1); expect(source.getSnapshot().guides).toHaveLength(before + 1);
    expect(container.textContent).toContain('Abrir la versión compartida'); expect(network).not.toHaveBeenCalled();
  });

  it('permite diagnosticar temas sin fuentes etiquetadas y exige reconocer las preguntas sin respuesta', async () => {
    const generate = vi.spyOn(source, 'runGuideAiStep'), review = vi.spyOn(source, 'reviewGuideAiTopics');
    await show(); await prepare('partial', 'Tema\nTema sin material'); await analyze();
    expect(container.textContent).toContain('Sin material suficiente');
    const inputs = [...container.querySelectorAll<HTMLTextAreaElement>('.guide-topic-review__question textarea')];
    expect(inputs).toHaveLength(2);
    await change(inputs[0]!, 'El profesor pidió resolver un caso concreto.');
    expect(button('Guardar respuestas y continuar').disabled).toBe(true);
    const acknowledgment = container.querySelector<HTMLInputElement>('.guide-topic-review__ack input')!;
    await act(async () => acknowledgment.click()); await click('Guardar respuestas y continuar');
    expect(review).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ acknowledgeGaps: true,
      answers: [expect.objectContaining({ answer: 'El profesor pidió resolver un caso concreto.' }), expect.objectContaining({ answer: '' })] }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Pendiente: no se aportó información adicional.');
    expect(button('Generar borrador privado').disabled).toBe(true);
  });

  it('guarda los aportes y reanuda la revisión al volver a abrir el borrador sin repetir el análisis', async () => {
    const generate = vi.spyOn(source, 'runGuideAiStep'), review = vi.spyOn(source, 'reviewGuideAiTopics');
    const answer = 'El profesor pidió comparar dos métodos y justificar cuándo aplicar cada uno.';
    await show(); await prepare(); await analyze(); await answerQuestions(answer);
    const saved = await source.getGuideAiDraft((await source.listGuideAiDrafts())[0]!.id);
    expect(saved.topicsReviewed).toBe(true); expect(saved.result).toBeUndefined();
    expect(saved.preparation.input.clarifications).toEqual([expect.objectContaining({ topic: 'Tema', answer })]);
    await act(async () => root.unmount()); root = createRoot(container); await show(); await clickSavedAiDraft('Mi borrador');
    expect(container.textContent).toContain('Revisión guardada'); expect(container.textContent).toContain(answer);
    expect(container.textContent).toContain('Aportes tuyos que también se enviarán');
    expect(generate).toHaveBeenCalledTimes(1); expect(review).toHaveBeenCalledTimes(1);
    expect(button('Generar borrador privado').disabled).toBe(true);
  });

  it('bloquea las respuestas al diagnóstico si cambia una fuente y exige revisar nuevamente los materiales', async () => {
    const generate = vi.spyOn(source, 'runGuideAiStep'), review = vi.spyOn(source, 'reviewGuideAiTopics');
    await show(); await prepare(); await analyze();
    const answer = container.querySelector<HTMLTextAreaElement>('.guide-topic-review__question textarea')!;
    await change(answer, 'Detalle para completar el tema.'); expect(button('Guardar respuestas y continuar').matches(':disabled')).toBe(false);
    const note = source.getSnapshot().notes.find((row) => row.title === 'Fuente compartida elegida')!;
    await act(async () => source.saveNote({ ...note, body: 'Texto vigente distinto', expectedVersion: note.version }));
    expect(container.textContent).toContain('Una fuente cambió o dejó de estar disponible');
    expect(button('Guardar respuestas y continuar').matches(':disabled')).toBe(true);
    await click('Guardar respuestas y continuar');
    expect(review).not.toHaveBeenCalled(); expect(generate).toHaveBeenCalledTimes(1);
  });

  it('limpia el material privado al cambiar de cuenta y vuelve a consultarlo únicamente como su dueño', async () => {
    await show(); await prepare(); expect(container.textContent).toContain('Texto exacto preparado para Gemini');
    await act(async () => source.setViewer('demo-2')); expect(container.textContent).not.toContain('Texto exacto preparado para Gemini'); expect(container.textContent).toContain('Todavía no tienes borradores privados');
    await act(async () => source.setViewer('demo-1')); expect(container.textContent).not.toContain('Texto exacto preparado para Gemini');
    await clickSavedAiDraft('Mi borrador'); expect(container.textContent).toContain('Texto exacto preparado para Gemini');
  });

  it('no reenvía una respuesta incierta y obliga a consultar el estado antes de otro intento', async () => {
    const detail = await legacy();
    const generate = vi.spyOn(source, 'runGuideAiStep').mockRejectedValue(new Error('No se pudo confirmar el resultado.'));
    await confirm(); await click('Generar borrador privado'); expect(generate).toHaveBeenCalledTimes(1);
    const generateButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === 'Generar borrador privado')!; expect(generateButton.disabled).toBe(true);
    const unknown: GuideAiDraft = { ...detail, revision: detail.revision + 1, state: 'unknown', steps: detail.steps.map((entry) => ({ ...entry, state: 'unknown' })) };
    vi.spyOn(source, 'getGuideAiDraft').mockResolvedValue(unknown);
    await click('Consultar estado guardado'); expect(container.textContent).toContain('Acepto otro intento manual'); expect(generate).toHaveBeenCalledTimes(1);
    await confirm(); expect([...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === 'Generar borrador privado')!.disabled).toBe(true);
  });

  it('permite reconocer un envío incierto anterior de otra operación sin reenviarlo automáticamente', async () => {
    await legacy(); const generate = vi.spyOn(source, 'runGuideAiStep').mockRejectedValue(new AiClientError('unknown_confirmation_required', 'Hay otro envío incierto.'));
    await confirm(); await click('Generar borrador privado'); expect(generate).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Acepto otro intento manual');
    await click('Consultar estado guardado'); await confirm();
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === 'Generar borrador privado')!.disabled).toBe(true);
    const acknowledgement = [...container.querySelectorAll<HTMLLabelElement>('label')].find((entry) => entry.textContent?.includes('Acepto otro intento manual'))!.querySelector<HTMLInputElement>('input')!;
    await act(async () => acknowledgement.click()); expect([...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === 'Generar borrador privado')!.disabled).toBe(false); expect(generate).toHaveBeenCalledTimes(1);
  });

  it('oculta el texto preparado en memoria cuando una fuente deja de estar disponible', async () => {
    await show(); await prepare(); const note = source.getSnapshot().notes.find((row) => row.title === 'Fuente compartida elegida')!;
    expect(container.textContent).toContain('Texto exacto preparado para Gemini');
    await act(async () => source.withdrawContent('note', note.id, true, note.version));
    expect(container.textContent).not.toContain('Texto exacto preparado para Gemini'); expect(container.textContent).toContain('Su texto preparado se ocultó');
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].some((entry) => entry.textContent === 'Generar borrador privado')).toBe(false);
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].some((entry) => entry.textContent === 'Analizar temas y hacer preguntas')).toBe(false);
    expect(container.textContent).toContain('Cancelar pasos pendientes');
  });

  it('actualiza las fuentes del mismo borrador conservando el texto y exige revisar las citas sin otra llamada a Gemini', async () => {
    await legacy(); const generate = vi.spyOn(source, 'runGuideAiStep'); const refresh = vi.spyOn(source, 'refreshGuideAiDraft');
    await confirm(); await click('Generar borrador privado');
    await fill('Texto de Objetivos', 'Texto corregido y conservado por mí.'); await click('Guardar cambios privados');
    const note = source.getSnapshot().notes.find((row) => row.title === 'Fuente compartida elegida')!;
    await act(async () => source.saveNote({ ...note, body: 'Material actualizado', expectedVersion: note.version }));
    await click('Actualizar fuentes conservando mi texto'); expect(container.textContent).toContain('Las transcripciones anteriores se quitaron');
    await click('Actualizar preparación sin enviar a Gemini');
    expect(refresh).toHaveBeenCalledTimes(1); expect(generate).toHaveBeenCalledTimes(1); expect(await source.listGuideAiDrafts()).toHaveLength(1);
    expect(container.textContent).toContain('Texto corregido y conservado por mí.'); expect(container.textContent).toContain('Revisa las citas de las ocho secciones');
    const publish = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Publicar guía para el grupo')!; expect(publish.disabled).toBe(true);
    await click('Guardar cambios privados'); expect(publish.disabled).toBe(false); expect(generate).toHaveBeenCalledTimes(1);
  });

  it('conserva las respuestas del diagnóstico al actualizar fuentes después de generar sin volver a enviarlas a la IA', async () => {
    const generate = vi.spyOn(source, 'runGuideAiStep'), refresh = vi.spyOn(source, 'refreshGuideAiDraft');
    const answer = 'Incluye la comparación de dos métodos y sus restricciones, según explicó el profesor.';
    await show(); await prepare(); await analyze(); await answerQuestions(answer);
    await confirm(); await click('Generar borrador privado');
    const before = await source.getGuideAiDraft((await source.listGuideAiDrafts())[0]!.id);
    expect(before.topicsReviewed).toBe(true); expect(before.preparation.input.clarifications).toHaveLength(1);
    expect(before.preparation.input.topicReview).toBeTruthy();
    const note = source.getSnapshot().notes.find((entry) => entry.title === 'Fuente compartida elegida')!;
    await act(async () => source.saveNote({ ...note, body: 'Material más completo para el mismo tema.', expectedVersion: note.version }));
    await click('Actualizar fuentes conservando mi texto'); await click('Actualizar preparación sin enviar a Gemini');
    expect(refresh).toHaveBeenCalledTimes(1); expect(generate).toHaveBeenCalledTimes(2);
    const updated = await source.getGuideAiDraft(before.id);
    expect(updated.preparation.input.clarifications).toEqual(before.preparation.input.clarifications);
    expect(updated.preparation.input.topicReview).toEqual(before.preparation.input.topicReview);
    expect(updated.topicsReviewed).toBe(true); expect(updated.needsCitationReview).toBe(true);
    expect(updated.result?.sections.map((section) => section.content)).toEqual(before.result?.sections.map((section) => section.content));
    expect(container.textContent).toContain(answer); expect(container.textContent).toContain('Revisa las citas de las ocho secciones');
    expect(button('Publicar guía para el grupo').disabled).toBe(true);
    await click('Guardar cambios privados'); expect(button('Publicar guía para el grupo').disabled).toBe(false);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('conserva los aportes al repetir el diagnóstico y solo los reutiliza por tema con una acción explícita', async () => {
    const generate = vi.spyOn(source, 'runGuideAiStep'), review = vi.spyOn(source, 'reviewGuideAiTopics');
    const firstAnswer = 'Para Tema, el profesor pidió justificar el procedimiento con un ejemplo.';
    const secondAnswer = 'Para Otro tema, pidió comparar dos métodos y sus restricciones.';
    await show(); await prepare('partial', 'Tema\nOtro tema'); await analyze();
    const initialQuestions = [...container.querySelectorAll<HTMLTextAreaElement>('.guide-topic-review__question textarea')];
    expect(initialQuestions).toHaveLength(2);
    await change(initialQuestions[0]!, firstAnswer); await change(initialQuestions[1]!, secondAnswer);
    await click('Guardar respuestas y continuar');
    const before = await source.getGuideAiDraft((await source.listGuideAiDrafts())[0]!.id);
    expect(before.result).toBeUndefined(); expect(before.preparation.input.clarifications).toHaveLength(2);
    const note = source.getSnapshot().notes.find((entry) => entry.title === 'Fuente compartida elegida')!;
    await act(async () => source.saveNote({ ...note, body: 'Más material para revisar el temario.', expectedVersion: note.version }));
    await click('Actualizar fuentes conservando mi texto');
    // Reordenar el temario hace que el segundo diagnóstico reutilice los ids para otras preguntas.
    await click('Volver al alcance'); await fill('Temario de la guía, un tema por línea', 'Otro tema\nTema'); await click('Elegir materiales');
    await click('Actualizar preparación sin enviar a Gemini');
    const refreshed = await source.getGuideAiDraft(before.id);
    expect(refreshed.assessment).toBeUndefined(); expect(refreshed.topicsReviewed).toBe(false);
    expect(refreshed.previousClarifications).toEqual(before.preparation.input.clarifications);
    expect(refreshed.preparation.input.clarifications).toBeUndefined(); expect(generate).toHaveBeenCalledTimes(1);
    await analyze(); expect(generate).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Tus respuestas anteriores se conservan (2)');
    const questions = [...container.querySelectorAll<HTMLElement>('.guide-topic-review__question')];
    expect(questions).toHaveLength(2); expect(questions[0]!.querySelector('small')!.textContent).toBe('Otro tema');
    expect(questions.map((question) => question.querySelector<HTMLTextAreaElement>('textarea')!.value)).toEqual(['', '']);
    expect(button('Guardar respuestas y continuar').disabled).toBe(true);
    for (const question of questions) {
      const reuse = [...question.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === 'Usar respuesta anterior')!;
      expect(reuse).toBeTruthy(); await act(async () => reuse.click());
    }
    expect(questions.map((question) => question.querySelector<HTMLTextAreaElement>('textarea')!.value)).toEqual([secondAnswer, firstAnswer]);
    await click('Guardar respuestas y continuar'); expect(review).toHaveBeenCalledTimes(2);
    const saved = await source.getGuideAiDraft(before.id);
    expect(saved.topicsReviewed).toBe(true);
    expect(saved.preparation.input.clarifications).toEqual([
      expect.objectContaining({ questionId: 'topic-1', topic: 'Otro tema', answer: secondAnswer }),
      expect.objectContaining({ questionId: 'topic-2', topic: 'Tema', answer: firstAnswer }),
    ]);
    expect(saved.assessment?.questions[0]?.id).toBe(before.assessment?.questions[0]?.id);
    expect(saved.assessment?.questions[0]?.question).not.toBe(before.assessment?.questions[0]?.question);
    expect(buildGuideAiProviderPayload(saved.preparation.input, 'direct', saved.preparation.fragments, []).studentClarifications).toEqual(saved.preparation.input.clarifications);
    expect(generate).toHaveBeenCalledTimes(2); expect(saved.result).toBeUndefined();
  });
  it('permite usar material personal propio en privado y bloquea publicarlo para el grupo', async () => {
    const publish = vi.spyOn(source, 'publishGuideAiDraft');
    await show(); await defineGuide(); await chooseSource('Nota privada propia disponible');
    expect(container.querySelector('[aria-label="Materiales agregados a la guía"]')?.textContent).toContain('Personal: la guía seguirá privada');
    await click('Preparar revisión de temas');
    const prepared = await source.getGuideAiDraft((await source.listGuideAiDrafts())[0]!.id);
    expect(prepared.preparation.sources).toMatchObject([{ kind: 'note', visibility: 'personal' }]);
    await analyze(); await answerQuestions(); await confirm(); await click('Generar borrador privado');
    expect(button('Publicar guía para el grupo').disabled).toBe(true); await click('Publicar guía para el grupo'); expect(publish).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Tu borrador se conserva privado');
  });

  it('recupera la lista agregada del borrador de materiales y conserva la selección al cambiar filtros', async () => {
    await show(); await defineGuide(); await chooseSource(); await click('Guardar borrador privado');
    const saved = (await source.listGuideMaterialSelections())[0]!;
    await act(async () => root.unmount()); root = createRoot(container); await show(`/m/guias?materialDraft=${saved.id}`);
    expect(container.querySelector('[aria-label="Materiales agregados a la guía"]')?.textContent).toContain('Fuente compartida elegida');
    expect((container.querySelector('input[placeholder="Repaso para el parcial"]') as HTMLInputElement).value).toBe('Mi borrador');
    await fill('Procedencia', 'peers'); await fill('Buscar materiales o compañeros', 'No coincide');
    expect(container.querySelectorAll('.ai-source__choice')).toHaveLength(0);
    expect(container.querySelector('[aria-label="Materiales agregados a la guía"]')?.textContent).toContain('Fuente compartida elegida');
    const prepareDraft = vi.spyOn(source, 'prepareGuideAiDraft'); await click('Preparar revisión de temas');
    expect(prepareDraft.mock.lastCall?.[0].input.sources).toMatchObject([{ kind: 'note' }]);
  });

  it('revalida la versión fijada de un examen y permite continuar aunque el catálogo ofrezca una posterior', async () => {
    const { draft, current } = pinnedExamDraft();
    const projection = vi.spyOn(source, 'getGuideExamMaterial').mockResolvedValue({ ...current, version: 2, title: 'Examen en su versión elegida', text: 'Contenido de la versión elegida 2.', fields: [{ name: 'pregunta:uno', text: 'Contenido de la versión elegida 2.' }], omissions: [] });
    const generate = vi.spyOn(source, 'runGuideAiStep');
    await show(); await fill('Materia de la guía', subjectId); await clickSavedAiDraft(draft.title);
    expect(source.listGuideExamMaterials).toHaveBeenCalledWith(subjectId); expect(projection).toHaveBeenCalledWith(current.id, 2, false);
    expect(container.textContent).not.toContain('Una fuente cambió o dejó de estar disponible');
    expect(container.textContent).not.toContain('Su texto preparado se ocultó');
    expect(container.textContent).toContain('Contenido de la versión elegida 2.');
    await confirm(); expect(button('Generar borrador privado').disabled).toBe(false); expect(generate).not.toHaveBeenCalled();
  });

  it('oculta los fragmentos y bloquea el envío si ya no se puede consultar la versión fijada del examen', async () => {
    const { draft, current } = pinnedExamDraft();
    const projection = vi.spyOn(source, 'getGuideExamMaterial').mockRejectedValue(new Error('La versión del examen ya no está disponible.'));
    const generate = vi.spyOn(source, 'runGuideAiStep');
    await show(); await fill('Materia de la guía', subjectId); await clickSavedAiDraft(draft.title);
    expect(projection).toHaveBeenCalledWith(current.id, 2, false);
    expect(container.textContent).toContain('Su texto preparado se ocultó');
    expect(container.textContent).not.toContain('Contenido de la versión elegida 2.');
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].some((entry) => entry.textContent === 'Generar borrador privado')).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

});
