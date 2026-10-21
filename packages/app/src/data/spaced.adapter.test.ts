import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import type { DbConnection } from '../module_bindings';
import { createSpacetimeActions } from './spacetimeActions';
import { emptySnapshot, PUBLIC_VIEWS, readSnapshot } from './spacetimeSnapshot';

const SELF = '00000000000000000000000000000000000000000000000000000000000000aa';
const OTHER = '00000000000000000000000000000000000000000000000000000000000000bb';
const HIGH = 18_446_744_073_709_551_614n;
const SUBJECT = 9_007_199_254_740_993n;
const at = new Date('2026-10-21T12:34:00Z');
const timestamp = Timestamp.fromDate(at);
const person = (value = SELF) => Identity.fromString(value);
const member = (value = SELF, fields: Record<string, unknown> = {}) => ({
  identity: person(value), displayName: 'Alumno de prueba', photoUrl: undefined,
  status: 'active', isCreator: false, joinedAt: timestamp, ...fields,
});
const collection = (fields: Record<string, unknown> = {}) => ({
  id: HIGH, subjectId: SUBJECT, termId: HIGH - 1n, title: 'Colección', visibility: 'group',
  ownerId: person(), version: 3, archived: false, createdAt: timestamp, updatedAt: timestamp, updatedBy: person(OTHER), ...fields,
});
const card = (fields: Record<string, unknown> = {}) => ({
  id: HIGH - 2n, collectionId: HIGH, question: 'Pregunta', explanation: 'Explicación', hint: 'Pista',
  sourceKind: 'note', sourceId: 5n, sourceVersion: 2, version: 4, archived: false,
  createdBy: person(), updatedBy: person(OTHER), createdAt: timestamp, updatedAt: timestamp, ...fields,
});
const note = (fields: Record<string, unknown> = {}) => ({
  id: 5n, subjectId: SUBJECT, title: 'Fuente', topic: '', body: 'Texto de la fuente', tags: [], visibility: 'group',
  source: 'student', author: person(), version: 2, createdAt: timestamp, updatedAt: timestamp, ...fields,
});
const progress = (fields: Record<string, unknown> = {}) => ({
  key: 'internal', memberId: person(), cardId: HIGH - 2n, cardVersion: 4, step: 3, revision: 7,
  dueAt: timestamp, reviewedAt: timestamp, ...fields,
});
const review = (fields: Record<string, unknown> = {}) => ({
  id: `${SELF}:request`, requestId: 'request', memberId: person(), cardId: HIGH - 2n, cardVersion: 4,
  expectedRevision: 6, rating: 'remembered', step: 3, reviewedAt: timestamp, dueAt: timestamp, ...fields,
});

function setup(initial: Record<string, unknown[]> = {}, reducers: Record<string, unknown> = {}) {
  const rows: Record<string, unknown[]> = { myMember: [member()], members: [member(), member(OTHER)], ...initial };
  const db = new Proxy({}, { get: (_target, name: string) => ({ iter: () => (rows[name] ?? []).values() }) });
  const connection = { db, reducers } as unknown as DbConnection;
  return { rows, connection, actions: createSpacetimeActions(() => connection, () => SELF) };
}

describe('adaptadores de repaso espaciado', () => {
  it('suscribe únicamente vistas filtradas y conserva IDs u64, versiones, fechas e identificadores de envío', () => {
    expect(PUBLIC_VIEWS).toEqual(expect.arrayContaining(['spaced_collections', 'spaced_cards', 'spaced_unavailable_cards',
      'my_spaced_enrollments', 'my_spaced_progress', 'my_spaced_reviews']));
    for (const table of ['spaced_collection', 'spaced_card', 'spaced_enrollment', 'spaced_progress', 'spaced_review']) {
      expect(PUBLIC_VIEWS).not.toContain(table);
    }
    const { connection } = setup({
      spacedCollections: [collection()], spacedCards: [card()], notes: [note()],
      mySpacedEnrollments: [{ key: 'internal', memberId: person(), collectionId: HIGH, active: false, updatedAt: timestamp }],
      mySpacedProgress: [progress()], mySpacedReviews: [review()],
    });
    const snapshot = readSnapshot(connection, SELF);
    expect(snapshot.spacedCollections[0]).toEqual({ id: HIGH.toString(), subjectId: SUBJECT.toString(), termId: (HIGH - 1n).toString(),
      title: 'Colección', visibility: 'group', ownerId: SELF, version: 3, archived: false, createdAt: at, updatedAt: at, updatedBy: OTHER });
    expect(snapshot.spacedCards[0]).toMatchObject({ id: (HIGH - 2n).toString(), collectionId: HIGH.toString(),
      sourceId: '5', sourceVersion: 2, version: 4, sourceKind: 'note', createdBy: SELF, updatedBy: OTHER, createdAt: at });
    expect(snapshot.spacedEnrollments[0]).toEqual({ memberId: SELF, collectionId: HIGH.toString(), active: false, updatedAt: at });
    expect(snapshot.spacedProgress[0]).toEqual({ memberId: SELF, cardId: (HIGH - 2n).toString(), cardVersion: 4, step: 3,
      revision: 7, dueAt: at, reviewedAt: at });
    expect(snapshot.spacedReviews[0]).toEqual({ id: `${SELF}:request`, requestId: 'request', memberId: SELF,
      cardId: (HIGH - 2n).toString(), cardVersion: 4, rating: 'remembered', step: 3, reviewedAt: at, dueAt: at });
    expect(snapshot.spacedReviews[0]).not.toHaveProperty('expectedRevision');
  });

  it.each([false, true])('excluye caché personal ajena y resultados ajenos incluso si administra=%s', (isCreator) => {
    const { connection } = setup({
      myMember: [member(SELF, { isCreator })], members: [member(SELF, { isCreator }), member(OTHER)],
      spacedCollections: [collection(), collection({ id: 2n, ownerId: person(OTHER), visibility: 'personal', title: 'Colección privada ajena' })],
      spacedCards: [card(), card({ id: 3n, collectionId: 2n, question: 'Pregunta privada ajena', sourceKind: 'enum futuro' })], notes: [note()],
      spacedUnavailableCards: [{ id: 4n, collectionId: HIGH, version: 8, archived: false },
        { id: 5n, collectionId: 2n, version: 2, archived: false }],
      mySpacedEnrollments: [{ memberId: person(OTHER), collectionId: HIGH, active: true, updatedAt: timestamp }],
      mySpacedProgress: [progress({ memberId: person(OTHER), step: 6 })],
      mySpacedReviews: [review({ memberId: person(OTHER), rating: 'enum futuro', requestId: 'Privado ajeno' })],
    });
    const snapshot = readSnapshot(connection, SELF);
    expect(snapshot.spacedCollections.map((item) => item.id)).toEqual([HIGH.toString()]);
    expect(snapshot.spacedCards.map((item) => item.id)).toEqual([(HIGH - 2n).toString()]);
    expect(snapshot.spacedUnavailableCards).toEqual([{ id: '4', collectionId: HIGH.toString(), version: 8, archived: false }]);
    expect(snapshot.spacedEnrollments).toEqual([]); expect(snapshot.spacedProgress).toEqual([]); expect(snapshot.spacedReviews).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('privada ajena');
    expect(JSON.stringify(snapshot)).not.toContain('Privado ajeno');
  });

  it('retira fuentes que se volvieron personales o perdieron acceso sin borrar progreso ni filtrar sus textos por la vista de reparación', () => {
    const { connection } = setup({
      spacedCollections: [collection()], spacedCards: [card(), card({ id: 8n, sourceId: 9n })],
      notes: [note({ visibility: 'personal' })],
      spacedUnavailableCards: [{ id: HIGH - 2n, collectionId: HIGH, version: 4, archived: false,
        question: 'Contenido oculto no permitido', sourceId: 5n }],
      mySpacedProgress: [progress()], mySpacedReviews: [review()],
    });
    const snapshot = readSnapshot(connection, SELF);
    expect(snapshot.spacedCards).toEqual([]);
    expect(snapshot.spacedProgress).toHaveLength(1); expect(snapshot.spacedReviews).toHaveLength(1);
    expect(snapshot.spacedUnavailableCards).toEqual([{ id: (HIGH - 2n).toString(), collectionId: HIGH.toString(), version: 4, archived: false }]);
    expect(JSON.stringify(snapshot.spacedUnavailableCards)).not.toContain('Contenido oculto');
    expect(snapshot.spacedUnavailableCards[0]).not.toHaveProperty('sourceId');
  });

  it('mantiene accesible la fuente personal solo en la colección de su propietario y valida enums visibles', () => {
    const { connection, rows } = setup({ spacedCollections: [collection({ visibility: 'personal' })], spacedCards: [card()],
      notes: [note({ visibility: 'personal' })] });
    expect(readSnapshot(connection, SELF).spacedCards).toHaveLength(1);
    rows.mySpacedReviews = [review({ rating: 'future' })];
    expect(() => readSnapshot(connection, SELF)).toThrow('versión');
  });

  it('limpia las vistas privadas al perder membresía o cambiar de identidad antes de evaluar filas antiguas', () => {
    const { connection, rows } = setup({ spacedCollections: [{ invalid: 'No evaluar' }],
      mySpacedReviews: [{ invalid: 'No evaluar' }], myMember: [member(SELF, { status: 'removed' })] });
    expect(readSnapshot(connection, SELF)).toEqual({ ...emptySnapshot('ready'), me: expect.objectContaining({ status: 'removed' }) });
    rows.myMember = [member()];
    expect(readSnapshot(connection, OTHER)).toEqual(emptySnapshot('ready'));
  });

  it('crea colecciones/tarjetas identificando su autor y convierte IDs sin perder precisión', async () => {
    const saveSpacedCollection = vi.fn(async () => {
      rows.spacedCollections!.push(collection({ id: 10n, title: 'Colección', ownerId: person(OTHER) }));
      rows.spacedCollections!.push(collection({ id: HIGH, title: 'Colección' }));
    });
    const saveSpacedCard = vi.fn(async () => {
      rows.spacedCards!.push(card({ id: 11n, createdBy: person(OTHER) }));
      rows.spacedCards!.push(card());
    });
    const { actions, rows } = setup({ spacedCollections: [], spacedCards: [] }, { saveSpacedCollection, saveSpacedCard });
    await expect(actions.saveSpacedCollection({ subjectId: SUBJECT.toString(), termId: (HIGH - 1n).toString(),
      title: ' Colección ', visibility: 'group' })).resolves.toBe(HIGH.toString());
    expect(saveSpacedCollection).toHaveBeenCalledWith({ collectionId: undefined, subjectId: SUBJECT, termId: HIGH - 1n,
      title: ' Colección ', visibility: 'group', expectedVersion: undefined });
    await expect(actions.saveSpacedCard({ collectionId: HIGH.toString(), question: ' Pregunta ', explanation: 'Explicación', hint: '',
      sourceKind: 'note', sourceId: '5' })).resolves.toBe((HIGH - 2n).toString());
    expect(saveSpacedCard).toHaveBeenCalledWith({ cardId: undefined, collectionId: HIGH, question: ' Pregunta ', explanation: 'Explicación',
      hint: '', sourceKind: 'note', sourceId: 5n, expectedVersion: undefined });
  });

  it('envía versiones, inscripciones, reparaciones y reintentos con la misma identificación al servidor sin mutar la caché', async () => {
    const saveSpacedCollection = vi.fn(async () => {}); const saveSpacedCard = vi.fn(async () => {});
    const publishSpacedCollection = vi.fn(async () => {}); const archiveSpacedCollection = vi.fn(async () => {});
    const archiveSpacedCard = vi.fn(async () => {}); const setSpacedEnrollment = vi.fn(async () => {});
    const replaceSpacedCardSource = vi.fn(async () => {});
    const reviewSpacedCard = vi.fn(async () => { throw new Error('Sin conexión'); });
    const { actions, rows } = setup({ spacedCollections: [collection()], spacedCards: [card()] }, {
      saveSpacedCollection, saveSpacedCard, publishSpacedCollection, archiveSpacedCollection,
      archiveSpacedCard, setSpacedEnrollment, reviewSpacedCard, replaceSpacedCardSource,
    });
    await expect(actions.saveSpacedCollection({ id: HIGH.toString(), subjectId: SUBJECT.toString(), title: 'Cambio',
      visibility: 'group', expectedVersion: 3 })).resolves.toBe(HIGH.toString());
    await expect(actions.saveSpacedCard({ id: '7', collectionId: HIGH.toString(), question: 'Cambio', explanation: 'Explicación', hint: '',
      sourceKind: 'guide', sourceId: '6', expectedVersion: 4 })).resolves.toBe('7');
    expect(saveSpacedCard).toHaveBeenCalledWith(expect.objectContaining({ cardId: 7n, sourceId: 6n, expectedVersion: 4 }));
    await actions.publishSpacedCollection(HIGH.toString(), 3);
    expect(publishSpacedCollection).toHaveBeenCalledWith({ collectionId: HIGH, expectedVersion: 3 });
    await actions.archiveSpacedCollection(HIGH.toString(), true, 3);
    expect(archiveSpacedCollection).toHaveBeenCalledWith({ collectionId: HIGH, archived: true, expectedVersion: 3 });
    await actions.archiveSpacedCard('7', false, 4);
    expect(archiveSpacedCard).toHaveBeenCalledWith({ cardId: 7n, archived: false, expectedVersion: 4 });
    await actions.replaceSpacedCardSource('7', 4, 'guide', SUBJECT.toString());
    expect(replaceSpacedCardSource).toHaveBeenCalledWith({ cardId: 7n, expectedVersion: 4, sourceKind: 'guide', sourceId: SUBJECT });
    await actions.setSpacedEnrollment(HIGH.toString(), false);
    expect(setSpacedEnrollment).toHaveBeenCalledWith({ collectionId: HIGH, active: false });
    const input = { cardId: '7', cardVersion: 4, expectedRevision: 7, rating: 'again' as const, requestId: 'misma-identificación' };
    await expect(actions.reviewSpacedCard(input)).rejects.toThrow('Sin conexión');
    await expect(actions.reviewSpacedCard(input)).rejects.toThrow('Sin conexión');
    expect(reviewSpacedCard).toHaveBeenNthCalledWith(1, { ...input, cardId: 7n });
    expect(reviewSpacedCard).toHaveBeenNthCalledWith(2, { ...input, cardId: 7n });
    expect(rows.spacedCards).toEqual([card()]);
    expect(rows.mySpacedProgress).toBeUndefined();
  });
});
