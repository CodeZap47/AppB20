import { describe, expect, it } from 'vitest';
import { MAX_SPACED_HINT_LENGTH, SPACED_DAY_MS, SPACED_INTERVAL_DAYS, type SpacedRating } from '@b20/core';
import { createDemoState, DemoDataSource } from './demo';
import type { SpacedCardInput, SpacedReviewInput } from './types';

const SUBJECT = 'IDSE-05010103';
const OTHER_SUBJECT = 'IDSE-05010104';
const at = new Date('2026-10-21T12:00:00Z');

function setup(viewer = 'demo-2') {
  const state = createDemoState(at);
  state.spacedCollections = []; state.spacedCards = []; state.spacedEnrollments = [];
  state.spacedProgress = []; state.spacedReviews = [];
  let now = new Date(at);
  const data = new DemoDataSource(state, viewer, () => new Date(now));
  return { data, state, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

function deck(data: DemoDataSource, visibility: 'personal' | 'group' = 'group', subjectId = SUBJECT) {
  return data.saveSpacedCollection({ subjectId, title: ' Mis tarjetas ', visibility });
}

function card(data: DemoDataSource, collectionId: string, fields: Partial<SpacedCardInput> = {}) {
  return data.saveSpacedCard({ collectionId, question: ' ¿Qué hace una condición? ',
    explanation: ' Elige qué instrucciones ejecutar. ', hint: ' Piensa en dos caminos. ', sourceKind: 'note', sourceId: 'n1', ...fields });
}

function attempt(data: DemoDataSource, cardId: string, requestId: string, rating: SpacedRating = 'remembered'): SpacedReviewInput {
  const snapshot = data.getSnapshot();
  return { cardId, cardVersion: snapshot.spacedCards.find((item) => item.id === cardId)!.version,
    expectedRevision: snapshot.spacedProgress.find((item) => item.cardId === cardId)?.revision ?? 0, rating, requestId };
}

describe('repaso espaciado en la demo', () => {
  it('muestra colecciones de grupo y mantiene colecciones, inscripciones y resultados personales privados incluso ante administradores', () => {
    const { data } = setup('demo-3');
    const personal = deck(data, 'personal', OTHER_SUBJECT);
    const personalCard = card(data, personal, { sourceId: 'n2' });
    data.setSpacedEnrollment(personal, true);
    data.reviewSpacedCard(attempt(data, personalCard, 'privado'));
    const group = deck(data);
    const groupCard = card(data, group);
    data.setSpacedEnrollment(group, true);
    data.reviewSpacedCard(attempt(data, groupCard, 'grupo-privado'));
    for (const viewer of ['demo-1', 'demo-2']) {
      data.setViewer(viewer);
      const snapshot = data.getSnapshot();
      expect(snapshot.spacedCollections.map((item) => item.id)).toEqual([group]);
      expect(snapshot.spacedCards.map((item) => item.id)).toEqual([groupCard]);
      expect(snapshot.spacedEnrollments).toEqual([]);
      expect(snapshot.spacedProgress).toEqual([]);
      expect(snapshot.spacedReviews).toEqual([]);
      expect(() => data.saveSpacedCard({ id: personalCard, collectionId: personal, question: 'Cruce', explanation: 'Cruce',
        hint: '', sourceKind: 'note', sourceId: 'n2', expectedVersion: 1 })).toThrow('acceso');
      expect(() => data.setSpacedEnrollment(personal, true)).toThrow('acceso');
    }
    data.setViewer('demo-3');
    expect(data.getSnapshot().spacedProgress).toHaveLength(2);
    expect(data.getSnapshot().spacedReviews).toHaveLength(2);
  });

  it('valida materia, parcial, fuentes y publicación explícita incluyendo tarjetas archivadas', () => {
    const { data } = setup('demo-3');
    expect(() => data.saveSpacedCollection({ subjectId: SUBJECT, termId: `${OTHER_SUBJECT}-p1`, title: 'Error', visibility: 'personal' })).toThrow('parcial');
    const personal = deck(data, 'personal', OTHER_SUBJECT);
    const privateCard = card(data, personal, { sourceId: 'n2' });
    expect(() => card(data, personal, { sourceId: 'n1' })).toThrow('materia');
    expect(() => card(data, personal, { sourceId: 'missing' })).toThrow('fuente');
    expect(() => data.saveSpacedCollection({ id: personal, subjectId: OTHER_SUBJECT, title: 'Compartir', visibility: 'group', expectedVersion: 1 })).toThrow('Publicar');
    data.archiveSpacedCard(privateCard, true, 1);
    expect(() => data.publishSpacedCollection(personal, 1)).toThrow('personales');
    data.saveSpacedCard({ ...data.getSnapshot().spacedCards.find((item) => item.id === privateCard)!,
      sourceId: 'n3', expectedVersion: 2 });
    data.publishSpacedCollection(personal, 1);
    expect(data.getSnapshot().spacedCollections.find((item) => item.id === personal)).toMatchObject({ visibility: 'group', version: 2 });
    expect(() => card(data, personal, { sourceId: 'n2' })).toThrow('personales');
    expect(() => data.saveSpacedCollection({ id: personal, subjectId: SUBJECT, title: 'Mover', visibility: 'group', expectedVersion: 2 })).toThrow('materia');
    expect(() => data.saveSpacedCollection({ id: personal, subjectId: OTHER_SUBJECT, title: 'Privada', visibility: 'personal', expectedVersion: 2 })).toThrow('compartida');
  });

  it('permite editar lo compartido a integrantes activos y reserva publicar/archivar al propietario', () => {
    const { data } = setup();
    const collectionId = deck(data);
    const cardId = card(data, collectionId);
    data.setViewer('demo-3');
    data.saveSpacedCollection({ id: collectionId, subjectId: SUBJECT, title: 'Edición compartida', visibility: 'group', expectedVersion: 1 });
    data.saveSpacedCard({ ...data.getSnapshot().spacedCards.find((item) => item.id === cardId)!, explanation: 'Otro ejemplo.', expectedVersion: 1 });
    expect(data.getSnapshot().spacedCards.find((item) => item.id === cardId)).toMatchObject({ updatedBy: 'demo-3', version: 2 });
    expect(() => data.publishSpacedCollection(collectionId, 2)).toThrow('propietario');
    expect(() => data.archiveSpacedCollection(collectionId, true, 2)).toThrow('propietario');
    data.setViewer('demo-1');
    data.removeMember('demo-2');
    expect(data.getSnapshot().spacedCollections.find((item) => item.id === collectionId)).toBeDefined();
    data.saveSpacedCollection({ id: collectionId, subjectId: SUBJECT, title: 'Grupo conserva la colección', visibility: 'group', expectedVersion: 2 });
    data.setViewer('demo-2');
    expect(data.getSnapshot().spacedCollections).toEqual([]);
    expect(() => data.setSpacedEnrollment(collectionId, true)).toThrow('miembro activo');
  });

  it('aplica todos los intervalos, limita a 120 días y toma el vencimiento desde el reloj de la fuente', () => {
    const { data, advance } = setup();
    const collectionId = deck(data); const cardId = card(data, collectionId);
    data.setSpacedEnrollment(collectionId, true);
    for (const [index, days] of [...SPACED_INTERVAL_DAYS, 120].entries()) {
      const before = data.getSnapshot().spacedProgress.find((item) => item.cardId === cardId)?.revision ?? 0;
      data.reviewSpacedCard(attempt(data, cardId, `intervalo-${index}`));
      const progress = data.getSnapshot().spacedProgress.find((item) => item.cardId === cardId)!;
      expect(progress.dueAt.getTime() - progress.reviewedAt.getTime()).toBe(days * SPACED_DAY_MS);
      expect(progress.step).toBe(Math.min(index + 1, 7));
      expect(progress.revision).toBe(before + 1);
      expect(() => data.reviewSpacedCard(attempt(data, cardId, `temprano-${index}`))).toThrow('Todavía');
      advance(days * SPACED_DAY_MS);
    }
    data.reviewSpacedCard(attempt(data, cardId, 'pista', 'hint'));
    expect(data.getSnapshot().spacedProgress[0]).toMatchObject({ step: 7 });
    advance(SPACED_DAY_MS);
    data.reviewSpacedCard(attempt(data, cardId, 'otra-vez', 'again'));
    const progress = data.getSnapshot().spacedProgress[0]!;
    expect(progress.step).toBe(0);
    expect(progress.dueAt.getTime() - progress.reviewedAt.getTime()).toBe(10 * 60_000);
    advance(10 * 60_000);
    data.reviewSpacedCard(attempt(data, cardId, 'reinicio'));
    expect(data.getSnapshot().spacedProgress[0]?.step).toBe(1);
  });

  it('hace los reintentos idempotentes, rechaza colisiones y evita avances concurrentes entre pestañas', () => {
    const { data } = setup();
    const collectionId = deck(data); const cardId = card(data, collectionId);
    data.setSpacedEnrollment(collectionId, true);
    const input = attempt(data, cardId, 'mismo-envio');
    data.reviewSpacedCard(input);
    data.reviewSpacedCard(input);
    expect(data.getSnapshot().spacedReviews).toHaveLength(1);
    expect(data.getSnapshot().spacedProgress[0]?.revision).toBe(1);
    expect(() => data.reviewSpacedCard({ ...input, requestId: 'otra-pestaña' })).toThrow('progreso');
    expect(() => data.reviewSpacedCard({ ...input, rating: 'again' })).toThrow('identificación');
    data.archiveSpacedCard(cardId, true, 1);
    expect(() => data.reviewSpacedCard(input)).not.toThrow();
    data.setViewer('demo-3');
    data.archiveSpacedCard(cardId, false, 2);
    data.setSpacedEnrollment(collectionId, true);
    data.reviewSpacedCard(attempt(data, cardId, 'mismo-envio'));
    expect(data.getSnapshot().spacedReviews).toHaveLength(1);
  });

  it('reinicia aprendizaje al editar contenido; referencia/archivo conservan aprendizaje sin rescatar versiones anteriores', () => {
    const { data } = setup();
    const collectionId = deck(data); const cardId = card(data, collectionId);
    data.setSpacedEnrollment(collectionId, true);
    const oldSession = attempt(data, cardId, 'antes'); data.reviewSpacedCard(oldSession);
    const saved = data.getSnapshot().spacedProgress[0]!;
    data.saveSpacedCard({ ...data.getSnapshot().spacedCards[0]!, sourceKind: 'guide', sourceId: 'gd1', expectedVersion: 1 });
    expect(data.getSnapshot().spacedProgress[0]).toMatchObject({ ...saved, cardVersion: 2, revision: 2 });
    expect(() => data.reviewSpacedCard({ ...oldSession, requestId: 'vieja' })).toThrow('contenido');
    data.saveSpacedCard({ ...data.getSnapshot().spacedCards[0]!, hint: 'Una pista mejor.', expectedVersion: 2 });
    expect(data.getSnapshot().spacedProgress[0]?.cardVersion).toBe(2);
    data.archiveSpacedCard(cardId, true, 3);
    data.archiveSpacedCard(cardId, false, 4);
    expect(data.getSnapshot().spacedProgress[0]?.cardVersion).toBe(2);
    data.reviewSpacedCard(attempt(data, cardId, 'contenido-nuevo'));
    expect(data.getSnapshot().spacedProgress[0]).toMatchObject({ cardVersion: 5, step: 1, revision: 3 });
    expect(data.getSnapshot().spacedReviews).toHaveLength(2);
    expect(() => data.saveSpacedCard({ ...data.getSnapshot().spacedCards[0]!, explanation: 'Cambio de pestaña', expectedVersion: 4 })).toThrow('contenido');
  });

  it('no modifica la tarjeta al cambiar la fuente y retira fuentes privadas/inexistentes conservando el historial', () => {
    const { data, state } = setup();
    const collectionId = deck(data); const cardId = card(data, collectionId);
    data.setSpacedEnrollment(collectionId, true);
    data.reviewSpacedCard(attempt(data, cardId, 'guardado'));
    const originalCard = data.getSnapshot().spacedCards[0]!;
    const note = data.getSnapshot().notes.find((item) => item.id === 'n1')!;
    data.saveNote({ ...note, body: 'Fuente actualizada', id: 'n1' });
    expect(data.getSnapshot().spacedCards[0]).toEqual(originalCard);
    expect(data.getSnapshot().notes.find((item) => item.id === 'n1')?.version).toBe(2);
    data.saveNote({ ...note, visibility: 'personal', id: 'n1' });
    expect(data.getSnapshot().spacedCards).toEqual([]);
    expect(data.getSnapshot().spacedUnavailableCards).toEqual([{ id: cardId, collectionId, version: 1, archived: false }]);
    expect(data.getSnapshot().spacedProgress).toHaveLength(1);
    expect(data.getSnapshot().spacedReviews).toHaveLength(1);
    expect(() => data.reviewSpacedCard({ cardId, cardVersion: 1, expectedRevision: 1, rating: 'again', requestId: 'no-fuente' })).toThrow('fuente');
    data.replaceSpacedCardSource(cardId, 1, 'guide', 'gd1');
    expect(data.getSnapshot().spacedUnavailableCards).toEqual([]);
    expect(data.getSnapshot().spacedCards[0]?.question).toBe(originalCard.question);
    expect(data.getSnapshot().spacedProgress[0]?.cardVersion).toBe(2);
    state.guides = [];
    data.setViewer('demo-2');
    expect(data.getSnapshot().spacedCards).toEqual([]);
    expect(data.getSnapshot().spacedReviews).toHaveLength(1);
  });

  it('pausar y archivar conservan el progreso, nuevas tarjetas entran sin inscripción individual y metadatos no reinician', () => {
    const { data } = setup();
    const collectionId = deck(data); const cardId = card(data, collectionId);
    expect(() => data.reviewSpacedCard(attempt(data, cardId, 'sin-inscripcion'))).toThrow('Añade');
    data.setSpacedEnrollment(collectionId, true);
    data.reviewSpacedCard(attempt(data, cardId, 'primera'));
    const saved = data.getSnapshot().spacedProgress[0]!;
    data.saveSpacedCollection({ ...data.getSnapshot().spacedCollections[0]!, title: 'Otro título', expectedVersion: 1 });
    expect(data.getSnapshot().spacedProgress[0]).toEqual(saved);
    data.setSpacedEnrollment(collectionId, false);
    const another = card(data, collectionId, { question: 'Otra pregunta' });
    expect(() => data.reviewSpacedCard(attempt(data, another, 'pausada'))).toThrow('Añade');
    data.setSpacedEnrollment(collectionId, true);
    data.reviewSpacedCard(attempt(data, another, 'nueva'));
    data.archiveSpacedCollection(collectionId, true, 2);
    expect(data.getSnapshot().spacedProgress).toHaveLength(2);
    expect(() => data.setSpacedEnrollment(collectionId, true)).toThrow('archivada');
    expect(() => data.reviewSpacedCard(attempt(data, cardId, 'archivada'))).toThrow('disponibles');
    data.archiveSpacedCollection(collectionId, false, 3);
    expect(data.getSnapshot().spacedProgress.find((item) => item.cardId === cardId)).toEqual(saved);
  });

  it('valida límites sin cambios parciales y limpia datos al terminar la sesión', () => {
    const { data } = setup();
    const collectionId = deck(data);
    expect(() => card(data, collectionId, { question: ' ' })).toThrow('pregunta');
    expect(() => card(data, collectionId, { hint: 'x'.repeat(MAX_SPACED_HINT_LENGTH + 1) })).toThrow('pista');
    expect(data.getSnapshot().spacedCards).toEqual([]);
    const cardId = card(data, collectionId);
    const before = data.getSnapshot();
    data.setSpacedEnrollment(collectionId, true);
    data.reviewSpacedCard(attempt(data, cardId, 'sin-novedad'));
    for (const field of ['notes', 'guides', 'revisions', 'questions', 'activities', 'lastSeenAt'] as const) {
      expect(data.getSnapshot()[field]).toEqual(before[field]);
    }
    data.dispose();
    expect(data.getSnapshot().spacedCollections).toEqual([]);
    expect(data.getSnapshot().spacedProgress).toEqual([]);
    expect(data.getSnapshot().spacedReviews).toEqual([]);
    expect(() => data.setSpacedEnrollment(collectionId, true)).toThrow('sesión de prueba');
  });
});
