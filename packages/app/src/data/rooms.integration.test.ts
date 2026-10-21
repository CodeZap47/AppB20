import { EMPTY_TEACHING_EXPLANATION, type TeachingExplanation } from '@b20/core';
import { describe, expect, it } from 'vitest';
import { contributionEntries } from '../lib/contributions';
import { buildNews } from '../lib/whatsNew';
import { createDemoState, DemoDataSource } from './demo';
import type { Snapshot } from './types';

const NOW = new Date('2026-10-21T17:00:00Z');
const OWNER = 'demo-2';
const PEER = 'demo-3';
const THIRD = 'demo-4';
const ADMIN = 'demo-1';
const revised: TeachingExplanation = {
  concept: 'Una condición evalúa un valor lógico para elegir una rama.',
  example: 'Si hay cupo se admite a otra persona; de lo contrario se espera.',
  limits: 'Para repetir una acción se utiliza un ciclo, no solo una decisión.',
};

function as(data: DemoDataSource, memberId: string) {
  data.setViewer(memberId);
  return data.getSnapshot();
}
function publicOutput(snapshot: Snapshot) {
  return { news: buildNews(snapshot, NOW), contributions: contributionEntries(snapshot), notes: snapshot.notes };
}
function summaryVersion(data: DemoDataSource, roomId: string) {
  return data.getSnapshot().roomSummaries.find((row) => row.roomId === roomId)!.version;
}
function setup() {
  const data = new DemoDataSource(createDemoState(NOW), OWNER, () => new Date(NOW));
  const contact = data.getSnapshot().helpContacts.find((row) => row.id === 'hc3')!;
  const roomId = data.createStudyRoom({ requestId: 'integration-help-room', title: 'Decisiones en compañía',
    subjectId: contact.subjectId, topic: contact.postTopic, objective: 'Explicar decisiones con ejemplos',
    startsAt: new Date(NOW.getTime() + 3_600_000), endsAt: new Date(NOW.getTime() + 7_200_000),
    capacity: 3, visibility: 'private', helpContactId: contact.id });
  return { data, contact, roomId };
}

describe('Salas junto con Ayuda, materiales y Aprende enseñando reales', () => {
  it('convierte Ayuda sin copiar el contacto y conserva la privacidad hasta aceptar', () => {
    const data = new DemoDataSource(createDemoState(NOW), OWNER, () => new Date(NOW));
    const before = publicOutput(as(data, THIRD));
    as(data, OWNER);
    const contact = data.getSnapshot().helpContacts.find((row) => row.id === 'hc3')!;
    const input = { requestId: 'retry-help-room', title: 'Sesión de conversiones', subjectId: contact.subjectId,
      topic: contact.postTopic, objective: 'Comprender conversiones', startsAt: NOW,
      endsAt: new Date(NOW.getTime() + 3_600_000), capacity: 2, visibility: 'private' as const,
      helpContactId: contact.id };
    const roomId = data.createStudyRoom(input);
    expect(data.createStudyRoom(input)).toBe(roomId);
    const room = data.getSnapshot().studyRooms.find((row) => row.id === roomId)!;
    expect(room.participantCount).toBe(1);
    expect(JSON.stringify(room)).not.toContain(contact.message);
    expect(JSON.stringify(room)).not.toContain(contact.id);
    expect(data.getSnapshot().helpRoomLinks).toContainEqual({ contactId: contact.id, roomId });
    data.sendStudyRoomEntry(roomId, 'message', 'Mensaje reservado de la sesión', 'message-private');
    data.saveStudyRoomSummary(roomId, 'Resumen reservado aún no publicado', summaryVersion(data, roomId));
    const invitation = as(data, PEER);
    expect(invitation.studyRooms.find((row) => row.id === roomId)).toMatchObject({ participantCount: 1 });
    expect(invitation.roomEntries.some((row) => row.roomId === roomId)).toBe(false);
    expect(invitation.roomSummaries.some((row) => row.roomId === roomId)).toBe(false);
    expect(() => data.sendStudyRoomEntry(roomId, 'message', 'No acepté', 'forbidden')).toThrow();
    data.respondStudyRoomInvitation(roomId, true);
    expect(data.getSnapshot().studyRooms.find((row) => row.id === roomId)?.participantCount).toBe(2);
    expect(data.getSnapshot().roomEntries.find((row) => row.roomId === roomId)?.text).toBe('Mensaje reservado de la sesión');
    as(data, OWNER);
    data.closeHelpContact(contact.id);
    expect(data.getSnapshot().studyRooms.find((row) => row.id === roomId)?.status).toBe('scheduled');
    for (const viewer of [THIRD, ADMIN]) {
      const snapshot = as(data, viewer);
      expect(snapshot.studyRooms.some((row) => row.id === roomId)).toBe(false);
      expect(snapshot.helpRoomLinks.some((row) => row.roomId === roomId)).toBe(false);
      expect(JSON.stringify(snapshot)).not.toMatch(/Mensaje reservado de la sesión|Resumen reservado aún no publicado/);
    }
    expect(publicOutput(as(data, THIRD))).toEqual(before);
  });

  it('usa Notas y Guías y comparte la explicación publicada sin entregar la práctica a la sala', () => {
    const { data, roomId } = setup();
    const sourceNote = data.getSnapshot().notes.find((row) => row.id === 'n1')!;
    data.setStudyRoomMaterial(roomId, 'note', sourceNote.id, true);
    const guideId = data.createGuide({ subjectId: sourceNote.subjectId, title: 'Guía de la sesión',
      topicsText: 'Condiciones', sections: [] }, [{ kind: 'nota', refId: sourceNote.id }]);
    data.setStudyRoomMaterial(roomId, 'guide', guideId, true);
    const personal = data.saveNote({ subjectId: sourceNote.subjectId, topic: 'Privado', title: 'Mi fuente reservada',
      body: 'Contenido original reservado', tags: [], visibility: 'personal', source: 'student' });
    expect(() => data.setStudyRoomMaterial(roomId, 'note', personal, true)).toThrow();
    const publicBefore = publicOutput(as(data, THIRD));
    as(data, OWNER);
    const practiceId = data.createTeachingPractice({ subjectId: sourceNote.subjectId, topic: 'Condiciones en la sala',
      source: { kind: 'note', id: sourceNote.id }, initial: { ...EMPTY_TEACHING_EXPLANATION } });
    expect(data.getSnapshot().teachingPractices.find((row) => row.id === practiceId)?.initial)
      .toEqual(EMPTY_TEACHING_EXPLANATION);
    data.saveTeachingPractice(practiceId, { initial: revised, revised: EMPTY_TEACHING_EXPLANATION,
      reflection: '', topicsToReview: '' });
    data.startTeachingPractice(practiceId);
    const question = data.getSnapshot().teachingQuestions.find((row) => row.practiceId === practiceId)!;
    data.answerTeachingQuestion(question.id, 'Respuesta privada de la práctica');
    data.saveTeachingPractice(practiceId, { initial: revised, revised,
      reflection: 'Reflexión privada que no pertenece a la sala', topicsToReview: 'Pendientes privados' });
    data.completeTeachingPractice(practiceId);
    as(data, PEER);
    data.respondStudyRoomInvitation(roomId, true);
    expect(data.getSnapshot().roomMaterials.filter((row) => row.roomId === roomId)).toHaveLength(2);
    expect(data.getSnapshot().teachingPractices.some((row) => row.id === practiceId)).toBe(false);
    expect(JSON.stringify(data.getSnapshot())).not.toMatch(/Reflexión privada que no pertenece|Respuesta privada de la práctica|Contenido original reservado/);
    expect(publicOutput(as(data, THIRD))).toEqual(publicBefore);
    as(data, OWNER);
    const publishedId = data.publishTeachingExplanation(practiceId);
    data.setStudyRoomMaterial(roomId, 'note', publishedId, true);
    expect(data.publishTeachingExplanation(practiceId)).toBe(publishedId);
    const peer = as(data, PEER);
    expect(peer.roomMaterials).toContainEqual(expect.objectContaining({ roomId, sourceId: publishedId, sourceVersion: 1 }));
    expect(peer.notes.find((row) => row.id === publishedId)?.body).toContain(revised.concept);
    expect(peer.teachingPractices.some((row) => row.id === practiceId)).toBe(false);
    const publicAfter = publicOutput(as(data, THIRD));
    expect(publicAfter.contributions.filter((row) => row.refId === publishedId)).toHaveLength(1);
    expect(publicAfter.news.filter((row) => row.link === `/m/notas/${publishedId}`)).toHaveLength(1);
    expect(JSON.stringify(publicAfter)).not.toMatch(/Reflexión privada que no pertenece|Respuesta privada de la práctica|Contenido original reservado/);
    as(data, OWNER);
    data.withdrawContent('note', sourceNote.id, true, sourceNote.version, '');
    expect(as(data, PEER).roomMaterials.some((row) => row.roomId === roomId && row.sourceId === sourceNote.id)).toBe(false);
  });

  it('publica una sola nota del resumen colaborativo y mantiene las ediciones independientes', () => {
    const { data, roomId } = setup();
    const before = publicOutput(as(data, THIRD));
    as(data, PEER);
    data.respondStudyRoomInvitation(roomId, true);
    const initialVersion = summaryVersion(data, roomId);
    data.saveStudyRoomSummary(roomId, 'Borrador redactado por el compañero', initialVersion);
    as(data, OWNER);
    expect(() => data.saveStudyRoomSummary(roomId, 'Edición desactualizada', initialVersion)).toThrow();
    data.sendStudyRoomEntry(roomId, 'question', 'Duda privada que no se publicará', 'private-question');
    let room = data.getSnapshot().studyRooms.find((row) => row.id === roomId)!;
    data.setStudyRoomStatus(roomId, 'active', room.version);
    room = data.getSnapshot().studyRooms.find((row) => row.id === roomId)!;
    data.setStudyRoomStatus(roomId, 'completed', room.version);
    as(data, PEER);
    data.saveStudyRoomSummary(roomId, 'Conclusión revisada entre compañeros.', summaryVersion(data, roomId));
    expect(() => data.publishStudyRoomSummary(roomId, summaryVersion(data, roomId))).toThrow();
    expect(publicOutput(as(data, THIRD))).toEqual(before);
    as(data, OWNER);
    const noteId = data.publishStudyRoomSummary(roomId, summaryVersion(data, roomId));
    expect(data.publishStudyRoomSummary(roomId, summaryVersion(data, roomId))).toBe(noteId);
    const note = data.getSnapshot().notes.find((row) => row.id === noteId)!;
    expect(note).toMatchObject({ visibility: 'group', source: 'student', authorId: OWNER,
      body: 'Conclusión revisada entre compañeros.' });
    data.saveNote({ ...note, body: 'Corregido exclusivamente desde Notas', expectedVersion: note.version });
    as(data, PEER);
    data.saveStudyRoomSummary(roomId, 'Cambio posterior en el resumen privado', summaryVersion(data, roomId));
    as(data, OWNER);
    expect(data.publishStudyRoomSummary(roomId, summaryVersion(data, roomId))).toBe(noteId);
    expect(data.getSnapshot().notes.find((row) => row.id === noteId)?.body).toBe('Corregido exclusivamente desde Notas');
    expect(data.getSnapshot().roomSummaries.find((row) => row.roomId === roomId)?.text).toBe('Cambio posterior en el resumen privado');
    const publicAfter = publicOutput(as(data, THIRD));
    expect(publicAfter.notes.filter((row) => row.id === noteId)).toHaveLength(1);
    expect(publicAfter.contributions.filter((row) => row.refId === noteId)).toHaveLength(1);
    expect(JSON.stringify(publicAfter)).not.toMatch(/Duda privada que no se publicará|Cambio posterior en el resumen privado/);
  });
});
