import { EMPTY_TEACHING_EXPLANATION, MAX_TEACHING_TEXT_LENGTH, MAX_TEACHING_QUESTION_LENGTH, TEACHING_PROMPTS, teachingNoteBody } from '@b20/core';
import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import type { SaveTeachingPracticeInput } from './types';

let teachingRequestSequence = 0;
function saveTeaching(data: DemoDataSource, id: string, input: SaveTeachingPracticeInput) {
  const expectedVersion = data.getSnapshot().teachingPractices.find((row) => row.id === id)?.version ?? 1;
  const requestId = `00000000-0000-4000-8000-${String(++teachingRequestSequence).padStart(12, '0')}`;
  return data.saveTeachingPractice(id, { ...input, expectedVersion, requestId });
}


const SUBJECT = 'IDSE-05010103';
const initial = { concept: 'Explicación inicial privada', example: 'Ejemplo inicial privado', limits: 'Límites iniciales privados' };
const revised = { concept: 'Explicación revisada compartible', example: 'Ejemplo revisado compartible', limits: 'Límites revisados compartibles' };
const personal = { reflection: 'Reflexión solo mía', topicsToReview: 'Tema privado para repasar' };
const saveInput = { initial, revised, ...personal };
const now = new Date('2026-10-21T12:00:00Z');
const source = (viewer = 'demo-2') => new DemoDataSource(createDemoState(now), viewer, () => new Date(now));

function practice(data: DemoDataSource) {
  return data.createTeachingPractice({ subjectId: SUBJECT, topic: 'Condicionales', initial });
}
function complete(data: DemoDataSource, id: string) {
  data.startTeachingPractice(id);
  saveTeaching(data, id, saveInput);
  const question = data.getSnapshot().teachingQuestions.find((question) => question.practiceId === id)!;
  data.answerTeachingQuestion(question.id, 'Respuesta privada');
  data.completeTeachingPractice(id);
}

describe('Aprende enseñando en la demo', () => {
  it('guarda borradores incompletos y referencias accesibles sin copiar la fuente', () => {
    const data = source('demo-3');
    const id = data.createTeachingPractice({ subjectId: 'IDSE-05010104', topic: ' Ciclos ',
      initial: { ...EMPTY_TEACHING_EXPLANATION }, source: { kind: 'note', id: 'n2' } });
    expect(data.getSnapshot().teachingPractices.find((item) => item.id === id)).toMatchObject({
      topic: 'Ciclos', status: 'draft', initial: EMPTY_TEACHING_EXPLANATION,
    });
    expect(data.getSnapshot().teachingPersonal.find((item) => item.practiceId === id)).toMatchObject({
      sourceKind: 'note', sourceId: 'n2', sourceVersion: 1,
    });
    expect(() => data.startTeachingPractice(id)).toThrow('no puede estar vacío');
    expect(() => data.setTeachingReviewer(id, 'demo-2')).toThrow('en curso');
  });

  it('rechaza fuentes ajenas, inexistentes o de otra materia sin crear filas', () => {
    const data = source();
    const before = data.getSnapshot().teachingPractices.length;
    for (const sourceRef of [{ kind: 'note' as const, id: 'n2' }, { kind: 'note' as const, id: 'missing' }]) {
      expect(() => data.createTeachingPractice({ subjectId: SUBJECT, topic: 'Fuente', initial, source: sourceRef })).toThrow('fuente');
    }
    expect(() => data.createTeachingPractice({ subjectId: SUBJECT, topic: 'Fuente', initial,
      source: { kind: 'note', id: 'n3' } })).toThrow('materia');
    expect(data.getSnapshot().teachingPractices).toHaveLength(before);
    const guide = data.getSnapshot().guides[0]!;
    const id = data.createTeachingPractice({ subjectId: guide.subjectId, topic: 'Desde una guía', initial,
      source: { kind: 'guide', id: guide.id } });
    expect(data.getSnapshot().teachingPersonal.find((item) => item.practiceId === id)?.sourceVersion).toBe(guide.version);
  });

  it('conserva la explicación inicial y solo crea tres preguntas orientadoras al comenzar', () => {
    const data = source();
    const id = practice(data);
    data.startTeachingPractice(id);
    expect(data.getSnapshot().teachingQuestions.filter((item) => item.practiceId === id).map((item) => item.text)).toEqual(TEACHING_PROMPTS);
    data.startTeachingPractice(id);
    expect(data.getSnapshot().teachingQuestions.filter((item) => item.practiceId === id)).toHaveLength(3);
    expect(() => saveTeaching(data, id, { ...saveInput, initial: { ...initial, concept: 'Cambio' } })).toThrow('inicial se conserva');
    saveTeaching(data, id, { ...saveInput, initial: { ...initial, concept: ` ${initial.concept} ` } });
    expect(data.getSnapshot().teachingPractices.find((item) => item.id === id)?.initial).toEqual(initial);
  });

  it.each([{ kind: 'note' as const, id: 'n1', version: 1 }, { kind: 'guide' as const, id: 'gd1', version: 2 }])('rechaza una fuente $kind retirada al practicar desde una sala, incluso para su autor', (ref) => {
    const data = source('demo-2');
    const before = data.getSnapshot().teachingPractices.length;
    data.withdrawContent(ref.kind, ref.id, true, ref.version, 'Material retirado de la sala');
    const visibleToAuthor = ref.kind === 'note' ? data.getSnapshot().notes : data.getSnapshot().guides;
    expect(visibleToAuthor.find((item) => item.id === ref.id)?.withdrawnAt).toBeDefined();
    expect(() => data.createTeachingPractice({ subjectId: SUBJECT, topic: 'Desde un material retirado', initial,
      source: { kind: ref.kind, id: ref.id } })).toThrow('fuente');
    expect(data.getSnapshot().teachingPractices).toHaveLength(before);
    data.setViewer('demo-3');
    expect(() => data.createTeachingPractice({ subjectId: SUBJECT, topic: 'Desde una referencia guardada', initial,
      source: { kind: ref.kind, id: ref.id } })).toThrow('fuente');
  });

  it('exige explicación revisada, reflexión y una respuesta para completar', () => {
    const data = source();
    const id = practice(data);
    data.startTeachingPractice(id);
    expect(() => data.completeTeachingPractice(id)).toThrow('explicación');
    saveTeaching(data, id, { ...saveInput, reflection: '' });
    expect(() => data.completeTeachingPractice(id)).toThrow('reflexión');
    saveTeaching(data, id, saveInput);
    expect(() => data.completeTeachingPractice(id)).toThrow('al menos una pregunta');
    const question = data.getSnapshot().teachingQuestions.find((item) => item.practiceId === id)!;
    data.answerTeachingQuestion(question.id, 'Mi respuesta');
    data.completeTeachingPractice(id);
    expect(data.getSnapshot().teachingPractices.find((item) => item.id === id)?.status).toBe('completed');
    expect(() => saveTeaching(data, id, saveInput)).toThrow('Reabre');
    expect(() => data.answerTeachingQuestion(question.id, 'Otra respuesta')).toThrow('en curso');
    data.reopenTeachingPractice(id);
    saveTeaching(data, id, saveInput);
    expect(data.getSnapshot().teachingQuestions.filter((item) => item.practiceId === id)).toHaveLength(3);
  });

  it('el compañero ve explicaciones y preguntas, nunca información personal ni referencias de la fuente', () => {
    const data = source('demo-3');
    const id = data.createTeachingPractice({ subjectId: 'IDSE-05010104', topic: 'Ciclos', initial,
      source: { kind: 'note', id: 'n2' } });
    data.startTeachingPractice(id);
    saveTeaching(data, id, saveInput);
    data.setTeachingReviewer(id, 'demo-2');
    data.setViewer('demo-2');
    expect(data.getSnapshot().teachingPractices.find((item) => item.id === id)).toMatchObject({ initial, revised });
    expect(data.getSnapshot().teachingPersonal.find((item) => item.practiceId === id)).toBeUndefined();
    expect(JSON.stringify(data.getSnapshot().teachingPractices)).not.toContain('sourceId');
    expect(JSON.stringify(data.getSnapshot())).not.toContain(personal.reflection);
    expect(data.getSnapshot().notes.find((note) => note.id === 'n2')).toBeUndefined();
    const questionId = data.askTeachingQuestion(id, '¿Por qué termina el ciclo?');
    expect(() => data.answerTeachingQuestion(questionId, 'Me respondo')).toThrow('no tienes acceso');
    expect(() => saveTeaching(data, id, saveInput)).toThrow('no tienes acceso');
    expect(() => data.setTeachingReviewer(id)).toThrow('no tienes acceso');
    expect(() => data.publishTeachingExplanation(id)).toThrow('no tienes acceso');
    data.setViewer('demo-3');
    data.answerTeachingQuestion(questionId, 'Porque la condición se vuelve falsa.');
    data.setViewer('demo-2');
    expect(data.getSnapshot().teachingQuestions.find((question) => question.id === questionId)?.answer).toContain('condición');
  });

  it('terceros y administradores carecen de acceso a prácticas privadas', () => {
    const data = source('demo-3');
    const id = practice(data);
    data.startTeachingPractice(id);
    const ownQuestion = data.getSnapshot().teachingQuestions.find((item) => item.practiceId === id)!;
    for (const viewer of ['demo-1', 'demo-4']) {
      data.setViewer(viewer);
      expect(data.getSnapshot().teachingPractices.find((item) => item.id === id)).toBeUndefined();
      expect(data.getSnapshot().teachingQuestions.find((item) => item.practiceId === id)).toBeUndefined();
      expect(() => data.askTeachingQuestion(id, 'Pregunta')).toThrow('no tienes acceso');
      expect(() => data.answerTeachingQuestion(ownQuestion.id, 'Respuesta')).toThrow('no tienes acceso');
      expect(() => data.startTeachingPractice(id)).toThrow('no tienes acceso');
    }
  });

  it('revocar y sustituir al compañero retira prácticas y preguntas de su siguiente snapshot', () => {
    const data = source();
    const id = practice(data);
    data.startTeachingPractice(id);
    data.setTeachingReviewer(id, 'demo-3');
    data.setViewer('demo-3');
    data.askTeachingQuestion(id, 'Pregunta del compañero anterior');
    data.setViewer('demo-2');
    data.setTeachingReviewer(id, 'demo-4');
    data.setViewer('demo-3');
    expect(data.getSnapshot().teachingPractices.find((item) => item.id === id)).toBeUndefined();
    expect(data.getSnapshot().teachingQuestions.find((item) => item.practiceId === id)).toBeUndefined();
    expect(() => data.askTeachingQuestion(id, 'Sigo preguntando')).toThrow('no tienes acceso');
    data.setViewer('demo-4');
    expect(data.getSnapshot().teachingQuestions.some((item) => item.practiceId === id)).toBe(true);
    data.setViewer('demo-2');
    data.setTeachingReviewer(id);
    data.setViewer('demo-4');
    expect(data.getSnapshot().teachingPractices.find((item) => item.id === id)).toBeUndefined();
  });

  it('las bajas del autor y del compañero retiran acceso y no permiten nuevas invitaciones', () => {
    const data = source('demo-3');
    const id = practice(data);
    data.startTeachingPractice(id);
    expect(() => data.setTeachingReviewer(id, 'demo-3')).toThrow('otro integrante');
    data.setTeachingReviewer(id, 'demo-2');
    data.setViewer('demo-1');
    data.removeMember('demo-2');
    data.setViewer('demo-2');
    expect(data.getSnapshot().teachingPractices).toEqual([]);
    expect(() => data.askTeachingQuestion(id, 'Pregunta')).toThrow('miembro activo');
    data.setViewer('demo-3');
    expect(() => data.setTeachingReviewer(id, 'demo-2')).toThrow('integrante activo');
    data.setTeachingReviewer(id, 'demo-4');
    data.setViewer('demo-1');
    data.removeMember('demo-3');
    data.setViewer('demo-4');
    expect(data.getSnapshot().teachingPractices.find((item) => item.id === id)).toBeUndefined();
    expect(() => data.askTeachingQuestion(id, 'Pregunta')).toThrow('no tienes acceso');
  });

  it('no permite que el autor agregue preguntas de compañero o responda una práctica ajena', () => {
    const data = source();
    const id = practice(data);
    data.startTeachingPractice(id);
    expect(() => data.askTeachingQuestion(id, 'Mi pregunta')).toThrow('no tienes acceso');
    expect(() => data.answerTeachingQuestion('tq-tp2-0', 'Respuesta cruzada')).toThrow('no tienes acceso');
    expect(() => data.answerTeachingQuestion('missing', 'Respuesta')).toThrow('no existe');
  });

  it('publica únicamente la explicación revisada y mantiene una sola nota independiente', () => {
    const data = source();
    const before = data.getSnapshot();
    const id = practice(data);
    expect(() => data.publishTeachingExplanation(id)).toThrow('Completa');
    complete(data, id);
    const afterPractice = data.getSnapshot();
    for (const collection of ['notes', 'questions', 'answers', 'revisions', 'activities', 'guides'] as const) {
      expect(afterPractice[collection]).toEqual(before[collection]);
    }
    const noteId = data.publishTeachingExplanation(id);
    expect(data.publishTeachingExplanation(id)).toBe(noteId);
    const note = data.getSnapshot().notes.find((item) => item.id === noteId)!;
    expect(note).toMatchObject({ subjectId: SUBJECT, topic: 'Condicionales', title: 'Condicionales',
      body: teachingNoteBody(revised), authorId: 'demo-2', source: 'student', visibility: 'group', tags: ['aprende-ensenando'] });
    for (const secret of [initial.concept, initial.example, initial.limits, personal.reflection, personal.topicsToReview, 'Respuesta privada']) {
      expect(JSON.stringify(note)).not.toContain(secret);
    }
    data.reopenTeachingPractice(id);
    saveTeaching(data, id, { ...saveInput, revised: { ...revised, concept: 'Nueva revisión privada' } });
    expect(data.publishTeachingExplanation(id)).toBe(noteId);
    expect(data.getSnapshot().notes.find((item) => item.id === noteId)?.body).toBe(teachingNoteBody(revised));
    data.saveNote({ ...note, id: noteId, body: 'Edición independiente en Notas' });
    expect(data.getSnapshot().teachingPractices.find((item) => item.id === id)?.revised.concept).toBe('Nueva revisión privada');
    expect(data.getSnapshot().notes.filter((item) => item.id === noteId)).toHaveLength(1);
  });

  it('valida tamaños antes de cambiar datos y bloquea acciones después de cerrar la sesión', () => {
    const data = source();
    expect(() => data.createTeachingPractice({ subjectId: SUBJECT, topic: ' ', initial })).toThrow('tema');
    const id = practice(data);
    expect(() => saveTeaching(data, id, { ...saveInput, reflection: 'x'.repeat(MAX_TEACHING_TEXT_LENGTH + 1) })).toThrow('caracteres');
    expect(() => saveTeaching(data, id, { ...saveInput, topicsToReview: 'x'.repeat(MAX_TEACHING_QUESTION_LENGTH + 1) })).toThrow('caracteres');
    expect(data.getSnapshot().teachingPractices.find((item) => item.id === id)?.revised).toEqual(EMPTY_TEACHING_EXPLANATION);
    data.startTeachingPractice(id);
    const questionId = data.getSnapshot().teachingQuestions.find((item) => item.practiceId === id)!.id;
    expect(() => data.answerTeachingQuestion(questionId, 'x'.repeat(MAX_TEACHING_QUESTION_LENGTH + 1))).toThrow('caracteres');
    data.dispose();
    expect(data.getSnapshot().teachingPractices).toEqual([]);
    expect(data.getSnapshot().teachingPersonal).toEqual([]);
    expect(data.getSnapshot().teachingQuestions).toEqual([]);
    expect(() => data.startTeachingPractice(id)).toThrow('sesión de prueba ya terminó');
  });
});
