// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { Snapshot } from '../data/types';
import type { CodingChallenge } from '../data/practiceTypes';
import { ChallengeCreatePage, ChallengeDetailPage, ChallengesPage } from './PracticePage';

const actions = { createCodingChallenge: vi.fn(), unlockChallengeHint: vi.fn(), saveChallengeSolution: vi.fn(), addChallengeComment: vi.fn(), closeCodingChallenge: vi.fn() };
let data: Snapshot;
let container: HTMLDivElement;
let root: Root;
vi.mock('../data/DataContext', () => ({ useSnapshot: () => data, useDataSource: () => actions }));
const at = new Date('2026-10-26T12:00:00Z');
const challenge: CodingChallenge = { id: 'sum', authorId: 'owner', requestId: 'sum', subjectId: 'logic', title: 'Suma de listas', topic: 'Listas', difficulty: 'basic', objective: 'Recorrer y acumular.', instructions: 'Suma cada elemento de la lista.', examples: '[1, 2] → 3', hintCount: 2, closed: false, closure: '', version: 3, createdAt: at, updatedAt: at };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  for (const action of Object.values(actions)) action.mockResolvedValue(undefined);
  const member = { id: 'owner', displayName: 'Ana', status: 'active' as const, isCreator: false, joinedAt: at };
  data = { ...emptySnapshot('ready'), me: { ...member, id: 'peer', displayName: 'Luis' }, members: [member, { ...member, id: 'peer', displayName: 'Luis' }],
    subjects: [{ id: 'logic', name: 'Lógica', period: 1 }, { id: 'programming', name: 'Programación', period: 1 }], codingChallenges: [{ ...challenge }] };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

function Saved() { return <output data-saved>{useLocation().pathname}</output>; }
async function show(path: string, savedDetail = false) {
  const router = createMemoryRouter([
    { path: '/m/retos', element: <ChallengesPage /> },
    { path: '/m/retos/nuevo', element: <ChallengeCreatePage /> },
    { path: '/m/retos/:challengeId', element: savedDetail ? <Saved /> : <ChallengeDetailPage /> },
  ], { initialEntries: [path] });
  await act(async () => root.render(<RouterProvider router={router} />));
}
function field(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const control = [...container.querySelectorAll('label')].find((node) => node.textContent?.startsWith(label))?.querySelector('input,select,textarea');
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) throw new Error(`Falta ${label}`);
  return control;
}
async function change(label: string, value: string) {
  const control = field(label);
  await act(async () => {
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
function button(label: string) {
  const control = [...container.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label);
  expect(control, label).toBeTruthy();
  return control!;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
const cardIds = () => [...container.querySelectorAll<HTMLAnchorElement>('li a[href^="/m/retos/"]')].map((link) => link.getAttribute('href')!.split('/').at(-1));

async function fillChallenge() {
  await change('Título', 'Encontrar el mayor');
  await change('Objetivo', 'Comparar valores en una lista.');
  await change('Instrucciones', 'Devuelve el valor mayor sin ordenar la lista.');
  await change('Ejemplos de entrada y resultado', '[2, 8, 3] → 8');
  await change('Tema', 'Recorridos');
}

describe('biblioteca y creación de retos', () => {
  it('combina filtros, anuncia resultados y restaura el listado de abiertos', async () => {
    data.codingChallenges.push(
      { ...challenge, id: 'loops', subjectId: 'programming', title: 'Ciclos anidados', topic: 'Ciclos', difficulty: 'advanced', createdAt: new Date(at.getTime() + 1000) },
      { ...challenge, id: 'closed', closed: true, closure: 'Listo' },
    );
    await show('/m/retos');
    expect(cardIds()).toEqual(['loops', 'sum']);
    await change('Materia', 'programming');
    await change('Dificultad', 'advanced');
    await change('Tema o título', 'CICLOS');
    expect(cardIds()).toEqual(['loops']);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('1 reto');
    await change('Estado', 'closed');
    expect(cardIds()).toEqual([]);
    expect(container.textContent).toContain('No hay retos con estos filtros');
    await click('Limpiar filtros');
    expect(field('Materia').value).toBe('');
    expect(field('Dificultad').value).toBe('');
    expect(field('Tema o título').value).toBe('');
    expect(field('Estado').value).toBe('open');
    expect(cardIds()).toEqual(['loops', 'sum']);
  });

  it('permite encontrar retos cerrados desde el vacío de abiertos sin crear otro reto', async () => {
    data.codingChallenges[0] = { ...challenge, closed: true, closure: 'Aprendimos acumulación.' };
    await show('/m/retos');
    expect(cardIds()).toEqual([]);
    await click('Ver todos los retos');
    expect(field('Estado').value).toBe('all');
    expect(cardIds()).toEqual(['sum']);
  });

  it('ofrece crear el primer reto cuando no existe ninguno', async () => {
    data.codingChallenges = [];
    await show('/m/retos');
    expect(container.textContent).toContain('Todavía no hay retos');
    expect([...container.querySelectorAll('a[href="/m/retos/nuevo"]')]).toHaveLength(2);
  });

  it('mantiene el orden de pistas al quitar una y publica con los campos completos', async () => {
    actions.createCodingChallenge.mockResolvedValue('new-challenge');
    await show('/m/retos/nuevo', true);
    await fillChallenge();
    await change('Materia', 'programming');
    await change('Dificultad', 'intermediate');
    await click('Añadir pista');
    await change('Pista 1', 'Una pista descartada.');
    await click('Añadir pista');
    await change('Pista 2', 'Conserva un máximo provisional.');
    await click('Quitar pista 1');
    expect(field('Pista 1').value).toBe('Conserva un máximo provisional.');
    await submit();
    expect(actions.createCodingChallenge).toHaveBeenCalledExactlyOnceWith({
      requestId: expect.any(String), subjectId: 'programming', title: 'Encontrar el mayor', topic: 'Recorridos', difficulty: 'intermediate',
      objective: 'Comparar valores en una lista.', instructions: 'Devuelve el valor mayor sin ordenar la lista.', examples: '[2, 8, 3] → 8', hints: ['Conserva un máximo provisional.'],
    });
    expect(container.querySelector('[data-saved]')?.textContent).toBe('/m/retos/new-challenge');
  });

  it('limita a ocho pistas y conserva el borrador y envío tras un error', async () => {
    actions.createCodingChallenge.mockRejectedValue(new Error('Sin conexión'));
    await show('/m/retos/nuevo');
    await fillChallenge();
    for (let index = 1; index <= 8; index++) { await click('Añadir pista'); await change(`Pista ${index}`, `Ayuda ${index}`); }
    expect(button('Añadir pista').disabled).toBe(true);
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Sin conexión');
    expect(field('Instrucciones').value).toBe('Devuelve el valor mayor sin ordenar la lista.');
    expect(field('Pista 8').value).toBe('Ayuda 8');
    await submit();
    expect(actions.createCodingChallenge.mock.calls[1]![0].requestId).toBe(actions.createCodingChallenge.mock.calls[0]![0].requestId);
    await change('Objetivo', 'Comparar y explicar los casos límite.');
    await submit();
    expect(actions.createCodingChallenge.mock.calls[2]![0].requestId).not.toBe(actions.createCodingChallenge.mock.calls[0]![0].requestId);
  });
});

describe('lectura, ayudas y participación en un reto', () => {
  it('muestra solo las pistas disponibles y pide exactamente la siguiente sin inventarla', async () => {
    data.challengeHints = [{ challengeId: 'sum', number: 1, body: 'Usa un acumulador.' }, { challengeId: 'other', number: 2, body: 'Pista de otro reto' }];
    data.challengeProgress = [{ challengeId: 'sum', unlockedHints: 1 }, { challengeId: 'other', unlockedHints: 8 }];
    await show('/m/retos/sum');
    expect(container.textContent).toContain('Usa un acumulador.');
    expect(container.textContent).not.toContain('Pista de otro reto');
    expect(container.querySelector('progress')?.value).toBe(1);
    expect(container.querySelector('progress')?.max).toBe(2);
    await click('Descubrir pista 2 de 2');
    expect(actions.unlockChallengeHint).toHaveBeenCalledExactlyOnceWith('sum', 1);
    expect([...container.querySelectorAll('h3')].some((heading) => heading.textContent === 'Pista 2')).toBe(false);
    expect(container.textContent).toContain('Este progreso es privado.');
    expect(container.textContent).not.toContain('Cerrar con conclusión');
  });

  it('conserva código y soluciones legibles como texto al cerrar, sin formularios de participación', async () => {
    data.codingChallenges[0] = { ...challenge, hintCount: 0, closed: true, closure: 'Aprendimos a comparar límites.' };
    data.challengeSolutions = [{ id: 'solution', challengeId: 'sum', authorId: 'peer', body: '<img src=x onerror=alert(1)>\n  return sum(values);', explanation: 'Recorro cada valor una sola vez.', version: 2, requestId: 'solution', createdAt: at, updatedAt: at }];
    await show('/m/retos/sum');
    expect(container.textContent).toContain('Aprendimos a comparar límites.');
    expect(container.querySelector('pre[aria-label="Código de la solución"]')?.textContent).toBe('<img src=x onerror=alert(1)>\n  return sum(values);');
    expect(container.querySelector('pre[aria-label="Código de la solución"]')?.getAttribute('tabindex')).toBe('0');
    expect(container.querySelector('pre img')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('#solucion-solution')?.getAttribute('aria-labelledby')).toBe('solucion-title-solution');
    expect(container.textContent).toContain('Tu solución está compartida');
  });

  it('ofrece el cierre al autor con la versión actual y conserva su conclusión tras un error', async () => {
    data.me = data.members[0];
    actions.closeCodingChallenge.mockRejectedValue(new Error('El reto cambió.'));
    await show('/m/retos/sum');
    await change('Conclusión y aprendizajes', 'Aprendimos a recorrer listas.');
    await click('Cerrar con conclusión');
    expect(actions.closeCodingChallenge).toHaveBeenCalledExactlyOnceWith('sum', 'Aprendimos a recorrer listas.', 3);
    expect(field('Conclusión y aprendizajes').value).toBe('Aprendimos a recorrer listas.');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('El reto cambió.');
    expect(container.querySelector('progress')).toBeNull();
    expect(container.textContent).toContain('puedes consultar todas sus pistas');
  });
});
