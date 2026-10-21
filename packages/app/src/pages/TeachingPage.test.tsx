// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Member, Snapshot, TeachingPractice } from '../data/types';
import { TeachingFormPage, TeachingPage, TeachingPracticePage } from './TeachingPage';

const now = new Date('2026-10-21T12:00:00Z');
const owner: Member = { id: 'owner', displayName: 'Ana', status: 'active', isCreator: false, joinedAt: now };
const reviewer: Member = { ...owner, id: 'reviewer', displayName: 'Luis' };
const other: Member = { ...owner, id: 'other', displayName: 'Otra persona' };
const explanation = { concept: 'Un concepto inicial', example: 'Un ejemplo inicial', limits: 'Un límite inicial' };
const revised = { concept: 'Concepto mejorado', example: 'Ejemplo mejorado', limits: 'Límites mejorados' };
const practice = (patch: Partial<TeachingPractice> = {}): TeachingPractice => ({
  id: 'practice-1', ownerId: owner.id, reviewerId: reviewer.id, subjectId: 'subject-1', topic: 'Recursión',
  initial: explanation, revised, status: 'practicing', createdAt: now, updatedAt: now, ...patch,
});

let snapshot: Snapshot;
let container: HTMLDivElement;
let root: Root;
let listeners: Set<() => void>;
let source: DataSource;
let actions: ReturnType<typeof makeActions>;

function makeActions() {
  return {
    createTeachingPractice: vi.fn().mockResolvedValue('created'),
    saveTeachingPractice: vi.fn().mockResolvedValue(undefined),
    getTeachingHistory: vi.fn().mockResolvedValue([]),
    startTeachingPractice: vi.fn().mockResolvedValue(undefined),
    completeTeachingPractice: vi.fn().mockResolvedValue(undefined),
    reopenTeachingPractice: vi.fn().mockResolvedValue(undefined),
    setTeachingReviewer: vi.fn().mockResolvedValue(undefined),
    askTeachingQuestion: vi.fn().mockResolvedValue('peer-question'),
    answerTeachingQuestion: vi.fn().mockResolvedValue(undefined),
    publishTeachingExplanation: vi.fn().mockResolvedValue('published-note'),
  };
}

async function mount(url = '/m/aprende-ensenando/practice-1') {
  const router = createMemoryRouter([
    { path: '/m/aprende-ensenando', element: <TeachingPage /> },
    { path: '/m/aprende-ensenando/nueva', element: <TeachingFormPage /> },
    { path: '/m/aprende-ensenando/created', element: <p>Práctica creada</p> },
    { path: '/m/aprende-ensenando/:practiceId', element: <TeachingPracticePage /> },
  ], { initialEntries: [url] });
  await act(async () => root.render(<DataProvider source={source}><RouterProvider router={router} /></DataProvider>));
}

async function update(patch: Partial<Snapshot>) {
  await act(async () => { snapshot = { ...snapshot, ...patch }; listeners.forEach((listener) => listener()); });
}

function input(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const target = [...container.querySelectorAll('label')].find((node) => node.textContent?.includes(label))?.querySelector('input, textarea, select');
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

async function click(label: string) {
  await act(async () => button(label).click());
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  snapshot = { ...emptySnapshot('ready'), me: owner, members: [owner, reviewer, other],
    subjects: [{ id: 'subject-1', name: 'Programación', period: 1 }, { id: 'subject-2', name: 'Matemáticas', period: 1 }],
    teachingPractices: [practice()],
    teachingPersonal: [{ practiceId: 'practice-1', reflection: 'Reflexión secreta', topicsToReview: 'Temas secretos', sourceKind: 'note', sourceId: 'private-note' }],
    teachingQuestions: [{ id: 'question-1', practiceId: 'practice-1', authorId: owner.id, kind: 'guided', text: '¿Por qué funciona?', answer: 'Porque tiene un caso base', createdAt: now }],
    notes: [{ id: 'private-note', subjectId: 'subject-1', title: 'Nota personal', topic: 'Recursión', body: 'Contenido privado de referencia', authorId: owner.id, source: 'student', visibility: 'personal', version: 1, tags: [], createdAt: now, updatedAt: now }],
  };
  listeners = new Set();
  actions = makeActions();
  source = { label: 'Prueba de pantallas', ...actions, getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  } as unknown as DataSource;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Aprende enseñando', () => {
  it('separa prácticas propias e invitaciones y permite buscar por tema y materia', async () => {
    snapshot.teachingPractices.push(practice({ id: 'review-1', ownerId: reviewer.id, reviewerId: owner.id, topic: 'Vectores', subjectId: 'subject-2' }));
    await mount('/m/aprende-ensenando');
    expect(container.textContent).toContain('Recursión');
    expect(container.textContent).not.toContain('Vectores');
    await click('Para revisar');
    expect(container.textContent).toContain('Vectores');
    expect(container.textContent).not.toContain('Recursión');
    await change(input('Buscar por tema'), 'sin resultado');
    expect(container.textContent).toContain('No hay prácticas con estos filtros');
    await change(input('Buscar por tema'), 'Vectores');
    await change(input('Materia'), 'subject-1');
    expect(container.textContent).toContain('No hay prácticas con estos filtros');
  });

  it('precarga una nota accesible sin copiar su texto y permite guardar un borrador incompleto', async () => {
    await mount('/m/aprende-ensenando/nueva?nota=private-note');
    expect(input('Tema').value).toBe('Recursión');
    expect(input('Materia').value).toBe('subject-1');
    expect(input('Nota o guía').value).toBe('note:private-note');
    expect(input('Concepto con tus palabras').value).toBe('');
    expect(container.textContent).not.toContain('Contenido privado de referencia');
    await click('Guardar borrador');
    expect(actions.createTeachingPractice).toHaveBeenCalledWith({ subjectId: 'subject-1', topic: 'Recursión',
      initial: { concept: '', example: '', limits: '' }, source: { kind: 'note', id: 'private-note' } });
    expect(container.textContent).toContain('Práctica creada');
  });

  it('bloquea una fuente inaccesible hasta elegir otra o continuar sin referencia', async () => {
    await mount('/m/aprende-ensenando/nueva?nota=missing');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Ya no puedes usar esta fuente');
    expect(button('Guardar borrador').disabled).toBe(true);
    await change(input('Nota o guía'), '');
    await change(input('Tema'), 'Un tema nuevo');
    expect(button('Guardar borrador').disabled).toBe(false);
  });

  for (const kind of ['note', 'guide'] as const) {
    const path = kind === 'note' ? 'nota=private-note' : 'guia=guide-1';
    const prepareGuide = () => { snapshot.guides = [{ id: 'guide-1', subjectId: 'subject-1', title: 'Guía de recursión', topics: ['Recursión'], sections: [], version: 1, createdBy: owner.id, createdAt: now, updatedBy: owner.id, updatedAt: now }]; };
    it(`bloquea una ${kind === 'note' ? 'nota' : 'guía'} retirada enviada por URL y permite continuar sin fuente`, async () => {
      prepareGuide();
      if (kind === 'note') snapshot.notes = snapshot.notes.map((note) => ({ ...note, withdrawnAt: now }));
      else snapshot.guides = snapshot.guides.map((guide) => ({ ...guide, withdrawnAt: now }));
      await mount(`/m/aprende-ensenando/nueva?${path}`);
      expect(button('Guardar borrador').disabled).toBe(true);
      expect((input('Nota o guía') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Fuente no disponible');
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Ya no puedes usar esta fuente');
      await change(input('Nota o guía'), '');
      await change(input('Tema'), 'Practicar sin fuente');
      expect(button('Guardar borrador').disabled).toBe(false);
      expect(actions.createTeachingPractice).not.toHaveBeenCalled();
    });

    it(`deshabilita guardar si la ${kind === 'note' ? 'nota' : 'guía'} seleccionada se retira con el formulario abierto`, async () => {
      prepareGuide();
      await mount(`/m/aprende-ensenando/nueva?${path}`);
      await change(input('Concepto con tus palabras'), 'Mi explicación pendiente');
      expect(button('Guardar borrador').disabled).toBe(false);
      if (kind === 'note') await update({ notes: snapshot.notes.map((note) => ({ ...note, withdrawnAt: now })) });
      else await update({ guides: snapshot.guides.map((guide) => ({ ...guide, withdrawnAt: now })) });
      expect(button('Guardar borrador').disabled).toBe(true);
      expect(input('Concepto con tus palabras').value).toBe('Mi explicación pendiente');
      expect((input('Nota o guía') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Fuente no disponible');
      await click('Guardar borrador');
      expect(actions.createTeachingPractice).not.toHaveBeenCalled();
    });
  }

  it('guarda la explicación antes de comenzar y conserva cambios locales al recibir actualizaciones', async () => {
    snapshot.teachingPractices = [practice({ status: 'draft', reviewerId: undefined })];
    await mount();
    await change(input('Concepto con tus palabras'), 'Texto local que no debe perderse');
    await update({ teachingPractices: [practice({ status: 'draft', reviewerId: undefined, updatedAt: new Date() })] });
    expect(input('Concepto con tus palabras').value).toBe('Texto local que no debe perderse');
    await click('Guardar y comenzar práctica');
    expect(actions.saveTeachingPractice).toHaveBeenCalledWith('practice-1', expect.objectContaining({ initial: { ...explanation, concept: 'Texto local que no debe perderse' } }));
    expect(actions.startTeachingPractice).toHaveBeenCalledWith('practice-1');
    expect(actions.saveTeachingPractice.mock.invocationCallOrder[0]).toBeLessThan(actions.startTeachingPractice.mock.invocationCallOrder[0]!);
  });

  it('mantiene respuestas y mejoras sin guardar al llegar una pregunta y completa con lo escrito', async () => {
    await mount();
    await change(input('Tu respuesta'), 'Respuesta todavía en edición');
    await change(input('Concepto con tus palabras'), 'Revisión local');
    await change(input('Reflexión personal'), 'Lo entendí mejor');
    await update({ teachingQuestions: [...snapshot.teachingQuestions, { id: 'peer-2', practiceId: 'practice-1', authorId: reviewer.id, kind: 'peer', text: 'Una pregunta nueva', answer: '', createdAt: now }] });
    expect(input('Tu respuesta').value).toBe('Respuesta todavía en edición');
    expect(input('Concepto con tus palabras').value).toBe('Revisión local');
    await click('Guardar y completar práctica');
    expect(actions.saveTeachingPractice).toHaveBeenCalledWith('practice-1', expect.objectContaining({ initial: explanation, revised: { ...revised, concept: 'Revisión local' }, reflection: 'Lo entendí mejor', topicsToReview: 'Temas secretos', expectedVersion: 1, requestId: expect.any(String) }));
    expect(actions.completeTeachingPractice).toHaveBeenCalledWith('practice-1');
  });

  it('detecta otro guardado, conserva la edición local y exige cargar la versión actual', async () => {
    await mount(); await change(input('Concepto con tus palabras'), 'Mi edición local sin guardar');
    await update({ teachingPractices: [practice({ version: 2, revised: { ...revised, concept: 'Guardado desde otra pestaña' } })] });
    expect(input('Concepto con tus palabras').value).toBe('Mi edición local sin guardar');
    expect(button('Guardar cambios').disabled).toBe(true); expect(container.textContent).toContain('Tu edición local se conserva');
    await click('Guardar cambios'); expect(actions.saveTeachingPractice).not.toHaveBeenCalled();
    await click('Cargar versión actual'); expect(input('Concepto con tus palabras').value).toBe('Guardado desde otra pestaña');
    await click('Guardar cambios'); expect(actions.saveTeachingPractice).toHaveBeenCalledWith('practice-1', expect.objectContaining({ expectedVersion: 2 }));
  });
  it('actualiza la etapa capturada al comenzar desde esta misma pantalla', async () => {
    snapshot.teachingPractices = [practice({ status: 'draft', version: 1 })];
    actions.startTeachingPractice.mockImplementation(async () => { snapshot = { ...snapshot, teachingPractices: [practice({ status: 'practicing', version: 2 })] }; for (const listener of listeners) listener(); });
    await mount(); await click('Guardar y comenzar práctica');
    expect(container.textContent).toContain('Mejora tu explicación'); expect(container.textContent).not.toContain('Tu edición local se conserva');
    await click('Guardar cambios'); expect(actions.saveTeachingPractice).toHaveBeenLastCalledWith('practice-1', expect.objectContaining({ expectedVersion: 2 }));
  });
  it('permite completar, reabrir y editar inmediatamente desde la propia pantalla', async () => {
    actions.saveTeachingPractice.mockImplementation(async (_id, input) => {
      const version = (input.expectedVersion ?? 1) + 1;
      snapshot = { ...snapshot, teachingPractices: [practice({ ...snapshot.teachingPractices[0], version, initial: input.initial, revised: input.revised })] };
      for (const listener of listeners) listener(); return version;
    });
    actions.completeTeachingPractice.mockImplementation(async () => { snapshot = { ...snapshot, teachingPractices: [practice({ version: 3, status: 'completed' })] }; for (const listener of listeners) listener(); });
    actions.reopenTeachingPractice.mockImplementation(async () => { snapshot = { ...snapshot, teachingPractices: [practice({ version: 4, status: 'practicing' })] }; for (const listener of listeners) listener(); });
    await mount(); await click('Guardar y completar práctica'); expect(container.textContent).toContain('Explicación revisada guardada');
    await click('Reabrir práctica'); expect(container.textContent).toContain('Mejora tu explicación');
    expect(container.textContent).not.toContain('Tu edición local se conserva'); expect(button('Guardar cambios').disabled).toBe(false);
    await change(input('Concepto con tus palabras'), 'Revisión después de reabrir'); await click('Guardar cambios');
    expect(actions.saveTeachingPractice).toHaveBeenLastCalledWith('practice-1', expect.objectContaining({ expectedVersion: 4, revised: { ...revised, concept: 'Revisión después de reabrir' } }));
  });
  it.each(['practicing', 'completed'] as const)('conserva una edición de borrador si otra sesión cambia el estado a %s', async (status) => {
    snapshot.teachingPractices = [practice({ status: 'draft', version: 1 })];
    await mount(); await change(input('Concepto con tus palabras'), 'BORRADOR_LOCAL_ANTE_CAMBIO_ESTADO');
    await update({ teachingPractices: [practice({ status, version: 2 })] });
    expect(input('Concepto con tus palabras').value).toBe('BORRADOR_LOCAL_ANTE_CAMBIO_ESTADO');
    expect(button('Guardar cambios').disabled).toBe(true); expect(container.textContent).toContain('Tu edición local se conserva');
    expect(actions.saveTeachingPractice).not.toHaveBeenCalled();
  });
  it('reutiliza el UUID si se pierde la confirmación sin cambiar el texto', async () => {
    actions.saveTeachingPractice.mockRejectedValueOnce(new Error('Confirmación perdida')).mockResolvedValue(undefined);
    await mount(); await click('Guardar cambios'); await click('Guardar cambios');
    expect(actions.saveTeachingPractice.mock.calls[0]![1].requestId).toBe(actions.saveTeachingPractice.mock.calls[1]![1].requestId);
  });
  it('consulta versiones y reflexión históricas sólo en la pantalla del autor', async () => {
    actions.getTeachingHistory.mockResolvedValue([{ version: 1, initial: explanation, revised, reflection: 'REFLEXIÓN_HISTÓRICA_SOLO_OWNER', topicsToReview: 'Pendientes anteriores', status: 'practicing', at: now }]);
    await mount(); expect(actions.getTeachingHistory).not.toHaveBeenCalled();
    await click('Consultar versiones guardadas'); expect(container.textContent).toContain('REFLEXIÓN_HISTÓRICA_SOLO_OWNER');
    await update({ me: reviewer }); expect(container.textContent).not.toContain('REFLEXIÓN_HISTÓRICA_SOLO_OWNER');
    expect([...container.querySelectorAll('button')].some((item) => item.textContent === 'Consultar versiones guardadas')).toBe(false);
  });
  it('el compañero puede preguntar sin recibir controles ni información personal y pierde la pantalla al revocarse', async () => {
    snapshot.me = reviewer;
    await mount();
    expect(container.textContent).toContain('Concepto mejorado');
    expect(container.textContent).not.toMatch(/Reflexión secreta|Temas secretos|Nota personal|private-note|Contenido privado/);
    expect(container.textContent).not.toContain('Compañero invitado');
    await change(input('Haz una pregunta'), '¿Siempre termina?');
    await click('Enviar pregunta');
    expect(actions.askTeachingQuestion).toHaveBeenCalledWith('practice-1', '¿Siempre termina?');
    await change(input('Haz una pregunta'), 'Texto pendiente privado');
    await update({ teachingPractices: [], teachingQuestions: [], teachingPersonal: [] });
    expect(container.textContent).toContain('Esta práctica no está disponible');
    expect(container.textContent).not.toContain('Concepto mejorado');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('muestra la vista previa sin información privada y evita reenvíos mientras publica', async () => {
    snapshot.teachingPractices = [practice({ status: 'completed' })];
    let finish!: (id: string) => void;
    actions.publishTeachingExplanation.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    await mount();
    const preview = container.querySelector('.teaching-preview')!;
    expect(preview.textContent).toContain('Concepto mejorado');
    expect(preview.textContent).not.toMatch(/Un concepto inicial|Reflexión secreta|Temas secretos|Nota personal|Por qué funciona/);
    await click('Publicar explicación en Notas');
    expect(button('Publicando').disabled).toBe(true);
    expect(actions.publishTeachingExplanation).toHaveBeenCalledTimes(1);
    await act(async () => finish('published-note'));
    expect(container.querySelector('a[href="/m/notas/published-note"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Publicar explicación en Notas de clase');
    await click('Reabrir práctica');
    expect(actions.reopenTeachingPractice).toHaveBeenCalledWith('practice-1');
  });

  it('presenta errores de guardado y mantiene el texto para reintentar', async () => {
    actions.saveTeachingPractice.mockRejectedValue(new Error('Se perdió la conexión.'));
    await mount();
    await change(input('Reflexión personal'), 'Mi reflexión sin perder');
    await click('Guardar cambios');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Se perdió la conexión');
    expect(input('Reflexión personal').value).toBe('Mi reflexión sin perder');
    expect(button('Guardar cambios').disabled).toBe(false);
  });
});
