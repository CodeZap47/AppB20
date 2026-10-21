import { Timestamp } from 'spacetimedb';
import { describe, expect, it, vi } from 'vitest';
import { nextSpacedSchedule, SPACED_DAY_MS } from '../../core/src/spaced';

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

import {
  archive_spaced_card, archive_spaced_collection, my_spaced_enrollments, my_spaced_progress,
  my_spaced_reviews, publish_spaced_collection, replace_spaced_card_source, review_spaced_card, save_spaced_card,
  save_spaced_collection, set_spaced_enrollment, spaced_cards, spaced_collections, spaced_unavailable_cards,
} from './index';

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
  const owner = identity('owner'); const other = identity('other'); const admin = identity('admin');
  const people = [owner, other, admin];
  const db = {
    appConfig: tableStore('id', [{ id: 0, owner: admin }]),
    authConfig: tableStore('id', [{ id: 0, issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['web'] }]),
    member: tableStore('identity', people.map((person) => ({ identity: person, status: 'active', isCreator: person === admin }))),
    subject: tableStore('id', [{ id: 1n }, { id: 2n }]),
    term: tableStore('id', [{ id: 10n, subjectId: 1n }, { id: 20n, subjectId: 2n }]),
    note: tableStore('id', [
      { id: 101n, author: owner, subjectId: 1n, visibility: 'personal', version: 2 },
      { id: 102n, author: other, subjectId: 1n, visibility: 'group', version: 1 },
      { id: 103n, author: other, subjectId: 1n, visibility: 'personal', version: 3 },
      { id: 104n, author: owner, subjectId: 2n, visibility: 'group', version: 4 },
    ]),
    studyGuide: tableStore('id', [{ id: 201n, subjectId: 1n, version: 5 }]),
    spacedCollection: tableStore('id'), spacedCard: tableStore('id'), spacedEnrollment: tableStore('key'),
    spacedProgress: tableStore('key'), spacedReview: tableStore('id'), changeLog: { insert: vi.fn() },
  };
  const mutableCtx = {
    sender: owner, db, timestamp: new Timestamp(1_800_000_000_000_123n), env: {},
    senderAuth: { jwt: { issuer: 'https://auth.spacetimedb.com/oidc', audience: ['web'],
      fullPayload: { email: 'member@example.com', email_verified: true } } },
  };
  const ctx = mutableCtx as unknown as Parameters<typeof save_spaced_collection>[0]
    & Parameters<typeof spaced_collections>[0];
  const as = (person: ReturnType<typeof identity>) => { mutableCtx.sender = person; };
  const remove = (person: ReturnType<typeof identity>) => {
    db.member.rows.set(person.toHexString(), { identity: person, status: 'removed', isCreator: false });
  };
  const collection = (input: Partial<Parameters<typeof save_spaced_collection>[1]> = {}) => {
    save_spaced_collection(ctx, { collectionId: undefined, subjectId: 1n, termId: 10n,
      title: 'Conceptos', visibility: 'personal', expectedVersion: undefined, ...input });
    return [...db.spacedCollection.rows.values()].at(-1)!.id as bigint;
  };
  const card = (collectionId: bigint, input: Partial<Parameters<typeof save_spaced_card>[1]> = {}) => {
    save_spaced_card(ctx, { cardId: undefined, collectionId, question: '¿Qué es una función?',
      explanation: 'Una transformación.', hint: 'Entrada y salida', sourceKind: 'note', sourceId: 102n,
      expectedVersion: undefined, ...input });
    return [...db.spacedCard.rows.values()].at(-1)!.id as bigint;
  };
  const editCard = (cardId: bigint, input: Partial<Parameters<typeof save_spaced_card>[1]> = {}) => {
    const row = db.spacedCard.rows.get(String(cardId))!;
    save_spaced_card(ctx, { cardId, collectionId: row.collectionId as bigint,
      question: row.question as string, explanation: row.explanation as string, hint: row.hint as string,
      sourceKind: row.sourceKind as string, sourceId: row.sourceId as bigint, expectedVersion: row.version as number,
      ...input });
  };
  const enroll = (collectionId: bigint, active = true) => set_spaced_enrollment(ctx, { collectionId, active });
  let requests = 0;
  const review = (cardId: bigint, input: Partial<Parameters<typeof review_spaced_card>[1]> = {}) => {
    const row = db.spacedCard.rows.get(String(cardId))!;
    const progress = db.spacedProgress.rows.get(`${cardId}:${mutableCtx.sender.toHexString()}`);
    const args = { cardId, cardVersion: row.version as number, expectedRevision: (progress?.revision ?? 0) as number,
      rating: 'remembered', requestId: `request-${++requests}`, ...input };
    review_spaced_card(ctx, args);
    return args;
  };
  const ready = (shared = false) => {
    const collectionId = collection({ visibility: shared ? 'group' : 'personal' });
    const cardId = card(collectionId); enroll(collectionId);
    return { collectionId, cardId };
  };
  const due = (cardId: bigint) => {
    mutableCtx.timestamp = db.spacedProgress.rows.get(`${cardId}:${mutableCtx.sender.toHexString()}`)!.dueAt as Timestamp;
  };
  const progress = (cardId: bigint) => db.spacedProgress.rows.get(`${cardId}:${mutableCtx.sender.toHexString()}`)!;
  return { ctx, mutableCtx, db, owner, other, admin, as, remove, collection, card, editCard, enroll, review, ready, due, progress };
}

describe('Repaso: fuentes, propiedad y vistas privadas', () => {
  it('oculta colecciones personales incluso a administradores y no permite editar por ID conocido', () => {
    const s = setup(); const id = s.collection(); s.card(id, { sourceId: 101n });
    expect(spaced_cards(s.ctx)).toHaveLength(1);
    for (const person of [s.other, s.admin]) {
      s.as(person);
      expect(spaced_collections(s.ctx)).toEqual([]); expect(spaced_cards(s.ctx)).toEqual([]);
      expect(() => s.enroll(id)).toThrow(/acceso/);
      expect(() => s.card(id)).toThrow(/acceso/);
    }
  });

  it('rechaza fuentes privadas ajenas, fuentes de otra materia y tipos desconocidos', () => {
    const s = setup(); const id = s.collection();
    for (const input of [{ sourceId: 103n }, { sourceId: 104n }, { sourceId: 999n }, { sourceKind: 'file' }]) {
      expect(() => s.card(id, input)).toThrow(/fuente/);
    }
    s.card(id, { sourceId: 101n }); s.card(id, { sourceKind: 'guide', sourceId: 201n });
    expect(spaced_cards(s.ctx)).toHaveLength(2);
    const shared = s.collection({ visibility: 'group' });
    expect(() => s.card(shared, { sourceId: 101n })).toThrow(/fuente/);
  });

  it('publica solo por acción explícita del propietario y valida también fuentes de tarjetas archivadas', () => {
    const s = setup(); const id = s.collection(); const cardId = s.card(id, { sourceId: 101n });
    expect(() => save_spaced_collection(s.ctx, { collectionId: id, subjectId: 1n, termId: 10n,
      title: 'Conceptos', visibility: 'group', expectedVersion: 1 })).toThrow(/Publicar/);
    archive_spaced_card(s.ctx, { cardId, archived: true, expectedVersion: 1 });
    expect(() => publish_spaced_collection(s.ctx, { collectionId: id, expectedVersion: 1 })).toThrow(/fuentes/);
    s.editCard(cardId, { sourceId: 102n });
    publish_spaced_collection(s.ctx, { collectionId: id, expectedVersion: 1 });
    s.as(s.other); expect(spaced_collections(s.ctx)).toHaveLength(1);
    expect(() => publish_spaced_collection(s.ctx, { collectionId: id, expectedVersion: 2 })).toThrow(/creador/);
  });

  it('permite editar al grupo, conserva autor/fecha/versión y reserva archivar al creador', () => {
    const s = setup(); const { collectionId, cardId } = s.ready(true);
    s.as(s.other); s.editCard(cardId, { question: 'Pregunta de un compañero' });
    expect(spaced_cards(s.ctx)[0]).toMatchObject({ version: 2, updatedBy: s.other, createdBy: s.owner });
    save_spaced_collection(s.ctx, { collectionId, subjectId: 1n, termId: undefined,
      title: 'Nuevo título', visibility: 'group', expectedVersion: 1 });
    expect(spaced_collections(s.ctx)[0]).toMatchObject({ version: 2, updatedBy: s.other, ownerId: s.owner });
    expect(() => archive_spaced_collection(s.ctx, { collectionId, archived: true, expectedVersion: 2 })).toThrow(/creador/);
    s.remove(s.owner); expect(spaced_cards(s.ctx)).toHaveLength(1); s.editCard(cardId, { hint: 'Todavía colaboramos' });
  });

  it('no sustituye tarjetas cuando cambia la fuente y las retira inmediatamente cuando la fuente se vuelve privada', () => {
    const s = setup(); const { cardId } = s.ready(true);
    const source = s.db.note.rows.get('102')!;
    s.db.note.rows.set('102', { ...source, version: 2 });
    expect(spaced_cards(s.ctx)[0]).toMatchObject({ sourceVersion: 1, version: 1 });
    s.db.note.rows.set('102', { ...source, visibility: 'personal' });
    expect(spaced_cards(s.ctx)).toEqual([]); expect(() => s.review(cardId)).toThrow(/fuente/);
    s.as(s.other); expect(spaced_cards(s.ctx)).toEqual([]);
    s.editCard(cardId, { sourceKind: 'guide', sourceId: 201n });
    expect(spaced_cards(s.ctx)[0]).toMatchObject({ sourceVersion: 5, version: 2 });
  });

  it('oculta también referencias eliminadas y deja reparar una tarjeta por ID sin devolver su contenido', () => {
    const s = setup(); const { cardId } = s.ready();
    s.db.note.rows.delete('102'); expect(spaced_cards(s.ctx)).toEqual([]);
    s.editCard(cardId, { sourceKind: 'guide', sourceId: 201n }); expect(spaced_cards(s.ctx)).toHaveLength(1);
  });

  it('ofrece solo identificadores seguros para reparar fuentes sin filtrar contenido ni autor', () => {
    const s = setup(); const { collectionId, cardId } = s.ready(true);
    s.db.note.rows.delete('102');
    for (const person of [s.owner, s.other, s.admin]) {
      s.as(person);
      expect(spaced_cards(s.ctx)).toEqual([]);
      expect(spaced_unavailable_cards(s.ctx)).toEqual([{ id: cardId, collectionId, version: 1, archived: false }]);
    }
    s.as(s.owner); const personal = s.collection(); s.card(personal, { sourceId: 101n }); s.db.note.rows.delete('101');
    s.as(s.other); expect(spaced_unavailable_cards(s.ctx)).toHaveLength(1);
    s.remove(s.other); expect(spaced_unavailable_cards(s.ctx)).toEqual([]);
  });

  it('reemplaza una fuente inaccesible conservando texto, historial, programación y revisión privada', () => {
    const s = setup(); const { cardId } = s.ready(true); s.review(cardId);
    const before = s.db.spacedCard.rows.get(String(cardId))!; const progress = s.progress(cardId);
    s.db.note.rows.delete('102'); s.as(s.other);
    replace_spaced_card_source(s.ctx, { cardId, expectedVersion: 1, sourceKind: 'guide', sourceId: 201n });
    expect(spaced_unavailable_cards(s.ctx)).toEqual([]);
    expect(spaced_cards(s.ctx)[0]).toMatchObject({ question: before.question, explanation: before.explanation,
      hint: before.hint, sourceKind: 'guide', sourceId: 201n, sourceVersion: 5, version: 2, updatedBy: s.other });
    s.as(s.owner); expect(s.progress(cardId)).toMatchObject({ step: 1, dueAt: progress.dueAt, revision: 2, cardVersion: 2 });
    expect(my_spaced_reviews(s.ctx)).toHaveLength(1); expect(s.db.changeLog.insert).not.toHaveBeenCalled();
    replace_spaced_card_source(s.ctx, { cardId, expectedVersion: 2, sourceKind: 'guide', sourceId: 201n });
    expect(spaced_cards(s.ctx)[0].version).toBe(2); expect(s.progress(cardId).revision).toBe(2);
  });

  it('protege la reparación ante colecciones personales ajenas, fuentes privadas, versiones viejas y bajas', () => {
    const s = setup(); const { cardId } = s.ready();
    const args = { cardId, expectedVersion: 1, sourceKind: 'guide', sourceId: 201n };
    s.as(s.other); expect(() => replace_spaced_card_source(s.ctx, args)).toThrow(/acceso/);
    s.as(s.admin); expect(() => replace_spaced_card_source(s.ctx, args)).toThrow(/acceso/);
    s.as(s.owner);
    expect(() => replace_spaced_card_source(s.ctx, { ...args, sourceKind: 'note', sourceId: 103n })).toThrow(/fuente/);
    expect(() => replace_spaced_card_source(s.ctx, { ...args, sourceKind: 'note', sourceId: 104n })).toThrow(/fuente/);
    expect(() => replace_spaced_card_source(s.ctx, { ...args, expectedVersion: 0 })).toThrow(/cambió/);
    s.remove(s.owner); expect(() => replace_spaced_card_source(s.ctx, args)).toThrow(/activo/);
    expect(s.db.spacedCard.rows.get(String(cardId))?.version).toBe(1);
  });

  it('no permite a administradores consultar progreso, resultados ni inscripciones ajenas', () => {
    const s = setup(); const { cardId } = s.ready(true); s.review(cardId);
    for (const person of [s.other, s.admin]) {
      s.as(person); expect(my_spaced_enrollments(s.ctx)).toEqual([]);
      expect(my_spaced_progress(s.ctx)).toEqual([]); expect(my_spaced_reviews(s.ctx)).toEqual([]);
    }
    s.as(s.owner); expect(my_spaced_progress(s.ctx)).toHaveLength(1); expect(my_spaced_reviews(s.ctx)).toHaveLength(1);
    expect(s.db.changeLog.insert).not.toHaveBeenCalled();
  });

  it('retira todas las vistas y bloquea estudio tras la baja; conserva datos para una futura recuperación', () => {
    const s = setup(); const { cardId } = s.ready(true); const args = s.review(cardId); s.remove(s.owner);
    for (const view of [spaced_collections, spaced_cards, spaced_unavailable_cards, my_spaced_enrollments, my_spaced_progress, my_spaced_reviews]) {
      expect(view(s.ctx)).toEqual([]);
    }
    expect(() => review_spaced_card(s.ctx, args)).toThrow(/activo/);
    expect(s.db.spacedProgress.rows.size).toBe(1); expect(s.db.spacedReview.rows.size).toBe(1);
  });
});

describe('Repaso: programación, versiones y concurrencia', () => {
  it('utiliza los intervalos compartidos de 24 h, los limita a 120 días y conserva precisión del servidor', () => {
    const s = setup(); const { cardId } = s.ready();
    for (const [index, days] of [1, 3, 7, 14, 30, 60, 120, 120].entries()) {
      const before = s.mutableCtx.timestamp.microsSinceUnixEpoch;
      s.review(cardId); const p = s.progress(cardId);
      expect(p.step).toBe(Math.min(index + 1, 7));
      expect((p.dueAt as Timestamp).microsSinceUnixEpoch - before).toBe(BigInt(days * SPACED_DAY_MS) * 1000n);
      expect(Number((p.dueAt as Timestamp).toMillis())).toBe(nextSpacedSchedule(Math.min(index, 7), 'remembered', Number(before / 1000n)).dueAt);
      s.due(cardId);
    }
    expect(s.db.spacedReview.rows.size).toBe(8);
  });

  it('la pista conserva el nivel y programa mañana; olvidar reinicia y programa en diez minutos', () => {
    const s = setup(); const { cardId } = s.ready(); s.review(cardId); s.due(cardId);
    let now = s.mutableCtx.timestamp.microsSinceUnixEpoch;
    s.review(cardId, { rating: 'hint' }); expect(s.progress(cardId).step).toBe(1);
    expect((s.progress(cardId).dueAt as Timestamp).microsSinceUnixEpoch - now).toBe(BigInt(SPACED_DAY_MS) * 1000n);
    s.due(cardId); now = s.mutableCtx.timestamp.microsSinceUnixEpoch;
    s.review(cardId, { rating: 'again' }); expect(s.progress(cardId).step).toBe(0);
    expect((s.progress(cardId).dueAt as Timestamp).microsSinceUnixEpoch - now).toBe(600_000_000n);
    s.due(cardId); s.review(cardId); expect(s.progress(cardId).step).toBe(1);
  });

  it('exige vencimiento, inscripción y una versión vigente del contenido/progreso', () => {
    const s = setup(); const { collectionId, cardId } = s.ready();
    s.enroll(collectionId, false); expect(() => s.review(cardId)).toThrow(/Añade/);
    s.enroll(collectionId); s.review(cardId);
    expect(() => s.review(cardId)).toThrow(/todavía/);
    s.due(cardId); expect(() => s.review(cardId, { cardVersion: 0 })).toThrow(/cambió/);
    expect(() => s.review(cardId, { expectedRevision: 0 })).toThrow(/reciente/);
    s.review(cardId); expect(s.progress(cardId).step).toBe(2);
  });

  it('dos pestañas no pueden avanzar la misma revisión dos veces', () => {
    const s = setup(); const { cardId } = s.ready();
    const args = s.review(cardId, { requestId: 'tab-a' });
    expect(() => review_spaced_card(s.ctx, { ...args, requestId: 'tab-b' })).toThrow(/reciente/);
    expect(s.db.spacedReview.rows.size).toBe(1); expect(s.progress(cardId).revision).toBe(1);
  });

  it('reintenta de forma idempotente incluso tras editar/archivar/pausar la tarjeta', () => {
    const s = setup(); const { collectionId, cardId } = s.ready(); const args = s.review(cardId, { requestId: 'retry' });
    s.editCard(cardId, { explanation: 'Una explicación más precisa' });
    archive_spaced_card(s.ctx, { cardId, archived: true, expectedVersion: 2 }); s.enroll(collectionId, false);
    expect(() => review_spaced_card(s.ctx, args)).not.toThrow();
    expect(s.db.spacedReview.rows.size).toBe(1); expect(s.progress(cardId).revision).toBe(1);
  });

  it('rechaza reutilizar un requestId para cualquier otro contenido o revisión', () => {
    const s = setup(); const { cardId } = s.ready(); const args = s.review(cardId, { requestId: 'retry' });
    for (const change of [{ cardId: 100n }, { cardVersion: 2 }, { expectedRevision: 1 }, { rating: 'hint' }]) {
      expect(() => review_spaced_card(s.ctx, { ...args, ...change })).toThrow(/otra revisión/);
    }
    expect(s.db.spacedReview.rows.size).toBe(1);
  });

  it('el mismo requestId tiene ámbito individual y cada alumno aprende por separado', () => {
    const s = setup(); const { collectionId, cardId } = s.ready(true); s.review(cardId, { requestId: 'shared-id' });
    s.as(s.other); s.enroll(collectionId); s.review(cardId, { requestId: 'shared-id', rating: 'again' });
    expect(my_spaced_progress(s.ctx)[0].step).toBe(0); expect(my_spaced_reviews(s.ctx)).toHaveLength(1);
    s.as(s.owner); expect(my_spaced_progress(s.ctx)[0].step).toBe(1); expect(my_spaced_reviews(s.ctx)).toHaveLength(1);
  });

  it('editar pregunta, explicación o pista inicia nuevamente aprendizaje sin borrar historial', () => {
    const s = setup(); const { cardId } = s.ready(); s.review(cardId); s.due(cardId); s.review(cardId);
    s.editCard(cardId, { hint: 'Una nueva pista' });
    expect(s.progress(cardId)).toMatchObject({ step: 2, cardVersion: 1, revision: 2 });
    expect(() => s.review(cardId, { cardVersion: 1 })).toThrow(/cambió/);
    s.review(cardId); expect(s.progress(cardId)).toMatchObject({ step: 1, cardVersion: 2, revision: 3 });
    expect(s.db.spacedReview.rows.size).toBe(3);
  });

  it('corregir o refrescar fuente conserva aprendizaje y aumenta revisión para cerrar sesiones obsoletas', () => {
    const s = setup(); const { cardId } = s.ready(); s.review(cardId); const before = s.progress(cardId);
    const note = s.db.note.rows.get('102')!; s.db.note.rows.set('102', { ...note, version: 2 });
    s.editCard(cardId); expect(s.progress(cardId)).toMatchObject({ step: 1, cardVersion: 2, revision: 2, dueAt: before.dueAt });
    expect(() => s.review(cardId, { expectedRevision: 1 })).toThrow(/reciente/);
    s.editCard(cardId, { sourceKind: 'guide', sourceId: 201n });
    expect(s.progress(cardId)).toMatchObject({ step: 1, cardVersion: 3, revision: 3, dueAt: before.dueAt });
    expect(s.db.spacedReview.rows.size).toBe(1);
  });

  it('archivar y restaurar conserva programación, historial e inscripción', () => {
    const s = setup(); const { collectionId, cardId } = s.ready(); s.review(cardId); const before = s.progress(cardId);
    archive_spaced_card(s.ctx, { cardId, archived: true, expectedVersion: 1 });
    expect(() => s.review(cardId)).toThrow(/disponible/);
    archive_spaced_card(s.ctx, { cardId, archived: false, expectedVersion: 2 });
    expect(s.progress(cardId)).toMatchObject({ step: 1, cardVersion: 3, revision: 3, dueAt: before.dueAt });
    archive_spaced_collection(s.ctx, { collectionId, archived: true, expectedVersion: 1 });
    expect(() => s.review(cardId)).toThrow(/archivada/); expect(() => s.editCard(cardId)).toThrow(/archivada/);
    archive_spaced_collection(s.ctx, { collectionId, archived: false, expectedVersion: 2 });
    expect(my_spaced_enrollments(s.ctx)[0].active).toBe(true); expect(my_spaced_reviews(s.ctx)).toHaveLength(1);
    expect(s.progress(cardId).dueAt).toBe(before.dueAt);
  });

  it('archivar o refrescar tras un cambio de contenido no resucita progreso de versiones anteriores', () => {
    const s = setup(); const { cardId } = s.ready(); s.review(cardId); s.due(cardId); s.review(cardId);
    s.editCard(cardId, { question: 'Pregunta cambiada' });
    s.editCard(cardId, { sourceKind: 'guide', sourceId: 201n });
    archive_spaced_card(s.ctx, { cardId, archived: true, expectedVersion: 3 });
    archive_spaced_card(s.ctx, { cardId, archived: false, expectedVersion: 4 });
    expect(s.progress(cardId)).toMatchObject({ cardVersion: 1, revision: 2 });
    s.review(cardId); expect(s.progress(cardId)).toMatchObject({ cardVersion: 5, step: 1, revision: 3 });
  });

  it('una inscripción incluye automáticamente tarjetas futuras y al pausar conserva el avance', () => {
    const s = setup(); const { collectionId, cardId } = s.ready(); s.review(cardId);
    const next = s.card(collectionId, { question: 'Nueva pregunta' }); s.review(next);
    s.enroll(collectionId, false); s.due(cardId); expect(() => s.review(cardId)).toThrow(/Añade/);
    s.enroll(collectionId); s.review(cardId); expect(s.progress(cardId).step).toBe(2);
    expect(s.db.spacedEnrollment.rows.size).toBe(1);
  });

  it('no cambia versiones en guardados idénticos y rechaza ediciones obsoletas', () => {
    const s = setup(); const { collectionId, cardId } = s.ready(); s.editCard(cardId);
    expect(spaced_cards(s.ctx)[0].version).toBe(1);
    expect(() => s.editCard(cardId, { expectedVersion: undefined })).toThrow(/cambió/);
    save_spaced_collection(s.ctx, { collectionId, subjectId: 1n, termId: 10n, title: ' Conceptos ',
      visibility: 'personal', expectedVersion: 1 });
    expect(spaced_collections(s.ctx)[0].version).toBe(1);
    expect(() => save_spaced_collection(s.ctx, { collectionId, subjectId: 2n, termId: undefined,
      title: 'Conceptos', visibility: 'personal', expectedVersion: 1 })).toThrow(/materia/);
  });

  it('valida campos, parcial, matrícula y resultados sin producir revisiones', () => {
    const s = setup();
    expect(() => s.collection({ termId: 20n })).toThrow(/parcial/);
    expect(() => s.collection({ title: ' ' })).toThrow(/vacío/);
    expect(() => s.collection({ visibility: 'public' })).toThrow(/Visibilidad/);
    const { collectionId, cardId } = s.ready();
    expect(() => s.card(collectionId, { question: ' ' })).toThrow(/vacío/);
    expect(() => s.card(collectionId, { explanation: 'a'.repeat(20_001) })).toThrow(/excede/);
    expect(() => s.card(collectionId, { hint: 'a'.repeat(2001) })).toThrow(/pista/);
    expect(() => s.review(cardId, { rating: 'bad' })).toThrow(/inválido/);
    expect(() => s.review(cardId, { requestId: ' ' })).toThrow(/inválido/);
    expect(s.db.spacedReview.rows.size).toBe(0);
  });
});
