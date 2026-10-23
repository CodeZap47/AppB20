import { Timestamp } from 'spacetimedb';
import { describe, expect, it, vi } from 'vitest';

// Solo se sustituye el registro del SDK; los permisos, vistas y reducers son los reales.
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return {
    SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }),
  };
});

import { save_presentation_practice, set_presentation_reviewer, archive_presentation_practice,
  create_presentation_attempt, save_presentation_attempt, complete_presentation_attempt,
  ask_presentation_question, answer_presentation_question, save_presentation_feedback,
  presentation_practices, presentation_attempts, my_presentation_personal, presentation_questions, presentation_feedback } from './index';

const identity = (hex: string) => ({
  toHexString: () => hex,
  isEqual: (other: { toHexString(): string }) => other.toHexString() === hex,
});
const keyOf = (value: unknown): string => value && typeof value === 'object' && 'toHexString' in value
  ? (value as ReturnType<typeof identity>).toHexString() : String(value);
type Row = Record<string, unknown>;
function tableStore(primaryKey: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[primaryKey]), row]));
  let nextId = 1n;
  const store = {
    rows, iter: () => rows.values(),
    insert: (row: Row) => {
      const inserted = primaryKey === 'id' && row.id === 0n ? { ...row, id: nextId++ } : row;
      if (rows.has(keyOf(inserted[primaryKey]))) throw new Error('Duplicate primary key');
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


function setup() {
  const owner = identity('owner'); const reviewer = identity('reviewer'); const third = identity('third'); const admin = identity('admin');
  const db = {
    appConfig: tableStore('id', [{ id: 0, owner: admin }]),
    authConfig: tableStore('id', [{ id: 0, issuer: 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1', audiences: ['web'] }]),
    member: tableStore('identity', [owner, reviewer, third, admin].map((person) => ({ identity: person, status: 'active', isCreator: person === admin }))),
    subject: tableStore('id', [{ id: 1n }, { id: 2n }]), term: tableStore('id', [{ id: 10n, subjectId: 1n }, { id: 20n, subjectId: 2n }]),
    note: tableStore('id', [{ id: 101n, author: owner, subjectId: 1n, visibility: 'personal', version: 2 },
      { id: 102n, author: reviewer, subjectId: 1n, visibility: 'group', version: 1 },
      { id: 103n, author: reviewer, subjectId: 1n, visibility: 'personal', version: 3 },
      { id: 104n, author: owner, subjectId: 2n, visibility: 'group', version: 1 }]),
    studyGuide: tableStore('id', [{ id: 201n, subjectId: 1n, version: 5 }]), contentStatus: tableStore('key'),
    presentationPractice: tableStore('id'), presentationAttempt: tableStore('id'), presentationPersonal: tableStore('attemptId'),
    presentationQuestion: tableStore('id'), presentationFeedback: tableStore('id'), changeLog: { insert: vi.fn() },
  };
  const mutableCtx = { sender: owner, db, timestamp: new Timestamp(1_800_000_000_000_123n), env: {},
    senderAuth: { jwt: { issuer: 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1', audience: ['web'], fullPayload: { email: 'a@example.com', email_verified: true } } } };
  const ctx = mutableCtx as unknown as Parameters<typeof save_presentation_practice>[0] & Parameters<typeof presentation_practices>[0];
  const as = (person: ReturnType<typeof identity>) => { mutableCtx.sender = person; };
  const remove = (person: ReturnType<typeof identity>) => db.member.rows.set(person.toHexString(), { identity: person, status: 'removed' });
  let request = 0;
  const config = { title: 'Exposición', topic: 'Funciones', audience: 'Compañeros de clase', targetMinutes: 5, keyPoints: ['Entrada y salida', 'Aplicaciones'] };
  const input = (extra: Partial<Parameters<typeof save_presentation_practice>[1]> = {}) => ({ practiceId: undefined, subjectId: 1n, termId: 10n,
    ...config, sourceKind: undefined, sourceId: undefined, expectedVersion: undefined, requestId: `practice-${++request}`, ...extra });
  const practice = (extra: Partial<Parameters<typeof save_presentation_practice>[1]> = {}) => {
    save_presentation_practice(ctx, input(extra)); return [...db.presentationPractice.rows.values()].at(-1)!.id as bigint;
  };
  const p = (id: bigint) => db.presentationPractice.rows.get(String(id))!;
  const a = (id: bigint) => db.presentationAttempt.rows.get(String(id))!;
  const invite = (practiceId: bigint, reviewerId = reviewer) => set_presentation_reviewer(ctx, { practiceId, reviewerId: reviewerId as unknown as Parameters<typeof set_presentation_reviewer>[1]['reviewerId'], expectedVersion: p(practiceId).version as number });
  const attempt = (practiceId: bigint, requestId = `attempt-${++request}`) => {
    create_presentation_attempt(ctx, { practiceId, requestId, expectedVersion: p(practiceId).version as number });
    return [...db.presentationAttempt.rows.values()].at(-1)!.id as bigint;
  };
  const save = (attemptId: bigint, extra: Partial<Parameters<typeof save_presentation_attempt>[1]> = {}) => save_presentation_attempt(ctx,
    { attemptId, body: 'Una función relaciona entradas con salidas.', clarity: 'Mi autoobservación secreta', examples: '', decisions: '', limitations: '',
      nextSteps: 'Mi plan privado', expectedVersion: a(attemptId).version as number, ...extra });
  const complete = (attemptId: bigint) => complete_presentation_attempt(ctx, { attemptId, expectedVersion: a(attemptId).version as number });
  const ready = (sourceId?: bigint) => { const id = practice(sourceId ? { sourceKind: 'note', sourceId } : {}); invite(id);
    const attemptId = attempt(id); save(attemptId); complete(attemptId); return { id, attemptId }; };
  const ask = (attemptId: bigint, text = '¿Qué otro ejemplo hay?', requestId = `question-${++request}`) => {
    ask_presentation_question(ctx, { attemptId, text, requestId }); return [...db.presentationQuestion.rows.values()].at(-1)!.id as bigint;
  };
  const feedback = (attemptId: bigint, extra: Partial<Parameters<typeof save_presentation_feedback>[1]> = {}) => save_presentation_feedback(ctx,
    { attemptId, clarity: 'Bien organizado', examples: '', decisions: '', limitations: '', comment: 'Podrías ampliar el ejemplo', expectedVersion: undefined, ...extra });
  return { ctx, mutableCtx, db, owner, reviewer, third, admin, as, remove, config, input, practice, p, a, invite, attempt, save, complete, ready, ask, feedback };
}

describe('Exposiciones: permisos privados y fuentes', () => {
  it('no entrega prácticas, borradores ni autoobservaciones a otros alumnos o administradores', () => {
    const s = setup(); const id = s.practice(); const attempt = s.attempt(id); s.save(attempt);
    expect(my_presentation_personal(s.ctx)[0]).toMatchObject({ clarity: 'Mi autoobservación secreta', nextSteps: 'Mi plan privado' });
    for (const person of [s.reviewer, s.third, s.admin]) {
      s.as(person); expect(presentation_practices(s.ctx)).toEqual([]); expect(presentation_attempts(s.ctx)).toEqual([]);
      expect(my_presentation_personal(s.ctx)).toEqual([]); expect(presentation_questions(s.ctx)).toEqual([]); expect(presentation_feedback(s.ctx)).toEqual([]);
      expect(() => s.save(attempt)).toThrow(/acceso/); expect(() => s.invite(id)).toThrow(/acceso/);
    }
  });
  it('el revisor explícito solo ve intentos completados y nunca información personal', () => {
    const s = setup(); const id = s.practice(); s.invite(id); const first = s.attempt(id); s.save(first);
    s.as(s.reviewer); expect(presentation_practices(s.ctx)).toEqual([]); expect(presentation_attempts(s.ctx)).toEqual([]);
    expect(() => s.ask(first)).toThrow(/acceso/); expect(() => s.feedback(first)).toThrow(/acceso/);
    s.as(s.owner); s.complete(first); const draft = s.attempt(id); s.save(draft, { body: 'Borrador secreto' });
    s.as(s.reviewer); expect(presentation_attempts(s.ctx)).toHaveLength(1); expect(presentation_attempts(s.ctx)[0].id).toBe(first);
    expect(my_presentation_personal(s.ctx)).toEqual([]); expect(presentation_questions(s.ctx)).toHaveLength(5);
    expect(presentation_attempts(s.ctx)[0]).not.toHaveProperty('clarity');
  });
  it('oculta al revisor los cambios de configuración posteriores al último intento completado', () => {
    const s = setup(); const { id } = s.ready(); save_presentation_practice(s.ctx, s.input({ practiceId: id,
      title: 'Título secreto del borrador nuevo', subjectId: 2n, termId: 20n, expectedVersion: s.p(id).version as number }));
    s.as(s.reviewer); expect(presentation_practices(s.ctx)[0]).toMatchObject({ title: 'Exposición', subjectId: 1n });
  });
  it('valida materia, parcial y accesibilidad actual de notas y guías', () => {
    const s = setup();
    for (const extra of [{ sourceKind: 'note', sourceId: 103n }, { sourceKind: 'note', sourceId: 104n },
      { sourceKind: 'guide', sourceId: 999n }, { sourceKind: 'url', sourceId: 1n }, { sourceKind: 'note' }, { termId: 20n }]) {
      expect(() => s.practice(extra)).toThrow(/fuente|parcial/);
    }
    const id = s.practice({ sourceKind: 'guide', sourceId: 201n }); expect(s.p(id)).toMatchObject({ sourceVersion: 5 });
  });
  it('permite fuentes personales propias pero enmascara sus identificadores ante el revisor', () => {
    const s = setup(); s.ready(101n); expect(presentation_attempts(s.ctx)[0]).toMatchObject({ sourceId: 101n, sourceVersion: 2 });
    s.as(s.reviewer); expect(presentation_attempts(s.ctx)[0]).toMatchObject({ sourceId: undefined, sourceKind: undefined, sourceVersion: undefined });
    expect(presentation_practices(s.ctx)[0]).toMatchObject({ sourceId: undefined, creationHash: '', requestId: '' });
  });
  it('rechaza fuentes retiradas por ID directo al crear o configurar y oculta la referencia al revisor', () => {
    const s = setup(); const { id, attemptId } = s.ready(102n);
    s.db.contentStatus.insert({ key: 'note:102', withdrawnAt: s.mutableCtx.timestamp });
    s.db.contentStatus.insert({ key: 'guide:201', withdrawnAt: s.mutableCtx.timestamp });
    expect(() => s.practice({ sourceKind: 'note', sourceId: 102n })).toThrow(/retirada/);
    expect(() => s.practice({ sourceKind: 'guide', sourceId: 201n })).toThrow(/retirada/);
    expect(() => s.attempt(id)).toThrow(/retirada/);
    expect(() => save_presentation_practice(s.ctx, s.input({ practiceId: id, sourceKind: 'note', sourceId: 102n,
      expectedVersion: s.p(id).version as number }))).toThrow(/retirada/);
    expect(presentation_attempts(s.ctx)[0]).toMatchObject({ id: attemptId, sourceId: 102n, sourceVersion: 1 });
    s.as(s.reviewer); expect(presentation_attempts(s.ctx)[0]).toMatchObject({ sourceKind: undefined, sourceId: undefined, sourceVersion: undefined });
    expect(presentation_practices(s.ctx)[0]).toMatchObject({ sourceId: undefined });
  });
  it('retira la referencia al cambiar su visibilidad, sin modificar el texto ni la versión de origen', () => {
    const s = setup(); const { attemptId } = s.ready(102n); s.db.note.rows.set('102', { ...s.db.note.rows.get('102')!, visibility: 'personal', author: s.third, version: 2 });
    s.as(s.reviewer); expect(presentation_attempts(s.ctx)[0]).toMatchObject({ id: attemptId, sourceId: undefined, body: 'Una función relaciona entradas con salidas.' });
    s.as(s.owner); expect(presentation_attempts(s.ctx)[0]).toMatchObject({ sourceVersion: 1 });
  });
  it('retira inmediatamente al revisor anterior y conserva su feedback únicamente para el autor', () => {
    const s = setup(); const { id, attemptId } = s.ready(); s.as(s.reviewer); s.feedback(attemptId); s.ask(attemptId);
    s.as(s.owner); s.invite(id, s.third); expect(presentation_feedback(s.ctx)).toHaveLength(1);
    s.as(s.reviewer); expect(presentation_practices(s.ctx)).toEqual([]); expect(presentation_attempts(s.ctx)).toEqual([]);
    expect(presentation_questions(s.ctx)).toEqual([]); expect(presentation_feedback(s.ctx)).toEqual([]); expect(() => s.feedback(attemptId)).toThrow(/acceso/);
    s.as(s.third); expect(presentation_attempts(s.ctx)).toHaveLength(1); expect(presentation_feedback(s.ctx)).toEqual([]);
  });
  it('rechaza revisores inactivos o al propio autor', () => {
    const s = setup(); const id = s.practice(); expect(() => s.invite(id, s.owner)).toThrow(/otro integrante/);
    s.remove(s.reviewer); expect(() => s.invite(id)).toThrow(/activo/);
  });
  it('bloquea todas las vistas y mutaciones cuando el alumno deja el grupo', () => {
    const s = setup(); const { attemptId } = s.ready(); s.remove(s.owner);
    for (const view of [presentation_practices, presentation_attempts, my_presentation_personal, presentation_questions, presentation_feedback]) expect(view(s.ctx)).toEqual([]);
    expect(() => s.save(attemptId)).toThrow(/activo/); s.as(s.reviewer); expect(presentation_attempts(s.ctx)).toEqual([]); expect(() => s.feedback(attemptId)).toThrow(/acceso/);
  });
  it('requiere JWT de la aplicación con correo verificado para mutar', () => {
    const s = setup(); s.mutableCtx.senderAuth.jwt.audience = ['otra']; expect(() => s.practice()).toThrow(/aplicación/);
    s.mutableCtx.senderAuth.jwt.audience = ['web']; s.mutableCtx.senderAuth.jwt.fullPayload.email_verified = false;
    expect(() => s.practice()).toThrow(/verificad/);
  });
});

describe('Exposiciones: intentos versionados, idempotencia y revisión', () => {
  it('crea una sola práctica al repetir la solicitud exacta y rechaza reutilizarla con otros datos', () => {
    const s = setup(); const input = s.input(); save_presentation_practice(s.ctx, input); save_presentation_practice(s.ctx, input);
    expect(s.db.presentationPractice.rows.size).toBe(1); expect(() => save_presentation_practice(s.ctx, { ...input, title: 'Otro' })).toThrow(/otro contenido/);
    expect(s.db.changeLog.insert).not.toHaveBeenCalled();
  });
  it('no reutiliza una solicitud para otro intento o práctica del mismo autor', () => {
    const s = setup(); const first = s.practice(); const second = s.practice();
    const attemptId = s.attempt(first, 'global-attempt');
    expect(() => create_presentation_attempt(s.ctx, { practiceId: second, requestId: 'global-attempt', expectedVersion: 1 })).toThrow(/otra versión/);
    s.save(attemptId); s.complete(attemptId); const otherAttempt = s.attempt(second);
    s.ask(attemptId, 'Pregunta idempotente', 'global-question');
    expect(() => s.ask(otherAttempt, 'Pregunta idempotente', 'global-question')).toThrow(/otro contenido/);
  });
  it('permite la misma identificación de solicitud a distintos alumnos sin mezclar sus datos', () => {
    const s = setup(); s.practice({ requestId: 'shared-id' }); s.as(s.reviewer); s.practice({ requestId: 'shared-id' });
    expect(s.db.presentationPractice.rows.size).toBe(2); expect(presentation_practices(s.ctx)).toHaveLength(1);
    expect(presentation_practices(s.ctx)[0].ownerId).toBe(s.reviewer);
  });
  it('valida límites y normaliza los datos con las reglas compartidas', () => {
    const s = setup(); expect(() => s.practice({ targetMinutes: 0 })).toThrow(/duración/); expect(() => s.practice({ keyPoints: [] })).toThrow(/punto/);
    const id = s.practice({ title: ' Título ', keyPoints: [' Ejemplo ', 'Ejemplo'] }); expect(s.p(id)).toMatchObject({ title: 'Título', keyPoints: ['Ejemplo'] });
  });
  it('rechaza actualizaciones de configuración y de revisor con versiones antiguas', () => {
    const s = setup(); const id = s.practice(); s.invite(id);
    expect(() => save_presentation_practice(s.ctx, s.input({ practiceId: id, expectedVersion: 1 }))).toThrow(/cambió/);
    expect(() => set_presentation_reviewer(s.ctx, { practiceId: id, reviewerId: undefined, expectedVersion: 1 })).toThrow(/cambió/);
  });
  it('crear intento es idempotente y solo permite un borrador por exposición', () => {
    const s = setup(); const id = s.practice(); const args = { practiceId: id, requestId: 'same', expectedVersion: 1 };
    create_presentation_attempt(s.ctx, args); create_presentation_attempt(s.ctx, args);
    expect(s.db.presentationAttempt.rows.size).toBe(1); expect(s.p(id).version).toBe(2);
    expect(() => create_presentation_attempt(s.ctx, { ...args, expectedVersion: 2 })).toThrow(/otra versión/);
    expect(() => s.attempt(id)).toThrow(/borrador/);
  });
  it('guardar un intento conserva privados sus campos y rechaza escrituras concurrentes', () => {
    const s = setup(); const id = s.practice(); const attempt = s.attempt(id); s.save(attempt);
    expect(() => s.save(attempt, { expectedVersion: 1 })).toThrow(/cambió/); expect(s.a(attempt).version).toBe(2);
    expect(my_presentation_personal(s.ctx)[0]).toMatchObject({ clarity: 'Mi autoobservación secreta', nextSteps: 'Mi plan privado' });
    expect(() => s.save(attempt, { body: 'a'.repeat(30_001) })).toThrow(/30000/);
  });
  it('exige explicación al completar, genera cinco preguntas locales y hace idempotente el doble envío', () => {
    const s = setup(); const id = s.practice(); const attempt = s.attempt(id); expect(() => s.complete(attempt)).toThrow(/obligatori/);
    s.save(attempt); const version = s.a(attempt).version as number; complete_presentation_attempt(s.ctx, { attemptId: attempt, expectedVersion: version });
    complete_presentation_attempt(s.ctx, { attemptId: attempt, expectedVersion: version });
    expect(presentation_questions(s.ctx)).toHaveLength(5); expect(presentation_questions(s.ctx).every((q) => q.kind === 'guided')).toBe(true);
    expect(() => s.save(attempt)).toThrow(/completado/); expect(s.a(attempt).status).toBe('completed');
  });
  it('conserva snapshots antiguos y copia solo el cuerpo al crear el segundo intento', () => {
    const s = setup(); const { id, attemptId } = s.ready(); save_presentation_practice(s.ctx, s.input({ practiceId: id, topic: 'Nuevo tema', expectedVersion: s.p(id).version as number }));
    const second = s.attempt(id); expect(s.a(attemptId)).toMatchObject({ topic: 'Funciones' }); expect(s.a(second)).toMatchObject({ topic: 'Nuevo tema', number: 2, status: 'draft', body: s.a(attemptId).body });
    expect(s.db.presentationPersonal.rows.get(String(second))).toMatchObject({ clarity: '', nextSteps: '' });
  });
  it('reserva edición de respuestas al autor y controla concurrencia', () => {
    const s = setup(); const { attemptId } = s.ready(); s.as(s.reviewer); const q = s.ask(attemptId);
    expect(() => answer_presentation_question(s.ctx, { questionId: q, answer: 'respuesta', expectedVersion: 1 })).toThrow(/acceso/);
    s.as(s.owner); answer_presentation_question(s.ctx, { questionId: q, answer: ' Mi respuesta ', expectedVersion: 1 });
    expect(() => answer_presentation_question(s.ctx, { questionId: q, answer: 'otra', expectedVersion: 1 })).toThrow(/cambió/);
    s.as(s.reviewer); expect(presentation_questions(s.ctx).find((row) => row.id === q)).toMatchObject({ kind: 'peer', answer: 'Mi respuesta', version: 2 });
  });
  it('preguntas personales y del revisor son idempotentes por autor y contenido', () => {
    const s = setup(); const { attemptId } = s.ready(); s.ask(attemptId, 'Pregunta propia', 'same'); s.ask(attemptId, 'Pregunta propia', 'same');
    expect(presentation_questions(s.ctx)).toHaveLength(6); expect(() => s.ask(attemptId, 'distinta', 'same')).toThrow(/otro contenido/);
    s.as(s.reviewer); s.ask(attemptId, 'Pregunta revisor', 'same'); expect(presentation_questions(s.ctx)).toHaveLength(7);
  });
  it('permite feedback orientativo solo al revisor actual en intentos completados', () => {
    const s = setup(); const { attemptId } = s.ready(); expect(() => s.feedback(attemptId)).toThrow(/acceso/);
    s.as(s.reviewer); s.feedback(attemptId); expect(presentation_feedback(s.ctx)[0]).toMatchObject({ clarity: 'Bien organizado', version: 1 });
    expect(() => s.feedback(attemptId)).toThrow(/cambió/); s.feedback(attemptId, { expectedVersion: 1, comment: 'Otro consejo' });
    expect(presentation_feedback(s.ctx)[0]).toMatchObject({ version: 2, comment: 'Otro consejo' });
  });
  it('archiva solo el autor, conserva el historial y restaura sin reinvitar automáticamente al revisor', () => {
    const s = setup(); const { id, attemptId } = s.ready(); s.as(s.admin);
    expect(() => archive_presentation_practice(s.ctx, { practiceId: id, archived: true, expectedVersion: s.p(id).version as number })).toThrow(/acceso/);
    s.as(s.owner); archive_presentation_practice(s.ctx, { practiceId: id, archived: true, expectedVersion: s.p(id).version as number });
    expect(presentation_attempts(s.ctx)).toHaveLength(1); expect(my_presentation_personal(s.ctx)).toHaveLength(1); expect(() => s.save(attemptId)).toThrow(/archivada/);
    s.as(s.reviewer); expect(presentation_attempts(s.ctx)).toEqual([]);
    s.as(s.owner); archive_presentation_practice(s.ctx, { practiceId: id, archived: false, expectedVersion: s.p(id).version as number });
    expect(s.p(id)).toMatchObject({ archived: false, reviewerId: undefined }); expect(presentation_questions(s.ctx)).toHaveLength(5);
  });
  it('reserva cinco preguntas de la cuota para las preguntas guiadas y limita intentos', () => {
    const s = setup(); const id = s.practice(); const attemptId = s.attempt(id); s.save(attemptId);
    for (let i = 0; i < 95; i++) s.ask(attemptId, `Pregunta ${i}`);
    expect(() => s.ask(attemptId)).toThrow(/100 preguntas/); s.complete(attemptId); expect(presentation_questions(s.ctx)).toHaveLength(100);
    expect(() => s.ask(attemptId)).toThrow(/100 preguntas/);
    for (let i = 2; i <= 100; i++) s.db.presentationAttempt.insert({ ...s.a(attemptId), id: BigInt(i), number: i, requestId: `old-${i}` });
    expect(() => s.attempt(id)).toThrow(/100 intentos/);
  });
});
