import { describe, expect, it } from 'vitest';
import type { Member, Revision, Work } from '../data/types';
import { authorsLabel, revisionsOf, submittersOf, worksOf } from './works';

const member = (id: string, displayName: string): Member => ({
  id,
  displayName,
  status: 'active',
  isCreator: false,
  joinedAt: new Date(2026, 0, 1),
});
const members = [member('ana', 'Ana López'), member('luis', 'Luis Pérez'), member('eva', 'Eva Ruiz')];
const day = (n: number) => new Date(2026, 9, n);
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
const ids = (list: { id: string }[]) => list.map((item) => item.id);

describe('trabajos de una tarea', () => {
  it('los lista del primero al más reciente y junta a quienes ya subieron', () => {
    expect(ids(worksOf('b', works))).toEqual(['w2', 'w1']);
    expect(submittersOf('b', works)).toEqual(['ana', 'luis', 'eva']);
    expect(submittersOf('a', works)).toEqual([]);
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
