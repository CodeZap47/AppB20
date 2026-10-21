import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import { DemoChatStore } from './demoChat';

let state: ReturnType<typeof createDemoState>;
let chat: DemoChatStore;
let viewer: string;
let sequence: number;
const now = new Date('2026-10-21T15:00:00Z');
const me = () => state.members.find((member) => member.id === viewer)!;
const snapshot = () => {
  const source = new DemoDataSource(state, viewer, () => now);
  try { return chat.snapshot(source.getSnapshot()); } finally { source.dispose(); }
};
beforeEach(() => {
  state = createDemoState(); viewer = 'demo-2'; sequence = 50_000;
  chat = new DemoChatStore({ state: () => state, active: () => { const member = me(); if (member?.status !== 'active') throw new Error('Miembro inactivo'); return member; }, id: () => String(sequence++), now: () => now, emit() {}, validateText: (text) => { if (!text.trim()) throw new Error('Mensaje vacío'); return text.trim(); } });
});

describe('canales y convivencia de la simulación', () => {
  it('crea canales de materia y proyecto, exige respuesta del mismo canal y conserva el archivo al archivar', () => {
    const subject = state.subjects[0]!.id;
    expect(() => chat.createChatChannel({ name: 'Materia inexistente', kind: 'subject', subjectId: 'missing' })).toThrow(/materia/i);
    const a = chat.createChatChannel({ name: 'Práctica', kind: 'subject', subjectId: subject });
    const b = chat.createChatChannel({ name: 'Proyecto final', kind: 'project' });
    const message = chat.sendChannelMessage(a, 'Primer mensaje');
    expect(() => chat.sendChannelMessage(b, 'Respuesta cruzada', message)).toThrow(/mismo canal/);
    viewer = 'demo-3'; expect(() => chat.setChatChannelArchived(a, true)).toThrow(/creador/);
    viewer = 'demo-2'; chat.setChatChannelArchived(a, true);
    expect(() => chat.sendChannelMessage(a, 'Nuevo')).toThrow(/archivado/);
    expect(chat.channelMessage(message).text).toBe('Primer mensaje');
    chat.setChatChannelArchived(a, false); expect(chat.sendChannelMessage(a, 'Reabierto')).toBeTruthy();
  });
  it('separa punteros y silencio de cada usuario y nunca retrocede una lectura', () => {
    const channel = chat.createChatChannel({ name: 'Equipo', kind: 'project' });
    const first = chat.sendChannelMessage(channel, 'Uno');
    const last = chat.sendChannelMessage(channel, 'Dos');
    chat.markConversationRead('channel', channel, last);
    chat.markConversationRead('channel', channel, first);
    chat.setConversationMuted('channel', channel, true);
    expect(snapshot().conversationStates).toContainEqual({ scope: 'channel', conversationId: channel, readThroughId: last, muted: true });
    viewer = 'demo-3'; expect(snapshot().conversationStates).toEqual([]);
    expect(() => chat.markConversationRead('group', 'general', last)).toThrow(/no pertenece/);
  });
  it('aplica bloqueo bidireccional sin revelar la lista del otro participante', () => {
    chat.setMemberBlocked('demo-3', true);
    expect(() => chat.assertDirectAllowed('demo-3')).toThrow(/No se pueden/);
    expect(snapshot().blockedMembers).toEqual([{ memberId: 'demo-3' }]);
    viewer = 'demo-3'; expect(() => chat.assertDirectAllowed('demo-2')).toThrow(/No se pueden/);
    expect(snapshot().blockedMembers).toEqual([]);
    viewer = 'demo-2'; chat.setMemberBlocked('demo-3', false);
    expect(() => chat.assertDirectAllowed('demo-3')).not.toThrow();
  });
  it('valida menciones activas y limita las de directos a sus dos participantes', () => {
    expect(chat.validateMentions('Hola [[mencion:demo-3]]', ['demo-2', 'demo-3'])).toContain('demo-3');
    expect(() => chat.validateMentions('Hola [[mencion:demo-4]]', ['demo-2', 'demo-3'])).toThrow(/conversación/);
    expect(() => chat.validateMentions('[[mencion:missing]]')).toThrow(/activos/);
  });
});

describe('adjuntos y reportes privados', () => {
  it('un tercero ni siquiera administrador descarga el DM, hasta que se comparte ese archivo explícitamente', async () => {
    state.directConversations.push({ id: 'private', participantIds: ['demo-2', 'demo-3'] });
    state.directMessages.push({ id: 'private-message', conversationId: 'private', senderId: 'demo-2', text: 'Prueba concreta', sentAt: now });
    const included = await chat.attachResourceFile('direct_message', 'private-message', new File(['evidencia'], 'evidencia.txt'), 1);
    const excluded = await chat.attachResourceFile('direct_message', 'private-message', new File(['secreto'], 'privado.txt'), 2);
    viewer = 'demo-1';
    expect(snapshot().resourceFiles.some((file) => file.id === included)).toBe(false);
    await expect(chat.downloadResourceFile(included)).rejects.toThrow(/no disponible/);
    viewer = 'demo-3';
    expect(snapshot().resourceFiles.some((file) => file.id === excluded)).toBe(true);
    const report = chat.reportMessage({ scope: 'direct', messageId: 'private-message', reason: 'Revisar esta prueba', shareText: false, attachmentIds: [included] });
    viewer = 'demo-4'; expect(snapshot().messageReports).toEqual([]);
    await expect(chat.downloadResourceFile(included)).rejects.toThrow(/no disponible/);
    viewer = 'demo-1';
    expect(snapshot().messageReports[0]?.evidenceText).toBe('');
    expect(snapshot().resourceFiles.filter((file) => [included, excluded].includes(file.id)).map((file) => file.id)).toEqual([included]);
    await expect(chat.downloadResourceFile(included)).resolves.toBeInstanceOf(Blob);
    await expect(chat.downloadResourceFile(excluded)).rejects.toThrow(/no disponible/);
    chat.resolveMessageReport(report); expect(snapshot().messageReports[0]?.status).toBe('resolved');
  });
  it('no acepta un adjunto de otro mensaje como prueba y exige versiones antes de retirar', async () => {
    const channel = chat.createChatChannel({ name: 'Convivencia', kind: 'topic' });
    const a = chat.sendChannelMessage(channel, 'Uno'); const b = chat.sendChannelMessage(channel, 'Dos');
    const file = await chat.attachResourceFile('channel_message', a, new File(['hola'], 'hola.txt'), 1);
    expect(chat.versionOf('channel', a)).toBe(2);
    expect(() => chat.removeResourceFile(file, 1)).toThrow(/cambiaron/);
    viewer = 'demo-3';
    expect(() => chat.reportMessage({ scope: 'channel', messageId: b, reason: 'Motivo', shareText: true, attachmentIds: [file] })).toThrow(/no pertenece/);
    await expect(chat.attachResourceFile('channel_message', a, new File(['hola'], 'otro.txt'), 2)).rejects.toThrow(/autor/);
  });
});
