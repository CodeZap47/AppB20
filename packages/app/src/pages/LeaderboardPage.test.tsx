// @vitest-environment jsdom
import { CONTRIBUTION_KINDS, CONTRIBUTION_RULES, NOT_SCORED } from '@b20/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Note, Snapshot } from '../data/types';
import { ContributorPage, LeaderboardPage } from './LeaderboardPage';

let container: HTMLDivElement;
let root: Root;
let snapshot: Snapshot;
let source: DataSource;
const now = new Date('2026-10-26T12:00:00Z');
const member = { id: 'me', displayName: 'Luis', status: 'active' as const, isCreator: false, joinedAt: now };
const ascending = ['Fuente procesada', 'Propuesta de corrección', 'Página registrada', 'Corrección', 'Respuesta', 'Evidencia de clase', 'Revisión de guía', 'Apunte para el grupo', 'Trabajo publicado', 'Respuesta aceptada', 'Guía de estudio'];
const descending = ['Guía de estudio', 'Trabajo publicado', 'Respuesta aceptada', 'Apunte para el grupo', 'Evidencia de clase', 'Revisión de guía', 'Respuesta', 'Página registrada', 'Corrección', 'Fuente procesada', 'Propuesta de corrección'];

async function mount(url = '/m/leaderboard') {
  const router = createMemoryRouter([
    { path: '/m/leaderboard', element: <LeaderboardPage /> },
    { path: '/m/leaderboard/:memberId', element: <ContributorPage /> },
  ], { initialEntries: [url] });
  await act(async () => root.render(<DataProvider source={source}><RouterProvider router={router} /></DataProvider>));
  return router;
}

function panel() {
  const element = container.querySelector<HTMLElement>('section[aria-label="Reglas del ranking"]');
  expect(element).not.toBeNull();
  return element!;
}

function control<T extends HTMLInputElement | HTMLSelectElement>(name: string) {
  const element = [...panel().querySelectorAll<T>('input, select')].find((candidate) =>
    [...(candidate.labels ?? [])].some((label) => label.textContent?.trim().startsWith(name)),
  );
  expect(element, `Control con etiqueta visible «${name}»`).toBeDefined();
  return element!;
}

function labels() {
  return [...panel().querySelectorAll('.ranking-rules__row h3')].map((element) => element.textContent);
}

function count() {
  return panel().querySelector('[role="status"]')?.textContent;
}

async function search(value: string) {
  const input = control<HTMLInputElement>('Buscar regla');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function select(name: string, value: string) {
  const input = control<HTMLSelectElement>(name);
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function clear() {
  const button = [...panel().querySelectorAll('button')].find((element) => element.textContent?.trim() === 'Limpiar filtros');
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

function note(id: string, at: Date): Note {
  return { id, authorId: member.id, subjectId: 'subject', topic: '', title: `Apunte ${id}`, body: '', tags: [], visibility: 'group', source: 'student', version: 1, createdAt: at, updatedAt: at };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  snapshot = { ...emptySnapshot('ready'), me: member, members: [member] };
  source = { label: 'Prueba', getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as DataSource;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('reglas del ranking', () => {
  it('muestra el catálogo intacto, con controles etiquetados y orden numérico ascendente estable', async () => {
    await mount();
    expect(panel().querySelector('h2')?.textContent).toBe('Reglas del ranking');
    expect(control<HTMLInputElement>('Buscar regla').type).toBe('search');
    expect(control<HTMLInputElement>('Buscar regla').value).toBe('');
    expect(control<HTMLSelectElement>('Orden').value).toBe('asc');
    expect(control<HTMLSelectElement>('Categoría').value).toBe('all');
    expect([...control<HTMLSelectElement>('Puntos').options].map((option) => option.value)).toEqual(['all', '2', '3', '4', '5', '8', '10', '15']);
    expect(count()).toBe('11 de 11 reglas');
    expect(panel().querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(labels()).toEqual(ascending);
    expect([...panel().querySelectorAll('.ranking-rules__points')].map((element) => Number(element.textContent?.match(/\d+/)?.[0]))).toEqual([2, 2, 3, 3, 4, 5, 5, 8, 10, 10, 15]);
    for (const kind of CONTRIBUTION_KINDS) {
      const rule = CONTRIBUTION_RULES[kind];
      const row = [...panel().querySelectorAll('.ranking-rules__row')].find((element) => element.querySelector('h3')?.textContent === rule.label);
      expect(row?.textContent).toContain(rule.rule);
      if (rule.limit) expect(row?.textContent).toContain(rule.limit);
    }
  });

  it('ordena de mayor a menor manteniendo el orden del catálogo cuando hay empate', async () => {
    await mount();
    await select('Orden', 'desc');
    expect(labels()).toEqual(descending);
    await select('Orden', 'asc');
    expect(labels()).toEqual(ascending);
  });

  it('busca sin distinguir acentos o mayúsculas y también consulta explicaciones y límites', async () => {
    await mount();
    await search('GUIA');
    expect(labels()).toEqual(['Fuente procesada', 'Revisión de guía', 'Guía de estudio']);
    expect(count()).toBe('3 de 11 reglas');
    await search('guía');
    expect(labels()).toEqual(['Fuente procesada', 'Revisión de guía', 'Guía de estudio']);
    await search('COMPAÑERO');
    expect(labels()).toEqual(['Respuesta']);
    await search('propio apunte');
    expect(labels()).toEqual(['Propuesta de corrección']);
  });

  it.each([
    ['materiales', ['Fuente procesada', 'Apunte para el grupo', 'Guía de estudio']],
    ['trabajos', ['Página registrada', 'Evidencia de clase', 'Trabajo publicado']],
    ['preguntas', ['Respuesta', 'Respuesta aceptada']],
    ['revision', ['Propuesta de corrección', 'Corrección', 'Revisión de guía']],
  ])('agrupa correctamente la categoría %s', async (category, expected) => {
    await mount();
    await select('Categoría', category as string);
    expect(labels()).toEqual(expected);
  });

  it('combina categoría, puntos y búsqueda por intersección y anuncia el resultado', async () => {
    await mount();
    await select('Categoría', 'revision');
    await select('Puntos', '3');
    await search('PAGINA');
    expect(labels()).toEqual(['Corrección']);
    expect(count()).toBe('1 de 11 reglas');
    await select('Puntos', '5');
    expect(labels()).toEqual([]);
    expect(count()).toBe('0 de 11 reglas');
    expect(panel().textContent).toContain('No hay reglas con estos filtros');
    expect([...panel().querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Limpiar filtros')).toBe(true);
  });

  it.each(['/m/leaderboard', '/m/leaderboard/me'])('conserva las aclaraciones y permite restablecer todos los filtros en %s', async (url) => {
    await mount(url);
    await select('Orden', 'desc');
    await select('Categoría', 'materiales');
    await select('Puntos', '3');
    await search('sin coincidencias');
    expect(labels()).toEqual([]);
    for (const text of [...NOT_SCORED, 'Las copias idénticas', 'Restaurar un aporte', 'Los límites se conservan al cambiar de periodo', 'Son puntos de prueba']) {
      expect(panel().textContent).toContain(text);
    }
    expect(container.textContent).toContain('Reconocimientos');
    await clear();
    expect(control<HTMLInputElement>('Buscar regla').value).toBe('');
    expect(control<HTMLSelectElement>('Orden').value).toBe('asc');
    expect(control<HTMLSelectElement>('Categoría').value).toBe('all');
    expect(control<HTMLSelectElement>('Puntos').value).toBe('all');
    expect(labels()).toEqual(ascending);
    expect(count()).toBe('11 de 11 reglas');
    expect(panel().textContent).not.toContain('No hay reglas con estos filtros');
  });

  it.each(['/m/leaderboard', '/m/leaderboard/me'])('mantiene filtros locales al cambiar de periodo sin alterar la puntuación en %s', async (url) => {
    snapshot.notes = [note('reciente', now), note('anterior', new Date('2026-08-01T12:00:00Z'))];
    const router = await mount(url);
    const score = () => container.querySelector(url.endsWith('/me') ? 'header.contributor p.muted' : '.my-points')?.textContent;
    expect(score()).toContain('8');
    const before = container.querySelector(url.endsWith('/me') ? '.ledger' : '.board')?.textContent;
    await select('Orden', 'desc');
    await select('Categoría', 'materiales');
    await select('Puntos', '8');
    await search('grupo');
    expect(labels()).toEqual(['Apunte para el grupo']);
    expect(container.querySelector(url.endsWith('/me') ? '.ledger' : '.board')?.textContent).toBe(before);
    expect(score()).toContain('8');
    expect(router.state.location.search).toBe('');
    const allTime = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Periodo"] button')].find((button) => button.textContent === 'Todo');
    expect(allTime).toBeDefined();
    await act(async () => allTime!.click());
    expect(router.state.location.search).toBe('?periodo=todo');
    expect(score()).toContain('16');
    expect(control<HTMLInputElement>('Buscar regla').value).toBe('grupo');
    expect(control<HTMLSelectElement>('Orden').value).toBe('desc');
    expect(control<HTMLSelectElement>('Categoría').value).toBe('materiales');
    expect(control<HTMLSelectElement>('Puntos').value).toBe('8');
    expect(labels()).toEqual(['Apunte para el grupo']);
    expect(count()).toBe('1 de 11 reglas');

    await act(async () => root.unmount());
    root = createRoot(container);
    await mount(`${url}?periodo=todo`);
    expect(control<HTMLInputElement>('Buscar regla').value).toBe('');
    expect(control<HTMLSelectElement>('Orden').value).toBe('asc');
    expect(control<HTMLSelectElement>('Categoría').value).toBe('all');
    expect(control<HTMLSelectElement>('Puntos').value).toBe('all');
    expect(labels()).toEqual(ascending);
    expect(score()).toContain('16');
  });
});
