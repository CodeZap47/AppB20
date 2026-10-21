import { describe, expect, it, vi } from 'vitest';

// Ejecuta los reducers y vistas reales, sin depender del runtime de SpacetimeDB.
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return {
    SenderError: class SenderError extends Error {},
    t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }),
  };
});

const identity = (hex: string) => ({
  toHexString: () => hex,
  isEqual: (other: { toHexString(): string }) => other.toHexString() === hex,
});
const keyOf = (value: unknown): string =>
  value && typeof value === 'object' && 'toHexString' in value
    ? (value as ReturnType<typeof identity>).toHexString() : String(value);

type Row = Record<string, unknown>;
function tableStore(primaryKey: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[primaryKey]), row]));
  let nextId = 1n;
  const store = {
    rows,
    iter: () => rows.values(),
    insert: (row: Row) => {
      const inserted = primaryKey === 'id' && row.id === 0n ? { ...row, id: nextId++ } : row;
      rows.set(keyOf(inserted[primaryKey]), inserted);
      return inserted;
    },
  };
  return new Proxy(store, {
    get(target, prop: string) {
      if (prop in target) return target[prop as keyof typeof target];
      return {
        find: (value: unknown) => rows.get(keyOf(value)),
        update: (row: Row) => { rows.set(keyOf(row[primaryKey]), row); return row; },
        delete: (value: unknown) => rows.delete(keyOf(value)),
        filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[prop]) === keyOf(value)),
      };
    },
  });
}

import {
  answer_teaching_question, ask_teaching_question, complete_teaching_practice,
  create_teaching_practice, my_teaching_personal, notes, publish_teaching_explanation,
  reopen_teaching_practice, save_teaching_practice, set_teaching_reviewer,
  start_teaching_practice, teaching_practices, teaching_questions, teaching_save_v2,
} from './index';

function setup() {
  const owner = identity('owner');
  const reviewer = identity('reviewer');
  const third = identity('third');
  const admin = identity('admin');
  const people = [owner, reviewer, third, admin];
  const db = {
    appConfig: tableStore('id', [{ id: 0, owner: admin }]),
    authConfig: tableStore('id', [{ id: 0, issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['web'] }]),
    member: tableStore('identity', people.map((person) => ({
      identity: person, status: 'active', isCreator: person === admin,
    }))),
    subject: tableStore('id', [{ id: 1n }, { id: 2n }]),
    contentStatus: tableStore('key'),
    note: tableStore('id', [
      { id: 101n, author: owner, subjectId: 1n, visibility: 'personal', version: 2, body: 'Fuente secreta' },
      { id: 102n, author: third, subjectId: 1n, visibility: 'group', version: 1 },
      { id: 103n, author: third, subjectId: 1n, visibility: 'personal', version: 3 },
      { id: 104n, author: owner, subjectId: 2n, visibility: 'group', version: 4 },
    ]),
    studyGuide: tableStore('id', [{ id: 201n, subjectId: 1n, version: 5 }, { id: 202n, subjectId: 2n, version: 1 }]),
    teachingHead: tableStore('practiceId'), teachingRevision: tableStore('key'), teachingIntent: tableStore('key'),
    teachingPractice: tableStore('id'),
    teachingPersonal: tableStore('practiceId'),
    teachingQuestion: tableStore('id'),
    changeLog: { insert: vi.fn() },
  };
  const mutableCtx = {
    sender: owner,
    senderAuth: { jwt: {
      issuer: 'https://auth.spacetimedb.com/oidc', audience: ['web'],
      fullPayload: { email: 'member@example.com', email_verified: true },
    } },
    db, timestamp: 123n, env: {},
  };
  const ctx = mutableCtx as unknown as Parameters<typeof create_teaching_practice>[0]
    & Parameters<typeof teaching_practices>[0];
  const as = (person: ReturnType<typeof identity>) => { mutableCtx.sender = person; };
  const remove = (person: ReturnType<typeof identity>) => {
    db.member.rows.set(person.toHexString(), { identity: person, status: 'removed', isCreator: false });
  };
  const create = (input: Partial<Parameters<typeof create_teaching_practice>[1]> = {}) => {
    create_teaching_practice(ctx, {
      subjectId: 1n, topic: 'Recursividad', concept: 'Concepto inicial', example: 'Ejemplo inicial',
      limits: 'Límites iniciales', ...input,
    });
    return [...db.teachingPractice.rows.values()].at(-1)!.id as bigint;
  };
  const save = (practiceId: bigint, input: Partial<Parameters<typeof save_teaching_practice>[1]> = {}) => {
    const row = db.teachingPractice.rows.get(String(practiceId))!;
    const fields = { practiceId, concept: row.concept as string, example: row.example as string, limits: row.limits as string,
      revisedConcept: 'Concepto mejorado', revisedExample: 'Ejemplo mejorado', revisedLimits: 'Límites mejorados',
      reflection: 'Mi reflexión secreta', topicsToReview: 'Mi pendiente secreto', ...input };
    const result = JSON.parse(teaching_save_v2({ withTx: (fn: (tx: typeof ctx) => string) => fn(ctx) } as unknown as Parameters<typeof teaching_save_v2>[0], { payload: JSON.stringify({ practiceId: String(practiceId),
      expectedVersion: db.teachingHead.rows.get(String(practiceId))?.version ?? 1, requestId: crypto.randomUUID(), initial: { concept: fields.concept, example: fields.example, limits: fields.limits },
      revised: { concept: fields.revisedConcept, example: fields.revisedExample, limits: fields.revisedLimits }, reflection: fields.reflection, topicsToReview: fields.topicsToReview }) }));
    if (!result.ok) throw new Error(result.message);

  };
  const begin = () => {
    const practiceId = create();
    start_teaching_practice(ctx, { practiceId });
    return practiceId;
  };
  const firstQuestionId = () => [...db.teachingQuestion.rows.values()][0]!.id as bigint;
  const complete = (practiceId: bigint) => {
    save(practiceId);
    answer_teaching_question(ctx, { questionId: firstQuestionId(), answer: 'Respuesta privada' });
    complete_teaching_practice(ctx, { practiceId });
  };
  return { ctx, mutableCtx, db, owner, reviewer, third, admin, as, remove, create, save, begin, complete, firstQuestionId };
}

describe('Aprende enseñando: handlers y vistas privadas', () => {
  it('conserva borradores incompletos, congela el original y no duplica las preguntas al continuar', () => {
    const s = setup();
    const practiceId = s.create({ concept: '', example: '', limits: '' });
    expect(() => start_teaching_practice(s.ctx, { practiceId })).toThrow(/concepto/);
    expect(s.db.teachingQuestion.rows.size).toBe(0);
    s.save(practiceId, { concept: ' Definición propia ', example: 'Un ejemplo', limits: 'Un límite' });
    start_teaching_practice(s.ctx, { practiceId });
    start_teaching_practice(s.ctx, { practiceId });
    expect(s.db.teachingQuestion.rows.size).toBe(3);
    expect([...s.db.teachingQuestion.rows.values()].map((row) => row.text)).toEqual([
      '¿En qué se diferencia este concepto de otro parecido?',
      '¿Por qué funciona el ejemplo que diste?',
      '¿Puedes describir un caso en el que este concepto no aplica?',
    ]);
    expect(() => s.save(practiceId, { concept: 'Cambio del original' })).toThrow(/inicial/);
    s.complete(practiceId);
    reopen_teaching_practice(s.ctx, { practiceId });
    start_teaching_practice(s.ctx, { practiceId });
    expect(s.db.teachingQuestion.rows.size).toBe(3);
    expect(s.db.teachingPractice.rows.get(String(practiceId))?.concept).toBe('Definición propia');
    expect(s.db.changeLog.insert).not.toHaveBeenCalled();
  });

  it('exige revisión completa, reflexión y al menos una pregunta respondida para completar', () => {
    const s = setup();
    const practiceId = s.begin();
    expect(() => complete_teaching_practice(s.ctx, { practiceId })).toThrow(/revisado/);
    s.save(practiceId, { reflection: '' });
    expect(() => complete_teaching_practice(s.ctx, { practiceId })).toThrow(/reflexión/);
    s.save(practiceId);
    expect(() => complete_teaching_practice(s.ctx, { practiceId })).toThrow(/al menos una pregunta/);
    answer_teaching_question(s.ctx, { questionId: s.firstQuestionId(), answer: '  Mi respuesta  ' });
    complete_teaching_practice(s.ctx, { practiceId });
    expect(s.db.teachingPractice.rows.get(String(practiceId))?.status).toBe('completed');
    expect(s.db.teachingQuestion.rows.get(String(s.firstQuestionId()))?.answer).toBe('Mi respuesta');
  });

  it('solo entrega prácticas y preguntas al autor y al compañero vigente; la reflexión y fuente solo al autor', () => {
    const s = setup();
    const practiceId = s.create({ sourceKind: 'note', sourceId: 101n });
    start_teaching_practice(s.ctx, { practiceId });
    s.save(practiceId);
    expect(my_teaching_personal(s.ctx)[0]).toMatchObject({
      reflection: 'Mi reflexión secreta', sourceKind: 'note', sourceId: 101n, sourceVersion: 2,
    });
    set_teaching_reviewer(s.ctx, { practiceId, reviewer: s.reviewer as never });
    s.as(s.reviewer);
    const practice = teaching_practices(s.ctx)[0];
    expect(practice).toBeDefined();
    expect(practice).not.toHaveProperty('sourceId');
    expect(practice).not.toHaveProperty('reflection');
    expect(my_teaching_personal(s.ctx)).toEqual([]);
    expect(teaching_questions(s.ctx)).toHaveLength(3);
    for (const person of [s.third, s.admin]) {
      s.as(person);
      expect(teaching_practices(s.ctx)).toEqual([]);
      expect(teaching_questions(s.ctx)).toEqual([]);
      expect(my_teaching_personal(s.ctx)).toEqual([]);
    }
  });

  it('revoca o sustituye de inmediato al compañero y conserva las preguntas para el autor', () => {
    const s = setup();
    const practiceId = s.begin();
    set_teaching_reviewer(s.ctx, { practiceId, reviewer: s.reviewer as never });
    s.as(s.reviewer);
    ask_teaching_question(s.ctx, { practiceId, text: '¿Cómo termina?' });
    s.as(s.owner);
    set_teaching_reviewer(s.ctx, { practiceId, reviewer: s.third as never });
    s.as(s.reviewer);
    expect(teaching_practices(s.ctx)).toEqual([]);
    expect(teaching_questions(s.ctx)).toEqual([]);
    expect(() => ask_teaching_question(s.ctx, { practiceId, text: 'Ya no puedo' })).toThrow();
    s.as(s.third);
    expect(teaching_questions(s.ctx)).toHaveLength(4);
    s.as(s.owner);
    set_teaching_reviewer(s.ctx, { practiceId, reviewer: undefined });
    expect(teaching_questions(s.ctx)).toHaveLength(4);
    s.as(s.third);
    expect(teaching_practices(s.ctx)).toEqual([]);
    expect(teaching_questions(s.ctx)).toEqual([]);
  });

  it.each(['owner', 'reviewer'] as const)('la baja de %s retira el acceso del compañero a todos los datos', (removed) => {
    const s = setup();
    const practiceId = s.begin();
    set_teaching_reviewer(s.ctx, { practiceId, reviewer: s.reviewer as never });
    s.remove(s[removed]);
    s.as(s.reviewer);
    expect(teaching_practices(s.ctx)).toEqual([]);
    expect(teaching_questions(s.ctx)).toEqual([]);
    expect(my_teaching_personal(s.ctx)).toEqual([]);
    expect(() => ask_teaching_question(s.ctx, { practiceId, text: 'Pregunta' })).toThrow();
    if (removed === 'owner') {
      s.as(s.owner);
      expect(() => s.save(practiceId)).toThrow(/miembro activo/);
      expect(teaching_practices(s.ctx)).toEqual([]);
      expect(my_teaching_personal(s.ctx)).toEqual([]);
    }
  });

  it('ni el compañero ni un administrador pueden modificar o publicar una práctica ajena', () => {
    const s = setup();
    const practiceId = s.begin();
    set_teaching_reviewer(s.ctx, { practiceId, reviewer: s.reviewer as never });
    for (const person of [s.reviewer, s.third, s.admin]) {
      s.as(person);
      expect(() => s.save(practiceId)).toThrow();
      expect(() => start_teaching_practice(s.ctx, { practiceId })).toThrow();
      expect(() => complete_teaching_practice(s.ctx, { practiceId })).toThrow();
      expect(() => reopen_teaching_practice(s.ctx, { practiceId })).toThrow();
      expect(() => set_teaching_reviewer(s.ctx, { practiceId, reviewer: undefined })).toThrow();
      expect(() => answer_teaching_question(s.ctx, { questionId: s.firstQuestionId(), answer: 'Ataque' })).toThrow();
      expect(() => publish_teaching_explanation(s.ctx, { practiceId })).toThrow();
    }
    expect(s.db.changeLog.insert).not.toHaveBeenCalled();
  });

  it('rechaza fuentes inaccesibles, referencias incompletas y fuentes de otra materia antes de crear filas', () => {
    const s = setup();
    for (const input of [
      { sourceKind: 'note', sourceId: 103n },
      { sourceKind: 'note', sourceId: 104n },
      { sourceKind: 'guide', sourceId: 202n },
      { sourceKind: 'guide', sourceId: 999n },
      { sourceKind: 'note' },
      { sourceId: 101n },
      { sourceKind: 'invalid', sourceId: 101n },
    ]) expect(() => s.create(input)).toThrow();
    expect(s.db.teachingPractice.rows.size).toBe(0);
    expect(s.db.teachingPersonal.rows.size).toBe(0);
    s.create({ sourceKind: 'note', sourceId: 102n });
    const guidePractice = s.create({ sourceKind: 'guide', sourceId: 201n });
    expect(s.db.teachingPersonal.rows.get(String(guidePractice))?.sourceVersion).toBe(5);
  });

  it('valida longitud y membresía también al crear o guardar, sin escrituras parciales', () => {
    const s = setup();
    expect(() => s.create({ topic: 'x'.repeat(121) })).toThrow();
    expect(() => s.create({ concept: 'x'.repeat(12001) })).toThrow();
    const practiceId = s.begin();
    expect(() => s.save(practiceId, { topicsToReview: 'x'.repeat(4001) })).toThrow();
    expect(s.db.teachingPractice.rows.get(String(practiceId))?.revisedConcept).toBe('');
    expect(() => answer_teaching_question(s.ctx, { questionId: s.firstQuestionId(), answer: ' ' })).toThrow();
    s.remove(s.owner);
    expect(() => s.create()).toThrow(/miembro activo/);
    expect(() => publish_teaching_explanation(s.ctx, { practiceId })).toThrow(/miembro activo/);
  });

  it('comprueba la práctica real de una pregunta y no permite contestar una de otro autor', () => {
    const s = setup();
    s.begin();
    const foreignQuestion = s.firstQuestionId();
    s.as(s.third);
    s.begin();
    expect(() => answer_teaching_question(s.ctx, { questionId: foreignQuestion, answer: 'Ajena' })).toThrow();
    expect(() => answer_teaching_question(s.ctx, { questionId: 999n, answer: 'Inexistente' })).toThrow();
  });

  it('solo admite invitaciones durante la práctica y bloquea los cambios hasta reabrir', () => {
    const s = setup();
    const practiceId = s.create();
    expect(() => set_teaching_reviewer(s.ctx, { practiceId, reviewer: s.reviewer as never })).toThrow();
    start_teaching_practice(s.ctx, { practiceId });
    expect(() => set_teaching_reviewer(s.ctx, { practiceId, reviewer: s.owner as never })).toThrow();
    set_teaching_reviewer(s.ctx, { practiceId, reviewer: s.reviewer as never });
    s.complete(practiceId);
    expect(() => s.save(practiceId)).toThrow(/Reabre/);
    expect(() => set_teaching_reviewer(s.ctx, { practiceId, reviewer: s.third as never })).toThrow();
    expect(() => answer_teaching_question(s.ctx, { questionId: s.firstQuestionId(), answer: 'Cambio' })).toThrow();
    s.as(s.reviewer);
    expect(() => ask_teaching_question(s.ctx, { practiceId, text: 'Cambio' })).toThrow();
    s.as(s.owner);
    set_teaching_reviewer(s.ctx, { practiceId, reviewer: undefined });
    reopen_teaching_practice(s.ctx, { practiceId });
    s.save(practiceId);
    s.remove(s.reviewer);
    expect(() => set_teaching_reviewer(s.ctx, { practiceId, reviewer: s.reviewer as never })).toThrow(/activo/);
  });

  it('publica solo la explicación revisada en una única nota de grupo y no altera después la nota publicada', () => {
    const s = setup();
    const practiceId = s.begin();
    expect(() => publish_teaching_explanation(s.ctx, { practiceId })).toThrow(/Completa/);
    s.complete(practiceId);
    const initialNotes = s.db.note.rows.size;
    publish_teaching_explanation(s.ctx, { practiceId });
    publish_teaching_explanation(s.ctx, { practiceId });
    expect(s.db.note.rows.size).toBe(initialNotes + 1);
    const publishedNoteId = s.db.teachingPersonal.rows.get(String(practiceId))?.publishedNoteId;
    const published = s.db.note.rows.get(String(publishedNoteId))!;
    expect(published).toMatchObject({
      author: s.owner, title: 'Recursividad', topic: 'Recursividad', source: 'student',
      visibility: 'group', tags: ['aprende-ensenando'],
      body: 'Concepto\nConcepto mejorado\n\nEjemplo\nEjemplo mejorado\n\nDónde aplica y dónde no\nLímites mejorados',
    });
    expect(published.body).not.toMatch(/inicial|secreta|privada/);
    expect(s.db.changeLog.insert).toHaveBeenCalledTimes(1);
    expect(s.db.changeLog.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create', entity: 'note', entityId: String(publishedNoteId),
    }));
    reopen_teaching_practice(s.ctx, { practiceId });
    s.save(practiceId, { revisedConcept: 'Una mejora posterior' });
    publish_teaching_explanation(s.ctx, { practiceId });
    expect(s.db.note.rows.size).toBe(initialNotes + 1);
    expect(s.db.note.rows.get(String(publishedNoteId))?.body).toBe(published.body);
    s.as(s.third);
    expect(notes(s.ctx)).toContainEqual(published);
    expect(teaching_practices(s.ctx)).toEqual([]);
    expect(my_teaching_personal(s.ctx)).toEqual([]);
  });
});
