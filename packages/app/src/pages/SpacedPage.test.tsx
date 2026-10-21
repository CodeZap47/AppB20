// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Member, Snapshot, SpacedCard, SpacedCollection, SpacedProgress, SpacedReviewInput } from '../data/types';
import { SpacedCardFormPage, SpacedCollectionFormPage, SpacedCollectionPage, SpacedPage, SpacedSessionPage } from './SpacedPage';

const now = new Date('2026-10-21T12:00:00Z');
const owner: Member = { id: 'owner', displayName: 'Ana', status: 'active', isCreator: false, joinedAt: now };
const other: Member = { ...owner, id: 'other', displayName: 'Luis', isCreator: true };
const collection = (patch: Partial<SpacedCollection> = {}): SpacedCollection => ({
  id: 'collection-1', subjectId: 'subject-1', termId: 'term-1', title: 'Conceptos de programación', visibility: 'group',
  ownerId: owner.id, version: 1, archived: false, createdAt: now, updatedAt: now, updatedBy: owner.id, ...patch,
});
const card = (patch: Partial<SpacedCard> = {}): SpacedCard => ({
  id: 'card-1', collectionId: 'collection-1', question: '¿Cómo termina una función recursiva?',
  explanation: 'Una condición base detiene las llamadas recursivas.', hint: 'Piensa en el caso más pequeño.',
  sourceKind: 'note', sourceId: 'note-1', sourceVersion: 1, version: 1, archived: false,
  createdBy: owner.id, updatedBy: owner.id, createdAt: now, updatedAt: now, ...patch,
});
const progress = (patch: Partial<SpacedProgress> = {}): SpacedProgress => ({
  memberId: owner.id, cardId: 'card-1', cardVersion: 1, step: 1, revision: 1,
  dueAt: new Date(now.getTime() - 10_000), reviewedAt: new Date(now.getTime() - 86_410_000), ...patch,
});

let snapshot: Snapshot;
let container: HTMLDivElement;
let root: Root;
let listeners: Set<() => void>;
let source: DataSource;
let actions: ReturnType<typeof makeActions>;

function makeActions() {
  return {
    saveSpacedCollection: vi.fn().mockResolvedValue('created-collection'),
    saveSpacedCard: vi.fn().mockResolvedValue('created-card'),
    archiveSpacedCard: vi.fn().mockResolvedValue(undefined),
    archiveSpacedCollection: vi.fn().mockResolvedValue(undefined),
    publishSpacedCollection: vi.fn().mockResolvedValue(undefined),
    setSpacedEnrollment: vi.fn().mockResolvedValue(undefined),
    replaceSpacedCardSource: vi.fn().mockResolvedValue(undefined),
    reviewSpacedCard: vi.fn().mockImplementation(async (input: SpacedReviewInput) => {
      snapshot = { ...snapshot, spacedReviews: [...snapshot.spacedReviews, { ...input, id: 'review-1', memberId: snapshot.me!.id,
        step: 1, reviewedAt: now, dueAt: new Date(now.getTime() + 86_400_000) }] };
      listeners.forEach((listener) => listener());
    }),
  };
}

async function mount(url = '/m/repaso/sesion') {
  const router = createMemoryRouter([
    { path: '/m/repaso', element: <SpacedPage /> },
    { path: '/m/repaso/nueva', element: <SpacedCollectionFormPage /> },
    { path: '/m/repaso/colecciones/created-collection', element: <p>Colección creada</p> },
    { path: '/m/repaso/colecciones/:collectionId', element: <SpacedCollectionPage /> },
    { path: '/m/repaso/colecciones/:collectionId/editar', element: <SpacedCollectionFormPage /> },
    { path: '/m/repaso/tarjetas/nueva', element: <SpacedCardFormPage /> },
    { path: '/m/repaso/tarjetas/:cardId/editar', element: <SpacedCardFormPage /> },
    { path: '/m/repaso/sesion', element: <SpacedSessionPage /> },
  ], { initialEntries: [url] });
  await act(async () => root.render(<DataProvider source={source}><RouterProvider router={router} /></DataProvider>));
  return router;
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
  vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
  snapshot = { ...emptySnapshot('ready'), me: owner, members: [owner, other],
    subjects: [{ id: 'subject-1', name: 'Programación', period: 1 }, { id: 'subject-2', name: 'Matemáticas', period: 1 }],
    terms: [{ id: 'term-1', subjectId: 'subject-1', name: 'Primer parcial', position: 1 }, { id: 'term-2', subjectId: 'subject-2', name: 'Segundo parcial', position: 2 }],
    spacedCollections: [collection()], spacedCards: [card()],
    spacedEnrollments: [{ memberId: owner.id, collectionId: 'collection-1', active: true, updatedAt: now }],
    notes: [{ id: 'note-1', subjectId: 'subject-1', title: 'Recursión y sus límites', topic: 'Recursión', body: 'Texto de referencia sin copiar automáticamente',
      tags: [], visibility: 'group', source: 'student', authorId: owner.id, version: 1, createdAt: now, updatedAt: now }],
    guides: [{ id: 'guide-1', subjectId: 'subject-1', termId: 'term-1', title: 'Guía de programación', topics: ['Recursión'], sections: [],
      version: 1, createdBy: owner.id, updatedBy: owner.id, createdAt: now, updatedAt: now }],
  };
  listeners = new Set();
  actions = makeActions();
  source = { label: 'Prueba de Repaso', ...actions, getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  } as unknown as DataSource;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Repaso espaciado', () => {
  it('oculta la explicación inicialmente, admite respuesta mental y confirma antes de avanzar', async () => {
    await mount();
    expect(container.textContent).toContain(card().question);
    expect(container.textContent).not.toContain(card().explanation);
    expect(input('Tu respuesta').value).toBe('');
    expect(container.querySelector('button')?.textContent).not.toContain('Lo recordé');
    await click('Revelar explicación');
    expect(container.textContent).toContain(card().explanation);
    await click('Lo recordé');
    expect(actions.reviewSpacedCard).toHaveBeenCalledWith({ cardId: 'card-1', cardVersion: 1, expectedRevision: 0,
      rating: 'remembered', requestId: expect.any(String) });
    expect(container.textContent).toContain('Revisión guardada');
    expect(container.textContent).toContain('Próxima revisión:');
    expect(container.textContent).not.toContain('Terminaste esta sesión');
    await click('Terminar sesión');
    expect(container.textContent).toContain('Terminaste esta sesión');
  });

  it('conserva el texto tras un error y reintenta exactamente el mismo token sin cambiar la calificación', async () => {
    actions.reviewSpacedCard.mockRejectedValueOnce(new Error('Conexión interrumpida'));
    await mount();
    await change(input('Tu respuesta'), 'Una respuesta escrita que solo yo veo');
    await click('Revelar explicación');
    await click('Debo repasarlo');
    expect(container.textContent).toContain('Conexión interrumpida');
    expect(input('Tu respuesta').value).toBe('Una respuesta escrita que solo yo veo');
    expect(button('Lo recordé').disabled).toBe(true);
    await click('Debo repasarlo');
    expect(actions.reviewSpacedCard).toHaveBeenCalledTimes(2);
    expect(actions.reviewSpacedCard.mock.calls[1]![0]).toEqual(actions.reviewSpacedCard.mock.calls[0]![0]);
    expect(actions.reviewSpacedCard.mock.calls[0]![0]).not.toHaveProperty('answer');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('bloquea doble envío incluso antes de que React actualice el botón', async () => {
    let finish!: () => void;
    actions.reviewSpacedCard.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await mount();
    await click('Revelar explicación');
    await act(async () => { button('Lo recordé').click(); button('Lo recordé').click(); });
    expect(actions.reviewSpacedCard).toHaveBeenCalledTimes(1);
    expect(button('Lo recordé').disabled).toBe(true);
    await act(async () => finish());
    expect(container.textContent).toContain('Revisión guardada');
  });

  it('descarta texto y oculta nuevamente la explicación si cambia la versión durante la sesión', async () => {
    await mount();
    await change(input('Tu respuesta'), 'Texto para la versión anterior');
    await click('Revelar explicación');
    await update({ spacedCards: [card({ version: 2, question: 'Pregunta corregida', explanation: 'Explicación corregida' })] });
    expect(container.textContent).toContain('La tarjeta cambió durante la sesión');
    expect(container.textContent).toContain('Pregunta corregida');
    expect(container.textContent).not.toContain('Explicación corregida');
    expect(input('Tu respuesta').value).toBe('');
    expect(actions.reviewSpacedCard).not.toHaveBeenCalled();
    await click('Revelar explicación');
    await click('Necesité una pista');
    expect(actions.reviewSpacedCard).toHaveBeenCalledWith(expect.objectContaining({ cardVersion: 2 }));
  });

  it('ignora el resultado tardío de una versión anterior mientras se responde la nueva', async () => {
    let finish!: () => void;
    actions.reviewSpacedCard.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await mount();
    await click('Revelar explicación');
    await click('Lo recordé');
    await update({ spacedCards: [card({ version: 2, explanation: 'Contenido nuevo secreto' })] });
    await act(async () => finish());
    expect(container.textContent).not.toContain('Revisión guardada');
    expect(container.textContent).not.toContain('Contenido nuevo secreto');
    expect(button('Revelar explicación').disabled).toBe(false);
  });

  it('cambia de cuenta sin revelar borradores ni confirmaciones de la cuenta anterior', async () => {
    let finish!: () => void;
    actions.reviewSpacedCard.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await mount();
    await change(input('Tu respuesta'), 'Respuesta privada de Ana');
    await click('Revelar explicación');
    await click('Lo recordé');
    await update({ me: other, spacedEnrollments: [{ memberId: other.id, collectionId: 'collection-1', active: true, updatedAt: now }] });
    await act(async () => finish());
    expect(container.textContent).not.toContain('Revisión guardada');
    expect(container.textContent).not.toContain(card().explanation);
    expect(input('Tu respuesta').value).toBe('');
  });

  it('congela una cola finita y borra el texto al avanzar', async () => {
    snapshot.spacedCards.push(card({ id: 'card-2', question: 'Segunda pregunta', explanation: 'Segunda explicación' }));
    await mount();
    await change(input('Tu respuesta'), 'Texto de la primera tarjeta');
    await update({ spacedCards: [...snapshot.spacedCards, card({ id: 'card-3', question: 'Una tarjeta agregada después' })] });
    expect(container.textContent).toContain('1 de 2 tarjetas');
    await click('Revelar explicación');
    await click('Lo recordé');
    await click('Siguiente tarjeta');
    expect(container.textContent).toContain('Segunda pregunta');
    expect(input('Tu respuesta').value).toBe('');
    expect(container.textContent).not.toContain('Segunda explicación');
    await click('Revelar explicación');
    await click('Lo recordé');
    await click('Terminar sesión');
    expect(container.textContent).not.toContain('Una tarjeta agregada después');
  });

  it('retira una tarjeta archivada o una fuente inaccesible durante la sesión sin guardar', async () => {
    await mount();
    await click('Revelar explicación');
    await update({ notes: [] });
    expect(container.textContent).toContain('Esta tarjeta dejó de estar disponible');
    expect(container.textContent).not.toContain(card().explanation);
    expect(container.querySelector('textarea')).toBeNull();
    expect(actions.reviewSpacedCard).not.toHaveBeenCalled();
  });

  it('detecta revisiones desde otra pestaña y conserva la revisión esperada para el servidor', async () => {
    snapshot.spacedProgress = [progress({ revision: 4 })];
    await mount();
    await click('Revelar explicación');
    await update({ spacedProgress: [progress({ revision: 5 })] });
    expect(container.textContent).toContain('Ya revisaste esta tarjeta desde otra sesión');
    expect(container.textContent).not.toContain(card().explanation);
    expect(actions.reviewSpacedCard).not.toHaveBeenCalled();
  });

  it('no guarda sin conexión y mantiene la respuesta hasta reconectar', async () => {
    await mount();
    await change(input('Tu respuesta'), 'Recordé la condición base');
    await click('Revelar explicación');
    await update({ connection: 'offline' });
    expect(button('Lo recordé').disabled).toBe(true);
    expect(input('Tu respuesta').value).toBe('Recordé la condición base');
    await update({ connection: 'ready' });
    await click('Lo recordé');
    expect(actions.reviewSpacedCard).toHaveBeenCalledOnce();
  });

  it('recupera la misma cola, borrador y token tras perder la membresía temporal al reconectar', async () => {
    let fail!: (error: Error) => void;
    actions.reviewSpacedCard.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
    await mount();
    await change(input('Tu respuesta'), 'Respuesta conservada durante la desconexión');
    await click('Revelar explicación');
    await click('Necesité una pista');
    const firstAttempt = actions.reviewSpacedCard.mock.calls[0]![0];
    await update({ connection: 'offline', me: undefined });
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).not.toContain(card().explanation);
    await act(async () => fail(new Error('Conexión perdida')));
    await update({ connection: 'ready', me: owner, spacedCards: [card(), card({ id: 'late-card', question: 'Agregada mientras estabas sin conexión' })] });
    expect(container.textContent).toContain('1 de 1 tarjetas');
    expect(input('Tu respuesta').value).toBe('Respuesta conservada durante la desconexión');
    expect(container.textContent).toContain(card().explanation);
    await click('Necesité una pista');
    expect(actions.reviewSpacedCard.mock.calls[1]![0]).toEqual(firstAttempt);
  });

  it('descarta el borrador y crea otro token después de salir voluntariamente de la sesión', async () => {
    const router = await mount();
    await change(input('Tu respuesta'), 'Texto que se descarta al salir');
    await click('Revelar explicación');
    await act(async () => router.navigate('/m/repaso'));
    await act(async () => router.navigate('/m/repaso/sesion'));
    expect(input('Tu respuesta').value).toBe('');
    expect(container.textContent).not.toContain(card().explanation);
  });

  it('restaura la confirmación de la última tarjeta cuando el servidor aceptó una revisión antes de desconectar', async () => {
    let fail!: (error: Error) => void;
    actions.reviewSpacedCard.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
    await mount();
    await change(input('Tu respuesta'), 'Un borrador que no debe reaparecer después del éxito');
    await click('Revelar explicación');
    await click('Lo recordé');
    const attempt = actions.reviewSpacedCard.mock.calls[0]![0];
    await update({ connection: 'offline', me: undefined });
    await act(async () => fail(new Error('Se cerró la conexión antes de recibir la respuesta')));
    await update({ connection: 'ready', me: owner, spacedProgress: [progress({ revision: 1, dueAt: new Date(now.getTime() + 86_400_000) })],
      spacedReviews: [{ ...attempt, id: 'accepted-review', memberId: owner.id, step: 1, reviewedAt: now, dueAt: new Date(now.getTime() + 86_400_000) }] });
    expect(container.textContent).toContain('Revisión guardada');
    expect(container.textContent).toContain('Próxima revisión:');
    expect(container.querySelector('textarea')).toBeNull();
    expect(actions.reviewSpacedCard).toHaveBeenCalledTimes(1);
    await click('Terminar sesión');
    expect(container.textContent).toContain('Terminaste esta sesión');
  });

  it('permite continuar si una tarjeta posterior de la cola ya se revisó en otra pestaña', async () => {
    snapshot.spacedCards.push(card({ id: 'card-2', question: 'La segunda tarjeta' }));
    await mount();
    await click('Revelar explicación');
    await click('Lo recordé');
    await update({ spacedProgress: [progress({ cardId: 'card-2', revision: 1, dueAt: new Date(now.getTime() + 86_400_000) })] });
    await click('Siguiente tarjeta');
    expect(container.textContent).toContain('Ya revisaste esta tarjeta desde otra sesión');
    expect(container.querySelector('textarea')).toBeNull();
    await click('Continuar');
    expect(container.textContent).toContain('Terminaste esta sesión');
    expect(actions.reviewSpacedCard).toHaveBeenCalledTimes(1);
  });

  it('permite continuar tras actualizar una referencia si la tarjeta ya quedó programada para después', async () => {
    snapshot.spacedCards.push(card({ id: 'card-2', question: 'Referencia actualizada' }));
    await mount();
    await click('Revelar explicación');
    await click('Lo recordé');
    await update({ spacedCards: [card(), card({ id: 'card-2', version: 2 })],
      spacedProgress: [progress({ cardId: 'card-2', cardVersion: 2, revision: 2, dueAt: new Date(now.getTime() + 86_400_000) })] });
    await click('Siguiente tarjeta');
    expect(container.textContent).toContain('Ya revisaste esta tarjeta desde otra sesión');
    await click('Continuar');
    expect(container.textContent).toContain('Terminaste esta sesión');
    expect(actions.reviewSpacedCard).toHaveBeenCalledTimes(1);
  });

  it('filtra materia y parcial, mantiene próximas revisiones y excluye colecciones privadas ajenas', async () => {
    snapshot.spacedCollections.push(collection({ id: 'collection-2', subjectId: 'subject-2', termId: 'term-2', title: 'Álgebra' }),
      collection({ id: 'private', ownerId: other.id, title: 'Colección confidencial ajena', visibility: 'personal' }));
    snapshot.spacedProgress = [progress({ dueAt: new Date(now.getTime() + 86_400_000) })];
    await mount('/m/repaso');
    expect(container.textContent).toContain('Álgebra');
    expect(container.textContent).not.toContain('Colección confidencial ajena');
    expect(container.textContent).toContain(card().question);
    await change(input('Materia'), 'subject-2');
    expect(container.textContent).toContain('Álgebra');
    expect(container.textContent).not.toContain('Conceptos de programación');
    expect(container.textContent).not.toContain(card().question);
    await change(input('Parcial'), 'term-2');
    expect(container.textContent).toContain('Álgebra');
  });

  it('precarga fuente de nota personal sin copiarla ni seleccionar colección compartida', async () => {
    snapshot.notes = [{ ...snapshot.notes[0]!, visibility: 'personal' }];
    await mount('/m/repaso/tarjetas/nueva?nota=note-1');
    expect(input('Colección').value).toBe('');
    expect(input('Materia').value).toBe('subject-1');
    expect(input('Nota o guía').value).toBe('note:note-1');
    expect(input('Pregunta').value).toBe('');
    expect(input('Explicación').value).toBe('');
    expect(container.textContent).not.toContain('Texto de referencia sin copiar automáticamente');
    await change(input('Título de la nueva colección'), 'Mis preguntas personales');
    await change(input('Pregunta'), '¿Cómo se detiene?');
    await change(input('Explicación'), 'Con una condición base');
    await click('Crear tarjeta');
    expect(actions.saveSpacedCollection).toHaveBeenCalledWith({ subjectId: 'subject-1', title: 'Mis preguntas personales', visibility: 'personal' });
    expect(actions.saveSpacedCard).toHaveBeenCalledWith(expect.objectContaining({ collectionId: 'created-collection', sourceKind: 'note', sourceId: 'note-1' }));
    expect(container.textContent).toContain('Colección creada');
  });

  it('precarga una guía y bloquea una fuente inaccesible hasta corregirla', async () => {
    const router = await mount('/m/repaso/tarjetas/nueva?guia=guide-1');
    expect(input('Nota o guía').value).toBe('guide:guide-1');
    expect(input('Colección').value).toBe('collection-1');
    await act(async () => router.navigate('/m/repaso/tarjetas/nueva?nota=missing&coleccion=collection-1'));
    expect(container.textContent).toContain('Ya no puedes usar esta fuente');
    expect(button('Crear tarjeta').disabled).toBe(true);
    await change(input('Nota o guía'), 'guide:guide-1');
    await change(input('Pregunta'), 'Una pregunta');
    await change(input('Explicación'), 'Su explicación');
    expect(button('Crear tarjeta').disabled).toBe(false);
  });

  it('bloquea publicar con notas personales y limita publicación y archivo al creador', async () => {
    snapshot.spacedCollections = [collection({ visibility: 'personal' })];
    snapshot.notes = [{ ...snapshot.notes[0]!, visibility: 'personal' }];
    await mount('/m/repaso/colecciones/collection-1');
    expect(button('Publicar en el grupo').disabled).toBe(true);
    expect(container.textContent).toContain('incluidas las tarjetas archivadas');
    expect(button('Archivar colección')).toBeDefined();
    await update({ me: other, spacedCollections: [collection({ visibility: 'group' })] });
    expect(container.textContent).not.toContain('Publicar en el grupo');
    expect(container.textContent).not.toContain('Archivar colección');
    expect(container.textContent).toContain('Editar colección');
  });

  it('presenta fuentes cambiadas y repara referencias sin mostrar contenido inaccesible', async () => {
    snapshot.notes = [{ ...snapshot.notes[0]!, version: 2 }];
    snapshot.spacedUnavailableCards = [{ id: 'hidden-card', collectionId: 'collection-1', version: 3, archived: false }];
    await mount('/m/repaso/colecciones/collection-1');
    expect(container.textContent).toContain('La fuente cambió a la versión 2');
    expect(container.textContent).toContain('Tarjeta con fuente no disponible');
    expect(container.textContent).not.toContain('hidden-card');
    await change(input('Nueva referencia'), 'guide:guide-1');
    await click('Corregir referencia');
    expect(actions.replaceSpacedCardSource).toHaveBeenCalledWith('hidden-card', 3, 'guide', 'guide-1');
  });

  it('no sobrescribe una colección editada mientras escribes y carga la nueva versión explícitamente', async () => {
    await mount('/m/repaso/colecciones/collection-1/editar');
    await change(input('Título de la colección'), 'Mi edición local');
    await update({ spacedCollections: [collection({ title: 'Edición remota', version: 2 })] });
    expect(input('Título de la colección').value).toBe('Mi edición local');
    expect(button('Guardar colección').disabled).toBe(true);
    await click('Guardar colección');
    expect(actions.saveSpacedCollection).not.toHaveBeenCalled();
    await click('Cargar versión actual');
    expect(input('Título de la colección').value).toBe('Edición remota');
    await click('Guardar colección');
    expect(actions.saveSpacedCollection).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 2 }));
  });

  it('no sobrescribe una tarjeta editada mientras escribes y confirma la nueva referencia al guardar', async () => {
    await mount('/m/repaso/tarjetas/card-1/editar');
    await change(input('Pregunta'), 'Mi pregunta en edición');
    await update({ spacedCards: [card({ version: 2, question: 'Corrección de otro compañero' })] });
    expect(input('Pregunta').value).toBe('Mi pregunta en edición');
    expect(button('Guardar tarjeta').disabled).toBe(true);
    await click('Cargar versión actual');
    expect(input('Pregunta').value).toBe('Corrección de otro compañero');
    await click('Guardar tarjeta');
    expect(actions.saveSpacedCard).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 2 }));
  });

  it('hereda el parcial de una guía al crear una colección personal en el mismo formulario', async () => {
    snapshot.spacedCollections = [];
    await mount('/m/repaso/tarjetas/nueva?guia=guide-1');
    expect(input('Parcial').value).toBe('term-1');
    await change(input('Título de la nueva colección'), 'Repaso del primer parcial');
    await change(input('Pregunta'), '¿Qué recordar?');
    await change(input('Explicación'), 'Un concepto importante');
    await click('Crear tarjeta');
    expect(actions.saveSpacedCollection).toHaveBeenCalledWith(expect.objectContaining({ termId: 'term-1', visibility: 'personal' }));
  });

  it('conserva entradas genéricas de historial para tarjetas con fuentes inaccesibles', async () => {
    snapshot.spacedCards = [];
    snapshot.spacedUnavailableCards = [{ id: 'hidden-card', collectionId: 'collection-1', version: 1, archived: false }];
    snapshot.spacedReviews = [{ id: 'hidden-review', requestId: 'hidden-request', memberId: owner.id, cardId: 'hidden-card', cardVersion: 1,
      rating: 'hint', step: 1, reviewedAt: now, dueAt: new Date(now.getTime() + 86_400_000) }];
    await mount('/m/repaso/colecciones/collection-1');
    expect(container.querySelector('.spaced-history')?.textContent).toContain('Tarjeta con fuente no disponible');
    expect(container.querySelector('.spaced-history')?.textContent).toContain('Necesité una pista');
    expect(container.textContent).not.toContain('hidden-card');
    await click('Archivar tarjeta');
    expect(actions.archiveSpacedCard).toHaveBeenCalledWith('hidden-card', true, 1);
    await update({ spacedUnavailableCards: [{ id: 'hidden-card', collectionId: 'collection-1', version: 2, archived: true }] });
    await click('Restaurar tarjeta');
    expect(actions.archiveSpacedCard).toHaveBeenCalledWith('hidden-card', false, 2);
  });

  it('conserva la cuenta de tarjetas y preguntas del historial al archivar una colección', async () => {
    snapshot.spacedCollections = [collection({ archived: true })];
    snapshot.spacedReviews = [{ id: 'review-1', requestId: 'request-1', memberId: owner.id, cardId: 'card-1', cardVersion: 1,
      rating: 'remembered', step: 1, reviewedAt: now, dueAt: new Date(now.getTime() + 86_400_000) }];
    const router = await mount('/m/repaso');
    expect(container.querySelector('.spaced-collections')?.textContent).toContain('1 tarjeta');
    await act(async () => router.navigate('/m/repaso/colecciones/collection-1'));
    expect(container.querySelector('.spaced-history')?.textContent).toContain(card().question);
    expect(container.querySelector('.spaced-history')?.textContent).not.toContain('Tarjeta con fuente no disponible');
    expect(container.textContent).not.toContain('Corregir referencia');
  });

  it('permite pausar, conserva el historial propio y no muestra resultados de otros miembros', async () => {
    snapshot.spacedReviews = [{ id: 'my-review', requestId: 'my-request', memberId: owner.id, cardId: 'card-1', cardVersion: 1,
      rating: 'remembered', step: 1, reviewedAt: now, dueAt: new Date(now.getTime() + 86_400_000) },
    { id: 'other-review', requestId: 'other-request', memberId: other.id, cardId: 'card-1', cardVersion: 1,
      rating: 'again', step: 0, reviewedAt: now, dueAt: new Date(now.getTime() + 600_000) }];
    await mount('/m/repaso/colecciones/collection-1');
    expect(container.querySelector('.spaced-history')?.textContent).toContain('Lo recordé');
    expect(container.querySelector('.spaced-history')?.textContent).not.toContain('Debo repasarlo');
    await click('Pausar repaso');
    expect(actions.setSpacedEnrollment).toHaveBeenCalledWith('collection-1', false);
  });
});
