import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import { emptyPresentationObservations } from '@b20/core';
import type { DbConnection } from '../module_bindings';
import { createSpacetimeActions } from './spacetimeActions';
import { emptySnapshot, PUBLIC_VIEWS, readSnapshot } from './spacetimeSnapshot';

const SELF = '00000000000000000000000000000000000000000000000000000000000000aa';
const OTHER = '00000000000000000000000000000000000000000000000000000000000000bb';
const THIRD = '00000000000000000000000000000000000000000000000000000000000000cc';
const HIGH = 18_446_744_073_709_551_614n;
const SUBJECT = 9_007_199_254_740_993n;
const at = new Date('2026-10-21T12:34:00Z'); const timestamp = Timestamp.fromDate(at);
const person = (value = SELF) => Identity.fromString(value);
const member = (id = SELF, fields: Record<string, unknown> = {}) => ({ identity: person(id), displayName: 'Alumno', photoUrl: undefined, status: 'active', isCreator: false, joinedAt: timestamp, ...fields });
const configuration = { title: 'Exposición', topic: 'Condicionales', audience: 'Compañeros', targetMinutes: 3, keyPoints: ['Condiciones', 'Ejemplo'] };
const practice = (fields: Record<string, unknown> = {}) => ({ id: HIGH, ownerId: person(), reviewerId: person(OTHER), subjectId: SUBJECT, termId: HIGH - 1n,
  ...configuration, archived: false, version: 4, requestId: 'create', creationHash: 'internal', createdAt: timestamp, updatedAt: timestamp, ...fields });
const attempt = (fields: Record<string, unknown> = {}) => ({ id: HIGH - 2n, practiceId: HIGH, number: 1, subjectId: SUBJECT, termId: HIGH - 1n,
  ...configuration, body: 'Explicación', status: 'completed', version: 3, requestId: 'attempt', creationVersion: 2, createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp, ...fields });
const question = (fields: Record<string, unknown> = {}) => ({ id: HIGH - 3n, attemptId: HIGH - 2n, authorId: person(), kind: 'personal',
  text: 'Pregunta', answer: 'Respuesta', version: 2, requestId: 'question', createdAt: timestamp, answeredAt: timestamp, ...fields });
const feedback = (fields: Record<string, unknown> = {}) => ({ id: HIGH - 4n, attemptId: HIGH - 2n, authorId: person(OTHER), ...emptyPresentationObservations(), comment: 'Comentario', version: 1, createdAt: timestamp, updatedAt: timestamp, ...fields });
function setup(initial: Record<string, unknown[]> = {}, reducers: Record<string, unknown> = {}, identity = SELF) {
  const rows: Record<string, unknown[]> = { myMember: [member(identity)], members: [member(SELF), member(OTHER), member(THIRD)], ...initial };
  const db = new Proxy({}, { get: (_target, name: string) => ({ iter: () => (rows[name] ?? []).values() }) });
  const connection = { db, reducers } as unknown as DbConnection;
  return { rows, connection, actions: createSpacetimeActions(() => connection, () => identity) };
}

describe('adaptadores de Exposiciones', () => {
  it('suscribe cinco vistas filtradas sin tablas privadas ni recibos internos', () => {
    expect(PUBLIC_VIEWS).toEqual(expect.arrayContaining(['presentation_practices', 'presentation_attempts', 'my_presentation_personal', 'presentation_questions', 'presentation_feedback']));
    for (const table of ['presentation_practice', 'presentation_attempt', 'presentation_personal', 'presentation_question', 'presentation_feedback_entry']) expect(PUBLIC_VIEWS).not.toContain(table);
    const { connection } = setup({ presentationPractices: [practice()], presentationAttempts: [attempt()], presentationQuestions: [question()],
      myPresentationPersonal: [{ attemptId: HIGH - 2n, ...emptyPresentationObservations(), clarity: 'Mi observación', nextSteps: 'Mi plan' }], presentationFeedback: [feedback()] });
    const snapshot = readSnapshot(connection, SELF);
    expect(snapshot.presentationPractices[0]).toMatchObject({ id: HIGH.toString(), subjectId: SUBJECT.toString(), termId: (HIGH - 1n).toString(), version: 4, createdAt: at });
    expect(snapshot.presentationAttempts[0]).toMatchObject({ id: (HIGH - 2n).toString(), status: 'completed', completedAt: at });
    expect(snapshot.presentationPersonal[0]).toMatchObject({ clarity: 'Mi observación', nextSteps: 'Mi plan' });
    expect(snapshot.presentationQuestions[0]).toMatchObject({ answer: 'Respuesta', kind: 'personal', answeredAt: at });
    expect(snapshot.presentationFeedback[0]).toMatchObject({ authorId: OTHER, comment: 'Comentario' });
    expect(JSON.stringify(snapshot)).not.toContain('creationHash'); expect(JSON.stringify(snapshot)).not.toContain('creationVersion');
    expect(snapshot.presentationPractices[0]).not.toHaveProperty('requestId');
  });
  it.each([false, true])('filtra prácticas y observaciones ajenas también si administra=%s', (isCreator) => {
    const { connection } = setup({ myMember: [member(SELF, { isCreator })], members: [member(SELF, { isCreator }), member(OTHER), member(THIRD)],
      presentationPractices: [practice({ ownerId: person(OTHER), reviewerId: person(THIRD), title: 'Privado' })], presentationAttempts: [attempt({ status: 'future', body: 'Cuerpo ajeno' })],
      myPresentationPersonal: [{ attemptId: HIGH - 2n, clarity: 'Dato secreto' }], presentationQuestions: [question({ kind: 'future' })], presentationFeedback: [feedback()] });
    const snapshot = readSnapshot(connection, SELF);
    for (const key of ['presentationPractices', 'presentationAttempts', 'presentationPersonal', 'presentationQuestions', 'presentationFeedback'] as const) expect(snapshot[key]).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('Dato secreto');
  });
  it('el revisor ve configuración completada, preguntas y su retroalimentación, sin borradores ni campos personales', () => {
    const { connection } = setup({ presentationPractices: [practice({ ownerId: person(OTHER), reviewerId: person(SELF), title: 'Borrador secreto', sourceKind: 'note', sourceId: 5n, sourceVersion: 1 })],
      presentationAttempts: [attempt({ sourceKind: 'note', sourceId: 5n, sourceVersion: 1 }), attempt({ id: 10n, number: 2, status: 'draft', body: 'Borrador secreto', title: 'Borrador secreto' })],
      myPresentationPersonal: [{ attemptId: HIGH - 2n, clarity: 'Reflexión secreta' }], presentationQuestions: [question(), question({ id: 11n, attemptId: 10n, text: 'Pregunta borrador' })],
      presentationFeedback: [feedback({ authorId: person(SELF) }), feedback({ id: 12n, authorId: person(THIRD), comment: 'Comentario revisor anterior' })],
      notes: [{ id: 5n, subjectId: SUBJECT, visibility: 'personal', author: person(OTHER), title: 'Nota personal', topic: '', body: '', tags: [], source: 'student', version: 1, createdAt: timestamp, updatedAt: timestamp }] });
    const snapshot = readSnapshot(connection, SELF); expect(snapshot.presentationPractices[0]?.title).toBe(configuration.title);
    expect(snapshot.presentationPractices[0]).not.toHaveProperty('sourceId'); expect(snapshot.presentationAttempts[0]).not.toHaveProperty('sourceId');
    expect(snapshot.presentationAttempts.map((row) => row.id)).toEqual([(HIGH - 2n).toString()]); expect(snapshot.presentationPersonal).toEqual([]);
    expect(snapshot.presentationQuestions).toHaveLength(1); expect(snapshot.presentationFeedback.map((row) => row.authorId)).toEqual([SELF]);
    expect(JSON.stringify(snapshot.presentationPractices)).not.toContain('secreto');
  });
  it.each([{ archived: true }, { reviewerId: person(THIRD) }])('revocar o archivar retira toda copia compartida', (fields) => {
    const { connection } = setup({ presentationPractices: [practice({ ownerId: person(OTHER), reviewerId: person(SELF), ...fields })],
      presentationAttempts: [attempt()], presentationQuestions: [question()], presentationFeedback: [feedback({ authorId: person(SELF) })] });
    const snapshot = readSnapshot(connection, SELF); expect(snapshot.presentationPractices).toEqual([]); expect(snapshot.presentationAttempts).toEqual([]);
    expect(snapshot.presentationQuestions).toEqual([]); expect(snapshot.presentationFeedback).toEqual([]);
  });
  it('la baja del propietario retira acceso y perder membresía limpia sin evaluar filas antiguas', () => {
    const { connection, rows } = setup({ members: [member(), member(OTHER, { status: 'removed' })],
      presentationPractices: [practice({ ownerId: person(OTHER), reviewerId: person(SELF) })], presentationAttempts: [attempt()] });
    expect(readSnapshot(connection, SELF).presentationPractices).toEqual([]);
    rows.myMember = [member(SELF, { status: 'removed' })]; rows.presentationPractices = [{ invalid: 'No evaluar' }];
    expect(readSnapshot(connection, SELF)).toEqual({ ...emptySnapshot('ready'), me: expect.objectContaining({ status: 'removed' }) });
  });
  it('valida enums visibles y conserva fuente personal e historial solo del propietario', () => {
    const { connection, rows } = setup({ presentationPractices: [practice({ archived: true, sourceKind: 'note', sourceId: 5n, sourceVersion: 2 })],
      presentationAttempts: [attempt({ sourceKind: 'note', sourceId: 5n, sourceVersion: 1 })], presentationQuestions: [question()] });
    expect(readSnapshot(connection, SELF).presentationPractices[0]?.sourceVersion).toBe(2);
    expect(readSnapshot(connection, SELF).presentationAttempts[0]?.sourceVersion).toBe(1);
    rows.presentationQuestions = [question({ kind: 'future' })]; expect(() => readSnapshot(connection, SELF)).toThrow('actualización');
  });
  it.each(['note', 'guide'])('retira metadatos de una fuente %s retirada incluso si su fila sigue en caché', (kind) => {
    const source = { sourceKind: kind, sourceId: 5n, sourceVersion: 1 };
    const cachedSource = kind === 'note' ? { id: 5n, subjectId: SUBJECT, title: 'Nota retirada', topic: '', body: '', tags: [], visibility: 'group', source: 'student', author: person(OTHER), version: 1, createdAt: timestamp, updatedAt: timestamp }
      : { id: 5n, subjectId: SUBJECT, title: 'Guía retirada', topics: [], sections: [], createdBy: person(OTHER), updatedBy: person(OTHER), version: 1, createdAt: timestamp, updatedAt: timestamp };
    const { connection } = setup({ presentationPractices: [practice({ ownerId: person(OTHER), reviewerId: person(SELF), ...source })],
      presentationAttempts: [attempt(source)], [kind === 'note' ? 'notes' : 'studyGuides']: [cachedSource],
      contentStatuses: [{ key: `${kind}:5`, kind, targetId: 5n, withdrawnAt: timestamp, withdrawnBy: person(OTHER), reason: '' }] });
    const snapshot = readSnapshot(connection, SELF);
    expect(snapshot.presentationPractices[0]).not.toHaveProperty('sourceId'); expect(snapshot.presentationAttempts[0]).not.toHaveProperty('sourceId');
    expect(snapshot.presentationAttempts[0]?.body).toBe('Explicación');
  });
  it('resuelve altas concurrentes e idempotentes por autor+requestId sin depender de una fila nueva', async () => {
    const savePresentationPractice = vi.fn(async () => {
      rows.presentationPractices = [practice({ ownerId: person(OTHER) }), practice({ id: 5n, requestId: 'otro' }), practice()];
    });
    const createPresentationAttempt = vi.fn(async () => { rows.presentationAttempts = [attempt({ id: 6n, requestId: 'otro' }), attempt()]; });
    const askPresentationQuestion = vi.fn(async () => { rows.presentationQuestions = [question({ id: 7n, authorId: person(OTHER) }), question()]; });
    const { actions, rows } = setup({}, { savePresentationPractice, createPresentationAttempt, askPresentationQuestion });
    const input = { ...configuration, subjectId: SUBJECT.toString(), termId: (HIGH - 1n).toString(), source: { kind: 'guide' as const, id: '5' }, requestId: 'create' };
    await expect(actions.savePresentationPractice(input)).resolves.toBe(HIGH.toString()); await expect(actions.savePresentationPractice(input)).resolves.toBe(HIGH.toString());
    expect(savePresentationPractice).toHaveBeenCalledWith({ practiceId: undefined, subjectId: SUBJECT, termId: HIGH - 1n, ...configuration,
      sourceKind: 'guide', sourceId: 5n, expectedVersion: undefined, requestId: 'create' });
    await expect(actions.createPresentationAttempt(HIGH.toString(), 'attempt', 2)).resolves.toBe((HIGH - 2n).toString());
    await expect(actions.createPresentationAttempt(HIGH.toString(), 'attempt', 2)).resolves.toBe((HIGH - 2n).toString());
    expect(createPresentationAttempt).toHaveBeenCalledWith({ practiceId: HIGH, requestId: 'attempt', expectedVersion: 2 });
    await expect(actions.askPresentationQuestion((HIGH - 2n).toString(), 'Pregunta', 'question')).resolves.toBe((HIGH - 3n).toString());
    expect(askPresentationQuestion).toHaveBeenCalledWith({ attemptId: HIGH - 2n, text: 'Pregunta', requestId: 'question' });
  });
  it('envía los nueve contratos con versiones e identidades sin mutación optimista', async () => {
    const reducers = Object.fromEntries(['savePresentationPractice', 'setPresentationReviewer', 'archivePresentationPractice', 'createPresentationAttempt', 'savePresentationAttempt',
      'completePresentationAttempt', 'askPresentationQuestion', 'answerPresentationQuestion', 'savePresentationFeedback'].map((name) => [name, vi.fn(async () => {})]));
    const { actions, rows } = setup({ presentationPractices: [practice()], presentationAttempts: [attempt()] }, reducers);
    await actions.savePresentationPractice({ id: HIGH.toString(), subjectId: SUBJECT.toString(), ...configuration, expectedVersion: 4, requestId: 'edit' });
    expect(reducers.savePresentationPractice).toHaveBeenCalledWith(expect.objectContaining({ practiceId: HIGH, expectedVersion: 4 }));
    await actions.setPresentationReviewer(HIGH.toString(), OTHER, 4); expect(reducers.setPresentationReviewer).toHaveBeenCalledWith({ practiceId: HIGH, reviewerId: person(OTHER), expectedVersion: 4 });
    await actions.setPresentationReviewer(HIGH.toString(), undefined, 5); expect(reducers.setPresentationReviewer).toHaveBeenLastCalledWith({ practiceId: HIGH, reviewerId: undefined, expectedVersion: 5 });
    await actions.archivePresentationPractice(HIGH.toString(), true, 6); expect(reducers.archivePresentationPractice).toHaveBeenCalledWith({ practiceId: HIGH, archived: true, expectedVersion: 6 });
    const input = { ...emptyPresentationObservations(), body: 'Explicación', nextSteps: 'Plan' };
    await actions.savePresentationAttempt((HIGH - 2n).toString(), input, 2); expect(reducers.savePresentationAttempt).toHaveBeenCalledWith({ attemptId: HIGH - 2n, ...input, expectedVersion: 2 });
    await actions.completePresentationAttempt((HIGH - 2n).toString(), 3); expect(reducers.completePresentationAttempt).toHaveBeenCalledWith({ attemptId: HIGH - 2n, expectedVersion: 3 });
    await actions.answerPresentationQuestion((HIGH - 3n).toString(), 'Respuesta', 2); expect(reducers.answerPresentationQuestion).toHaveBeenCalledWith({ questionId: HIGH - 3n, answer: 'Respuesta', expectedVersion: 2 });
    const feedbackInput = { ...emptyPresentationObservations(), comment: 'Comentario' };
    await actions.savePresentationFeedback((HIGH - 2n).toString(), feedbackInput, 1); expect(reducers.savePresentationFeedback).toHaveBeenCalledWith({ attemptId: HIGH - 2n, ...feedbackInput, expectedVersion: 1 });
    expect(rows.presentationPractices).toEqual([practice()]); expect(rows.presentationAttempts).toEqual([attempt()]);
  });
  it('conserva el envío al desconectar y no confunde un resultado ausente con datos de otra persona', async () => {
    const savePresentationPractice = vi.fn().mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValue(undefined);
    const { actions, rows } = setup({ presentationPractices: [practice({ ownerId: person(OTHER) })] }, { savePresentationPractice });
    const input = { subjectId: SUBJECT.toString(), ...configuration, requestId: 'create' };
    await expect(actions.savePresentationPractice(input)).rejects.toThrow('Sin conexión');
    await expect(actions.savePresentationPractice(input)).rejects.toThrow('mismo envío');
    expect(savePresentationPractice.mock.calls[0]).toEqual(savePresentationPractice.mock.calls[1]);
    rows.presentationPractices!.push(practice()); await expect(actions.savePresentationPractice(input)).resolves.toBe(HIGH.toString());
  });
});
