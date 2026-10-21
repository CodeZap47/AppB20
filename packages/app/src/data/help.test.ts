import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import type { HelpPostInput } from './types';

const input: HelpPostInput = {
  kind: 'offer', subjectId: 'IDSE-05010104', title: 'Puedo explicar ciclos', topic: 'Ciclos',
  description: 'Revisamos juntos un ejercicio de ejemplo.', level: 'initial', modality: 'messages', availability: '',
};
function setup() {
  const state = createDemoState(new Date('2026-10-21T12:00:00Z'));
  state.helpPosts = [];
  state.helpContacts = [];
  const data = new DemoDataSource(state, 'demo-2');
  const postId = data.saveHelpPost(input);
  return { state, data, postId };
}
function send(data: DemoDataSource, postId: string, viewer = 'demo-3') {
  data.setViewer(viewer);
  return data.sendHelpContact(postId, 'Me gustaría practicar.');
}

describe('ayuda entre compañeros en la demo', () => {
  it('publica, edita, cierra y reabre sin compartir disponibilidad automáticamente', () => {
    const { data, postId } = setup();
    expect(data.getSnapshot().helpPosts[0]).toMatchObject({ ...input, status: 'open', authorId: 'demo-2' });
    expect(data.saveHelpPost({ ...input, id: postId, title: '  Otro título  ', availability: 'Por la tarde' })).toBe(postId);
    expect(data.getSnapshot().helpPosts[0]).toMatchObject({ title: 'Otro título', availability: 'Por la tarde' });
    data.setHelpPostStatus(postId, 'closed');
    expect(data.getSnapshot().helpPosts[0]?.status).toBe('closed');
    data.setHelpPostStatus(postId, 'open');
    expect(data.getSnapshot().helpPosts[0]?.status).toBe('open');
  });

  it('solo el autor edita, cambia estado o tipo; ni un administrador edita publicaciones ajenas', () => {
    const { data, postId } = setup();
    expect(() => data.saveHelpPost({ ...input, id: postId, kind: 'request' })).toThrow('tipo');
    for (const viewer of ['demo-3', 'demo-1']) {
      data.setViewer(viewer);
      expect(() => data.saveHelpPost({ ...input, id: postId })).toThrow('autor');
      expect(() => data.setHelpPostStatus(postId, 'closed')).toThrow('autor');
    }
  });

  it('los contactos solo son visibles para emisor y destinatario, sin excepción administrativa', () => {
    const { data, postId } = setup();
    const requestId = send(data, postId);
    expect(data.getSnapshot().helpContacts.map((r) => r.id)).toEqual([requestId]);
    data.setViewer('demo-2');
    expect(data.getSnapshot().helpContacts.map((r) => r.id)).toEqual([requestId]);
    for (const viewer of ['demo-4', 'demo-1']) {
      data.setViewer(viewer);
      expect(data.getSnapshot().helpContacts).toEqual([]);
      expect(() => data.respondHelpContact(requestId, 'accepted')).toThrow('no está disponible');
      expect(() => data.cancelHelpContact(requestId)).toThrow('no está disponible');
      expect(() => data.closeHelpContact(requestId)).toThrow('no está disponible');
    }
  });

  it('impide contactos propios y reenvíos incluso después de rechazo o cancelación', () => {
    const { data, postId } = setup();
    expect(() => data.sendHelpContact(postId)).toThrow('enviarte');
    const requestId = send(data, postId);
    expect(() => data.sendHelpContact(postId)).toThrow('Ya enviaste');
    data.cancelHelpContact(requestId);
    expect(() => data.sendHelpContact(postId)).toThrow('Ya enviaste');
    const another = send(data, postId, 'demo-4');
    data.setViewer('demo-2');
    data.respondHelpContact(another, 'rejected');
    data.setViewer('demo-4');
    expect(() => data.sendHelpContact(postId)).toThrow('Ya enviaste');
  });

  it('aceptar reutiliza el chat, no manda mensajes y deja abierta la publicación', () => {
    const { data, postId } = setup();
    data.setViewer('demo-2');
    const conversationId = data.openDirectConversation('demo-3');
    const requestId = send(data, postId);
    data.setViewer('demo-2');
    const before = data.getSnapshot();
    data.respondHelpContact(requestId, 'accepted');
    expect(data.getSnapshot().helpContacts[0]).toMatchObject({ status: 'accepted', conversationId });
    expect(data.getSnapshot().directConversations).toHaveLength(before.directConversations.length);
    expect(data.getSnapshot().directMessages).toEqual(before.directMessages);
    expect(data.getSnapshot().helpPosts[0]?.status).toBe('open');
    data.setViewer('demo-3');
    data.closeHelpContact(requestId);
    expect(data.getSnapshot().helpContacts[0]).toMatchObject({ status: 'closed', closedBy: 'demo-3', conversationId });
  });

  it('crea solo una conversación al aceptar entre compañeros sin chat previo', () => {
    const { data, postId } = setup();
    const requestId = send(data, postId, 'demo-5');
    data.setViewer('demo-2');
    const before = data.getSnapshot().directConversations.length;
    data.respondHelpContact(requestId, 'accepted');
    expect(data.getSnapshot().directConversations).toHaveLength(before + 1);
    expect(() => data.respondHelpContact(requestId, 'accepted')).toThrow('pendiente');
    expect(data.getSnapshot().directConversations).toHaveLength(before + 1);
  });

  it('rechaza acciones de transición ajenas o fuera de estado', () => {
    const { data, postId } = setup();
    const requestId = send(data, postId);
    expect(() => data.respondHelpContact(requestId, 'accepted')).toThrow('destinatario');
    expect(() => data.closeHelpContact(requestId)).toThrow('aceptado');
    data.setViewer('demo-2');
    expect(() => data.cancelHelpContact(requestId)).toThrow('quien envió');
    data.respondHelpContact(requestId, 'rejected');
    expect(() => data.respondHelpContact(requestId, 'accepted')).toThrow('pendiente');
    expect(data.getSnapshot().helpContacts[0]?.conversationId).toBeUndefined();
  });

  it('cerrar resuelve pendientes y conserva contactos aceptados y su chat', () => {
    const { data, postId } = setup();
    const accepted = send(data, postId);
    data.setViewer('demo-2');
    data.respondHelpContact(accepted, 'accepted');
    const pending = send(data, postId, 'demo-5');
    data.setViewer('demo-2');
    data.setHelpPostStatus(postId, 'closed');
    expect(data.getSnapshot().helpContacts.find((r) => r.id === pending)).toMatchObject({ status: 'closed', closeReason: 'post_closed' });
    expect(data.getSnapshot().helpContacts.find((r) => r.id === accepted)?.status).toBe('accepted');
    expect(() => data.respondHelpContact(pending, 'accepted')).toThrow('pendiente');
    data.setViewer('demo-6');
    expect(() => data.sendHelpContact(postId)).toThrow('no está abierta');
  });

  it('retirar oculta al grupo, conserva contexto privado y no permite editar ni reabrir', () => {
    const { data, postId } = setup();
    const requestId = send(data, postId);
    data.setViewer('demo-2');
    data.saveHelpPost({ ...input, id: postId, title: 'Título editado después del contacto' });
    data.withdrawHelpPost(postId);
    expect(data.getSnapshot().helpPosts[0]?.status).toBe('withdrawn');
    expect(() => data.saveHelpPost({ ...input, id: postId })).toThrow('retirada');
    expect(() => data.setHelpPostStatus(postId, 'open')).toThrow('retirada');
    data.setViewer('demo-3');
    expect(data.getSnapshot().helpPosts).toEqual([]);
    expect(data.getSnapshot().helpContacts[0]).toMatchObject({ id: requestId, postTitle: input.title, postTopic: input.topic, status: 'closed', closeReason: 'post_withdrawn' });
    data.setViewer('demo-1');
    expect(data.getSnapshot().helpPosts).toEqual([]);
    expect(data.getSnapshot().helpContacts).toEqual([]);
  });

  it('exige motivo al administrador y lo muestra al autor, sin acceso administrativo a contactos', () => {
    const { data, postId } = setup();
    send(data, postId);
    expect(() => data.withdrawHelpPost(postId, 'No autorizado')).toThrow('administrador');
    data.setViewer('demo-1');
    expect(() => data.withdrawHelpPost(postId)).toThrow('motivo');
    data.withdrawHelpPost(postId, 'Contiene información que debe revisarse.');
    data.setViewer('demo-2');
    expect(data.getSnapshot().helpPosts[0]).toMatchObject({ withdrawnBy: 'demo-1', withdrawalReason: 'Contiene información que debe revisarse.' });
  });

  it('las bajas bloquean nuevos contactos y aceptaciones, sin impedir cerrar un acuerdo existente', () => {
    const { data, postId } = setup();
    const requestId = send(data, postId);
    data.setViewer('demo-1');
    data.removeMember('demo-3');
    data.setViewer('demo-2');
    expect(() => data.respondHelpContact(requestId, 'accepted')).toThrow('disponibles');
    data.setViewer('demo-3');
    expect(data.getSnapshot().helpContacts).toEqual([]);
    expect(() => data.sendHelpContact(postId)).toThrow('activo');
    data.setViewer('demo-1');
    data.removeMember('demo-2');
    data.setViewer('demo-4');
    expect(data.getSnapshot().helpPosts).toEqual([]);
    expect(() => data.sendHelpContact(postId)).toThrow('abierta');
  });

  it('valida límites, valores permitidos y materia sin truncar contenido', () => {
    const { data } = setup();
    expect(() => data.saveHelpPost({ ...input, topic: ' ' })).toThrow('tema');
    expect(() => data.saveHelpPost({ ...input, subjectId: 'missing' })).toThrow('materia');
    expect(() => data.saveHelpPost({ ...input, availability: 'a'.repeat(501) })).toThrow('disponibilidad');
    expect(() => data.saveHelpPost({ ...input, modality: 'unknown' as HelpPostInput['modality'] })).toThrow('modalidad');
    const postId = data.saveHelpPost({ ...input, kind: 'request' });
    data.setViewer('demo-5');
    expect(() => data.sendHelpContact(postId, 'a'.repeat(1001))).toThrow('mensaje');
    expect(data.getSnapshot().helpContacts).toEqual([]);
  });

  it('descarta contactos al terminar la sesión demo', () => {
    const { data, postId } = setup();
    send(data, postId);
    data.dispose();
    expect(data.getSnapshot().helpPosts).toEqual([]);
    expect(data.getSnapshot().helpContacts).toEqual([]);
    expect(() => data.sendHelpContact(postId)).toThrow('sesión de prueba');
  });
});
