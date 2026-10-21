import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { GuideSource, Snapshot, StudyGuide } from '../data/types';
import { candidateSources, guideStatus } from './guides';

const at = new Date('2026-10-20T12:00:00Z');
const guide: StudyGuide = { id: 'g1', subjectId: 's1', termId: 'p1', title: 'Guía', topics: ['Ciclos'],
  sections: [], version: 1, createdBy: 'a', createdAt: at, updatedBy: 'a', updatedAt: at };
const source: GuideSource = { id: 'src1', guideId: 'g1', kind: 'trabajo', refId: 'w1', sourceVersion: 1,
  status: 'processed', reason: '', topics: ['Ciclos'], addedBy: 'a', addedAt: at };

function fixture(): Snapshot {
  return { ...emptySnapshot('ready'), guides: [guide], guideSources: [source],
    assignments: [{ id: 't1', subjectId: 's1', termId: 'p1', kind: 'tarea', title: 'Consigna', instructions: '',
      version: 1, createdBy: 'a', createdAt: at, updatedBy: 'a', updatedAt: at }],
    works: [{ id: 'w1', assignmentId: 't1', title: 'Ciclos', description: 'Ejemplo', version: 1,
      authorIds: ['a'], createdAt: at, updatedAt: at }],
  };
}

describe('vigencia de fuentes de una guía', () => {
  it('reclasificar la consigna fuera de materia invalida cobertura sin cambiar la versión del trabajo', () => {
    const data = fixture();
    data.assignments = data.assignments.map((row) => ({ ...row, subjectId: 's2', termId: 'p2', version: 2 }));
    const status = guideStatus(guide, data);
    expect(data.works[0]?.version).toBe(1);
    expect(status).toMatchObject({ covered: 0, processed: 0, pending: 1, outdated: 1, missing: 0 });
    expect(status.coverage).toEqual([{ topic: 'Ciclos', processed: 0, pending: 1 }]);
    expect(status.sources[0]?.source).toMatchObject({ id: 'src1', refId: 'w1', sourceVersion: 1, status: 'pending' });
    expect(status.sources[0]?.source.reason).toContain('otra materia');
    expect(status.sources[0]?.info).toMatchObject({ subjectId: 's2', version: 1, link: '/m/tareas/t1?trabajo=w1' });
    expect(data.guideSources[0]).toBe(source);
    expect(source).toMatchObject({ status: 'processed', reason: '' });
    expect(candidateSources('s1', 'p1', data).matched).toEqual([]);
  });

  it('reclasificar fuera del parcial también muestra la razón pendiente en el índice de fuentes', () => {
    const data = fixture();
    data.assignments = data.assignments.map((row) => ({ ...row, termId: 'p2' }));
    const status = guideStatus(guide, data);
    expect(status.sources[0]?.source).toMatchObject({ status: 'pending', topics: ['Ciclos'] });
    expect(status.sources[0]?.source.reason).toContain('otro parcial');
    expect(status).toMatchObject({ covered: 0, pending: 1, outdated: 1 });
  });

  it('respeta las fuentes sin parcial elegidas manualmente y las guías sin parcial', () => {
    const data = fixture();
    data.assignments = data.assignments.map((row) => ({ ...row, termId: undefined }));
    expect(guideStatus(guide, data)).toMatchObject({ covered: 1, processed: 1, pending: 0, outdated: 0 });
    expect(candidateSources('s1', 'p1', data).unplaced.some((item) => item.refId === 'w1')).toBe(true);
    data.assignments = data.assignments.map((row) => ({ ...row, termId: 'p2' }));
    expect(guideStatus({ ...guide, termId: undefined }, data)).toMatchObject({ covered: 1, processed: 1, pending: 0 });
  });

  it('volver a la clasificación de la guía recupera la lectura sin escribir en las fuentes', () => {
    const data = fixture();
    data.assignments = data.assignments.map((row) => ({ ...row, termId: 'p2' }));
    expect(guideStatus(guide, data).covered).toBe(0);
    data.assignments = data.assignments.map((row) => ({ ...row, termId: 'p1' }));
    expect(guideStatus(guide, data)).toMatchObject({ covered: 1, processed: 1, pending: 0, outdated: 0 });
    expect(data.guideSources[0]).toBe(source);
  });

  it('tampoco cuenta material que ya no está disponible y conserva la referencia original', () => {
    const data = fixture();
    data.works = [];
    const status = guideStatus(guide, data);
    expect(status).toMatchObject({ covered: 0, processed: 0, pending: 1, missing: 1 });
    expect(status.sources[0]?.source).toMatchObject({ id: source.id, refId: source.refId, status: 'pending' });
    expect(status.sources[0]?.source.reason).toContain('no está disponible');
    expect(source.status).toBe('processed');
  });

  it('un recurso retirado no aporta cobertura aunque su autor todavía pueda verlo, y restaurarlo recupera la referencia', () => {
    const data = fixture();
    data.works = data.works.map((work) => ({ ...work, withdrawnAt: at }));
    expect(guideStatus(guide, data)).toMatchObject({ covered: 0, processed: 0, pending: 1, missing: 1 });
    expect(candidateSources('s1', 'p1', data).matched.some((item) => item.kind === 'trabajo')).toBe(false);
    data.works = data.works.map((work) => ({ ...work, withdrawnAt: undefined }));
    expect(guideStatus(guide, data)).toMatchObject({ covered: 1, processed: 1, pending: 0 });
    expect(data.guideSources[0]).toBe(source);
  });

  it('propone las notas compartidas del parcial y excluye las retiradas', () => {
    const data = fixture();
    data.notes = [{ id: 'note', subjectId: 's1', termId: 'p1', session: '2026-10-21', title: 'Apunte', body: 'Contenido', topic: 'Tema', tags: [], visibility: 'group', source: 'student', authorId: 'a', version: 2, createdAt: at, updatedAt: at }];
    expect(candidateSources('s1', 'p1', data).matched.some((item) => item.kind === 'nota' && item.refId === 'note')).toBe(true);
    data.notes = data.notes.map((note) => ({ ...note, withdrawnAt: at }));
    expect(candidateSources('s1', 'p1', data).matched.some((item) => item.kind === 'nota')).toBe(false);
  });
});
