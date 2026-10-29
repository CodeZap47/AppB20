// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@b20/core';
import { DataProvider, useSnapshot } from '../../data/DataContext';
import { createDemoState, DemoDataSource } from '../../data/demo';
import type { Snapshot } from '../../data/types';
import { FeedComposer } from './FeedComposer';

const destinations = [
  ['Crear tarea', '/m/tareas/nueva'],
  ['Compartir apunte', '/m/notas/nueva?visibilidad=grupo'],
  ['Hacer pregunta', '/m/preguntas/nueva'],
  ['Registrar actividad', '/m/actividades/nueva'],
  ['Crear guía', '/m/guias/nueva'],
  ['Preparar examen', '/m/examenes/nuevo'],
  ['Crear votación', '/m/votaciones/nueva'],
  ['Crear sala', '/m/salas/nueva'],
  ['Publicar ayuda', '/m/ayuda/nueva'],
  ['Crear reto', '/m/retos/nuevo'],
  ['Pedir revisión de código', '/m/revision-codigo/nueva'],
  ['Documentar bug', '/m/museo-bugs?crear=1'],
  ['Crear colección de repaso', '/m/repaso/nueva?visibilidad=grupo'],
  ['Compartir oportunidad', '/m/oportunidades?crear=1'],
] as const;

let root: Root, container: HTMLDivElement, source: DemoDataSource, data: Snapshot;
function Harness() {
  const snapshot = useSnapshot(), location = useLocation();
  return <><FeedComposer me={snapshot.me} subjects={snapshot.subjects} /><output aria-label="Destino">{location.pathname + location.search}</output></>;
}
const show = () => act(async () => root.render(<MemoryRouter initialEntries={['/m/inicio']}><DataProvider source={source}><Harness /></DataProvider></MemoryRouter>));
const links = () => [...container.querySelectorAll<HTMLAnchorElement>('[aria-label="Crear desde un módulo"] a')];
const draft = () => container.querySelector<HTMLTextAreaElement>('[aria-label="Escribe una publicación para el grupo"]')!;
async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(draft(), text);
    draft().dispatchEvent(new Event('input', {bubbles: true}));
  });
}
beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  source = new DemoDataSource(createDemoState(), 'demo-1'); data = source.getSnapshot();
  vi.spyOn(source, 'getSnapshot').mockImplementation(() => data);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.restoreAllMocks(); });

describe('crear desde los módulos del feed', () => {
  it('muestra los catorce accesos completos con los tres actuales al principio e iconos decorativos', async () => {
    await show();
    expect(links().map(link => [link.textContent, link.getAttribute('href')])).toEqual(destinations);
    expect(links().every(link => link.querySelector('svg[aria-hidden="true"]'))).toBe(true);
    expect(links().every(link => !link.hasAttribute('aria-disabled'))).toBe(true);
  });

  it.each(destinations)('abre %s sin publicar ni vaciar el borrador', async (label, destination) => {
    const publish = vi.spyOn(source, 'createFeedPost');
    await show(); await type('Mi borrador sigue sin publicar');
    const subject = container.querySelector<HTMLSelectElement>('[aria-label="Materia"]')!;
    await act(async () => { subject.value = data.subjects[0]!.id; subject.dispatchEvent(new Event('change', {bubbles: true})); });
    await act(async () => links().find(link => link.textContent === label)!.click());
    expect(container.querySelector('output')?.textContent).toBe(destination);
    expect(publish).not.toHaveBeenCalled();
    expect(draft().value).toBe('Mi borrador sigue sin publicar');
    expect(subject.value).toBe(data.subjects[0]!.id);
  });

  it('presenta un módulo futuro declarado por el catálogo sin exigir un icono específico', async () => {
    vi.spyOn(core, 'availableFeedCreateActions').mockReturnValue([...core.availableFeedCreateActions(), {
      id: 'future', moduleId: 'future-module', label: 'Crear desde el módulo futuro', path: '/m/futuro/nuevo',
    }]);
    await show();
    const future = links().find(link => link.textContent === 'Crear desde el módulo futuro')!;
    expect(future.getAttribute('href')).toBe('/m/futuro/nuevo');
    expect(future.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    await act(async () => future.click());
    expect(container.querySelector('output')?.textContent).toBe('/m/futuro/nuevo');
  });

  it('bloquea navegación y doble envío durante el guardado y conserva datos ante errores', async () => {
    let rejectSave!: (reason: Error) => void;
    const publish = vi.spyOn(source, 'createFeedPost').mockImplementation(() => new Promise<string>((_resolve, reject) => { rejectSave = reject; }));
    await show(); await type('Conservar esta idea si falla la red');
    const submit = () => container.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    await act(async () => { submit(); });
    expect(links()).toHaveLength(14);
    expect(links().every(link => link.getAttribute('aria-disabled') === 'true' && link.tabIndex === -1 && !link.hasAttribute('href'))).toBe(true);
    await act(async () => { links()[0]!.click(); submit(); });
    expect(container.querySelector('output')?.textContent).toBe('/m/inicio');
    expect(publish).toHaveBeenCalledTimes(1);
    await act(async () => rejectSave(new Error('No hubo conexión')));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('No hubo conexión');
    expect(draft().value).toBe('Conservar esta idea si falla la red');
    expect(links().every(link => !link.hasAttribute('aria-disabled'))).toBe(true);
  });

  it.each(['offline', 'inactive'] as const)('respeta la restricción de acceso %s', async (condition) => {
    data = condition === 'offline' ? {...data, connection: 'offline'} : {...data, me: {...data.me!, status: 'removed'}};
    await show();
    expect(links().every(link => link.getAttribute('aria-disabled') === 'true')).toBe(true);
    await act(async () => links()[0]!.click());
    expect(container.querySelector('output')?.textContent).toBe('/m/inicio');
    expect(draft().disabled).toBe(true);
  });
});
