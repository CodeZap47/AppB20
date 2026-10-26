// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider, useSnapshot } from '../../data/DataContext';
import { createDemoState, DemoDataSource } from '../../data/demo';
import type { DataSource } from '../../data/types';
import type { NewsItem } from '../../lib/whatsNew';
import { FeedActions } from './FeedActions';

const now = new Date('2026-10-26T18:00:00Z');
let state: ReturnType<typeof createDemoState>;
let demo: DemoDataSource;
let source: DataSource;
let container: HTMLDivElement;
let root: Root;
const item = (kind: NewsItem['kind'], id: string, target?: 'poll' | 'question'): NewsItem => ({
  kind, key: `${kind}:${id}`, actorId: 'demo-2', subjectId: undefined, text: 'Publicación',
  link: '/', at: now, ...(target ? { target: { kind: target, id } } : { resource: { kind: 'room', id } }),
});
function Harness({ news }: { news: NewsItem }) { return <FeedActions item={news} snapshot={useSnapshot()} />; }
async function mount(news: NewsItem) {
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter><Harness news={news} /></MemoryRouter></DataProvider>));
}
function button(label: string) {
  const node = [...container.querySelectorAll('button')].find((row) => row.textContent?.trim() === label);
  if (!node) throw new Error(`Falta botón: ${label}`);
  return node;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function choose(index: number) { await act(async () => (container.querySelectorAll('input')[index] as HTMLInputElement).click()); }
async function draft(value: string) {
  const control = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state = createDemoState(now);
  state.polls = [{ id: 'feed-poll', title: 'Tema de repaso', description: 'Elegimos juntos',
    options: ['Recursión', 'Condiciones', 'Funciones'], multiple: false, allowChange: true,
    eligibleIds: ['demo-1', 'demo-2', 'demo-3'], createdBy: 'demo-2', createdAt: now, updatedAt: now,
    closesAt: new Date(now.getTime() + 3_600_000), cancelReason: '', decision: '' }];
  state.pollVotes = [];
  state.questions = [{ id: 'feed-question', subjectId: state.subjects[0]!.id, topic: 'Recursión',
    title: '¿Cómo termina la llamada?', body: '¿Cuál es el caso base?', authorId: 'demo-2',
    status: 'open', createdAt: now }];
  state.answers = [];
  state.studyRooms = [{ id: 'feed-room', requestId: 'feed-room', title: 'Repaso de recursión',
    topic: 'Recursión', subjectId: state.subjects[0]!.id, objective: 'Resolver ejercicios',
    startsAt: now, endsAt: new Date(now.getTime() + 3_600_000), capacity: 3, visibility: 'group',
    status: 'scheduled', organizerId: 'demo-2', participantCount: 1, version: 1, createdAt: now, updatedAt: now }];
  state.roomMembers = [{ roomId: 'feed-room', memberId: 'demo-2', status: 'joined', joinedAt: now, updatedAt: now }];
  state.roomTimers = [{ roomId: 'feed-room', phase: 'study', state: 'idle', studyMinutes: 25,
    breakMinutes: 5, remainingMs: 1_500_000, version: 1, updatedAt: now }];
  demo = new DemoDataSource(state, 'demo-1', () => new Date()); source = demo;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); demo.dispose(); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('acciones del feed con el proveedor demo real', () => {
  it('vota, muestra participación y selección confirmadas y permite cambiar el voto', async () => {
    await mount(item('votacion', 'feed-poll', 'poll'));
    expect(container.textContent).toContain('Tu voto es nominal');
    expect(button('Votar').disabled).toBe(true);
    await choose(0); await click('Votar');
    expect(demo.getSnapshot().pollVotes).toContainEqual(expect.objectContaining({ pollId: 'feed-poll', voterId: 'demo-1', choices: [0] }));
    expect(container.textContent).toContain('Tu voto: Recursión');
    expect(container.textContent).toContain('1 de 3 participantes');
    await click('Cambiar mi voto'); await choose(2); await click('Guardar mi nuevo voto');
    expect(demo.getSnapshot().pollVotes.filter((row) => row.voterId === 'demo-1')).toHaveLength(1);
    expect(container.textContent).toContain('Tu voto: Funciones');
  });

  it('permite varias opciones y respeta una votación que no admite cambios', async () => {
    state.polls[0]!.multiple = true; state.polls[0]!.allowChange = false;
    await mount(item('votacion', 'feed-poll', 'poll'));
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    await choose(0); await choose(2); await click('Votar');
    expect(demo.getSnapshot().pollVotes[0]?.choices).toEqual([0, 2]);
    expect(container.textContent).toContain('Esta votación no permite cambiar el voto');
    expect(container.textContent).not.toContain('Cambiar mi voto');
  });

  it('bloquea dos envíos simultáneos y espera los datos confirmados sin inventar un voto', async () => {
    let finish!: () => void;
    const cast = vi.spyOn(source, 'castVote').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await mount(item('votacion', 'feed-poll', 'poll')); await choose(1);
    await act(async () => { const form = container.querySelector('form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(cast).toHaveBeenCalledTimes(1); expect(button('Guardando voto…').disabled).toBe(true);
    expect(container.textContent).not.toContain('Tu voto:');
    await act(async () => finish());
    expect(container.textContent).not.toContain('Tu voto:');
    expect(container.textContent).toContain('0 de 3 participantes');
  });

  it('actualiza el cierre con un aviso único e impide votar al cumplirse la hora', async () => {
    const cast = vi.spyOn(source, 'castVote');
    await mount(item('votacion', 'feed-poll', 'poll')); await choose(0);
    await act(async () => { vi.advanceTimersByTime(3_600_030); });
    expect(container.textContent).toContain('Cerrada');
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(cast).not.toHaveBeenCalled();
  });

  it('conserva la selección cuando falla un voto y deja corregirlo manualmente', async () => {
    vi.spyOn(source, 'castVote').mockRejectedValueOnce(new Error('Se perdió la conexión.'));
    await mount(item('votacion', 'feed-poll', 'poll')); await choose(1); await click('Votar');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Se perdió la conexión');
    expect((container.querySelectorAll('input')[1] as HTMLInputElement).checked).toBe(true);
    expect(demo.getSnapshot().pollVotes).toHaveLength(0);
  });

  it.each(['pregunta', 'resuelta', 'museo'] as const)('publica una respuesta desde una tarjeta %s y evita duplicarla', async (kind) => {
    if (kind === 'resuelta') state.questions[0]!.status = 'resolved';
    const answer = vi.spyOn(source, 'answerQuestion');
    await mount(item(kind, 'feed-question', 'question')); await click('Responder pregunta');
    await draft('  La recursión termina en el caso base.  ');
    await act(async () => { const form = container.querySelector('form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(answer).toHaveBeenCalledTimes(1);
    expect(demo.getSnapshot().answers).toContainEqual(expect.objectContaining({ questionId: 'feed-question', body: 'La recursión termina en el caso base.' }));
    expect(container.querySelector('textarea')).toBeNull(); expect(container.querySelector('[role="status"]')?.textContent).toContain('Tu respuesta se publicó');
  });

  it('conserva una respuesta al fallar y no reenvía automáticamente', async () => {
    const answer = vi.spyOn(source, 'answerQuestion').mockRejectedValueOnce(new Error('No se pudo confirmar el envío.'));
    await mount(item('pregunta', 'feed-question', 'question')); await click('Responder pregunta'); await draft('Una respuesta por conservar'); await click('Publicar respuesta');
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(answer).toHaveBeenCalledTimes(1); expect(container.querySelector('textarea')?.value).toBe('Una respuesta por conservar');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No se pudo confirmar');
    await click('Cerrar editor'); await click('Responder pregunta');
    expect(container.querySelector('textarea')?.value).toBe('Una respuesta por conservar');
  });

  it('el cambio de perfil descarta el borrador y las confirmaciones de la sesión anterior', async () => {
    let finish!: (id: string) => void;
    vi.spyOn(source, 'answerQuestion').mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    await mount(item('pregunta', 'feed-question', 'question')); await click('Responder pregunta'); await draft('Texto de la sesión anterior'); await click('Publicar respuesta');
    await act(async () => demo.setViewer('demo-3')); await act(async () => finish('answer-stale'));
    expect(container.textContent).not.toContain('Tu respuesta se publicó'); await click('Responder pregunta');
    expect(container.querySelector('textarea')?.value).toBe('');
  });

  it('inscribe, abre la sala y pide confirmar antes de salir', async () => {
    const join = vi.spyOn(source, 'joinStudyRoom'); const leave = vi.spyOn(source, 'leaveStudyRoom');
    await mount(item('sala', 'feed-room')); await click('Inscribirme');
    expect(join).toHaveBeenCalledOnce(); expect(container.querySelector('a')?.getAttribute('href')).toBe('/m/salas/feed-room');
    expect(demo.getSnapshot().roomMembers).toContainEqual(expect.objectContaining({ roomId: 'feed-room', memberId: 'demo-1', status: 'joined' }));
    await click('Salir de la sala'); expect(leave).not.toHaveBeenCalled();
    await click('Seguir en la sala'); expect(leave).not.toHaveBeenCalled();
    await click('Salir de la sala'); await click('Confirmar salida');
    expect(leave).toHaveBeenCalledOnce(); expect(button('Inscribirme')).toBeDefined();
  });

  it('acepta la invitación vigente usando su acción específica', async () => {
    state.roomMembers.push({ roomId: 'feed-room', memberId: 'demo-1', status: 'invited', invitedBy: 'demo-2', updatedAt: now });
    const accept = vi.spyOn(source, 'respondStudyRoomInvitation'); const join = vi.spyOn(source, 'joinStudyRoom');
    await mount(item('sala', 'feed-room')); await click('Aceptar invitación');
    expect(accept).toHaveBeenCalledWith('feed-room', true); expect(join).not.toHaveBeenCalled();
    expect(container.querySelector('a')?.textContent).toBe('Abrir sala');
  });

  it('resuelve una carrera por la última plaza con el resultado real y sin repetir inscripción', async () => {
    state.studyRooms[0]!.capacity = 2;
    const original = source.joinStudyRoom.bind(source);
    let finish!: () => void;
    const join = vi.spyOn(source, 'joinStudyRoom').mockImplementation(() => new Promise<void>((resolve, reject) => { finish = () => { try { original('feed-room'); resolve(); } catch (error) { reject(error); } }; }));
    await mount(item('sala', 'feed-room'));
    await act(async () => { button('Inscribirme').click(); button('Inscribirme').click(); });
    const peer = new DemoDataSource(state, 'demo-3', () => new Date());
    await act(async () => peer.joinStudyRoom('feed-room')); await act(async () => finish()); peer.dispose();
    expect(join).toHaveBeenCalledTimes(1); expect(button('Sala sin plazas disponibles').disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('cupo');
    expect(demo.getSnapshot().roomMembers.some((row) => row.memberId === 'demo-1' && row.status === 'joined')).toBe(false);
  });

  it('oculta salas privadas, expulsadas y preguntas retiradas', async () => {
    state.studyRooms[0]!.visibility = 'private'; state.roomMembers.push({ roomId: 'feed-room', memberId: 'demo-1', status: 'invited', updatedAt: now });
    await mount(item('sala', 'feed-room')); expect(container.textContent).toBe('');
    state.studyRooms[0]!.visibility = 'group'; state.roomMembers[1]!.status = 'removed';
    await act(async () => demo.setViewer('demo-1')); expect(container.textContent).toBe('');
    const author = new DemoDataSource(state, 'demo-2', () => new Date());
    await act(async () => author.withdrawContent('question', 'feed-question', true, 1)); author.dispose();
    await mount(item('pregunta', 'feed-question', 'question')); expect(container.textContent).toBe('');
  });

  it('el organizador abre su sala sin ofrecer salir y una sala finalizada no admite inscripciones', async () => {
    demo.setViewer('demo-2'); await mount(item('sala', 'feed-room'));
    expect(container.querySelector('a')?.textContent).toBe('Abrir sala'); expect(container.textContent).not.toContain('Salir de la sala');
    await act(async () => demo.setViewer('demo-1'));
    const owner = new DemoDataSource(state, 'demo-2', () => new Date());
    await act(async () => owner.setStudyRoomStatus('feed-room', 'cancelled', 1)); owner.dispose();
    expect(container.textContent).toContain('La sala ya no recibe inscripciones'); expect(container.querySelector('button')).toBeNull();
  });

  it('bloquea las acciones sin conexión', async () => {
    const offline = { ...demo.getSnapshot(), connection: 'offline' as const };
    vi.spyOn(source, 'getSnapshot').mockReturnValue(offline);
    await mount(item('pregunta', 'feed-question', 'question'));
    expect(button('Responder pregunta').disabled).toBe(true); expect(container.textContent).toContain('Conéctate');
  });
});
