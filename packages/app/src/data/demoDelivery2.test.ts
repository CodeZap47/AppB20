import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import type { MemberProfileInput, SaveNoteInput } from './types';

let source: DemoDataSource;
beforeEach(() => { source = new DemoDataSource(createDemoState(), 'demo-2', () => new Date('2026-10-21T12:00:00Z')); });
afterEach(() => source.dispose());
const noteInput = (): SaveNoteInput => ({ subjectId: source.getSnapshot().subjects[0]!.id, topic: 'Prueba', title: 'Nota privada', body: 'Versión privada', tags: [], source: 'student', visibility: 'personal' });

describe('integración de stores de la segunda entrega en la demo', () => {
  it('publica una copia con adjuntos independientes sin exponer la nota ni sus versiones privadas', async () => {
    const personalId = source.saveNote(noteInput());
    const originalFile = await source.attachResourceFile('note', personalId, new File(['privado'], 'prueba.txt'), 1);
    expect(source.getSnapshot().notes.find((note) => note.id === personalId)?.version).toBe(2);
    const publishedId = source.publishNoteVersion(personalId, 2);
    expect(source.publishNoteVersion(personalId, 2)).toBe(publishedId);
    const publicFile = source.getSnapshot().resourceFiles.find((file) => file.targetKind === 'note' && file.targetId === publishedId)!;
    expect(publicFile.id).not.toBe(originalFile);
    source.setViewer('demo-4');
    expect(source.getSnapshot().notes.some((note) => note.id === personalId)).toBe(false);
    expect(source.getSnapshot().notes.find((note) => note.id === publishedId)?.visibility).toBe('group');
    expect(source.getSnapshot().notes.find((note) => note.id === publishedId)?.publishedFromId).toBeUndefined();
    expect(source.getSnapshot().noteVersions.some((version) => version.noteId === personalId)).toBe(false);
    await expect(source.downloadResourceFile(originalFile)).rejects.toThrow(/acceso|no existe/);
    expect(await (await source.downloadResourceFile(publicFile.id)).text()).toBe('privado');
    source.setViewer('demo-2'); source.removeResourceFile(originalFile, 2);
    expect(await (await source.downloadResourceFile(publicFile.id)).text()).toBe('privado');
  });
  it('versiona el perfil y su foto, y exige el perfil actual para elegir una imagen', async () => {
    const input: MemberProfileInput = { preferredName: 'Luis', bio: 'Estudio programación', interests: [], learningGoals: '', skills: [], helpTopics: [], portfolioLinks: [], subjectIds: [], expectedVersion: 0 };
    const profileId = source.saveMemberProfile(input);
    const photo = await source.attachResourceFile('profile', profileId, new File([new Uint8Array([137,80,78,71])], 'foto.png', { type: 'image/png' }), 1);
    const profile = source.getSnapshot().memberProfiles.find((row) => row.id === profileId)!;
    expect(profile.version).toBe(2); expect(profile.photoFileId).toBe(photo);
    expect(() => source.saveMemberProfile({ ...input, expectedVersion: 1 })).toThrow(/cambió/);
    const currentPhoto = await source.attachResourceFile('profile', profileId, new File([new Uint8Array([137,80,78,71])], 'foto-nueva.png', { type: 'image/png' }), 2);
    source.setViewer('demo-4'); expect(source.getSnapshot().memberProfiles.some((row) => row.id === profileId)).toBe(true);
    expect(source.getSnapshot().resourceFiles.some((file) => file.id === photo)).toBe(false);
    expect(source.getSnapshot().resourceFiles.some((file) => file.id === currentPhoto)).toBe(true);
    await expect(source.downloadResourceFile(photo)).rejects.toThrow(/acceso/);
    await expect(source.attachResourceFile('profile', profileId, new File(['x'], 'foto.png', { type: 'image/png' }), 3)).rejects.toThrow(/autor/);
  });
  it('mantiene el historial directo privado tras bloquear y al recibir un reporte seleccionado', async () => {
    const conversation = source.openDirectConversation('demo-3');
    const message = source.sendDirectMessage(conversation, 'Elegir evidencia');
    const selected = await source.attachResourceFile('direct_message', message, new File(['seleccionado'], 'evidencia.txt'), 1);
    const excluded = await source.attachResourceFile('direct_message', message, new File(['privado'], 'privado.txt'), 2);
    source.setMemberBlocked('demo-3', true);
    expect(() => source.sendDirectMessage(conversation, 'No enviar')).toThrow(/No se pueden/);
    source.setViewer('demo-3'); expect(source.getSnapshot().directMessages.some((row) => row.id === message)).toBe(true);
    expect(() => source.sendDirectMessage(conversation, 'Tampoco enviar')).toThrow(/No se pueden/);
    source.reportMessage({ scope: 'direct', messageId: message, reason: 'Revisar este adjunto', shareText: false, attachmentIds: [selected] });
    source.setViewer('demo-1');
    expect(source.getSnapshot().directMessages.some((row) => row.id === message)).toBe(false);
    expect(source.getSnapshot().messageReports[0]?.evidenceText).toBe('');
    expect(await (await source.downloadResourceFile(selected)).text()).toBe('seleccionado');
    await expect(source.downloadResourceFile(excluded)).rejects.toThrow(/acceso|no existe/);
  });
  it('las retiradas por moderación conservan versiones y requieren que un administrador las restaure', async () => {
    const id = source.saveNote({ ...noteInput(), visibility: 'group' });
    source.setViewer('demo-1'); source.withdrawContent('note', id, true, 1, 'Revisar antes de publicar');
    expect(source.getSnapshot().notes.find((note) => note.id === id)?.version).toBe(2);
    source.setViewer('demo-4'); expect(source.getSnapshot().notes.some((note) => note.id === id)).toBe(false);
    source.setViewer('demo-2');
    expect(source.getSnapshot().noteVersions.filter((version) => version.noteId === id)).toHaveLength(2);
    expect(() => source.withdrawContent('note', id, false, 2)).toThrow(/administrador/);
    source.setViewer('demo-1'); source.withdrawContent('note', id, false, 2);
    source.setViewer('demo-4'); expect(source.getSnapshot().notes.find((note) => note.id === id)?.withdrawnAt).toBeUndefined();
    source.setViewer('demo-2'); const privateId = source.saveNote(noteInput()); source.setViewer('demo-1');
    expect(() => source.withdrawContent('note', privateId, true, 1, 'No permitido')).toThrow();
  });
  it('cambiar las fuentes de una guía crea versiones completas que se pueden restaurar', () => {
    const subjectId = source.getSnapshot().subjects[0]!.id;
    const noteId = source.saveNote({ ...noteInput(), subjectId, visibility: 'group' });
    const guideId = source.createGuide({ subjectId, title: 'Guía', topicsText: 'Tema', sections: [] }, []);
    source.addGuideSources(guideId, [{ kind: 'nota', refId: noteId }]);
    expect(source.getSnapshot().guides.find((guide) => guide.id === guideId)?.version).toBe(2);
    expect(source.getSnapshot().guideVersions.find((version) => version.guideId === guideId && version.version === 1)?.sources).toEqual([]);
    source.restoreGuideVersion(guideId, 1, 2);
    expect(source.getSnapshot().guideSources.filter((row) => row.guideId === guideId)).toEqual([]);
    expect(source.getSnapshot().guides.find((guide) => guide.id === guideId)?.version).toBe(3);
  });
});
