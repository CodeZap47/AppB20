// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import type { Note } from '../data/types';
import { NotesPage } from './NotesPage';

let root: Root;
let container: HTMLDivElement;
let source: DemoDataSource;
let state: ReturnType<typeof createDemoState>;
let subjectA: string;
let subjectB: string;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  state = createDemoState();
  subjectA = state.subjects[0]!.id;
  subjectB = state.subjects[1]!.id;
  state.members.find((member) => member.id === 'demo-2')!.displayName = 'Elena García';
  const base = state.notes[0]!;
  const note = (values: Partial<Note> & Pick<Note, 'id' | 'title'>): Note => ({
    ...base, subjectId: subjectA, topic: 'Matrices', body: 'Operaciones y determinantes.',
    tags: ['repaso'], authorId: 'demo-1', updatedAt: new Date('2026-10-22T12:00:00Z'), ...values,
  });
  state.notes = [
    note({ id: 'own-group', title: 'Matrices compartidas', session: '2026-10-20' }),
    note({ id: 'teacher', title: 'Material del docente', authorId: 'demo-2', source: 'teacher',
      body: 'Matrices y ejemplos resueltos.', tags: [], updatedAt: new Date('2026-10-23T12:00:00Z') }),
    note({ id: 'own-personal', title: 'Mi apunte de matrices', visibility: 'personal',
      updatedAt: new Date('2026-10-24T12:00:00Z') }),
    note({ id: 'other-subject', title: 'Matrices en código', subjectId: subjectB, authorId: 'demo-2',
      updatedAt: new Date('2026-10-21T12:00:00Z') }),
    note({ id: 'foreign-personal', title: 'Secreto ajeno', subjectId: subjectB,
      authorId: 'demo-2', visibility: 'personal' }),
    note({ id: 'withdrawn', title: 'Matrices desactualizadas' }),
  ];
  source = new DemoDataSource(state, 'demo-1');
  source.withdrawContent('note', 'withdrawn', true, 1);
});

afterEach(async () => {
  await act(async () => root.unmount());
  source.dispose();
  container.remove();
});

function Location() {
  return <output data-location>{useLocation().search}</output>;
}

async function show(search = '') {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/m/notas${search}`]}>
      <DataProvider source={source}><NotesPage /><Location /></DataProvider>
    </MemoryRouter>,
  ));
}

function params() {
  return new URLSearchParams(container.querySelector('[data-location]')!.textContent!);
}

function noteIds() {
  return [...container.querySelectorAll<HTMLAnchorElement>('li a[href^="/m/notas/"]')]
    .map((link) => link.getAttribute('href')!.split('/').at(-1));
}

function filter(group: 'Vista' | 'Materia', label: string) {
  const buttons = container.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${group}"] button`);
  const button = [...buttons].find((item) => {
    const text = item.textContent!.replace(/\s+/g, ' ').trim();
    return text === label || text.startsWith(`${label} `);
  });
  expect(button, `${group}: ${label}`).toBeTruthy();
  return button!;
}

async function click(button: HTMLButtonElement) {
  await act(async () => button.click());
}

async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Buscar notas"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('biblioteca de notas de clase', () => {
  it('combina la URL con conteos cruzados y conserva la materia al crear una nota', async () => {
    await show(`?q=matrices&vista=grupo&materia=${encodeURIComponent(subjectA)}`);
    expect(noteIds()).toEqual(['teacher', 'own-group']);
    expect(filter('Vista', 'Todas').textContent).toMatch(/Todas\s*3/);
    expect(filter('Vista', 'Del grupo').textContent).toMatch(/Del grupo\s*2/);
    expect(filter('Vista', 'Personales').textContent).toMatch(/Personales\s*1/);
    expect(filter('Vista', 'Mis notas').textContent).toMatch(/Mis notas\s*2/);
    expect(filter('Vista', 'Retiradas').textContent).toMatch(/Retiradas\s*1/);
    expect(filter('Vista', 'Del grupo').getAttribute('aria-pressed')).toBe('true');
    expect(filter('Materia', state.subjects[0]!.name).textContent).toMatch(/2\s*$/);
    expect(filter('Materia', state.subjects[1]!.name).textContent).toMatch(/1\s*$/);
    expect(container.querySelector('a[href^="/m/notas/nueva"]')?.getAttribute('href'))
      .toBe(`/m/notas/nueva?materia=${encodeURIComponent(subjectA)}`);

    await click(filter('Vista', 'Personales'));
    expect(noteIds()).toEqual(['own-personal']);
    expect(params().get('q')).toBe('matrices');
    expect(params().get('materia')).toBe(subjectA);
    expect(params().get('vista')).toBe('personales');
    expect(filter('Vista', 'Personales').getAttribute('aria-pressed')).toBe('true');
    expect(filter('Vista', 'Del grupo').getAttribute('aria-pressed')).toBe('false');
  });

  it('busca por contenido y autor sin acentos y permite limpiar todos los filtros', async () => {
    await show(`?vista=grupo&materia=${encodeURIComponent(subjectA)}`);
    await search('garcia ejemplos');
    expect(noteIds()).toEqual(['teacher']);
    expect(params().get('q')).toBe('garcia ejemplos');
    expect(params().get('vista')).toBe('grupo');
    expect(params().get('materia')).toBe(subjectA);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('1 nota');

    const clear = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Limpiar filtros')!;
    await click(clear);
    expect(params().toString()).toBe('');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Buscar notas"]')?.value).toBe('');
    expect(filter('Vista', 'Todas').getAttribute('aria-pressed')).toBe('true');
    expect(filter('Materia', 'Todas las materias').getAttribute('aria-pressed')).toBe('true');
    expect(noteIds()).toEqual(['own-personal', 'teacher', 'own-group', 'other-subject']);
  });

  it('ordena por actualización y separa notas propias, privadas ajenas y retiradas', async () => {
    await show();
    expect(noteIds()).toEqual(['own-personal', 'teacher', 'own-group', 'other-subject']);
    expect(container.textContent).not.toContain('Secreto ajeno');
    expect(container.textContent).not.toContain('Matrices desactualizadas');
    await click(filter('Vista', 'Mis notas'));
    expect(noteIds()).toEqual(['own-personal', 'own-group']);
    await click(filter('Vista', 'Retiradas'));
    expect(noteIds()).toEqual(['withdrawn']);
    expect(filter('Vista', 'Retiradas').getAttribute('aria-pressed')).toBe('true');
  });

  it('cambia la materia sin perder la búsqueda ni la vista elegida', async () => {
    await show('?q=matrices&vista=grupo');
    await click(filter('Materia', state.subjects[1]!.name));
    expect(noteIds()).toEqual(['other-subject']);
    expect(params().get('q')).toBe('matrices');
    expect(params().get('vista')).toBe('grupo');
    expect(params().get('materia')).toBe(subjectB);
    expect(filter('Materia', state.subjects[1]!.name).getAttribute('aria-pressed')).toBe('true');
  });

  it('muestra un resultado vacío con opción para corregir los filtros', async () => {
    await show('?q=imposible');
    expect(noteIds()).toEqual([]);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('0 notas');
    expect(container.textContent).toContain('Prueba con otras palabras o quita algún filtro.');
    expect([...container.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Limpiar filtros')).toBe(true);
  });

  it('invita a escribir la primera nota cuando la biblioteca está vacía', async () => {
    source.dispose();
    state.notes = [];
    source = new DemoDataSource(state, 'demo-1');
    await show();
    expect(container.textContent).toContain('Todavía no hay notas');
    expect([...container.querySelectorAll<HTMLAnchorElement>('a')]
      .find((link) => link.textContent?.trim() === 'Escribir la primera')?.getAttribute('href')).toBe('/m/notas/nueva');
    expect(container.querySelector('input[aria-label="Buscar notas"]')).toBeNull();
  });
});
