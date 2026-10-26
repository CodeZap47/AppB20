import type { SpacedSourceKind, SpacedVisibility } from '@b20/core';
import type { Member, Snapshot, SpacedCard, SpacedCollection, SpacedProgress } from '../data/types';

export interface SpacedSourceInfo {
  kind: SpacedSourceKind;
  id: string;
  title: string;
  link: string;
  version: number;
  subjectId: string;
  termId?: string;
  visibility: SpacedVisibility;
}

export interface SpacedFilters { collectionId?: string; subjectId?: string; termId?: string }
export interface SpacedQueueItem {
  card: SpacedCard;
  collection: SpacedCollection;
  /** Conserva la revisión incluso si el contenido cambió, para detectar carreras al guardar. */
  progress?: SpacedProgress;
  isNew: boolean;
  dueAt?: Date;
}

export function canReadSpacedCollection(collection: SpacedCollection, me: Member | undefined): boolean {
  return me?.status === 'active' && (collection.visibility === 'group' || collection.ownerId === me.id);
}

/** Usa exclusivamente las fuentes que ya puede consultar la persona actual. */
export function spacedSource(card: Pick<SpacedCard, 'sourceKind' | 'sourceId'>, data: Snapshot): SpacedSourceInfo | undefined {
  if (data.me?.status !== 'active') return undefined;
  if (card.sourceKind === 'exam_question') { const stored = data.spacedCards.find((entry) => entry.sourceKind === card.sourceKind && entry.sourceId === card.sourceId); const collection = stored && data.spacedCollections.find((entry) => entry.id === stored.collectionId); return stored && collection?.ownerId === data.me.id && collection.visibility === 'personal' ? { kind: 'exam_question', id: card.sourceId, title: 'Pregunta de examen', link: '/m/examenes', version: stored.sourceVersion, subjectId: collection.subjectId, termId: collection.termId, visibility: 'personal' } : undefined; }
  if (card.sourceKind === 'note') {
    const note = data.notes.find((n) => n.id === card.sourceId &&
      (n.visibility === 'group' || n.authorId === data.me!.id));
    return note && { kind: 'note', id: note.id, title: note.title,
      link: `/m/notas/${note.id}`, version: note.version, subjectId: note.subjectId, visibility: note.visibility };
  }
  const guide = data.guides.find((g) => g.id === card.sourceId);
  return guide && { kind: 'guide', id: guide.id, title: guide.title,
    link: `/m/guias/${guide.id}`, version: guide.version,
    subjectId: guide.subjectId, termId: guide.termId, visibility: 'group' };
}

export function spacedCardsForCollection(data: Snapshot, collectionId: string, includeArchived = false): SpacedCard[] {
  const collection = data.spacedCollections.find((c) => c.id === collectionId);
  if (!collection || !canReadSpacedCollection(collection, data.me)) return [];
  return data.spacedCards.filter((card) => {
    if (card.collectionId !== collectionId || (!includeArchived && card.archived)) return false;
    const source = spacedSource(card, data);
    return source?.subjectId === collection.subjectId &&
      (collection.visibility === 'personal' || source.visibility === 'group');
  });
}

/** Solo colecciones activadas por el alumno; las nuevas tarjetas se incorporan sin otra inscripción. */
export function spacedStudyCards(data: Snapshot, filters: SpacedFilters = {}): SpacedQueueItem[] {
  if (data.connection !== 'ready' || data.me?.status !== 'active') return [];
  const mine = data.me.id;
  const enabled = new Set(data.spacedEnrollments.filter((e) => e.memberId === mine && e.active).map((e) => e.collectionId));
  return data.spacedCollections.filter((c) => enabled.has(c.id) && !c.archived &&
    canReadSpacedCollection(c, data.me) && (!filters.collectionId || c.id === filters.collectionId) &&
    (!filters.subjectId || c.subjectId === filters.subjectId) && (!filters.termId || c.termId === filters.termId))
    .flatMap((collection) => spacedCardsForCollection(data, collection.id).map((card) => {
      const progress = data.spacedProgress.find((p) => p.memberId === mine && p.cardId === card.id);
      const isNew = !progress || progress.cardVersion !== card.version;
      return { card, collection, progress, isNew, dueAt: isNew ? undefined : progress.dueAt };
    }));
}

function byDue(a: SpacedQueueItem, b: SpacedQueueItem): number {
  if (a.isNew !== b.isNew) return a.isNew ? 1 : -1;
  return (a.dueAt?.getTime() ?? a.card.createdAt.getTime()) -
    (b.dueAt?.getTime() ?? b.card.createdAt.getTime()) || a.card.id.localeCompare(b.card.id);
}

export function spacedQueue(data: Snapshot, now = new Date(), filters: SpacedFilters = {}): SpacedQueueItem[] {
  return spacedStudyCards(data, filters).filter((item) => item.isNew || item.dueAt!.getTime() <= now.getTime()).sort(byDue);
}

export function spacedUpcoming(data: Snapshot, now = new Date(), filters: SpacedFilters = {}): SpacedQueueItem[] {
  return spacedStudyCards(data, filters).filter((item) => !item.isNew && item.dueAt!.getTime() > now.getTime()).sort(byDue);
}
