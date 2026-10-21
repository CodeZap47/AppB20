// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Snapshot } from '../data/types';
import type { StudyRoom } from '../data/roomTypes';
import { RoomFormPage, RoomPage, RoomsPage } from './RoomsPage';
import { TeachingFormPage } from './TeachingPage';

const now = new Date('2026-10-21T12:00:00Z');
const room: StudyRoom = { id: 'r1', title: 'Repasar recursión', subjectId: 's1', topic: 'Recursión', objective: 'Resolver dudas con ejemplos', startsAt: now, endsAt: new Date(now.getTime() + 3600_000), organizerId: 'owner', visibility: 'private', status: 'scheduled', version: 1, participantCount: 2, requestId: 'request-1', createdAt: now, updatedAt: now };
let data: Snapshot;
let source: DataSource;
let root: Root;
let container: HTMLDivElement;
let listeners: Set<() => void>;
let actions: ReturnType<typeof makeActions>;
function makeActions() { return {
  getStudyRoomClock: vi.fn().mockResolvedValue(now),
  controlStudyRoomTimer: vi.fn().mockResolvedValue(undefined),
  saveStudyRoomSummary: vi.fn().mockResolvedValue(undefined),
  sendStudyRoomEntry: vi.fn().mockResolvedValue('e2'),
  respondStudyRoomInvitation: vi.fn().mockResolvedValue(undefined),
  createTeachingPractice: vi.fn().mockResolvedValue('p1'),
  createStudyRoom: vi.fn().mockResolvedValue('r2'),
}; }
async function mount(path = '/m/salas/r1') {
  const router = createMemoryRouter([
    { path: '/m/salas', element: <RoomsPage /> },
    { path: '/m/salas/nueva', element: <RoomFormPage /> },
    { path: '/m/salas/:roomId', element: <RoomPage /> },
    { path: '/m/salas/:roomId/editar', element: <RoomFormPage /> },
    { path: '/m/aprende-ensenando/nueva', element: <TeachingFormPage /> },
  ], { initialEntries: [path] });
  await act(async () => root.render(<DataProvider source={source}><RouterProvider router={router} /></DataProvider>));
}
async function update(patch: Partial<Snapshot>) { await act(async () => { data = { ...data, ...patch }; listeners.forEach((listener) => listener()); }); }
function field(label: string) {
  const input = [...container.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith(label))?.querySelector('input,select,textarea');
  if (!input) throw new Error(`Falta ${label}`); return input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}
async function change(label: string, value: string) {
  const input = field(label);
  await act(async () => { const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
function button(label: string) { const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label)); if (!button) throw new Error(`Falta botón ${label}`); return button; }
async function click(label: string) { await act(async () => button(label).click()); }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const owner = { id: 'owner', displayName: 'Ana', isCreator: false, status: 'active' as const, joinedAt: now };
  data = { ...emptySnapshot('ready'), me: owner, members: [owner, { ...owner, id: 'peer', displayName: 'Luis' }], subjects: [{ id: 's1', name: 'Programación', period: 1 }], studyRooms: [room], roomMembers: [{ roomId: room.id, memberId: 'owner', status: 'joined', joinedAt: now, updatedAt: now }, { roomId: room.id, memberId: 'peer', status: 'joined', joinedAt: now, updatedAt: now }], roomTimers: [{ roomId: room.id, phase: 'study', state: 'idle', studyMinutes: 25, breakMinutes: 5, remainingMs: 1500_000, version: 1, updatedAt: now }], roomSummaries: [{ roomId: room.id, text: 'Resumen guardado', version: 1, updatedBy: 'owner', updatedAt: now }], roomEntries: [{ id: 'e1', roomId: room.id, kind: 'question', authorId: 'peer', text: 'Pregunta interna de la sala', createdAt: now, requestId: 'entry-1' }] };
  listeners = new Set(); actions = makeActions();
  source = { label: 'Pantallas de sala', ...actions, getSnapshot: () => data, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } } as unknown as DataSource;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('Salas de estudio', () => {
  it('exige comenzar una sala programada antes de mostrar finalizar o controlar el temporizador', async () => {
    await mount();
    expect(button('Comenzar sesión')).toBeDefined();
    expect(container.textContent).not.toContain('Finalizar sesión');
    expect(container.textContent).not.toContain('Iniciar bloque');
    await update({ studyRooms: [{ ...room, status: 'active', version: 2 }] });
    expect(button('Finalizar sesión')).toBeDefined();
    expect(button('Iniciar bloque')).toBeDefined();
    expect(container.textContent).not.toContain('Comenzar sesión');
  });
  it('muestra solo la ficha al invitado y permite aceptar sin entregar conversación ni resumen', async () => {
    data.me = data.members[1]; data.roomMembers = [{ roomId: room.id, memberId: 'peer', status: 'invited', updatedAt: now }]; data.roomEntries = []; data.roomSummaries = []; data.roomTimers = [];
    await mount();
    expect(container.textContent).toContain('Tienes una invitación');
    expect(container.textContent).not.toContain('Conversación de la sala');
    expect(container.textContent).not.toContain('Resumen colaborativo');
    await click('Aceptar invitación');
    expect(actions.respondStudyRoomInvitation).toHaveBeenCalledWith('r1', true);
  });
  it('retira el contenido y borradores inmediatamente cuando revocan el acceso abierto', async () => {
    data.me = data.members[1]; await mount();
    await change('Mensaje', 'Borrador de conversación secreto'); await change('Resumen de la sesión', 'Borrador de resumen secreto');
    await update({ roomMembers: [{ roomId: 'r1', memberId: 'peer', status: 'removed', updatedAt: new Date() }], roomEntries: [], roomSummaries: [], roomTimers: [] });
    expect(container.textContent).not.toContain('Pregunta interna de la sala');
    expect(container.querySelector('textarea')).toBeNull();
    await update({ roomMembers: [{ roomId: 'r1', memberId: 'peer', status: 'joined', joinedAt: new Date(), updatedAt: new Date() }], roomSummaries: [{ roomId: 'r1', text: 'Resumen guardado', version: 1, updatedBy: 'owner', updatedAt: now }] });
    expect(field('Mensaje').value).toBe(''); expect(field('Resumen de la sesión').value).toBe('Resumen guardado');
  });
  it('conserva el borrador de resumen ante una edición ajena y exige cargar la nueva versión', async () => {
    await mount(); await change('Resumen de la sesión', 'Mi resumen sin guardar');
    await update({ roomSummaries: [{ roomId: 'r1', text: 'Nueva conclusión de Luis', version: 2, updatedBy: 'peer', updatedAt: now }] });
    expect(field('Resumen de la sesión').value).toBe('Mi resumen sin guardar'); expect(button('Guardar resumen').disabled).toBe(true);
    expect(container.textContent).toContain('Tu borrador se conserva');
    await click('Cargar versión guardada'); expect(field('Resumen de la sesión').value).toBe('Nueva conclusión de Luis');
    await change('Resumen de la sesión', 'Conclusión consensuada'); await click('Guardar resumen');
    expect(actions.saveStudyRoomSummary).toHaveBeenCalledWith('r1', 'Conclusión consensuada', 2);
  });
  it('precarga tema y materia para una práctica privada sin copiar el resumen ni conversar con la sala', async () => {
    await mount('/m/aprende-ensenando/nueva?sala=r1');
    expect(field('Materia').value).toBe('s1'); expect(field('Tema').value).toBe('Recursión');
    expect(field('Concepto con tus palabras').value).toBe('');
    expect(container.textContent).not.toContain('Resumen guardado'); expect(container.textContent).toContain('Esta práctica no se comparte con la sala');
    await update({ roomMembers: [] }); expect(container.textContent).toContain('La sala no está disponible'); expect(container.querySelector('textarea')).toBeNull();
  });
  it('rechaza una nota personal enviada por URL al crear o añadir materiales', async () => {
    data.notes = [{ id: 'private', authorId: 'owner', subjectId: 's1', title: 'Referencia secreta', topic: 'Recursión', body: 'Nunca copiar', source: 'student', visibility: 'personal', version: 1, tags: [], createdAt: now, updatedAt: now }];
    await mount('/m/salas/nueva?nota=private'); expect(container.textContent).toContain('Publica primero una copia'); expect(container.textContent).not.toContain('Referencia secreta'); expect(container.querySelector('form')).toBeNull();
  });
  it('usa reloj de servidor y versión al controlar un temporizador compartido', async () => {
    data.studyRooms = [{ ...room, status: 'active' }]; await mount(); expect(actions.getStudyRoomClock).toHaveBeenCalledWith('r1'); expect(container.querySelector('output')?.textContent).toBe('25:00');
    await change('Estudio (minutos)', '30'); await click('Iniciar bloque');
    expect(actions.controlStudyRoomTimer).toHaveBeenCalledWith('r1', { action: 'start', expectedVersion: 1, studyMinutes: 30, breakMinutes: 5 });
    await act(async () => document.dispatchEvent(new Event('visibilitychange'))); expect(actions.getStudyRoomClock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it('al finalizar mantiene el resumen editable y deja la conversación de consulta', async () => {
    data.studyRooms = [{ ...room, status: 'completed' }]; await mount();
    expect(container.textContent).toContain('El chat quedó de consulta'); expect(container.querySelectorAll('textarea')).toHaveLength(1);
    await click('Vista previa para publicar'); expect(container.textContent).toContain('Solo este resumen se publicará');
    expect(container.querySelector('.rooms-preview')?.textContent).not.toContain('Pregunta interna');
  });
  it('exige reiniciar para aplicar duraciones nuevas a un bloque pausado', async () => {
    data.studyRooms = [{ ...room, status: 'active' }];
    data.roomTimers = [{ roomId: room.id, phase: 'study', state: 'paused', studyMinutes: 25, breakMinutes: 5, remainingMs: 900_000, version: 3, updatedAt: now }];
    await mount();
    expect(button('Continuar').disabled).toBe(false);
    await change('Estudio (minutos)', '30');
    expect(button('Continuar').disabled).toBe(true);
    expect(container.textContent).toContain('Reinicia el bloque para aplicar las nuevas duraciones');
    await click('Reiniciar bloque');
    expect(actions.controlStudyRoomTimer).toHaveBeenCalledWith('r1', { action: 'reset', expectedVersion: 3, studyMinutes: 30, breakMinutes: 5 });
    expect(actions.controlStudyRoomTimer).toHaveBeenCalledTimes(1);
  });
  it('protege los borradores bloqueando campos mientras guarda el resumen o envía un aporte', async () => {
    let finishSummary!: () => void;
    let finishEntry!: (id: string) => void;
    actions.saveStudyRoomSummary.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSummary = resolve; }));
    actions.sendStudyRoomEntry.mockImplementationOnce(() => new Promise<string>((resolve) => { finishEntry = resolve; }));
    await mount();
    await change('Resumen de la sesión', 'Un resumen listo');
    await click('Guardar resumen');
    expect(field('Resumen de la sesión').disabled).toBe(true);
    expect(field('Resumen de la sesión').value).toBe('Un resumen listo');
    await act(async () => finishSummary());
    expect(field('Resumen de la sesión').disabled).toBe(false);
    await change('Mensaje', 'Aporte que se está enviando');
    await click('Enviar aporte');
    expect(field('Mensaje').disabled).toBe(true);
    expect(field('Tipo de aporte').disabled).toBe(true);
    expect(field('Mensaje').value).toBe('Aporte que se está enviando');
    await act(async () => finishEntry('e2'));
    expect(field('Mensaje').disabled).toBe(false);
    expect(field('Mensaje').value).toBe('');
  });
});
