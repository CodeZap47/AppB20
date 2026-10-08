import { describe, expect, it } from 'vitest';
import type { Activity, Evidence, Subject } from '../data/types';
import { filterActivities, groupByMonth, participantsOf } from './activities';

const subjects: Subject[] = [
  { id: 'log', name: 'Lógica de Programación', period: 1 },
  { id: 'poo', name: 'Programación Orientada a Objetos', period: 2 },
];
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
  createdAt: new Date(2026, 9, 1),
  updatedBy: 'ana',
  updatedAt: new Date(2026, 9, 1),
  ...over,
});
const activities = [
  activity('a', '2026-09-28', { topic: 'Diagramas de flujo', termId: 'log-p1' }),
  activity('b', '2026-10-06', { title: 'Práctica de ciclos' }),
  activity('c', '2026-10-02', { subjectId: 'poo' }),
  activity('d', '2026-10-06', { createdAt: new Date(2026, 9, 7) }),
];
const evidence = (id: string, activityId: string, participantIds: string[]): Evidence => ({
  id,
  activityId,
  authorId: participantIds[0] ?? '',
  participantIds,
  content: 'x',
  createdAt: new Date(2026, 9, 6),
});
const evidences = [evidence('e1', 'b', ['ana', 'luis']), evidence('e2', 'b', ['eva', 'luis']), evidence('e3', 'c', ['eva'])];
const ctx = { subjects, evidences, meId: 'eva' };
const all = { query: '', period: 0, subjectId: '', termId: '', mine: false };
const ids = (list: Activity[]) => list.map((a) => a.id);

describe('participantsOf', () => {
  it('junta a quienes aparecen en las evidencias sin repetir', () => {
    expect(participantsOf('b', evidences)).toEqual(['ana', 'luis', 'eva']);
    expect(participantsOf('a', evidences)).toEqual([]);
  });
});

describe('filterActivities', () => {
  it('filtra por cuatrimestre, materia y participación propia', () => {
    expect(ids(filterActivities(activities, { ...all, period: 2 }, ctx))).toEqual(['c']);
    expect(ids(filterActivities(activities, { ...all, subjectId: 'log' }, ctx))).toEqual(['a', 'b', 'd']);
    expect(ids(filterActivities(activities, { ...all, mine: true }, ctx))).toEqual(['b', 'c']);
    expect(ids(filterActivities(activities, { ...all, mine: true }, { ...ctx, meId: undefined }))).toEqual([]);
  });

  it('filtra por parcial, incluidas las que no tienen', () => {
    expect(ids(filterActivities(activities, { ...all, termId: 'log-p1' }, ctx))).toEqual(['a']);
    expect(ids(filterActivities(activities, { ...all, subjectId: 'log', termId: 'ninguno' }, ctx))).toEqual([
      'b',
      'd',
    ]);
  });

  it('busca sin acentos en título, tema y materia', () => {
    expect(ids(filterActivities(activities, { ...all, query: 'practica' }, ctx))).toEqual(['b']);
    expect(ids(filterActivities(activities, { ...all, query: 'diagramas' }, ctx))).toEqual(['a']);
    expect(ids(filterActivities(activities, { ...all, query: 'objetos' }, ctx))).toEqual(['c']);
  });
});

describe('groupByMonth', () => {
  it('ordena de la sesión más reciente a la más antigua y agrupa por mes', () => {
    expect(groupByMonth(activities).map((m) => [m.key, ids(m.activities)])).toEqual([
      ['2026-10', ['d', 'b', 'c']],
      ['2026-09', ['a']],
    ]);
  });
});
