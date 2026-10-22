import {
  CONTRIBUTION_RULES,
  EMPTY_TEACHING_EXPLANATION,
  teachingNoteBody,
  type TeachingExplanation,
} from '@b20/core';
import { describe, expect, it } from 'vitest';
import { buildLeaderboard, contributionEntries } from '../lib/contributions';
import { candidateSources, describeSource, guideStatus } from '../lib/guides';
import { spacedCardsForCollection, spacedQueue, spacedSource, spacedUpcoming } from '../lib/spaced';
import { buildNews } from '../lib/whatsNew';
import { createDemoState, DemoDataSource } from './demo';
import type { CreateTeachingPracticeInput, SaveTeachingPracticeInput, Snapshot } from './types';

let teachingRequestSequence = 0;
function saveTeaching(data: DemoDataSource, id: string, input: SaveTeachingPracticeInput) {
  const expectedVersion = data.getSnapshot().teachingPractices.find((row) => row.id === id)?.version ?? 1;
  const requestId = `00000000-0000-4000-8000-${String(++teachingRequestSequence).padStart(12, '0')}`;
  return data.saveTeachingPractice(id, { ...input, expectedVersion, requestId });
}

const SUBJECT = 'IDSE-05010103';
const OWNER = 'demo-3';
const REVIEWER = 'demo-2';
const THIRD = 'demo-4';
const ADMIN = 'demo-1';
const NOW = new Date('2026-10-21T12:00:00Z');
const INITIAL: TeachingExplanation = {
  concept: 'Borrador reservado del concepto',
  example: 'Ejemplo reservado de la práctica',
  limits: 'Límites reservados de la práctica',
};
const REVISED: TeachingExplanation = {
  concept: 'Una condición selecciona un camino según un valor lógico.',
  example: 'Si hay cupo, se permite registrar a otra persona.',
  limits: 'La decisión debe repetirse cuando cambie el cupo disponible.',
};
const REFLECTION = 'Reflexión personal sobre mi dificultad para explicarlo';
const TOPICS = 'Pendiente privado: distinguir condición y repetición';
const ANSWER = 'Respuesta privada a la pregunta orientadora';

function snapshotAs(data: DemoDataSource, memberId: string): Snapshot {
  data.setViewer(memberId);
  return data.getSnapshot();
}

function setup() {
  const data = new DemoDataSource(createDemoState(NOW), OWNER, () => new Date(NOW));
  const personalNoteId = data.saveNote({
    subjectId: SUBJECT, topic: 'Condiciones', title: 'Fuente personal que no debe aparecer',
    body: 'Contenido original personal que no debe copiarse', tags: ['solo-mio'],
    visibility: 'personal', source: 'student',
  });
  data.setViewer(REVIEWER);
  const guideId = data.createGuide({
    subjectId: SUBJECT, title: 'Guía compartida de condiciones', topicsText: 'Condiciones',
    sections: ['Contenido original de la guía que no debe copiarse'],
  }, []);
  data.setViewer(OWNER);
  return { data, personalNoteId, guideId };
}

function completePractice(data: DemoDataSource, source: NonNullable<CreateTeachingPracticeInput['source']>, topic: string) {
  data.setViewer(OWNER);
  const id = data.createTeachingPractice({
    subjectId: SUBJECT, topic, initial: { ...EMPTY_TEACHING_EXPLANATION }, source,
  });
  expect(data.getSnapshot().teachingPractices.find((practice) => practice.id === id)?.initial)
    .toEqual(EMPTY_TEACHING_EXPLANATION);
  saveTeaching(data, id, { initial: INITIAL, revised: EMPTY_TEACHING_EXPLANATION,
    reflection: '', topicsToReview: '' });
  data.startTeachingPractice(id);
  data.setTeachingReviewer(id, REVIEWER);
  const guided = data.getSnapshot().teachingQuestions.find((question) => question.practiceId === id)!;
  data.answerTeachingQuestion(guided.id, ANSWER);
  data.setViewer(REVIEWER);
  const peerId = data.askTeachingQuestion(id, 'Pregunta privada sobre el ejemplo');
  data.setViewer(OWNER);
  data.answerTeachingQuestion(peerId, 'Respuesta reservada al compañero');
  saveTeaching(data, id, { initial: INITIAL, revised: REVISED,
    reflection: REFLECTION, topicsToReview: TOPICS });
  data.completeTeachingPractice(id);
  return id;
}

/** Estos son los datos públicos que consumen Perfiles, Novedades y Contribuciones. */
function publicOutputs(snapshot: Snapshot) {
  return {
    profileNotes: snapshot.notes.filter((note) => note.authorId === OWNER),
    news: buildNews(snapshot),
    contributions: contributionEntries(snapshot),
    leaderboard: buildLeaderboard(snapshot, {}),
    guideSources: candidateSources(SUBJECT, undefined, snapshot),
  };
}

function expectPrivateNoteHidden(data: DemoDataSource, personalNoteId: string) {
  for (const viewer of [REVIEWER, THIRD, ADMIN]) {
    const snapshot = snapshotAs(data, viewer);
    expect(snapshot.notes.some((note) => note.id === personalNoteId)).toBe(false);
    expect(describeSource({ kind: 'nota', refId: personalNoteId }, snapshot)).toBeUndefined();
    expect(JSON.stringify(publicOutputs(snapshot))).not.toContain(personalNoteId);
    expect(JSON.stringify(snapshot)).not.toContain('Contenido original personal que no debe copiarse');
    expect(JSON.stringify(snapshot)).not.toContain(REFLECTION);
    expect(JSON.stringify(snapshot)).not.toContain(TOPICS);
  }
}

describe('Aprende enseñando junto con los demás módulos', () => {
  it.each(['note', 'guide'] as const)(
    'desde %s solo publica una nota normal y mantiene los cambios privados fuera de otros módulos',
    (kind) => {
      const { data, personalNoteId, guideId } = setup();
      const before = publicOutputs(snapshotAs(data, THIRD));
      const source = { kind, id: kind === 'note' ? personalNoteId : guideId };
      const topic = `Condiciones explicadas desde ${kind}`;
      const practiceId = completePractice(data, source, topic);
      const completed = data.getSnapshot();
      expect(completed.teachingPractices.find((practice) => practice.id === practiceId))
        .toMatchObject({ subjectId: SUBJECT, ownerId: OWNER, status: 'completed', initial: INITIAL, revised: REVISED });
      expect(completed.teachingPersonal.find((personal) => personal.practiceId === practiceId))
        .toMatchObject({ sourceKind: kind, sourceId: source.id, sourceVersion: 1 });
      for (const viewer of [REVIEWER, THIRD, ADMIN]) {
        const snapshot = snapshotAs(data, viewer);
        const outputs = publicOutputs(snapshot);
        // A collaborator can read the practice, but its questions and reflection never become contributions.
        expect(outputs.contributions).toEqual(before.contributions);
        expect(outputs.profileNotes).toEqual(before.profileNotes);
        expect(outputs.leaderboard).toEqual(before.leaderboard);
        expect(JSON.stringify(outputs)).not.toContain(topic);
        expect(JSON.stringify(outputs)).not.toContain(ANSWER);
      }
      expect(publicOutputs(snapshotAs(data, THIRD))).toEqual(before);
      expectPrivateNoteHidden(data, personalNoteId);

      data.setViewer(OWNER);
      const noteId = data.publishTeachingExplanation(practiceId);
      expect(data.publishTeachingExplanation(practiceId)).toBe(noteId);
      const note = data.getSnapshot().notes.find((item) => item.id === noteId)!;
      expect(note).toMatchObject({
        authorId: OWNER, subjectId: SUBJECT, topic, title: topic, visibility: 'group',
        source: 'student', body: teachingNoteBody(REVISED), version: 1,
      });
      const publicAfter = publicOutputs(snapshotAs(data, THIRD));
      expect(publicAfter.profileNotes).toEqual([...before.profileNotes, note]);
      const newContributions = publicAfter.contributions.filter((entry) =>
        !before.contributions.some((old) => old.refId === entry.refId && old.kind === entry.kind));
      expect(newContributions).toEqual([expect.objectContaining({
        kind: 'apunte', refId: noteId, memberId: OWNER, link: `/m/notas/${noteId}`,
      })]);
      const priorPoints = before.leaderboard.find((entry) => entry.memberId === OWNER)!.points;
      expect(publicAfter.leaderboard.find((entry) => entry.memberId === OWNER)!.points)
        .toBe(priorPoints + CONTRIBUTION_RULES.apunte.points);
      const newNews = publicAfter.news.filter((item) => !before.news.some((old) => old.key === item.key));
      expect(newNews).toEqual([expect.objectContaining({
        kind: 'nota', actorId: OWNER, link: `/m/notas/${noteId}`, text: `compartió la nota de clase «${topic}»`,
      })]);
      for (const secret of [INITIAL.concept, INITIAL.example, INITIAL.limits, REFLECTION, TOPICS, ANSWER,
        'Pregunta privada sobre el ejemplo', 'Contenido original personal que no debe copiarse',
        'Contenido original de la guía que no debe copiarse']) {
        expect(JSON.stringify(publicAfter)).not.toContain(secret);
      }

      data.setViewer(OWNER);
      data.reopenTeachingPractice(practiceId);
      const changed = { ...REVISED, concept: 'Nueva explicación que sigo trabajando en privado' };
      saveTeaching(data, practiceId, { initial: INITIAL, revised: changed,
        reflection: REFLECTION, topicsToReview: TOPICS });
      expect(data.publishTeachingExplanation(practiceId)).toBe(noteId);
      expect(data.getSnapshot().notes.find((item) => item.id === noteId)).toEqual(note);
      expect(publicOutputs(snapshotAs(data, THIRD))).toEqual(publicAfter);

      data.setViewer(OWNER);
      data.saveNote({ ...note, body: 'Edición posterior hecha desde Notas' });
      expect(data.getSnapshot().teachingPractices.find((item) => item.id === practiceId)?.revised).toEqual(changed);
      expect(data.publishTeachingExplanation(practiceId)).toBe(noteId);
      const afterNoteEdit = publicOutputs(snapshotAs(data, THIRD));
      expect(afterNoteEdit.profileNotes.filter((item) => item.id === noteId)).toHaveLength(1);
      expect(afterNoteEdit.contributions).toEqual(publicAfter.contributions);
      expect(afterNoteEdit.news.filter((item) => item.link === `/m/notas/${noteId}`))
        .toEqual([expect.objectContaining({ text: `actualizó la nota de clase «${topic}»` })]);
      expectPrivateNoteHidden(data, personalNoteId);
    },
  );

  it('permite citar la nota publicada en Guías y Repaso sin compartir la fuente personal ni el progreso', () => {
    const { data, personalNoteId } = setup();
    const practiceId = completePractice(data, { kind: 'note', id: personalNoteId }, 'Condiciones con ejemplos');
    const noteId = data.publishTeachingExplanation(practiceId);
    const publicNote = data.getSnapshot().notes.find((note) => note.id === noteId)!;
    const beforeGuide = data.getSnapshot();
    expect(candidateSources(SUBJECT, undefined, beforeGuide).unplaced)
      .toContainEqual(expect.objectContaining({ kind: 'nota', refId: noteId, link: `/m/notas/${noteId}` }));
    const guideId = data.createGuide({ subjectId: SUBJECT, title: 'Guía con explicación publicada',
      topicsText: 'Condiciones', sections: [] }, [{ kind: 'nota', refId: noteId }]);
    const guide = data.getSnapshot().guides.find((item) => item.id === guideId)!;
    const linkedSource = guideStatus(guide, data.getSnapshot()).sources;
    expect(linkedSource).toHaveLength(1);
    expect(linkedSource[0]!.source).toMatchObject({ kind: 'nota', refId: noteId, sourceVersion: publicNote.version });
    expect(linkedSource[0]!.info).toMatchObject({ title: publicNote.title, link: `/m/notas/${noteId}` });

    const collectionId = data.saveSpacedCollection({ subjectId: SUBJECT, title: 'Repasar la explicación', visibility: 'group' });
    const cardId = data.saveSpacedCard({ collectionId, question: '¿Cuándo se usa una condición?',
      explanation: REVISED.concept, hint: 'Recuerda el cupo disponible.', sourceKind: 'note', sourceId: noteId });
    data.setSpacedEnrollment(collectionId, true);
    const ownCard = spacedQueue(data.getSnapshot(), NOW, { collectionId })[0]!;
    expect(ownCard).toMatchObject({ card: { id: cardId, sourceId: noteId, sourceVersion: 1 }, isNew: true });
    data.reviewSpacedCard({ cardId, cardVersion: ownCard.card.version, expectedRevision: 0,
      rating: 'remembered', requestId: 'owner-studies-published-explanation' });
    const ownerProgress = data.getSnapshot().spacedProgress.find((progress) => progress.cardId === cardId)!;
    expect(ownerProgress).toMatchObject({ memberId: OWNER, step: 1, revision: 1 });
    expect(spacedQueue(data.getSnapshot(), NOW, { collectionId })).toEqual([]);
    expect(spacedUpcoming(data.getSnapshot(), NOW, { collectionId })).toHaveLength(1);
    const publicAfterSetup = publicOutputs(snapshotAs(data, THIRD));

    data.setViewer(REVIEWER);
    expect(data.getSnapshot().spacedProgress.some((progress) => progress.cardId === cardId)).toBe(false);
    expect(data.getSnapshot().spacedReviews.some((review) => review.cardId === cardId)).toBe(false);
    data.setSpacedEnrollment(collectionId, true);
    const reviewerCard = spacedQueue(data.getSnapshot(), NOW, { collectionId })[0]!;
    expect(reviewerCard).toMatchObject({ isNew: true, progress: undefined });
    expect(spacedSource(reviewerCard.card, data.getSnapshot()))
      .toMatchObject({ id: noteId, visibility: 'group', version: 1, link: `/m/notas/${noteId}` });
    data.reviewSpacedCard({ cardId, cardVersion: reviewerCard.card.version, expectedRevision: 0,
      rating: 'again', requestId: 'reviewer-studies-published-explanation' });
    expect(data.getSnapshot().spacedProgress.find((progress) => progress.cardId === cardId))
      .toMatchObject({ memberId: REVIEWER, step: 0, revision: 1 });
    expect(data.getSnapshot().spacedCards.find((card) => card.id === cardId)?.sourceId).toBe(noteId);
    expect(snapshotAs(data, OWNER).spacedProgress.find((progress) => progress.cardId === cardId)).toEqual(ownerProgress);
    expect(publicOutputs(snapshotAs(data, THIRD))).toEqual(publicAfterSetup);

    for (const viewer of [REVIEWER, THIRD, ADMIN]) {
      const snapshot = snapshotAs(data, viewer);
      expect(spacedCardsForCollection(snapshot, collectionId)).toHaveLength(1);
      expect(guideStatus(snapshot.guides.find((item) => item.id === guideId)!, snapshot).sources[0]!.info?.refId).toBe(noteId);
      expect(snapshot.spacedProgress.filter((progress) => progress.memberId !== viewer)).toEqual([]);
      expect(snapshot.spacedReviews.filter((review) => review.memberId !== viewer)).toEqual([]);
    }
    expectPrivateNoteHidden(data, personalNoteId);
  });
});
