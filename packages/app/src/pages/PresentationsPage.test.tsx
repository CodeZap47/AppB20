// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyPresentationObservations } from '@b20/core';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Member, Snapshot } from '../data/types';
import type { PresentationAttempt, PresentationPractice } from '../data/presentationTypes';
import { PresentationAttemptPage, PresentationFormPage, PresentationPracticePage, PresentationsPage } from './PresentationsPage';

const now = new Date('2026-10-21T12:00:00Z');
const owner: Member = { id: 'owner', displayName: 'Ana', status: 'active', isCreator: false, joinedAt: now };
const reviewer: Member = { ...owner, id: 'reviewer', displayName: 'Luis' };
const other: Member = { ...owner, id: 'other', displayName: 'Otra persona' };
const configuration = { title: 'Explicar recursión', topic: 'Recursión', audience: 'Compañeros', targetMinutes: 5, keyPoints: ['Caso base', 'Paso recursivo'] };
const practice = (patch: Partial<PresentationPractice> = {}): PresentationPractice => ({
  id: 'practice-1', ownerId: owner.id, reviewerId: reviewer.id, subjectId: 'subject-1', termId: 'term-1',
  ...configuration, version: 3, archived: false, createdAt: now, updatedAt: now, ...patch,
});
const attempt = (patch: Partial<PresentationAttempt> = {}): PresentationAttempt => ({
  id: 'attempt-1', practiceId: 'practice-1', subjectId: 'subject-1', termId: 'term-1', number: 1, status: 'draft', body: 'La recursión usa un caso base.',
  ...configuration, version: 2, createdAt: now, updatedAt: now, ...patch,
});
let snapshot: Snapshot;
let container: HTMLDivElement;
let root: Root;
let listeners: Set<() => void>;
let source: DataSource;
let actions: ReturnType<typeof makeActions>;

function makeActions() {
  return {
    savePresentationPractice: vi.fn().mockResolvedValue('created'),
    setPresentationReviewer: vi.fn().mockResolvedValue(undefined),
    archivePresentationPractice: vi.fn().mockResolvedValue(undefined),
    createPresentationAttempt: vi.fn().mockResolvedValue('created-attempt'),
    savePresentationAttempt: vi.fn().mockResolvedValue(undefined),
    completePresentationAttempt: vi.fn().mockResolvedValue(undefined),
    askPresentationQuestion: vi.fn().mockResolvedValue('created-question'),
    answerPresentationQuestion: vi.fn().mockResolvedValue(undefined),
    savePresentationFeedback: vi.fn().mockResolvedValue(undefined),
  };
}

async function mount(url = '/m/exposiciones/practice-1/intentos/attempt-1') {
  const router = createMemoryRouter([
    { path: '/m/exposiciones', element: <PresentationsPage /> },
    { path: '/m/exposiciones/nueva', element: <PresentationFormPage /> },
    { path: '/m/exposiciones/created', element: <p>Exposición creada</p> },
    { path: '/m/exposiciones/:practiceId/editar', element: <PresentationFormPage /> },
    { path: '/m/exposiciones/:practiceId', element: <PresentationPracticePage /> },
    { path: '/m/exposiciones/:practiceId/intentos/created-attempt', element: <p>Nuevo intento creado</p> },
    { path: '/m/exposiciones/:practiceId/intentos/:attemptId', element: <PresentationAttemptPage /> },
  ], { initialEntries: [url] });
  await act(async () => root.render(<DataProvider source={source}><RouterProvider key={url} router={router} /></DataProvider>));
}
async function update(patch: Partial<Snapshot>) {
  await act(async () => { snapshot = { ...snapshot, ...patch }; listeners.forEach((listener) => listener()); });
}
function input(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const target = [...container.querySelectorAll('label')].find((node) => node.textContent?.startsWith(label))?.querySelector('input, textarea, select');
  if (!target) throw new Error(`No encontramos el campo ${label}`);
  return target as HTMLInputElement;
}
async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
function button(label: string): HTMLButtonElement {
  const target = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes(label));
  if (!target) throw new Error(`No encontramos el botón ${label}`);
  return target;
}
async function click(label: string) { await act(async () => button(label).click()); }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  snapshot = { ...emptySnapshot('ready'), me: owner, members: [owner, reviewer, other],
    subjects: [{ id: 'subject-1', name: 'Programación', period: 1 }, { id: 'subject-2', name: 'Matemáticas', period: 1 }],
    terms: [{ id: 'term-1', subjectId: 'subject-1', name: 'Primer parcial', position: 1 }],
    presentationPractices: [practice()], presentationAttempts: [attempt()],
    presentationPersonal: [{ attemptId: 'attempt-1', ...emptyPresentationObservations(), clarity: 'Observación secreta', nextSteps: 'Pasos secretos' }],
    presentationQuestions: [{ id: 'question-1', attemptId: 'attempt-1', authorId: owner.id, kind: 'guided', text: '¿Cuál es el caso base?', answer: '', version: 1, createdAt: now }],
    presentationFeedback: [],
    notes: [{ id: 'private-note', subjectId: 'subject-1', title: 'Nota personal', topic: 'Recursión', body: 'Contenido privado de referencia', authorId: owner.id, source: 'student', visibility: 'personal', version: 2, tags: [], createdAt: now, updatedAt: now }],
  };
  listeners = new Set(); actions = makeActions();
  source = { label: 'Pantallas de exposiciones', ...actions, getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  } as unknown as DataSource;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('Exposiciones', () => {
  it('separa prácticas propias e invitaciones y filtra por tema, materia y parcial', async () => {
    snapshot.presentationPractices.push(practice({ id: 'review', ownerId: reviewer.id, reviewerId: owner.id, title: 'Vectores', topic: 'Vectores', subjectId: 'subject-2', termId: undefined }));
    await mount('/m/exposiciones');
    expect(container.textContent).toContain('Explicar recursión'); expect(container.textContent).not.toContain('Vectores');
    await click('Revisiones invitadas'); expect(container.textContent).toContain('Vectores'); expect(container.textContent).not.toContain('Explicar recursión');
    await change(input('Materia'), 'subject-1'); expect(container.textContent).toContain('No hay exposiciones con estos filtros');
    await click('Mis prácticas'); await change(input('Parcial'), 'term-1'); expect(container.textContent).toContain('Explicar recursión');
    await change(input('Buscar por tema'), 'sin resultado'); expect(container.textContent).toContain('No hay exposiciones con estos filtros');
  });
  it('muestra el estado vacío sin prácticas', async () => {
    snapshot.presentationPractices = []; await mount('/m/exposiciones');
    expect(container.textContent).toContain('Prepara tu primera exposición');
  });
  it('permite crear sin fuente con contexto, duración y puntos', async () => {
    await mount('/m/exposiciones/nueva');
    await change(input('Título'), 'Explicar listas'); await change(input('Tema'), 'Listas'); await change(input('Público'), 'El grupo'); await change(input('Duración'), '7'); await change(input('Puntos'), 'Nodos\nEnlaces');
    await click('Guardar exposición');
    expect(actions.savePresentationPractice).toHaveBeenCalledWith(expect.objectContaining({ title: 'Explicar listas', topic: 'Listas', audience: 'El grupo', targetMinutes: 7, keyPoints: ['Nodos', 'Enlaces'], source: undefined, requestId: expect.any(String) }));
    expect(container.textContent).toContain('Exposición creada');
  });
  it('precarga nota sin copiar texto y bloquea fuente inaccesible', async () => {
    await mount('/m/exposiciones/nueva?nota=private-note');
    expect(input('Título').value).toBe('Nota personal'); expect(input('Tema').value).toBe('Recursión'); expect(input('Nota o guía').value).toBe('note:private-note');
    expect(container.textContent).not.toContain('Contenido privado de referencia');
    await update({ notes: [] }); expect(button('Guardar exposición').disabled).toBe(true); expect(container.textContent).toContain('Ya no puedes usar esta fuente');
    await change(input('Nota o guía'), ''); expect(input('Nota o guía').value).toBe('');
  });
  it('conserva configuración escrita y versión original ante cambios concurrentes', async () => {
    await mount('/m/exposiciones/practice-1/editar'); await change(input('Título'), 'Título local');
    await update({ presentationPractices: [practice({ title: 'Cambio remoto', version: 4 })] });
    expect(input('Título').value).toBe('Título local'); expect(container.textContent).toContain('La configuración cambió');
    await click('Guardar exposición'); expect(actions.savePresentationPractice).toHaveBeenCalledWith(expect.objectContaining({ title: 'Título local', expectedVersion: 3 }));
  });
  it('crea primer intento por separado y envía versión de la práctica', async () => {
    snapshot.presentationAttempts = []; await mount('/m/exposiciones/practice-1'); await click('Crear primer intento');
    expect(actions.createPresentationAttempt).toHaveBeenCalledWith('practice-1', expect.any(String), 3); expect(container.textContent).toContain('Nuevo intento creado');
  });
  it('reintenta la creación con el mismo identificador y versión después de una respuesta perdida', async () => {
    snapshot.presentationAttempts = []; actions.createPresentationAttempt.mockRejectedValueOnce(new Error('Aún no llegó el intento.'));
    await mount('/m/exposiciones/practice-1'); await click('Crear primer intento');
    await update({ presentationPractices: [practice({ version: 4 })] }); await click('Crear primer intento');
    expect(actions.createPresentationAttempt.mock.calls[0]).toEqual(actions.createPresentationAttempt.mock.calls[1]);
    expect(actions.createPresentationAttempt.mock.calls[1]?.[2]).toBe(3);
  });
  it('retoma el borrador antes de crear otro intento', async () => {
    await mount('/m/exposiciones/practice-1'); expect(button('Nuevo intento').disabled).toBe(true);
    expect(container.querySelector('a[href="/m/exposiciones/practice-1/intentos/attempt-1"]')).not.toBeNull();
  });
  it('explica lo que se comparte y requiere invitación explícita', async () => {
    snapshot.presentationPractices = [practice({ reviewerId: undefined })]; await mount('/m/exposiciones/practice-1');
    await change(input('Compañero revisor'), 'reviewer'); expect(actions.setPresentationReviewer).not.toHaveBeenCalled();
    expect(container.textContent).toContain('No se comparten borradores, observaciones personales ni siguientes pasos');
    await click('Invitar revisor'); expect(actions.setPresentationReviewer).toHaveBeenCalledWith('practice-1', 'reviewer', 3);
    expect(container.textContent).toContain('Acceso del revisor actualizado');
  });
  it('guarda un borrador con observaciones privadas y confirma el resultado', async () => {
    await mount(); await change(input('Explicación'), 'Texto nuevo'); await change(input('Claridad'), 'Revisar claridad'); await change(input('Siguientes pasos'), 'Hacer otro ejemplo');
    await click('Guardar borrador');
    expect(actions.savePresentationAttempt).toHaveBeenCalledWith('attempt-1', { body: 'Texto nuevo', clarity: 'Revisar claridad', examples: '', decisions: '', limitations: '', nextSteps: 'Hacer otro ejemplo' }, 2);
    expect(container.textContent).toContain('Borrador guardado');
    await click('Guardar borrador'); expect(actions.savePresentationAttempt.mock.calls[1]?.[2]).toBe(3);
  });
  it('conserva el texto y la versión para reintentar después de fallo', async () => {
    actions.savePresentationAttempt.mockRejectedValueOnce(new Error('Sin conexión.')); await mount(); await change(input('Explicación'), 'Texto pendiente');
    await click('Guardar borrador'); expect(container.textContent).toContain('Sin conexión'); expect(input('Explicación').value).toBe('Texto pendiente');
    await click('Guardar borrador'); expect(actions.savePresentationAttempt.mock.calls.map((call) => call[2])).toEqual([2, 2]); expect(container.textContent).toContain('Borrador guardado');
  });
  it('no concluye si falla el guardado y conserva el borrador al reconectar sin storage', async () => {
    const persist = vi.spyOn(Storage.prototype, 'setItem');
    actions.savePresentationAttempt.mockRejectedValueOnce(new Error('Sin conexión.'));
    await mount(); await change(input('Explicación'), 'Mi ensayo privado sin guardar'); await change(input('Siguientes pasos'), 'Mi plan privado');
    await click('Guardar y concluir'); expect(actions.completePresentationAttempt).not.toHaveBeenCalled();
    await update({ connection: 'offline', me: undefined }); await act(async () => root.render(null));
    snapshot = { ...snapshot, connection: 'ready', me: owner, presentationAttempts: [attempt({ version: 5, body: 'Cambio remoto' })] };
    await mount(); expect(input('Explicación').value).toBe('Mi ensayo privado sin guardar'); expect(input('Siguientes pasos').value).toBe('Mi plan privado');
    expect(container.textContent).toContain('Sin conexión'); expect(container.textContent).toContain('Este intento cambió en otra pestaña');
    await click('Guardar borrador'); expect(actions.savePresentationAttempt.mock.calls[1]?.[2]).toBe(2); expect(persist).not.toHaveBeenCalled();
  });
  it('descarta el borrador al salir voluntariamente', async () => {
    await mount(); await change(input('Explicación'), 'Texto temporal'); await act(async () => root.render(null));
    await mount(); expect(input('Explicación').value).toBe('La recursión usa un caso base.');
  });
  it('evita doble envío mientras guarda y conserva el texto ante actualización externa', async () => {
    let finish!: () => void; actions.savePresentationAttempt.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })); await mount();
    await change(input('Explicación'), 'Mi texto'); await click('Guardar borrador'); expect(button('Guardando').disabled).toBe(true); expect(button('Guardar y concluir').disabled).toBe(true);
    await update({ presentationAttempts: [attempt({ version: 4, body: 'Texto remoto' })] }); expect(input('Explicación').value).toBe('Mi texto');
    await act(async () => finish()); expect(actions.savePresentationAttempt).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Este intento cambió en otra pestaña');
  });
  it('permite cargar explícitamente la versión guardada tras un conflicto', async () => {
    await mount(); await change(input('Explicación'), 'Mi cambio'); await update({ presentationAttempts: [attempt({ version: 4, body: 'Texto remoto' })] });
    expect(input('Explicación').value).toBe('Mi cambio'); await click('Cargar versión guardada'); expect(input('Explicación').value).toBe('Texto remoto');
    await click('Guardar borrador'); expect(actions.savePresentationAttempt).toHaveBeenCalledWith('attempt-1', expect.objectContaining({ body: 'Texto remoto' }), 4);
  });
  it('concluye después de guardar, bloquea el cuerpo y muestra preguntas locales', async () => {
    await mount(); expect(container.textContent).not.toContain('¿Cuál es el caso base?'); await click('Guardar y concluir');
    expect(actions.completePresentationAttempt).toHaveBeenCalledWith('attempt-1', 3);
    expect(actions.savePresentationAttempt.mock.invocationCallOrder[0]).toBeLessThan(actions.completePresentationAttempt.mock.invocationCallOrder[0]!);
    expect((input('Explicación') as HTMLTextAreaElement).readOnly).toBe(true);
    await update({ presentationAttempts: [attempt({ status: 'completed', version: 4 })] });
    expect(container.textContent).toContain('¿Cuál es el caso base?'); expect(container.textContent).toContain('plantillas locales, sin IA');
  });
  it('reintenta conclusión fallida usando la versión del borrador ya guardado', async () => {
    actions.completePresentationAttempt.mockRejectedValueOnce(new Error('Se perdió la conexión al concluir.')); await mount(); await click('Guardar y concluir');
    expect(input('Explicación').value).toBe('La recursión usa un caso base.'); expect(container.textContent).toContain('Se perdió la conexión al concluir');
    await click('Guardar y concluir'); expect(actions.savePresentationAttempt.mock.calls.map((call) => call[2])).toEqual([2, 3]); expect(actions.completePresentationAttempt.mock.calls.map((call) => call[1])).toEqual([3, 4]);
  });
  it('guarda respuestas con versión capturada y conserva texto tras concurrencia', async () => {
    snapshot.presentationAttempts = [attempt({ status: 'completed' })]; await mount(); await change(input('Tu respuesta'), 'Llega al caso base');
    await update({ presentationQuestions: [{ ...snapshot.presentationQuestions[0]!, answer: 'Otra respuesta', version: 2 }] });
    expect(input('Tu respuesta').value).toBe('Llega al caso base'); actions.answerPresentationQuestion.mockRejectedValueOnce(new Error('La respuesta cambió.'));
    await click('Guardar respuesta'); expect(actions.answerPresentationQuestion).toHaveBeenCalledWith('question-1', 'Llega al caso base', 1); expect(input('Tu respuesta').value).toBe('Llega al caso base');
  });
  it('el revisor solo recibe controles de preguntas y rúbrica, nunca datos personales', async () => {
    snapshot.me = reviewer; snapshot.presentationAttempts = [attempt({ status: 'completed', sourceKind: 'note', sourceId: 'private-note', sourceVersion: 1 })]; await mount();
    expect(container.textContent).toContain('La recursión usa un caso base'); expect(container.textContent).not.toMatch(/Observación secreta|Pasos secretos|Nota personal|Contenido privado|Siguientes pasos|Observaciones personales/);
    expect(container.querySelector('textarea[readonly]')).toBeNull(); expect(container.textContent).not.toContain('Guardar borrador');
    await change(input('Añadir una pregunta'), '¿Siempre termina?'); await click('Enviar pregunta'); expect(actions.askPresentationQuestion).toHaveBeenCalledWith('attempt-1', '¿Siempre termina?', expect.any(String));
    await change(input('Claridad'), 'Se entiende la idea'); await change(input('Comentario general'), 'Agrega un ejemplo'); await click('Guardar retroalimentación');
    expect(actions.savePresentationFeedback).toHaveBeenCalledWith('attempt-1', { clarity: 'Se entiende la idea', examples: '', decisions: '', limitations: '', comment: 'Agrega un ejemplo' }, undefined);
  });
  it('oculta el intento borrador y retira contenido cuando se revoca el acceso', async () => {
    snapshot.me = reviewer; await mount(); expect(container.textContent).toContain('Esta exposición no está disponible');
    await update({ presentationAttempts: [attempt({ status: 'completed' })] }); expect(container.textContent).toContain('La recursión usa un caso base');
    await update({ presentationPractices: [] }); expect(container.textContent).toContain('Esta exposición no está disponible'); expect(container.querySelector('textarea')).toBeNull();
  });
  it('conserva retroalimentación histórica y compara el segundo intento con el primero', async () => {
    snapshot.presentationAttempts = [attempt({ id: 'first', status: 'completed', body: 'Explicación anterior' }), attempt({ number: 2, body: 'Explicación mejorada' })];
    snapshot.presentationFeedback = [{ id: 'old-feedback', attemptId: 'attempt-1', authorId: other.id, ...emptyPresentationObservations(), clarity: 'Comentario anterior conservado', comment: '', version: 1, createdAt: now, updatedAt: now }];
    await mount(); expect(container.textContent).toContain('Comparar con el intento 1'); expect(container.textContent).toContain('Explicación anterior');
    await update({ presentationAttempts: snapshot.presentationAttempts.map((item) => ({ ...item, status: 'completed' })) }); expect(container.textContent).toContain('Comentario anterior conservado');
  });
  it('archiva y restaura sin borrar historial; los intentos archivados son de solo lectura', async () => {
    await mount('/m/exposiciones/practice-1'); await click('Archivar exposición'); expect(actions.archivePresentationPractice).toHaveBeenCalledWith('practice-1', true, 3);
    await update({ presentationPractices: [practice({ archived: true, version: 4 })] }); await click('Restaurar exposición'); expect(actions.archivePresentationPractice).toHaveBeenCalledWith('practice-1', false, 4);
    await mount(); expect((input('Explicación') as HTMLTextAreaElement).readOnly).toBe(true); expect(container.textContent).not.toContain('Guardar borrador');
  });
  it('avisa fuente cambiada y evita enlaces cuando pierde acceso', async () => {
    snapshot.presentationAttempts = [attempt({ sourceKind: 'note', sourceId: 'private-note', sourceVersion: 1 })]; await mount();
    expect(container.textContent).toContain('La fuente cambió a la versión 2'); expect(container.querySelector('a[href="/m/notas/private-note"]')).not.toBeNull();
    await update({ notes: [] }); expect(container.textContent).toContain('La referencia ya no está accesible'); expect(container.querySelector('a[href="/m/notas/private-note"]')).toBeNull();
    expect(input('Explicación').value).toBe('La recursión usa un caso base.');
  });
  it('usa materia y parcial originales del intento aunque se configure otra materia', async () => {
    snapshot.presentationPractices = [practice({ subjectId: 'subject-2', termId: undefined })];
    snapshot.presentationAttempts = [attempt({ sourceKind: 'note', sourceId: 'private-note', sourceVersion: 2 })];
    await mount(); expect(container.querySelector('a[href="/m/notas/private-note"]')).not.toBeNull();
    expect(container.querySelector('.page-header .eyebrow')?.textContent).toContain('Programación · Primer parcial');
    expect(container.textContent).not.toContain('La referencia ya no está accesible');
  });
  it('no permite elegir una fuente retirada y conserva el ensayo previo sin enlace', async () => {
    snapshot.notes = snapshot.notes.map((note) => ({ ...note, withdrawnAt: now }));
    snapshot.presentationAttempts = [attempt({ sourceKind: 'note', sourceId: 'private-note', sourceVersion: 2 })];
    await mount('/m/exposiciones/nueva?nota=private-note');
    expect(input('Título').value).toBe(''); expect(input('Nota o guía').textContent).not.toContain('Nota personal');
    expect(container.textContent).toContain('Ya no puedes usar esta fuente');
    await mount(); expect(container.querySelector('a[href="/m/notas/private-note"]')).toBeNull();
    expect(container.textContent).toContain('La referencia ya no está accesible'); expect(input('Explicación').value).toBe('La recursión usa un caso base.');
  });
  it('presenta la estimación como orientativa y no ofrece audio o IA inactivos', async () => {
    await mount(); expect(container.textContent).toContain('120 palabras/minuto'); expect(container.textContent).toContain('no mide una exposición oral real');
    expect([...container.querySelectorAll('button')].map((item) => item.textContent).join(' ')).not.toMatch(/Audio|Grabar|Gemini|IA/);
  });
});
