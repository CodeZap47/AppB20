import { describe, expect, it } from 'vitest';
import type { Assignment, Member, Revision, Subject, Term, Work } from '../data/types';
import {
  authorsLabel,
  filterAssignments,
  groupAssignments,
  NO_TERM,
  revisionsOf,
  sortRecent,
  submittersOf,
  worksOf,
} from './works';

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
const day = (n: number) => new Date(2026, 9, n);
const assignment = (id: string, over: Partial<Assignment>): Assignment => ({
  id,
  subjectId: 'alg',
  kind: 'tarea',
  title: id,
  instructions: '',
  version: 1,
  createdBy: 'ana',
  createdAt: day(1),
  updatedBy: 'ana',
  updatedAt: day(1),
  ...over,
});
const assignments = [
  assignment('a', { termId: 'p1', title: 'Árbol binario', updatedAt: day(2) }),
  assignment('b', { termId: 'p1' }),
  assignment('c', { termId: 'p2', kind: 'examen' }),
  assignment('d', {}),
  assignment('e', { subjectId: 'red', instructions: 'Configurar una subred', kind: 'exposicion' }),
  assignment('f', { subjectId: 'log', kind: 'actividad' }),
];
const work = (id: string, assignmentId: string, authorIds: string[], over: Partial<Work> = {}): Work => ({
  id,
  assignmentId,
  title: '',
  description: '',
  version: 1,
  authorIds,
  createdAt: day(3),
  updatedAt: day(3),
  ...over,
});
const works = [
  work('w1', 'b', ['luis', 'eva'], { createdAt: day(4), updatedAt: day(5) }),
  work('w2', 'b', ['ana'], { description: 'Recorrido en anchura' }),
  work('w3', 'c', ['eva']),
];
const ctx = { subjects, terms, members, works };
const all = { query: '', kindGroup: '' as const, period: 0, subjectId: '', termId: '', authorId: '' };
const ids = (list: { id: string }[]) => list.map((item) => item.id);

describe('trabajos de una tarea', () => {
  it('los lista del primero al más reciente y junta a quienes ya subieron', () => {
    expect(ids(worksOf('b', works))).toEqual(['w2', 'w1']);
    expect(submittersOf('b', works)).toEqual(['ana', 'luis', 'eva']);
    expect(submittersOf('a', works)).toEqual([]);
  });
});

describe('filterAssignments', () => {
  it('filtra por materia y parcial', () => {
    expect(ids(filterAssignments(assignments, { ...all, subjectId: 'alg', termId: 'p1' }, ctx))).toEqual(['a', 'b']);
    expect(ids(filterAssignments(assignments, { ...all, subjectId: 'alg', termId: NO_TERM }, ctx))).toEqual(['d']);
  });

  it('separa tareas y actividades de exposiciones y exámenes', () => {
    expect(ids(filterAssignments(assignments, { ...all, kindGroup: 'tareas-actividades' }, ctx))).toEqual([
      'a',
      'b',
      'd',
      'f',
    ]);
    expect(ids(filterAssignments(assignments, { ...all, kindGroup: 'exposiciones-examenes' }, ctx))).toEqual([
      'c',
      'e',
    ]);
  });

  it('filtra por cuatrimestre de la materia', () => {
    expect(ids(filterAssignments(assignments, { ...all, period: 1 }, ctx))).toEqual(['f']);
    expect(ids(filterAssignments(assignments, { ...all, period: 2 }, ctx))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('con un autor, deja solo las tareas donde subió un trabajo', () => {
    expect(ids(filterAssignments(assignments, { ...all, authorId: 'eva' }, ctx))).toEqual(['b', 'c']);
  });

  it('busca sin acentos en la tarea, su materia y los trabajos subidos', () => {
    expect(ids(filterAssignments(assignments, { ...all, query: 'arbol' }, ctx))).toEqual(['a']);
    expect(ids(filterAssignments(assignments, { ...all, query: 'subred' }, ctx))).toEqual(['e']);
    expect(ids(filterAssignments(assignments, { ...all, query: 'redes' }, ctx))).toEqual(['e']);
    expect(ids(filterAssignments(assignments, { ...all, query: 'anchura' }, ctx))).toEqual(['b']);
    expect(ids(filterAssignments(assignments, { ...all, query: 'luis perez' }, ctx))).toEqual(['b']);
  });

  it('busca también por el nombre de los archivos adjuntos', () => {
    const files = [
      {
        id: 'f',
        workId: 'w3',
        name: 'diagrama-final.png',
        size: 1024,
        contentType: 'image/png',
        uploadedBy: 'eva',
        createdAt: day(3),
      },
    ];
    expect(ids(filterAssignments(assignments, { ...all, query: 'diagrama' }, { ...ctx, files }))).toEqual(['c']);
  });
});

describe('orden del archivo', () => {
  it('lo reciente considera la última edición y el último trabajo subido', () => {
    expect(ids(sortRecent(assignments, works)).slice(0, 3)).toEqual(['b', 'c', 'a']);
  });

  it('agrupa por cuatrimestre y materia, y dentro por parcial', () => {
    const sections = groupAssignments(assignments, works, subjects, terms);
    expect(sections.map((s) => [s.subject.name, s.count])).toEqual([
      ['Lógica', 1],
      ['Algoritmos', 4],
      ['Redes', 1],
    ]);
    expect(sections[1]?.groups.map((g) => [g.name, ids(g.assignments)])).toEqual([
      ['Parcial 1', ['b', 'a']],
      ['Parcial 2', ['c']],
      ['Sin parcial', ['d']],
    ]);
  });
});

describe('revisionsOf', () => {
  it('da el historial de una página, de la versión más reciente a la primera', () => {
    const revision = (id: string, page: Revision['page'], pageId: string, version: number): Revision => ({
      id,
      page,
      pageId,
      version,
      editedBy: 'ana',
      editedAt: day(version),
      title: '',
      summary: '',
      body: '',
    });
    const revisions = [
      revision('r1', 'assignment', 'a', 1),
      revision('r2', 'activity', 'a', 1),
      revision('r3', 'assignment', 'a', 2),
      revision('r4', 'assignment', 'b', 1),
    ];
    expect(ids(revisionsOf('assignment', 'a', revisions))).toEqual(['r3', 'r1']);
  });
});

describe('authorsLabel', () => {
  it('pone primero a quien mira y resume a partir de tres autores', () => {
    expect(authorsLabel(['ana'], members)).toBe('Ana López');
    expect(authorsLabel(['ana', 'luis'], members, 'luis')).toBe('Tú y Ana López');
    expect(authorsLabel(['ana', 'luis', 'eva'], members)).toBe('Ana López y 2 más');
  });
});
