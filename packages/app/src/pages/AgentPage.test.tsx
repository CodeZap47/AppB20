// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { DemoDataSource, createDemoState } from '../data/demo';
import { agentOriginality } from '../data/agentDemo';
import { AgentPage } from './AgentPage';

let root: Root, container: HTMLDivElement, source: DemoDataSource;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); source = new DemoDataSource(createDemoState(), 'demo-1'); });
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); });
const show = async (entry = '/m/agente') => { await act(async () => root.render(<MemoryRouter initialEntries={[entry]}><DataProvider source={source}><AgentPage /></DataProvider></MemoryRouter>)); };
const remount = async (entry?: string) => { await act(async () => root.unmount()); root = createRoot(container); await show(entry); };
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text);
async function click(text: string) { const target = button(text); expect(target, text).toBeTruthy(); expect(target!.disabled, text).toBe(false); await act(async () => target!.click()); }
async function type(element: HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function activate() { await act(async () => container.querySelector<HTMLInputElement>('.agent-consent input')!.click()); await click('Activar a Alumno_DP1_BOT'); }

describe('agente personal guardado (AG-3)', () => {
  it('se llama NOMBRE_BOT, muestra las trece premisas y exige aceptarlas antes de usarlo', async () => {
    await show();
    expect(container.querySelector('h1')?.textContent).toBe('Alumno_DP1_BOT');
    const items = [...container.querySelectorAll('#premisas li')].map((li) => li.textContent);
    expect(items).toHaveLength(13);
    expect(items[0]).toBe('Soy Alumno_DP1_BOT, el agente personal de Alumno. Solo trabajo para la persona dueña de esta cuenta y solo con su clave de Gemini.');
    expect(items[7]).toBe('No entrego, publico ni subo tareas por mi cuenta. Publicar o entregar siempre es una acción expresa de Alumno.');
    expect(button('Entrenar estilo')).toBeUndefined(); expect(button('Activar a Alumno_DP1_BOT')?.disabled).toBe(true);
    await activate(); expect(source.getSnapshot().agentProfile?.premisesVersion).toBe(1); expect(button('Entrenar estilo')).toBeTruthy();
  });

  it('entrena solo con textos propios y conserva el perfil al volver a abrir la página', async () => {
    await show(); await activate();
    const coauthored = [...container.querySelectorAll('.agent-sources li')].find((li) => li.textContent?.includes('Coautorado'));
    expect(coauthored?.querySelector('input')?.checked).toBe(false);
    await click('Entrenar a Alumno_DP1_BOT');
    expect(source.getSnapshot().agentStyleSnapshots).toHaveLength(1); expect(container.textContent).toContain('aprendido de');
    await remount('/m/agente?pestana=profile');
    expect(container.querySelector('.badge--resolved')?.textContent).toBe('Listo'); expect(container.textContent).toContain('Versión 1');
  });

  it('guarda el borrador, aplica sugerencias y compara con el grupo sin reescribir', async () => {
    const works = source.getSnapshot().works.length; const theirs = source.getSnapshot().works.find((w) => !w.authorIds.includes('demo-1'))!;
    await show(`/m/agente?tarea=${theirs.assignmentId}`); await activate();
    await click('Empezar con Alumno_DP1_BOT'); expect(container.textContent).toContain('Punto clave');
    await click('Revisar mi borrador'); expect(source.getSnapshot().agentSessions[0]?.stage).toBe('review');
    await type(container.querySelector('textarea')!, 'El ciclo ciclo termina cuando la condición deja de cumplirse.');
    expect(button('Pedir sugerencias a Alumno_DP1_BOT')?.disabled).toBe(true);
    await click('Guardar borrador'); await click('Pedir sugerencias a Alumno_DP1_BOT'); await click('Aceptar');
    expect(source.getSnapshot().agentSessions[0]).toMatchObject({ draft: 'El ciclo termina cuando la condición deja de cumplirse.', draftVersion: 2 });
    expect(container.querySelector('textarea')!.value).toBe('El ciclo termina cuando la condición deja de cumplirse.');
    await click('Entendido'); expect(container.querySelectorAll('.agent-suggestions [data-state="proposed"]')).toHaveLength(0);

    await type(container.querySelector('textarea')!, theirs.description); await click('Guardar borrador'); await click('Comparar con el grupo');
    expect(container.textContent).toContain('Alerta de originalidad'); expect(container.textContent).toContain('Oración copiada');
    expect(container.querySelector('textarea')!.value).toBe(theirs.description);
    await click('Reescribiré esta parte'); expect(source.getSnapshot().agentOriginalityChecks[0]?.acknowledged).toHaveLength(1);
    await remount(`/m/agente?tarea=${theirs.assignmentId}`);
    expect(container.querySelector('textarea')!.value).toBe(theirs.description); expect(container.textContent).toContain('Marcaste que reescribirás esta parte.');
    expect(button('Subir tarea (plug-in, pendiente)')?.disabled).toBe(true);
    expect(source.getSnapshot().works).toHaveLength(works);
  });

  it('cada integrante ve solo su agente y desactivarlo borra sus datos', async () => {
    await show(); await activate(); await click('Entrenar a Alumno_DP1_BOT');
    await act(async () => source.setViewer('demo-2'));
    expect(container.querySelector('h1')?.textContent).toBe('Alumno_DP2_BOT'); expect(source.getSnapshot().agentProfile).toBeUndefined();
    await act(async () => source.setViewer('demo-1'));
    await act(async () => container.querySelector<HTMLDetailsElement>('.agent-disable')!.setAttribute('open', ''));
    await act(async () => container.querySelector<HTMLInputElement>('.agent-disable input')!.click());
    await click('Desactivar y borrar mis datos del agente');
    expect(source.getSnapshot().agentProfile).toBeUndefined(); expect(source.getSnapshot().agentStyleSnapshots).toHaveLength(0);
  });
});

describe('originalidad contra lo publicado', () => {
  const essay = 'Un ciclo while repite instrucciones mientras su condición sea verdadera. Si el índice nunca cambia, el ciclo no termina y el programa se queda congelado. Por eso conviene revisar el incremento antes de ejecutar el programa completo.';
  const withWork = (description: string, authorIds: string[]) => { const data = source.getSnapshot(); const base = data.works[0]!; return { ...data, works: [...data.works, { ...base, id: 'w-extra', title: 'Ensayo de ciclos', description, authorIds }] }; };
  it('da porcentaje con textos largos, excluye los propios y la consigna', () => {
    expect(agentOriginality(essay, withWork(essay, ['demo-2']))[0]).toMatchObject({ refKey: 'work:w-extra', status: 'compared', score: 100, level: 'block' });
    expect(agentOriginality(essay, withWork(essay, ['demo-1']))).toEqual([]);
    const assignment = { ...source.getSnapshot().assignments[0]!, instructions: essay };
    expect(agentOriginality(essay, withWork(essay, ['demo-2']), assignment)).toEqual([]);
  });
  it('respeta umbrales configurados', () => {
    const half = `${essay} Las listas enlazadas guardan nodos con una referencia al siguiente elemento y se recorren uno por uno hasta encontrar el valor buscado en la estructura.`;
    expect(agentOriginality(half, withWork(essay, ['demo-2']))[0]?.level).toBe('warn');
    expect(agentOriginality(half, withWork(essay, ['demo-2']), undefined, { warn: 10, block: 40 })[0]?.level).toBe('block');
  });
});

describe('agente con Gemini por pasos (AG-4)', () => {
  it('muestra la vista previa con las premisas y no envía nada si el paso está apagado', async () => {
    const theirs = source.getSnapshot().works.find((w) => !w.authorIds.includes('demo-1'))!;
    await show(`/m/agente?tarea=${theirs.assignmentId}`); await activate();
    await click('Entrenar estilo'); await click('Entrenar a Alumno_DP1_BOT');
    await click('Ayudar con una tarea'); await click('Empezar con Alumno_DP1_BOT');
    await click('Entender y planear (apagado)');
    const preview = container.querySelector('[aria-label="Vista previa del envío"]')!;
    expect(preview.textContent).toContain('tokens estimados'); expect(preview.textContent).toContain('Soy Alumno_DP1_BOT, el agente personal de Alumno.');
    expect(preview.textContent).toContain('no se envía nada'); expect(button('Enviar a Gemini')).toBeUndefined();
    await click('Revisar mi borrador'); await type(container.querySelector('textarea')!, 'Mi borrador propio sobre el tema.'); await click('Guardar borrador');
    await click('Revisión del borrador (apagado)');
    expect(container.querySelector('[aria-label="Vista previa del envío"]')?.textContent).toContain('Tu borrador (33 caracteres)');
    await click('Explicación del parecido (apagado)'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Compara tu borrador actual');
  });
});
