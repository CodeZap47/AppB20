// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiPrepareInput, ExamDetail } from '@b20/core';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { ExamCreatePage, parseExamQuestionIds } from './ExamsPage';
import { ExamAttemptPage, ExamPage } from './ExamDetailPage';

let root: Root; let container: HTMLDivElement; let source: DemoDataSource; let input: AiPrepareInput; let noteId: string;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1'); const subjectId = source.getSnapshot().subjects[0]!.id;
  noteId = source.saveNote({ subjectId, title: 'Material EX2 compartido', topic: 'Tema', body: 'Contenido compartido para revisar', tags: [], visibility: 'group', source: 'student' });
  input = { subjectId, topics: ['Tema'], sources: [{ kind: 'note', refId: noteId, topics: ['Tema'], includeUnplaced: true }], config: { questionCount: 2, types: ['single'], difficulty: 'basic', topicWeights: [{ topic: 'Tema', weight: 1 }] } };
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function show(path: string) { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><DataProvider source={source}><Routes><Route path="/m/examenes/nuevo" element={<ExamCreatePage />} /><Route path="/m/examenes/:examId/regenerar" element={<ExamCreatePage />} /><Route path="/m/examenes/intentos/:attemptId" element={<ExamAttemptPage />} /><Route path="/m/examenes/:examId" element={<ExamPage />} /></Routes></DataProvider></MemoryRouter>)); }
async function click(text: string) { const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === text)!; expect(button, text).toBeTruthy(); await act(async () => button.click()); }
async function check(text: string) { const label = [...container.querySelectorAll<HTMLLabelElement>('label')].find((entry) => entry.textContent?.includes(text))!; expect(label, text).toBeTruthy(); await act(async () => label.querySelector<HTMLInputElement>('input')!.click()); }
async function fill(label: string, value: string) {
  const field = [...container.querySelectorAll<HTMLLabelElement>('label')].find((entry) => entry.querySelector('span')?.textContent === label)!;
  const control = field.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')!;
  await act(async () => { const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
async function generated(preparationInput = input) {
  const preparation = await source.prepareExamMaterial(preparationInput); return source.generateExamQuestions({ id: crypto.randomUUID(), preparationId: preparation.id, fingerprint: preparation.fingerprint, config: preparation.config, confirmed: true });
}
async function exam(ready = true): Promise<ExamDetail> {
  const generation = await generated(); const draft = await source.examAction({ action: 'importGeneration', generationId: generation.id, requestId: crypto.randomUUID(), title: 'Examen EX2' });
  return ready ? source.examAction({ action: 'approveVersion', examId: draft.id, version: 1, expectedRevision: draft.revision, reviewedQuestionIds: draft.draft!.questions.map((question) => question.id) }) : draft;
}
async function focus() { await act(async () => window.dispatchEvent(new Event('focus'))); }

describe('recorrido de Exámenes de estudio', () => {
  it('muestra el texto exacto y exige confirmación antes de generar; el resultado sigue privado hasta revisar y aprobar', async () => {
    const generate = vi.spyOn(source, 'generateExamQuestions'); await show('/m/examenes/nuevo');
    await fill('Materia del examen', input.subjectId); await fill('Temario del examen, un tema por línea', 'Tema'); await fill('Cantidad de preguntas', '2');
    await check('Material EX2 compartido'); await click('Preparar vista previa sin enviar a Gemini');
    expect(container.textContent).toContain('Texto exacto preparado'); expect(generate).not.toHaveBeenCalled();
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Generar preguntas con mi clave')?.disabled).toBe(true);
    await check('Revisé texto, fuentes, omisiones, modelo y estimación'); await click('Generar preguntas con mi clave'); expect(generate).toHaveBeenCalledTimes(1); expect(await source.examAction({ action: 'listExams' })).toEqual([]);
    await click('Guardar preguntas como borrador privado'); expect(container.textContent).toContain('Revisar y editar mi borrador privado');
    const approve = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Aprobar versión lista para resolver')!; expect(approve.disabled).toBe(true);
    const reviews = [...container.querySelectorAll<HTMLLabelElement>('label')].filter((label) => label.textContent?.includes('Revisé esta pregunta, respuesta'));
    for (const label of reviews) await act(async () => label.querySelector<HTMLInputElement>('input')!.click());
    await click('Aprobar versión lista para resolver'); expect(container.textContent).toContain('Iniciar práctica'); expect((await source.examAction({ action: 'listExams' }))[0]?.visibility).toBe('personal');
  }, 20_000);

  it('permite finalizar un simulacro con preguntas sin responder y las cuenta como incorrectas sin generar otra vez', async () => {
    const ready = await exam(); const attempt = await source.examAction({ action: 'startAttempt', examId: ready.id, version: 1, mode: 'simulation', requestId: crypto.randomUUID() });
    const generate = vi.spyOn(source, 'generateExamQuestions'); await show(`/m/examenes/intentos/${attempt.id}`);
    const finish = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Terminar intento y ver resultado privado')!;
    expect(finish.disabled).toBe(false); expect(container.textContent).not.toContain('Guarda tus cambios de respuesta');
    await click('Terminar intento y ver resultado privado'); expect(container.textContent).toContain('0 de 2 aciertos'); expect(generate).not.toHaveBeenCalled();
  });

  it('guarda Q1 y conserva Q2 pendiente, incluso al consultar al recuperar el foco', async () => {
    const ready = await exam(); const attempt = await source.examAction({ action: 'startAttempt', examId: ready.id, version: 1, mode: 'practice', requestId: crypto.randomUUID() }); await show(`/m/examenes/intentos/${attempt.id}`);
    const questions = [...container.querySelectorAll<HTMLElement>('.exam-question')]; const q1 = questions[0]!.querySelector<HTMLInputElement>('input[type=radio]')!; const q2 = questions[1]!.querySelector<HTMLInputElement>('input[type=radio]')!;
    await act(async () => { q1.click(); q2.click(); }); expect(q1.checked).toBe(true); expect(q2.checked).toBe(true);
    await click('Guardar respuesta 1'); expect(q2.checked).toBe(true); expect(container.textContent).toContain('Guarda tus cambios de respuesta'); await focus(); expect(q2.checked).toBe(true);
    await click('Confirmar respuesta 1 y ver explicación'); expect(q2.checked).toBe(true); expect(container.querySelector('[aria-label="Explicación de la pregunta 1"]')).toBeTruthy();
    await click('Guardar respuesta 2'); expect((await source.examAction({ action: 'getAttempt', attemptId: attempt.id })).answers).toHaveLength(2);
  });

  it('detecta revisiones remotas y exige recargar; confirmaciones y cierre remotos prevalecen', async () => {
    const ready = await exam(); let attempt = await source.examAction({ action: 'startAttempt', examId: ready.id, version: 1, mode: 'practice', requestId: crypto.randomUUID() }); await show(`/m/examenes/intentos/${attempt.id}`);
    const q = attempt.questions[0]!; const radio = container.querySelector<HTMLInputElement>(`input[name="question-${q.id}"]`)!; await act(async () => radio.click());
    attempt = await source.examAction({ action: 'confirmAnswer', attemptId: attempt.id, expectedRevision: attempt.revision, questionId: q.id, optionId: q.options[1]!.id, requestId: crypto.randomUUID() }); await focus();
    expect(container.textContent).toContain('El intento cambió en otra ventana'); expect(container.querySelector('[aria-label="Explicación de la pregunta 1"]')).toBeTruthy(); expect(container.querySelector<HTMLInputElement>(`input[name="question-${q.id}"][value="${q.options[1]!.id}"]`)?.checked).toBe(true);
    await focus(); expect(container.textContent).toContain('El intento cambió en otra ventana');
    await click('Recargar estado descartando selecciones pendientes'); expect(container.textContent).not.toContain('El intento cambió en otra ventana');
    await source.examAction({ action: 'finishAttempt', attemptId: attempt.id, expectedRevision: attempt.revision, requestId: crypto.randomUUID() }); await focus(); expect(container.textContent).toContain('Mi resultado privado'); expect(container.textContent).not.toContain('Terminar intento y ver resultado privado');
  });

  it('oculta las preguntas al retirarse una fuente y conserva el resultado privado', async () => {
    const ready = await exam(); let attempt = await source.examAction({ action: 'startAttempt', examId: ready.id, version: 1, mode: 'simulation', requestId: crypto.randomUUID() }); attempt = await source.examAction({ action: 'finishAttempt', attemptId: attempt.id, expectedRevision: attempt.revision, requestId: crypto.randomUUID() }); await show(`/m/examenes/intentos/${attempt.id}`);
    expect(container.textContent).toContain('Pregunta ficticia'); const note = source.getSnapshot().notes.find((row) => row.id === noteId)!; await act(async () => source.withdrawContent('note', noteId, true, note.version));
    expect(container.textContent).not.toContain('Pregunta ficticia'); expect(container.textContent).not.toContain('Explicación ficticia'); expect(container.textContent).toContain('0 de 2 aciertos');
  });

  it('recupera una regeneración completada tras recargar y la aplica sin preparar ni llamar a Gemini', async () => {
    const draft = await exam(false); const selection = [draft.draft!.questions[0]!.id]; await generated({ ...input, config: { ...input.config!, questionCount: 1 } });
    const generate = vi.spyOn(source, 'generateExamQuestions'); const prepare = vi.spyOn(source, 'prepareExamMaterial');
    await show(`/m/examenes/${draft.id}/regenerar?${new URLSearchParams({ preguntas: JSON.stringify(selection) })}`); await click('Revisar resultado guardado para esta selección');
    expect(container.textContent).toContain('1 preguntas recuperadas para reemplazar 1'); await check('Revisé este resultado y confirmo reemplazar'); await click('Aplicar resultado guardado sin usar Gemini');
    expect(container.textContent).toContain('Revisar y editar mi borrador privado'); expect(generate).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
    expect((await source.examAction({ action: 'getExam', examId: draft.id })).draft!.questions).toHaveLength(2);
  });

  it('conserva cambios del borrador en consultas y avisa si cambió su revisión remota', async () => {
    const draft = await exam(false); await show(`/m/examenes/${draft.id}`); await fill('Título de mi borrador', 'Mi título pendiente'); await focus(); expect(container.querySelector<HTMLInputElement>('input[maxlength="200"]')?.value).toBe('Mi título pendiente');
    await source.examAction({ action: 'saveDraft', examId: draft.id, expectedRevision: draft.revision, version: 1, title: 'Cambio remoto', config: draft.draft!.config, questions: draft.draft!.questions }); await focus(); expect(container.textContent).toContain('El examen cambió en otra ventana'); expect(container.querySelector<HTMLInputElement>('input[maxlength="200"]')?.value).toBe('Mi título pendiente');
    await click('Recargar versión actual descartando cambios locales'); expect(container.querySelector<HTMLInputElement>('input[maxlength="200"]')?.value).toBe('Cambio remoto');
  });

  it('conserva identificadores de preguntas con coma y temas que coinciden con propiedades de Object', async () => {
    const ids = ['pregunta,con coma', 'otra pregunta', '__proto__']; expect(parseExamQuestionIds(JSON.stringify(ids))).toEqual(ids);
    await show('/m/examenes/nuevo'); await fill('Materia del examen', input.subjectId); await fill('Temario del examen, un tema por línea', 'constructor\n__proto__'); await fill('Cantidad de preguntas', '2'); expect(container.textContent).toContain('constructor: 1'); expect(container.textContent).toContain('__proto__: 1');
    await check('Material EX2 compartido'); const topicChecks = [...container.querySelectorAll<HTMLInputElement>('.ai-source__topics input')]; for (const checkbox of topicChecks) await act(async () => checkbox.click()); await click('Preparar vista previa sin enviar a Gemini'); expect(container.textContent).toContain('Texto exacto preparado');
  });
});
