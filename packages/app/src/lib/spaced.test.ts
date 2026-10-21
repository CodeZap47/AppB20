import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { Snapshot, SpacedCard, SpacedCollection } from '../data/types';
import { spacedCardsForCollection, spacedQueue, spacedSource, spacedUpcoming } from './spaced';
import { contributionEntries } from './contributions';
import { buildNews } from './whatsNew';

const now = new Date('2026-10-21T18:00:00Z');
const collection = (patch: Partial<SpacedCollection> = {}): SpacedCollection => ({
  id: 'deck', subjectId: 'subject', termId: 'term', title: 'Conceptos', visibility: 'group',
  ownerId: 'other', version: 1, archived: false, createdAt: now, updatedAt: now, updatedBy: 'other', ...patch,
});
const card = (patch: Partial<SpacedCard> = {}): SpacedCard => ({
  id: 'new', collectionId: 'deck', question: '¿Qué es una variable?', explanation: 'Un nombre asociado a un valor.',
  hint: '', sourceKind: 'note', sourceId: 'note', sourceVersion: 1, version: 1, archived: false,
  createdBy: 'other', updatedBy: 'other', createdAt: now, updatedAt: now, ...patch,
});

function data(): Snapshot {
  return { ...emptySnapshot('ready'),
    me: { id: 'me', displayName: 'Yo', status: 'active', isCreator: true, joinedAt: now },
    spacedCollections: [collection()], spacedCards: [card(), card({ id: 'due' }), card({ id: 'later' })],
    spacedEnrollments: [{ memberId: 'me', collectionId: 'deck', active: true, updatedAt: now }],
    spacedProgress: ['due', 'later'].map((cardId) => ({ memberId: 'me', cardId, cardVersion: 1,
      step: 2, revision: 1, reviewedAt: now, dueAt: new Date(now.getTime() + (cardId === 'due' ? 0 : 1000)) })),
    notes: [{ id: 'note', subjectId: 'subject', topic: '', title: 'Variables', body: 'Texto', tags: [],
      visibility: 'group', source: 'student', authorId: 'other', version: 2, createdAt: now, updatedAt: now }],
  };
}

describe('cola personal de repaso', () => {
  it('el estudio personal no produce puntos ni novedades comunitarias', () => {
    const snapshot = data();
    const points = contributionEntries(snapshot);
    const news = buildNews(snapshot);
    snapshot.spacedReviews.push({ id: 'private', requestId: 'private', memberId: 'me',
      cardId: 'due', cardVersion: 1, rating: 'again', step: 0, reviewedAt: now, dueAt: now });
    snapshot.spacedProgress[0]!.step = 7;
    expect(contributionEntries(snapshot)).toEqual(points);
    expect(buildNews(snapshot)).toEqual(news);
  });
  it('incluye el vencimiento exacto, pone revisiones antes de nuevas y separa próximas', () => {
    const snapshot = data();
    expect(spacedQueue(snapshot, now).map((entry) => entry.card.id)).toEqual(['due', 'new']);
    expect(spacedUpcoming(snapshot, now).map((entry) => entry.card.id)).toEqual(['later']);
    expect(spacedQueue(snapshot, now, { termId: 'another' })).toEqual([]);
    expect(spacedQueue(snapshot, now, { subjectId: 'subject', collectionId: 'deck' })).toHaveLength(2);
  });
  it('una edición reinicia el aprendizaje sin perder la revisión para comprobar concurrencia', () => {
    const snapshot = data();
    snapshot.spacedCards.find((c) => c.id === 'later')!.version = 2;
    const changed = spacedQueue(snapshot, now).find((entry) => entry.card.id === 'later')!;
    expect(changed.isNew).toBe(true);
    expect(changed.progress?.revision).toBe(1);
    expect(changed.dueAt).toBeUndefined();
  });
  it('conserva la referencia original para advertir cambios en la fuente', () => {
    const snapshot = data();
    expect(spacedSource(snapshot.spacedCards[0]!, snapshot)?.version).toBe(2);
    expect(snapshot.spacedCards[0]?.sourceVersion).toBe(1);
  });
  it('pausar o archivar retira las tarjetas; añadir nuevas las incorpora a la siguiente cola', () => {
    const snapshot = data();
    snapshot.spacedCards.push(card({ id: 'added' }));
    expect(spacedQueue(snapshot, now).map((entry) => entry.card.id)).toContain('added');
    snapshot.spacedEnrollments[0]!.active = false;
    expect(spacedQueue(snapshot, now)).toEqual([]);
    snapshot.spacedEnrollments[0]!.active = true;
    snapshot.spacedCollections[0]!.archived = true;
    expect(spacedQueue(snapshot, now)).toEqual([]);
  });
  it('no usa inscripciones, progreso ni colecciones personales ajenas, incluso para creadores', () => {
    const snapshot = data();
    snapshot.spacedEnrollments = [{ memberId: 'other', collectionId: 'deck', active: true, updatedAt: now }];
    expect(spacedQueue(snapshot, now)).toEqual([]);
    snapshot.spacedCollections[0]!.visibility = 'personal';
    expect(spacedCardsForCollection(snapshot, 'deck', true)).toEqual([]);
    snapshot.spacedCollections[0] = collection();
    snapshot.spacedEnrollments = [{ memberId: 'me', collectionId: 'deck', active: true, updatedAt: now }];
    snapshot.spacedProgress.forEach((p) => { p.memberId = 'other'; });
    expect(spacedQueue(snapshot, now).every((entry) => entry.isNew && !entry.progress)).toBe(true);
  });
  it('retira fuentes privadas/inaccesibles o de otra materia sin exponer su contenido', () => {
    const snapshot = data();
    snapshot.notes[0]!.visibility = 'personal';
    expect(spacedSource(snapshot.spacedCards[0]!, snapshot)).toBeUndefined();
    expect(spacedCardsForCollection(snapshot, 'deck', true)).toEqual([]);
    snapshot.notes[0]!.authorId = 'me';
    expect(spacedCardsForCollection(snapshot, 'deck')).toEqual([]);
    snapshot.spacedCollections[0] = collection({ visibility: 'personal', ownerId: 'me' });
    expect(spacedCardsForCollection(snapshot, 'deck')).toHaveLength(3);
    snapshot.notes[0]!.subjectId = 'another';
    expect(spacedQueue(snapshot, now)).toEqual([]);
    snapshot.me!.status = 'removed';
    expect(spacedSource(snapshot.spacedCards[0]!, snapshot)).toBeUndefined();
    expect(spacedUpcoming(snapshot, now)).toEqual([]);
  });
});
