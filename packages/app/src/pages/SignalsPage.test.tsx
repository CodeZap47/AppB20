// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySignalCommand, emptySignalsState, projectSignals, starterSignalDefinitions, type SignalCommand, type SignalContext, type SignalState } from '../../../core/src/signals';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Member, Snapshot } from '../data/types';
import { SignalsPage } from './SignalsPage';

const now = Date.UTC(2026, 9, 26, 12);
const owner: Member = { id: 'owner', displayName: 'Ana', isCreator: true, status: 'active', joinedAt: new Date(now) };
const peer: Member = { ...owner, id: 'peer', displayName: 'Bruno', isCreator: false };
let state: SignalState;
let actor: Member;
let snapshot: Snapshot;
let container: HTMLDivElement;
let root: Root;
let listeners: Set<() => void>;
let signalAction: ReturnType<typeof vi.fn<(command: SignalCommand) => string | undefined | Promise<string | undefined>>>;
let source: DataSource;
let dictionaryId: string;
let sourceAccessible: boolean;

function context(): SignalContext { return { actor: actor.id, now, activeMembers: [owner.id, peer.id], subjects: ['subject'], isAdmin: actor.isCreator, source: (kind, id) => sourceAccessible && kind === 'note' && id === 'note' ? { subjectId: 'subject', version: 2 } : undefined }; }
function sync() { snapshot = { ...snapshot, me: actor, signals: projectSignals(state, context()) }; listeners.forEach((listener) => listener()); }
function command(value: SignalCommand) { const result = applySignalCommand(state, value, context()); state = result.state; return result.id; }
function seed() { dictionaryId = command({ action: 'createDictionary', subjectId: 'subject', title: 'Convenciones de algoritmos', topic: 'Algoritmos', definitions: starterSignalDefinitions(), requestId: 'create' })!; command({ action: 'publishDictionary', dictionaryId, expectedVersion: 1, requestId: 'publish' }); sync(); }
async function mount(tab = 'diccionario', linkedDictionary?: string) { const router = createMemoryRouter([{ path: '/m/senales', element: <SignalsPage /> }], { initialEntries: [`/m/senales?pestana=${tab}${linkedDictionary ? `&diccionario=${encodeURIComponent(linkedDictionary)}` : ''}`] }); await act(async () => root.render(<DataProvider source={source}><RouterProvider router={router} /></DataProvider>)); }
function button(text: string) { const target = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === text); if (!target) throw new Error(`Falta botón: ${text}`); return target; }
async function click(text: string) { await act(async () => button(text).click()); }
function field(text: string) { const label = [...container.querySelectorAll('label')].find((node) => node.textContent?.startsWith(text)); const target = label?.querySelector('input,select,textarea'); if (!target) throw new Error(`Falta campo: ${text}`); return target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; }
async function change(text: string, value: string) { const element = field(text); await act(async () => { const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); }
async function as(member: Member) { await act(async () => { actor = member; sync(); }); }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  actor = owner; sourceAccessible = true; state = emptySignalsState(); listeners = new Set();
  snapshot = { ...emptySnapshot('ready'), me: owner, members: [owner, peer], subjects: [{ id: 'subject', name: 'Programación', period: 1 }], notes: [{ id: 'note', subjectId: 'subject', title: 'Apunte propio', topic: 'Algoritmos', body: 'Contenido privado que no debe copiarse', authorId: owner.id, source: 'student', visibility: 'personal', version: 2, tags: [], createdAt: new Date(now), updatedAt: new Date(now) }] };
  signalAction = vi.fn((input: SignalCommand) => { const id = command(input); sync(); return id; });
  source = { label: 'Prueba de señales', getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, signalAction } as unknown as DataSource;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('Lenguaje de señales: recorridos compartidos', () => {
  it('abre el diccionario exacto del enlace de chat y solo permite compartir versiones publicadas', async () => {
    seed(); const publishedId = dictionaryId;
    dictionaryId = command({ action: 'createDictionary', subjectId: 'subject', title: 'Mi borrador privado', topic: 'Borrador', definitions: starterSignalDefinitions(), requestId: 'private' })!; sync();
    await mount('diccionario', publishedId);
    expect(container.querySelector('.signals-card.is-selected h3')?.textContent).toBe('Convenciones de algoritmos');
    expect(container.querySelectorAll('.chat-share-button')).toHaveLength(1);
    const privateCard = [...container.querySelectorAll('.signals-card')].find(card => card.querySelector('h3')?.textContent === 'Mi borrador privado')!;
    await act(async () => privateCard.querySelector<HTMLButtonElement>('button')!.click());
    expect(container.querySelector('.signals-card.is-selected h3')?.textContent).toBe('Mi borrador privado');
    expect(container.querySelectorAll('.chat-share-button')).toHaveLength(0);
  });
  it('indica que un diccionario solicitado ya no está disponible sin elegir otro', async () => {
    seed(); await mount('diccionario', 'retirado');
    expect(container.textContent).toContain('El diccionario solicitado no está disponible');
    expect(container.querySelector('.signals-card.is-selected')).toBeNull();
  });
  it('crea un borrador con los tres medios, lo revisa y publica una versión', async () => {
    await mount(); await click('Crear diccionario'); await change('Tema', 'Recursión'); await change('Nombre del diccionario', 'Señales para recursión'); await click('Crear borrador');
    expect(state.dictionaries).toHaveLength(1); expect(new Set(state.dictionaries[0]!.draft.map((row) => row.medium)).size).toBe(3);
    expect(container.textContent).toContain('Primera publicación');
    expect(container.textContent).not.toMatch(/Separador separator|Confirmación confirm|Final end/);
    const separator = [...container.querySelectorAll('details')].find((detail) => detail.querySelector('summary')?.textContent?.includes('· Separador'))!;
    expect(separator.textContent).toContain('Significado del control');
    expect(separator.querySelector('input[value="separator"]')).toBeNull();
    await click('Publicar versión revisada');
    expect(state.versions).toHaveLength(1); expect(container.textContent).toContain('Versión publicada 1');
  });
  it('conserva el borrador y el identificador de envío al reintentar un error', async () => {
    seed(); await mount(); await click('Abrir diccionario'); await change('Nombre', 'Mi cambio local');
    signalAction.mockImplementationOnce(() => Promise.reject(new Error('Conexión interrumpida')));
    await click('Guardar borrador'); expect(container.textContent).toContain('Conexión interrumpida'); expect(field('Nombre').value).toBe('Mi cambio local');
    const request = signalAction.mock.calls.at(-1)![0].requestId; await click('Guardar borrador');
    expect(signalAction.mock.calls.at(-1)![0].requestId).toBe(request); expect(state.dictionaries[0]!.title).toBe('Mi cambio local');
  });
  it('solo guarda el mensaje por acción expresa y permite retirarlo y restaurarlo', async () => {
    seed(); await mount('constructor'); await change('Referencia de la pregunta', '12'); await change('Medio', 'foot');
    expect(signalAction).not.toHaveBeenCalled(); expect(container.textContent).toContain('Pregunta 12'); await click('Guardar mensaje privado');
    expect(state.messages[0]).toMatchObject({ reference: '12', medium: 'foot', answer: 'A' });
    await click('Enviar a papelera'); expect(state.messages[0]!.deletedAt).toBe(now); await click('Restaurar'); expect(state.messages[0]!.deletedAt).toBeUndefined();
  });
  it('oculta la solución antes de responder y conserva el resultado en el historial propio', async () => {
    seed(); await mount('practicar'); await click('Empezar ejercicio');
    const attempt = state.attempts[0]!; expect(snapshot.signals.attempts[0]!.expected).toBeUndefined(); expect(container.textContent).not.toContain('Respuesta esperada:');
    const radio = [...container.querySelectorAll<HTMLInputElement>('input[type=radio]')].find((element) => element.value === attempt.expected)!;
    await act(async () => radio.click()); await click('Comprobar interpretación');
    expect(state.attempts[0]!.correct).toBe(true); expect(container.textContent).toContain('Interpretación acertada'); expect(container.textContent).toContain(`Respuesta esperada: ${attempt.expected}`);
  });
  it('acepta una invitación, alterna los turnos y mantiene oculto el objetivo al receptor', async () => {
    seed(); await mount('parejas'); await change('Compañero', 'peer'); await click('Invitar a practicar');
    await as(peer); expect(container.textContent).toContain('Ana te invita a practicar'); await click('Aceptar invitación'); await click('Comenzar sesión');
    expect(container.textContent).toContain('Es el turno de emitir de Ana'); await as(owner); await click('Abrir sesión');
    await change('Referencia de la pregunta', '12'); await click('Enviar secuencia'); expect(state.turns).toHaveLength(1);
    await as(peer); await click('Abrir sesión'); expect(snapshot.signals.turns[0]!.expected).toBeUndefined(); expect(container.textContent).not.toContain('Objetivo:');
    await change('Mensaje interpretado', '12 → A'); await click('Enviar interpretación');
    expect(state.turns[0]!.correct).toBe(true); expect(container.textContent).toContain('Tu turno de emitir'); expect(container.textContent).toContain('Objetivo: 12 → A');
  });
  it('guarda fichas privadas con fuente versionada sin copiar el apunte y muestra revisiones', async () => {
    seed(); await mount('fichas'); await click('Crear ficha privada'); await change('Tema de la ficha', 'Recursión'); await change('Pregunta o referencia', 'Caso base'); await change('Anotación breve', 'Condición para detenerse'); await change('Material de origen', 'note:note');
    expect(container.textContent).not.toContain('Contenido privado que no debe copiarse'); await click('Guardar ficha');
    expect(state.cards[0]!.source).toMatchObject({ kind: 'note', id: 'note', version: 2 }); expect(state.cardRevisions).toHaveLength(1);
    await change('Anotación breve', 'Condición y retorno de salida'); await click('Guardar ficha'); expect(state.cardRevisions).toHaveLength(2);
    expect(container.textContent).toContain('Historial de revisiones (2)'); await as(peer); expect(container.textContent).not.toContain('Condición y retorno de salida');
  });
  it('mantiene los cambios locales cuando otra sesión guarda una versión nueva', async () => {
    seed(); await mount(); await click('Abrir diccionario'); await change('Nombre', 'Cambio local sin guardar');
    command({ action: 'saveDictionary', dictionaryId, expectedVersion: 2, title: 'Cambio remoto', topic: 'Algoritmos', definitions: starterSignalDefinitions(), requestId: 'remote' });
    await act(async () => sync()); expect(field('Nombre').value).toBe('Cambio local sin guardar');
    await click('Guardar borrador'); expect(signalAction.mock.calls.at(-1)![0]).toMatchObject({ expectedVersion: 2, title: 'Cambio local sin guardar' });
    expect(field('Nombre').value).toBe('Cambio local sin guardar'); await click('Cargar versión actual'); expect(field('Nombre').value).toBe('Cambio remoto');
  });
  it('recomienda con la versión de la selección del grupo y señala una fuente retirada', async () => {
    seed(); await mount(); await click('Abrir diccionario'); await click('Recomendar al grupo');
    expect(state.recommendations[0]).toMatchObject({ dictionaryId, version: 1 });
    command({ action: 'saveCard', subjectId: 'subject', topic: 'Algoritmos', reference: 'Origen de la ficha', body: 'Texto de mi autoría', conditions: '', support: 'Repaso', source: { kind: 'note', id: 'note', version: 2, location: 'Apartado 1' }, expectedVersion: 0, requestId: 'card-source' });
    sourceAccessible = false; await act(async () => sync()); await click('Fichas');
    expect(snapshot.signals.cards[0]!.source).toBeUndefined(); expect(container.textContent).toContain('La fuente ya no está disponible');
    expect(container.textContent).not.toContain('Anotación propia, sin fuente enlazada'); expect(container.textContent).toContain('Texto de mi autoría');
  });
  it('vacía el contenido y los formularios privados al perder membresía', async () => {
    seed(); await mount('fichas'); await click('Crear ficha privada'); await change('Anotación breve', 'Borrador secreto sin guardar');
    await act(async () => { snapshot = { ...snapshot, me: { ...owner, status: 'removed' } }; listeners.forEach((listener) => listener()); });
    expect(container.textContent).toContain('Conecta con el grupo'); expect(container.textContent).not.toContain('Borrador secreto'); expect(container.querySelector('textarea')).toBeNull();
  });
});
