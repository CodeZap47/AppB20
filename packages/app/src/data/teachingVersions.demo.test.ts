import { EMPTY_TEACHING_EXPLANATION } from '@b20/core';
import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import type { SaveTeachingPracticeInput } from './types';

const now = new Date('2026-10-21T17:00:00Z');
const initial = { concept: 'Concepto inicial', example: 'Ejemplo inicial', limits: 'Límites iniciales' };
const revised = { concept: 'Concepto revisado', example: 'Ejemplo revisado', limits: 'Límites revisados' };
const input = { initial, revised, reflection: 'Reflexión reservada de esta revisión versionada', topicsToReview: 'Pendientes privados' };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup() {
  const state = createDemoState(now);
  const owner = new DemoDataSource(state, 'demo-2', () => new Date(now));
  const other = new DemoDataSource(state, 'demo-2', () => new Date(now));
  const reviewer = new DemoDataSource(state, 'demo-3', () => new Date(now));
  const admin = new DemoDataSource(state, 'demo-1', () => new Date(now));
  const id = owner.createTeachingPractice({ subjectId: 'IDSE-05010103', topic: 'Condiciones', initial });
  const save = (body: SaveTeachingPracticeInput, request: number, expectedVersion = owner.getSnapshot().teachingPractices.find((row) => row.id === id)!.version!) =>
    owner.saveTeachingPractice(id, { ...body, expectedVersion, requestId: uuid(request) });
  const dispose = () => [owner, other, reviewer, admin].forEach((data) => data.dispose());
  return { state, owner, other, reviewer, admin, id, save, dispose };
}

describe('Versiones privadas de Aprende enseñando en la demo', () => {
  it('comparte la versión entre sesiones y rechaza una pestaña antigua sin perder borradores previos', () => {
    const { owner, other, id, save, dispose } = setup();
    try {
      expect(other.getSnapshot().teachingPractices.find((row) => row.id === id)?.version).toBe(1);
      expect(save(input, 1, 1)).toBe(2);
      expect(other.getSnapshot().teachingPractices.find((row) => row.id === id)?.version).toBe(2);
      expect(() => other.saveTeachingPractice(id, { ...input, reflection: 'Edición obsoleta', expectedVersion: 1, requestId: uuid(2) })).toThrow('cambió');
      expect(owner.getTeachingHistory(id).map((row) => ({ version: row.version, reflection: row.reflection }))).toEqual([
        { version: 2, reflection: input.reflection }, { version: 1, reflection: '' },
      ]);
      expect(owner.getTeachingHistory(id)[1]!.revised).toEqual(EMPTY_TEACHING_EXPLANATION);
    } finally { dispose(); }
  });

  it('recupera recibos tras cambiar el estado y rechaza reutilizar un UUID para otro contenido o práctica', () => {
    const { owner, other, id, save, dispose } = setup();
    try {
      save(input, 1, 1);
      owner.startTeachingPractice(id);
      expect(other.saveTeachingPractice(id, { ...input, expectedVersion: 1, requestId: uuid(1) })).toBe(2);
      const caseSensitiveId = 'AAAAAAAA-AAAA-4000-8000-AAAAAAAAAAAA';
      expect(other.saveTeachingPractice(id, { ...input, expectedVersion: 3, requestId: caseSensitiveId })).toBe(3);
      expect(other.saveTeachingPractice(id, { ...input, expectedVersion: 3, requestId: caseSensitiveId.toLowerCase() })).toBe(3);
      expect(owner.getTeachingHistory(id).map((row) => row.version)).toEqual([3, 2, 1]);
      expect(() => save({ ...input, reflection: 'Otro guardado' }, 1, 1)).toThrow('otro cambio');
      const second = owner.createTeachingPractice({ subjectId: 'IDSE-05010103', topic: 'Otra práctica', initial });
      expect(() => owner.saveTeachingPractice(second, { ...input, expectedVersion: 1, requestId: uuid(1) })).toThrow('otro cambio');
    } finally { dispose(); }
  });

  it('no acepta el contrato antiguo ni identificadores inválidos y no crea versiones por un guardado sin cambios', () => {
    const { owner, id, save, dispose } = setup();
    try {
      expect(() => owner.saveTeachingPractice(id, input)).toThrow('Actualiza la aplicación');
      expect(() => owner.saveTeachingPractice(id, { ...input, expectedVersion: 1 })).toThrow('Actualiza la aplicación');
      expect(() => owner.saveTeachingPractice(id, { ...input, requestId: uuid(1) })).toThrow('Actualiza la aplicación');
      expect(() => owner.saveTeachingPractice(id, { ...input, expectedVersion: 1, requestId: 'guardado' })).toThrow('Actualiza la aplicación');
      const unchanged = { initial, revised: EMPTY_TEACHING_EXPLANATION, reflection: '', topicsToReview: '' };
      save(unchanged, 2);
      save(unchanged, 2, 1);
      expect(owner.getTeachingHistory(id).map((row) => row.version)).toEqual([1]);
      expect(owner.getSnapshot().teachingPractices.find((row) => row.id === id)?.version).toBe(1);
    } finally { dispose(); }
  });

  it('versiona inicio, cierre y reapertura; las preguntas y el compañero conservan la cabecera del texto', () => {
    const { owner, reviewer, id, save, dispose } = setup();
    try {
      owner.startTeachingPractice(id);
      expect(() => save(input, 1, 1)).toThrow('cambió');
      save(input, 2, 2);
      owner.setTeachingReviewer(id, 'demo-3');
      const question = reviewer.askTeachingQuestion(id, '¿Por qué ese ejemplo?');
      owner.answerTeachingQuestion(question, 'Porque ilustra la condición.');
      expect(owner.getSnapshot().teachingPractices.find((row) => row.id === id)?.version).toBe(3);
      owner.completeTeachingPractice(id);
      owner.reopenTeachingPractice(id);
      expect(() => save(input, 3, 3)).toThrow('cambió');
      expect(owner.getTeachingHistory(id).map((row) => [row.version, row.status])).toEqual([
        [5, 'practicing'], [4, 'completed'], [3, 'practicing'], [2, 'practicing'], [1, 'draft'],
      ]);
    } finally { dispose(); }
  });

  it('conserva el historial reservado al autor, con copias independientes y sin referencias de fuentes', () => {
    const { owner, reviewer, admin, id, save, dispose } = setup();
    try {
      save(input, 1);
      owner.startTeachingPractice(id);
      owner.setTeachingReviewer(id, 'demo-3');
      expect(reviewer.getSnapshot().teachingPractices.some((row) => row.id === id)).toBe(true);
      expect(reviewer.getSnapshot().teachingPractices.find((row) => row.id === id)?.version).toBe(1);
      expect(() => reviewer.getTeachingHistory(id)).toThrow('no tienes acceso');
      expect(() => admin.getTeachingHistory(id)).toThrow('no tienes acceso');
      const history = owner.getTeachingHistory(id);
      history[0]!.reflection = 'Alteración de la copia';
      history[0]!.initial.concept = 'Alteración de explicación';
      history[0]!.at.setFullYear(1990);
      const current = owner.getTeachingHistory(id)[0]!;
      expect(current.reflection).toBe(input.reflection);
      expect(current.initial).toEqual(initial);
      expect(current.at).toEqual(now);
      expect(JSON.stringify(current)).not.toMatch(/sourceId|sourceKind|publishedNoteId/);
      expect(JSON.stringify(reviewer.getSnapshot())).not.toContain(input.reflection);
    } finally { dispose(); }
  });

  it('migra de forma perezosa la práctica previa y devuelve las últimas treinta revisiones', () => {
    const { state, owner, id, save, dispose } = setup();
    try {
      const existing = state.teachingPractices.find((row) => row.id === id)!;
      delete existing.version;
      expect(owner.getSnapshot().teachingPractices.find((row) => row.id === id)?.version).toBe(1);
      for (let n = 1; n <= 32; n++) save({ ...input, reflection: `Reflexión ${n}` }, n);
      const history = owner.getTeachingHistory(id);
      expect(history).toHaveLength(30);
      expect(history[0]!.version).toBe(33);
      expect(history.at(-1)!.version).toBe(4);
    } finally { dispose(); }
  });
});
