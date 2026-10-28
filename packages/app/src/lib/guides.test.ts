import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { GuideSource, Snapshot, StudyGuide } from '../data/types';
import { candidateSources, guideScopeLabel, guideStatus, isOutdated } from './guides';

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
  it('mantiene cobertura de otros parciales cuando su procedencia confirma la selección disponible', () => {
    const data = fixture(); data.assignments[0]!.termId = 'p2';
    data.guideAiSourceAvailability = [{ sourceId: source.id, guideId: guide.id, guideVersion: guide.version, available: true, outdated: false, reason: '' }];
    expect(guideStatus(guide, data)).toMatchObject({ covered: 1, processed: 1, pending: 0 });
    data.guideAiSourceAvailability[0]!.available = false;
    expect(guideStatus(guide, data)).toMatchObject({ covered: 0, pending: 1 });
  });
  it('una guía cuatrimestral propone material de varios parciales y deja sin clasificar para revisión expresa', () => {
    const data = fixture();
    data.assignments.push({ ...data.assignments[0]!, id: 't2', termId: 'p2', title: 'Segundo parcial' },
      { ...data.assignments[0]!, id: 't3', termId: undefined, title: 'Sin clasificar' });
    const sources = candidateSources('s1', undefined, data);
    expect(sources.matched.filter((item) => item.kind === 'tarea').map((item) => item.refId)).toEqual(['t1', 't2']);
    expect(sources.unplaced.map((item) => item.refId)).toEqual(['t3']);
    expect(candidateSources('s1', 'p1', data).matched.some((item) => item.refId === 't2')).toBe(false);
    expect(guideScopeLabel({ termId: undefined }, data)).toBe('Cuatrimestre completo');
    expect(guideScopeLabel({ termId: 'unknown' }, data)).toBe('Parcial');
  });

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

  it('una actividad visible deja de cubrir cuando solo se citó una evidencia que ya no está disponible', () => {
    const data = fixture();
    data.activities = [{ id: 'activity', subjectId: 's1', termId: 'p1', topic: 'Ciclos', date: '', title: 'Actividad visible', objective: '', instructions: '',
      version: 3, createdBy: 'a', createdAt: at, updatedBy: 'a', updatedAt: at }];
    data.guideSources = [{ ...source, kind: 'actividad', refId: 'activity', sourceVersion: 3 }];
    data.guideAiSourceAvailability = [{ sourceId: source.id, guideId: guide.id, guideVersion: guide.version,
      available: false, outdated: false, reason: 'La evidencia citada fue retirada del grupo.' }];
    const status = guideStatus(guide, data);
    expect(status).toMatchObject({ covered: 0, processed: 0, pending: 1, missing: 1 });
    expect(status.sources[0]?.info?.title).toBe('Actividad visible');
    expect(status.sources[0]?.source.reason).toBe('La evidencia citada fue retirada del grupo.');
    expect(data.guideSources[0]?.status).toBe('processed');
  });

  it('conserva la cobertura citada histórica y avisa de cambios en evidencia, respuesta o archivo sin alterar el padre', () => {
    const data = fixture();
    data.guideAiSourceAvailability = [{ sourceId: source.id, guideId: guide.id, guideVersion: guide.version,
      available: true, outdated: true, reason: 'El material tiene cambios posteriores a la versión citada.' }];
    const status = guideStatus(guide, data);
    expect(status).toMatchObject({ covered: 1, processed: 1, pending: 0, missing: 0, outdated: 1 });
    expect(status.sources[0]?.info?.version).toBe(source.sourceVersion);
    expect(isOutdated(status.sources[0]!.source, status.sources[0]?.info)).toBe(true);
    expect(source.sourceVersion).toBe(1);
  });

  it('ignora disponibilidad de otra versión y nunca convierte texto preparado sin citar en cobertura', () => {
    const data = fixture();
    data.guideAiSourceAvailability = [{ sourceId: source.id, guideId: guide.id, guideVersion: guide.version + 1,
      available: false, outdated: true, reason: 'Otra versión.' }];
    expect(guideStatus(guide, data)).toMatchObject({ covered: 1, missing: 0, outdated: 0 });
    data.guideSources = [{ ...source, status: 'pending', reason: 'Preparada, pero no citada en esta versión.' }];
    data.guideAiSourceAvailability[0] = { ...data.guideAiSourceAvailability[0]!, guideVersion: guide.version, available: true, outdated: false };
    expect(guideStatus(guide, data)).toMatchObject({ covered: 0, processed: 0, pending: 1 });
  });

  it('retirar disponibilidad no oculta la guía, sus revisiones ni la versión histórica citada', () => {
    const data = fixture();
    data.guideReviews = [{ id: 'review', guideId: guide.id, guideVersion: guide.version, reviewerId: 'b', verdict: 'approved', comment: 'Leída.', createdAt: at }];
    data.guideAiSourceAvailability = [{ sourceId: source.id, guideId: guide.id, guideVersion: guide.version,
      available: false, outdated: true, reason: 'La fuente ya no es compartida.' }];
    const status = guideStatus(guide, data);
    expect(status).toMatchObject({ covered: 0, approvals: 1, outdated: 1 });
    expect(status.sources[0]?.source.sourceVersion).toBe(source.sourceVersion);
    expect(data.guides).toEqual([guide]); expect(data.guideReviews).toHaveLength(1);
  });
});
