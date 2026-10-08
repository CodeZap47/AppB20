import { describe, expect, it } from 'vitest';
import type { Member, Subject, Term, Work } from '../data/types';
import { authorsLabel, filterWorks, groupWorks, NO_TERM } from './works';

const member = (id: string, displayName: string): Member => ({
  id,
  displayName,
  status: 'active',
  isCreator: false,
  joinedAt: new Date(2026, 0, 1),
});
const members = [member('ana', 'Ana López'), member('luis', 'Luis Pérez'), member('eva', 'Eva Ruiz')];
const subjects: Subject[] = [
  { id: 'red', name: 'Redes', period: 2 },
  { id: 'alg', name: 'Algoritmos', period: 2 },
  { id: 'log', name: 'Lógica', period: 1 },
];
const terms: Term[] = [
  { id: 'p2', subjectId: 'alg', name: 'Parcial 2', position: 2 },
  { id: 'p1', subjectId: 'alg', name: 'Parcial 1', position: 1 },
];
const work = (id: string, over: Partial<Work>): Work => ({
  id,
  subjectId: 'alg',
  kind: 'tarea',
  title: id,
  assignment: '',
  description: '',
  version: 1,
  authorIds: ['ana'],
  createdAt: new Date(2026, 9, 1),
  updatedAt: new Date(2026, 9, 1),
  ...over,
});
const works = [
  work('a', { termId: 'p1', title: 'Árbol binario', updatedAt: new Date(2026, 9, 2) }),
  work('b', { termId: 'p1', authorIds: ['luis', 'eva'], updatedAt: new Date(2026, 9, 5) }),
  work('c', { termId: 'p2', kind: 'examen' }),
  work('d', {}),
  work('e', { subjectId: 'red', assignment: 'Configurar una subred', kind: 'exposicion' }),
  work('f', { subjectId: 'log', kind: 'actividad' }),
];
const ctx = { subjects, terms, members };
const all = { query: '', kindGroup: '' as const, period: 0, subjectId: '', termId: '', authorId: '' };
const ids = (list: Work[]) => list.map((w) => w.id);

describe('filterWorks', () => {
  it('filtra por materia, parcial y autor', () => {
    expect(ids(filterWorks(works, { ...all, subjectId: 'alg', termId: 'p1' }, ctx))).toEqual(['a', 'b']);
    expect(ids(filterWorks(works, { ...all, subjectId: 'alg', termId: NO_TERM }, ctx))).toEqual(['d']);
    expect(ids(filterWorks(works, { ...all, authorId: 'eva' }, ctx))).toEqual(['b']);
  });

  it('separa tareas y actividades de exposiciones y exámenes', () => {
    expect(ids(filterWorks(works, { ...all, kindGroup: 'tareas-actividades' }, ctx))).toEqual([
      'a',
      'b',
      'd',
      'f',
    ]);
    expect(ids(filterWorks(works, { ...all, kindGroup: 'exposiciones-examenes' }, ctx))).toEqual(['c', 'e']);
  });

  it('filtra por cuatrimestre de la materia', () => {
    expect(ids(filterWorks(works, { ...all, period: 1 }, ctx))).toEqual(['f']);
    expect(ids(filterWorks(works, { ...all, period: 2 }, ctx))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('busca sin acentos en título, consigna, materia y autores', () => {
    expect(ids(filterWorks(works, { ...all, query: 'arbol' }, ctx))).toEqual(['a']);
    expect(ids(filterWorks(works, { ...all, query: 'subred' }, ctx))).toEqual(['e']);
    expect(ids(filterWorks(works, { ...all, query: 'redes' }, ctx))).toEqual(['e']);
    expect(ids(filterWorks(works, { ...all, query: 'luis perez' }, ctx))).toEqual(['b']);
  });

  it('busca también por el nombre de los archivos adjuntos', () => {
    const files = [
      {
        id: 'f',
        workId: 'c',
        name: 'diagrama-final.png',
        size: 1024,
        contentType: 'image/png',
        uploadedBy: 'ana',
        createdAt: new Date(2026, 9, 1),
      },
    ];
    expect(ids(filterWorks(works, { ...all, query: 'diagrama' }, { ...ctx, files }))).toEqual(['c']);
  });
});

describe('groupWorks', () => {
  it('ordena materias por cuatrimestre y nombre, parciales por posición y trabajos por fecha', () => {
    const sections = groupWorks(works, subjects, terms);
    expect(sections.map((s) => [s.subject.name, s.count])).toEqual([
      ['Lógica', 1],
      ['Algoritmos', 4],
      ['Redes', 1],
    ]);
    expect(sections[1]?.groups.map((g) => [g.name, ids(g.works)])).toEqual([
      ['Parcial 1', ['b', 'a']],
      ['Parcial 2', ['c']],
      ['Sin parcial', ['d']],
    ]);
  });

  it('omite las materias sin trabajos', () => {
    expect(groupWorks(works.slice(0, 1), subjects, terms).map((s) => s.subject.id)).toEqual(['alg']);
  });
});

describe('authorsLabel', () => {
  it('pone primero a quien mira y resume a partir de tres autores', () => {
    expect(authorsLabel(['ana'], members)).toBe('Ana López');
    expect(authorsLabel(['ana', 'luis'], members, 'luis')).toBe('Tú y Ana López');
    expect(authorsLabel(['ana', 'luis', 'eva'], members)).toBe('Ana López y 2 más');
  });
});
