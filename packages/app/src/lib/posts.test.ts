import { describe, expect, it } from 'vitest';
import type { Activity, Assignment, Evidence, Member, Subject, Term, Work } from '../data/types';
import { buildPosts, filterPosts, groupByMonth, groupBySubject } from './posts';

const day = (n: number) => new Date(2026, 9, n);
const members: Member[] = ['ana', 'luis', 'eva'].map((id) => ({
  id,
  displayName: id === 'ana' ? 'Ana López' : id === 'luis' ? 'Luis Pérez' : 'Eva Ruiz',
  status: 'active',
  isCreator: false,
  joinedAt: day(1),
}));
const subjects: Subject[] = [
  { id: 'alg', name: 'Algoritmos', period: 2 },
  { id: 'log', name: 'Lógica', period: 1 },
];
const terms: Term[] = [
  { id: 'log-p1', subjectId: 'log', name: 'Parcial 1', position: 1 },
  { id: 'log-p2', subjectId: 'log', name: 'Parcial 2', position: 2 },
];
const assignment = (id: string, over: Partial<Assignment>): Assignment => ({
  id,
  subjectId: 'log',
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
const activity = (id: string, date: string, over: Partial<Activity> = {}): Activity => ({
  id,
  subjectId: 'log',
  topic: '',
  date,
  title: id,
  objective: '',
  instructions: '',
  version: 1,
  createdBy: 'ana',
  createdAt: day(1),
  updatedBy: 'ana',
  updatedAt: day(1),
  ...over,
});
const works: Work[] = [
  {
    id: 'w1',
    assignmentId: 'tarea',
    title: '',
    description: 'Recorrido en anchura',
    version: 1,
    authorIds: ['luis'],
    createdAt: day(6),
    updatedAt: day(6),
  },
];
const evidences: Evidence[] = [
  { id: 'e1', activityId: 'clase', authorId: 'eva', participantIds: ['eva', 'ana'], content: 'Diagrama', createdAt: day(7) },
];
const posts = buildPosts({
  assignments: [
    assignment('tarea', { termId: 'log-p2', dueDate: '2026-10-12' }),
    assignment('examen', { subjectId: 'alg', kind: 'examen' }),
  ],
  works,
  activities: [
    activity('clase', '2026-10-07', { termId: 'log-p2', topic: 'Ciclos' }),
    activity('vieja', '2026-09-20', { termId: 'log-p1' }),
  ],
  evidences,
  members,
});
const ctx = { subjects, terms };
const all = { query: '', kindGroup: '' as const, period: 0, subjectId: '', termId: '', personId: '' };
const keys = (list: { key: string }[]) => list.map((p) => p.key);

describe('buildPosts', () => {
  it('junta tareas y actividades de clase con quién subió y cuánto', () => {
    expect(posts.map((p) => [p.key, p.label, p.count, p.people])).toEqual([
      ['t:tarea', 'Tarea', 1, ['luis']],
      ['t:examen', 'Examen', 0, []],
      ['a:clase', 'Actividad de clase', 1, ['eva', 'ana']],
      ['a:vieja', 'Actividad de clase', 0, []],
    ]);
  });

  it('ubica cada una en un día: la sesión, la entrega o su creación', () => {
    expect(posts.map((p) => p.day)).toEqual(['2026-10-12', '2026-10-01', '2026-10-07', '2026-09-20']);
  });
});

describe('filterPosts', () => {
  it('filtra los dos tipos por materia, parcial, cuatrimestre y familia', () => {
    expect(keys(filterPosts(posts, { ...all, subjectId: 'log', termId: 'log-p2' }, ctx))).toEqual([
      't:tarea',
      'a:clase',
    ]);
    expect(keys(filterPosts(posts, { ...all, period: 2 }, ctx))).toEqual(['t:examen']);
    expect(keys(filterPosts(posts, { ...all, kindGroup: 'exposiciones-examenes' }, ctx))).toEqual(['t:examen']);
    expect(keys(filterPosts(posts, { ...all, kindGroup: 'tareas-actividades' }, ctx))).toEqual([
      't:tarea',
      'a:clase',
      'a:vieja',
    ]);
  });

  it('con una persona, deja donde subió trabajo o aparece en una evidencia', () => {
    expect(keys(filterPosts(posts, { ...all, personId: 'luis' }, ctx))).toEqual(['t:tarea']);
    expect(keys(filterPosts(posts, { ...all, personId: 'ana' }, ctx))).toEqual(['a:clase']);
  });

  it('busca en el tema, en los trabajos y en las evidencias', () => {
    expect(keys(filterPosts(posts, { ...all, query: 'ciclos' }, ctx))).toEqual(['a:clase']);
    expect(keys(filterPosts(posts, { ...all, query: 'anchura' }, ctx))).toEqual(['t:tarea']);
    expect(keys(filterPosts(posts, { ...all, query: 'diagrama' }, ctx))).toEqual(['a:clase']);
    expect(keys(filterPosts(posts, { ...all, query: 'actividad de clase' }, ctx))).toEqual(['a:clase', 'a:vieja']);
  });
});

describe('las dos vistas', () => {
  it('por materia: cuatrimestre, materia y parcial, mezclando los dos tipos', () => {
    const sections = groupBySubject(posts, subjects, terms);
    expect(sections.map((s) => [s.subject.name, s.count])).toEqual([
      ['Lógica', 3],
      ['Algoritmos', 1],
    ]);
    expect(sections[0]?.groups.map((g) => [g.name, keys(g.posts)])).toEqual([
      ['Parcial 1', ['a:vieja']],
      ['Parcial 2', ['a:clase', 't:tarea']],
    ]);
  });

  it('por fecha: del día más reciente al más antiguo, por mes', () => {
    expect(groupByMonth(posts).map((m) => [m.key, keys(m.posts)])).toEqual([
      ['2026-10', ['t:tarea', 'a:clase', 't:examen']],
      ['2026-09', ['a:vieja']],
    ]);
  });
});
