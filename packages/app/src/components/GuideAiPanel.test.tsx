// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import type { GuideAiDraft } from '@b20/core';
import { GuideAiPanel } from './GuideAiPanel';
import { AiClientError } from '../data/aiClient';

let root: Root; let container: HTMLDivElement; let source: DemoDataSource; let subjectId: string;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1'); subjectId = source.getSnapshot().subjects[0]!.id;
  source.saveNote({ subjectId, title: 'Fuente compartida elegida', topic: 'Tema', body: 'Contenido', tags: [], visibility: 'group', source: 'student' });
  source.saveNote({ subjectId, title: 'Nota privada que no debe aparecer', topic: 'Tema', body: 'Privado', tags: [], visibility: 'personal', source: 'student' });
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.unstubAllGlobals(); });
async function show() { await act(async () => root.render(<MemoryRouter><DataProvider source={source}><GuideAiPanel /></DataProvider></MemoryRouter>)); }
async function fill(label: string, value: string) {
  const field = [...container.querySelectorAll<HTMLLabelElement>('label')].find((entry) => entry.querySelector('span')?.textContent === label)!;
  const control = field.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')!;
  await act(async () => { const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
async function click(text: string) { const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === text)!; expect(button).toBeTruthy(); await act(async () => button.click()); }
async function selectSource() {
  await fill('Materia de la guía', subjectId); await fill('Título del borrador privado', 'Mi borrador'); await fill('Temario de la guía, un tema por línea', 'Tema');
  const label = [...container.querySelectorAll<HTMLLabelElement>('.ai-source__choice')].find((entry) => entry.textContent?.includes('Fuente compartida elegida'))!;
  await act(async () => label.querySelector<HTMLInputElement>('input')!.click());
}
async function prepare() { await selectSource(); await click('Preparar borrador privado sin enviar a Gemini'); }
async function confirm() { const label = [...container.querySelectorAll<HTMLLabelElement>('label')].find((entry) => entry.textContent?.includes('Revisé la vista previa y confirmo enviar'))!; await act(async () => label.querySelector<HTMLInputElement>('input')!.click()); }

describe('recorrido de Guías con Gemini', () => {
  it('requiere confirmación después de la vista previa, conserva el borrador y solo publica con acción explícita', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network); const generate = vi.spyOn(source, 'runGuideAiStep'); const publish = vi.spyOn(source, 'publishGuideAiDraft');
    const before = source.getSnapshot().guides.length;
    await show(); await prepare();
    expect(container.textContent).not.toContain('Nota privada que no debe aparecer');
    expect(container.textContent).toContain('Texto exacto preparado para Gemini'); expect(container.textContent).toContain('1 llamada prevista');
    expect(generate).not.toHaveBeenCalled(); const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === 'Generar borrador privado')!; expect(button.disabled).toBe(true);
    await confirm(); await click('Generar borrador privado'); expect(generate).toHaveBeenCalledTimes(1); expect(publish).not.toHaveBeenCalled(); expect(source.getSnapshot().guides).toHaveLength(before);
    expect(container.textContent).toContain('Revisar y editar el borrador');
    await click('Publicar guía para el grupo'); expect(publish).toHaveBeenCalledTimes(1); expect(source.getSnapshot().guides).toHaveLength(before + 1);
    expect(container.textContent).toContain('Abrir la versión compartida'); expect(network).not.toHaveBeenCalled();
  });

  it('limpia el material privado al cambiar de cuenta y vuelve a consultarlo únicamente como su dueño', async () => {
    await show(); await prepare(); expect(container.textContent).toContain('Texto exacto preparado para Gemini');
    await act(async () => source.setViewer('demo-2')); expect(container.textContent).not.toContain('Texto exacto preparado para Gemini'); expect(container.textContent).toContain('Todavía no tienes borradores privados');
    await act(async () => source.setViewer('demo-1')); expect(container.textContent).not.toContain('Texto exacto preparado para Gemini');
    await click('Mi borrador'); expect(container.textContent).toContain('Texto exacto preparado para Gemini');
  });

  it('no reenvía una respuesta incierta y obliga a consultar el estado antes de otro intento', async () => {
    await show(); await prepare(); const draft = (await source.listGuideAiDrafts())[0]!; const detail = await source.getGuideAiDraft(draft.id);
    const generate = vi.spyOn(source, 'runGuideAiStep').mockRejectedValue(new Error('No se pudo confirmar el resultado.'));
    await confirm(); await click('Generar borrador privado'); expect(generate).toHaveBeenCalledTimes(1);
    const generateButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === 'Generar borrador privado')!; expect(generateButton.disabled).toBe(true);
    const unknown: GuideAiDraft = { ...detail, revision: detail.revision + 1, state: 'unknown', steps: detail.steps.map((entry) => ({ ...entry, state: 'unknown' })) };
    vi.spyOn(source, 'getGuideAiDraft').mockResolvedValue(unknown);
    await click('Consultar estado guardado'); expect(container.textContent).toContain('Acepto otro intento manual'); expect(generate).toHaveBeenCalledTimes(1);
    await confirm(); expect([...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === 'Generar borrador privado')!.disabled).toBe(true);
  });

  it('permite reconocer un envío incierto anterior de otra operación sin reenviarlo automáticamente', async () => {
    await show(); await prepare(); const generate = vi.spyOn(source, 'runGuideAiStep').mockRejectedValue(new AiClientError('unknown_confirmation_required', 'Hay otro envío incierto.'));
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
    expect(container.textContent).toContain('Cancelar pasos pendientes');
  });

  it('actualiza las fuentes del mismo borrador conservando el texto y exige revisar las citas sin otra llamada a Gemini', async () => {
    await show(); await prepare(); const generate = vi.spyOn(source, 'runGuideAiStep'); const refresh = vi.spyOn(source, 'refreshGuideAiDraft');
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
});
