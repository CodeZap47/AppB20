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
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text);
async function click(text: string) { const target = button(text); expect(target, text).toBeTruthy(); await act(async () => target!.click()); }
async function type(element: HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }

describe('agente personal simulado (AG-1)', () => {
  it('se llama NOMBRE_BOT y muestra las trece premisas literales', async () => {
    await show();
    expect(container.querySelector('h1')?.textContent).toBe('Alumno_DP1_BOT');
    const items = [...container.querySelectorAll('#premisas li')].map((li) => li.textContent);
    expect(items).toHaveLength(13);
    expect(items[0]).toBe('Soy Alumno_DP1_BOT, el agente personal de Alumno. Solo trabajo para la persona dueña de esta cuenta y solo con su clave de Gemini.');
    expect(items[7]).toBe('No entrego, publico ni subo tareas por mi cuenta. Publicar o entregar siempre es una acción expresa de Alumno.');
  });

  it('entrena solo con textos propios, deja fuera los coautorados y exige consentimiento', async () => {
    await show();
    const coauthored = [...container.querySelectorAll('.agent-sources li')].find((li) => li.textContent?.includes('Coautorado'));
    expect(coauthored?.querySelector('input')?.checked).toBe(false);
    expect(button('Entrenar a Alumno_DP1_BOT')?.disabled).toBe(true);
    await act(async () => [...container.querySelectorAll<HTMLInputElement>('.check input')].at(-1)!.click());
    await click('Entrenar a Alumno_DP1_BOT');
    expect(container.textContent).toContain('Aprendido de');
    expect(container.querySelector('.badge--resolved')?.textContent).toBe('Listo');
  });

  it('revisa el borrador con sugerencias una por una y señala el parecido sin reescribirlo', async () => {
    const works = source.getSnapshot().works.length; const theirs = source.getSnapshot().works.find((w) => !w.authorIds.includes('demo-1'))!;
    await show(`/m/agente?tarea=${theirs.assignmentId}`);
    expect(container.textContent).toContain('Punto clave');
    await click('Revisar mi borrador');
    const draft = container.querySelector('textarea')!;
    await type(draft, 'El ciclo ciclo termina cuando la condición deja de cumplirse.');
    await click('Pedir sugerencias a Alumno_DP1_BOT'); await click('Aceptar');
    expect(draft.value).toBe('El ciclo termina cuando la condición deja de cumplirse.');
    await click('Entendido');
    expect(container.querySelectorAll('.agent-suggestions [data-state="proposed"]')).toHaveLength(0);

    await type(draft, theirs.description); await click('Comparar con el grupo');
    expect(container.textContent).toContain('Alerta de originalidad'); expect(container.textContent).toContain('Oración copiada');
    expect(draft.value).toBe(theirs.description);
    await click('Reescribiré esta parte'); expect(container.textContent).toContain('Marcaste que reescribirás esta parte.');
    expect(button('Subir tarea (plug-in, pendiente)')?.disabled).toBe(true);
    expect(source.getSnapshot().works).toHaveLength(works);
  });

  it('reinicia el perfil y el borrador al cambiar de integrante', async () => {
    await show();
    await act(async () => [...container.querySelectorAll<HTMLInputElement>('.check input')].at(-1)!.click());
    await act(async () => source.setViewer('demo-2'));
    expect(container.querySelector('h1')?.textContent).toBe('Alumno_DP2_BOT');
    expect(button('Entrenar a Alumno_DP2_BOT')?.disabled).toBe(true);
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
