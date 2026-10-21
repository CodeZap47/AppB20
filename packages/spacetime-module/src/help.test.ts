import { describe, expect, it, vi } from 'vitest';

// Ejecutamos los reducers y vistas reales; el registro del SDK depende del runtime del servidor.
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return {
    SenderError: class SenderError extends Error {},
    t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }),
  };
});

import {
  cancel_help_contact, close_help_contact, help_posts, my_help_contact_requests,
  respond_help_contact, save_help_post, send_help_contact, set_help_post_status,
  withdraw_help_post,
} from './index';

const identity = (hex: string) => ({
  toHexString: () => hex,
  isEqual: (other: { toHexString(): string }) => other.toHexString() === hex,
});
type Identity = ReturnType<typeof identity>;
type Row = Record<string, unknown>;
const rowKey = (value: unknown) =>
  value && typeof value === 'object' && 'toHexString' in value
    ? (value as Identity).toHexString() : String(value);

function tableStore(key: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [rowKey(row[key]), row]));
  let nextId = 1n;
  const update = (row: Row) => { rows.set(rowKey(row[key]), row); return row; };
  const filter = (field: string) => (value: unknown) =>
    [...rows.values()].filter((row) => rowKey(row[field]) === rowKey(value));
  const primary = { find: (value: unknown) => rows.get(rowKey(value)), update };
  return {
    rows,
    iter: () => rows.values(),
    insert: (input: Row) => {
      const row = key === 'id' && input.id === 0n ? { ...input, id: nextId++ } : input;
      return update(row);
    },
    id: primary,
    identity: primary,
    postId: { filter: filter('postId') },
    sender: { filter: filter('sender') },
    recipient: { filter: filter('recipient') },
    userA: { filter: filter('userA') },
    userB: { filter: filter('userB') },
  };
}

function setup() {
  const author = identity('01');
  const sender = identity('02');
  const third = identity('03');
  const admin = identity('04');
  const issuer = 'https://auth.spacetimedb.com/oidc';
  const db = {
    appConfig: tableStore('id', [{ id: 0, owner: admin }]),
    authConfig: tableStore('id', [{ id: 0, issuer, audiences: ['b20'] }]),
    member: tableStore('identity', [author, sender, third, admin].map((person) => ({
      identity: person, status: 'active', isCreator: person === admin,
    }))),
    subject: tableStore('id', [{ id: 1n, name: 'Programación' }]),
    helpPost: tableStore('id'),
    helpContactRequest: tableStore('id'),
    directConversation: tableStore('id'),
    directMessage: { insert: vi.fn() },
    changeLog: tableStore('id'),
  };
  const mutableCtx = {
    sender: author,
    senderAuth: { jwt: { issuer, audience: ['b20'], fullPayload: { email: 'alumno@example.com', email_verified: true } } },
    db,
    env: { B20_BOOTSTRAP_OWNER_IDENTITY: undefined },
    timestamp: 123n,
  };
  const ctx = mutableCtx as unknown as Parameters<typeof save_help_post>[0] & Parameters<typeof help_posts>[0];
  const as = (person: Identity) => { mutableCtx.sender = person; mutableCtx.timestamp += 1n; };
  const save = (fields: Partial<Parameters<typeof save_help_post>[1]> = {}) => save_help_post(ctx, {
    id: undefined, kind: 'offer', subjectId: 1n, title: ' Te ayudo con ciclos ', topic: ' Ciclos ',
    description: ' Practicamos con ejemplos. ', level: 'initial', modality: 'messages', availability: ' ',
    ...fields,
  });
  const contact = (person = sender, postId = 1n) => {
    as(person);
    send_help_contact(ctx, { postId, message: ' ¿Me ayudas con este ejercicio? ' });
  };
  const remove = (person: Identity) => {
    const member = db.member.identity.find(person)!;
    db.member.identity.update({ ...member, status: 'removed' });
  };
  return { ctx, db, author, sender, third, admin, as, save, contact, remove };
}

describe('Puedo ayudarte / necesito ayuda: servidor', () => {
  it('publica ambos tipos con campos validados y permite editar solo al autor sin cambiar el tipo', () => {
    const { ctx, db, save, as, sender } = setup();
    save();
    expect(db.helpPost.id.find(1n)).toMatchObject({
      title: 'Te ayudo con ciclos', topic: 'Ciclos', description: 'Practicamos con ejemplos.',
      availability: '', status: 'open', kind: 'offer',
    });
    save({ kind: 'request', title: 'Necesito ayuda con matrices' });
    expect(help_posts(ctx)).toHaveLength(2);
    save({ id: 1n, title: 'Ciclos y condiciones', availability: 'Viernes de 16 a 17' });
    expect(db.helpPost.id.find(1n)?.availability).toBe('Viernes de 16 a 17');
    expect(() => save({ id: 1n, kind: 'request' })).toThrow(/tipo/);
    as(sender);
    expect(() => save({ id: 1n })).toThrow(/autor/);
  });

  it.each([
    { title: '' }, { topic: ' ' }, { description: '' }, { title: 'x'.repeat(201) },
    { topic: 'x'.repeat(121) }, { description: 'x'.repeat(4001) }, { availability: 'x'.repeat(501) },
    { kind: 'otro' }, { level: 'experto' }, { modality: 'otro' }, { subjectId: 99n },
  ])('rechaza campos inválidos sin guardar: %o', (fields) => {
    const { db, save } = setup();
    expect(() => save(fields)).toThrow();
    expect(db.helpPost.rows.size).toBe(0);
  });

  it('la solicitud es privada para sus participantes, también frente a un administrador ajeno', () => {
    const { ctx, db, author, sender, third, admin, as, save, contact } = setup();
    save();
    const publicEvents = db.changeLog.rows.size;
    contact();
    expect(db.helpContactRequest.id.find(1n)).toMatchObject({
      postTitle: 'Te ayudo con ciclos', postTopic: 'Ciclos', postKind: 'offer', subjectId: 1n,
      message: '¿Me ayudas con este ejercicio?', status: 'pending',
    });
    for (const person of [sender, author]) {
      as(person);
      expect(my_help_contact_requests(ctx)).toHaveLength(1);
    }
    for (const person of [third, admin]) {
      as(person);
      expect(my_help_contact_requests(ctx)).toEqual([]);
      expect(() => respond_help_contact(ctx, { requestId: 1n, decision: 'accepted' })).toThrow(/no existe/);
      expect(() => cancel_help_contact(ctx, { requestId: 1n })).toThrow(/no existe/);
      expect(() => close_help_contact(ctx, { requestId: 1n })).toThrow(/no existe/);
    }
    expect(db.changeLog.rows.size).toBe(publicEvents);
  });

  it('impide contactos propios y duplicados, incluso después de rechazarlos o cancelarlos', () => {
    const { ctx, author, sender, third, as, save, contact } = setup();
    save();
    expect(() => send_help_contact(ctx, { postId: 1n, message: '' })).toThrow(/contigo/);
    contact();
    expect(() => send_help_contact(ctx, { postId: 1n, message: '' })).toThrow(/Ya solicitaste/);
    as(author);
    respond_help_contact(ctx, { requestId: 1n, decision: 'rejected' });
    as(sender);
    expect(() => send_help_contact(ctx, { postId: 1n, message: '' })).toThrow(/Ya solicitaste/);
    contact(third);
    cancel_help_contact(ctx, { requestId: 2n });
    expect(() => send_help_contact(ctx, { postId: 1n, message: '' })).toThrow(/Ya solicitaste/);
  });

  it('aceptar abre un chat ordenado, conserva abierta la publicación y no envía mensajes ni eventos públicos', () => {
    const { ctx, db, author, sender, as, save, contact } = setup();
    save();
    contact();
    const publicEvents = db.changeLog.rows.size;
    as(author);
    respond_help_contact(ctx, { requestId: 1n, decision: 'accepted' });
    expect(db.directConversation.rows.size).toBe(1);
    expect(db.directConversation.id.find(1n)).toMatchObject({ userA: author, userB: sender });
    expect(db.helpContactRequest.id.find(1n)).toMatchObject({ status: 'accepted', conversationId: 1n });
    expect(db.helpPost.id.find(1n)?.status).toBe('open');
    expect(db.directMessage.insert).not.toHaveBeenCalled();
    expect(db.changeLog.rows.size).toBe(publicEvents);
  });

  it('reutiliza la conversación existente al aceptar otra publicación del mismo par', () => {
    const { ctx, db, author, as, save, contact } = setup();
    save();
    contact();
    as(author);
    respond_help_contact(ctx, { requestId: 1n, decision: 'accepted' });
    save({ kind: 'request' });
    contact(undefined, 2n);
    as(author);
    respond_help_contact(ctx, { requestId: 2n, decision: 'accepted' });
    expect(db.directConversation.rows.size).toBe(1);
    expect(db.helpContactRequest.id.find(2n)?.conversationId).toBe(1n);
  });

  it.each(['author', 'sender'] as const)('un contacto aceptado puede cerrarlo %s sin cerrar su chat', (participant) => {
    const fixture = setup();
    const { ctx, db, author, as, save, contact } = fixture;
    save();
    contact();
    as(author);
    respond_help_contact(ctx, { requestId: 1n, decision: 'accepted' });
    as(fixture[participant]);
    close_help_contact(ctx, { requestId: 1n });
    expect(db.helpContactRequest.id.find(1n)).toMatchObject({ status: 'closed', closedBy: fixture[participant] });
    expect(db.directConversation.rows.size).toBe(1);
  });

  it('rechazar o cancelar conserva el historial privado sin abrir una conversación', () => {
    const { ctx, db, author, third, as, save, contact } = setup();
    save();
    const publicEvents = db.changeLog.rows.size;
    contact();
    as(author);
    respond_help_contact(ctx, { requestId: 1n, decision: 'rejected' });
    contact(third);
    cancel_help_contact(ctx, { requestId: 2n });
    expect(db.helpContactRequest.id.find(1n)?.status).toBe('rejected');
    expect(db.helpContactRequest.id.find(2n)?.status).toBe('cancelled');
    expect(db.directConversation.rows.size).toBe(0);
    expect(db.changeLog.rows.size).toBe(publicEvents);
  });

  it('solo destinatario responde, solo remitente cancela y ambos cierran únicamente contactos aceptados', () => {
    const { ctx, db, author, sender, as, save, contact } = setup();
    save();
    contact();
    expect(() => respond_help_contact(ctx, { requestId: 1n, decision: 'accepted' })).toThrow(/destinatario/);
    expect(() => close_help_contact(ctx, { requestId: 1n })).toThrow(/aceptado/);
    as(author);
    expect(() => cancel_help_contact(ctx, { requestId: 1n })).toThrow(/remitente/);
    expect(() => respond_help_contact(ctx, { requestId: 1n, decision: 'otro' })).toThrow(/inválida/);
    respond_help_contact(ctx, { requestId: 1n, decision: 'accepted' });
    as(sender);
    expect(() => cancel_help_contact(ctx, { requestId: 1n })).toThrow(/pendiente/);
    close_help_contact(ctx, { requestId: 1n });
    expect(db.helpContactRequest.id.find(1n)).toMatchObject({ status: 'closed', closedBy: sender, closeReason: 'participant', conversationId: 1n });
    as(author);
    expect(() => respond_help_contact(ctx, { requestId: 1n, decision: 'accepted' })).toThrow(/pendiente/);
    expect(() => close_help_contact(ctx, { requestId: 1n })).toThrow(/aceptado/);
  });

  it('cierra pendientes al cerrar la publicación, conserva aceptados y permite reabrir sin revivir solicitudes', () => {
    const { ctx, db, author, sender, third, as, save, contact } = setup();
    save();
    contact();
    as(author);
    respond_help_contact(ctx, { requestId: 1n, decision: 'accepted' });
    contact(third);
    as(sender);
    expect(() => set_help_post_status(ctx, { postId: 1n, status: 'closed' })).toThrow(/autor/);
    as(author);
    set_help_post_status(ctx, { postId: 1n, status: 'closed' });
    expect(db.helpContactRequest.id.find(1n)?.status).toBe('accepted');
    expect(db.helpContactRequest.id.find(2n)).toMatchObject({ status: 'closed', closedBy: author, closeReason: 'post_closed' });
    expect(() => respond_help_contact(ctx, { requestId: 2n, decision: 'accepted' })).toThrow(/pendiente/);
    as(third);
    expect(() => send_help_contact(ctx, { postId: 1n, message: '' })).toThrow(/abierta/);
    as(author);
    set_help_post_status(ctx, { postId: 1n, status: 'open' });
    expect(db.helpContactRequest.id.find(2n)?.status).toBe('closed');
  });

  it('retirar oculta la publicación a terceros y conserva el contexto del contacto y el chat aceptado', () => {
    const { ctx, db, author, sender, third, admin, as, save, contact } = setup();
    save();
    contact();
    as(author);
    respond_help_contact(ctx, { requestId: 1n, decision: 'accepted' });
    contact(third);
    as(author);
    save({ id: 1n, title: 'Nuevo título', topic: 'Nuevo tema' });
    withdraw_help_post(ctx, { postId: 1n, reason: '' });
    expect(help_posts(ctx)).toHaveLength(1);
    expect(db.helpContactRequest.id.find(1n)).toMatchObject({ status: 'accepted', postTitle: 'Te ayudo con ciclos', postTopic: 'Ciclos', conversationId: 1n });
    expect(db.helpContactRequest.id.find(2n)).toMatchObject({ status: 'closed', closeReason: 'post_withdrawn' });
    expect(() => save({ id: 1n })).toThrow(/retirada/);
    expect(() => set_help_post_status(ctx, { postId: 1n, status: 'open' })).toThrow(/retirada/);
    for (const person of [sender, third, admin]) {
      as(person);
      expect(help_posts(ctx)).toEqual([]);
    }
  });

  it('el administrador retira con motivo visible solo al autor y sin registrar ese motivo en el historial público', () => {
    const { ctx, db, author, sender, admin, as, save } = setup();
    save();
    as(sender);
    expect(() => withdraw_help_post(ctx, { postId: 1n, reason: 'No corresponde' })).toThrow(/creadores/);
    as(admin);
    expect(() => withdraw_help_post(ctx, { postId: 1n, reason: ' ' })).toThrow(/motivo/);
    expect(() => withdraw_help_post(ctx, { postId: 1n, reason: 'x'.repeat(501) })).toThrow(/500/);
    withdraw_help_post(ctx, { postId: 1n, reason: ' Detalles privados para el autor. ' });
    expect(help_posts(ctx)).toEqual([]);
    as(author);
    expect(help_posts(ctx)[0]).toMatchObject({ withdrawalReason: 'Detalles privados para el autor.', withdrawnBy: admin });
    expect([...db.changeLog.rows.values()].some((row) => JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? String(value) : value).includes('Detalles privados'))).toBe(false);
  });

  it('las bajas impiden toda operación y lectura propia, ocultan publicaciones y bloquean aceptaciones', () => {
    const { ctx, db, author, sender, as, save, contact, remove } = setup();
    save();
    contact();
    remove(sender);
    expect(help_posts(ctx)).toEqual([]);
    expect(my_help_contact_requests(ctx)).toEqual([]);
    expect(() => send_help_contact(ctx, { postId: 1n, message: '' })).toThrow(/miembro activo/);
    expect(() => cancel_help_contact(ctx, { requestId: 1n })).toThrow(/miembro activo/);
    expect(() => close_help_contact(ctx, { requestId: 1n })).toThrow(/miembro activo/);
    as(author);
    expect(() => respond_help_contact(ctx, { requestId: 1n, decision: 'accepted' })).toThrow(/activo/);
    expect(db.directConversation.rows.size).toBe(0);
    expect(db.helpContactRequest.id.find(1n)?.status).toBe('pending');
    remove(author);
    expect(() => save()).toThrow(/miembro activo/);
    expect(() => set_help_post_status(ctx, { postId: 1n, status: 'closed' })).toThrow(/miembro activo/);
    expect(() => withdraw_help_post(ctx, { postId: 1n, reason: '' })).toThrow(/miembro activo/);
    expect(() => respond_help_contact(ctx, { requestId: 1n, decision: 'rejected' })).toThrow(/miembro activo/);
  });

  it('no permite contactar publicaciones de autores dados de baja ni expone esas publicaciones', () => {
    const { ctx, author, sender, as, save, remove } = setup();
    save();
    remove(author);
    as(sender);
    expect(help_posts(ctx)).toEqual([]);
    expect(() => send_help_contact(ctx, { postId: 1n, message: '' })).toThrow(/autor.*activo/);
  });

  it('el mensaje opcional admite vacío y rechaza más de 1000 caracteres sin truncarlo', () => {
    const { ctx, db, sender, as, save } = setup();
    save();
    as(sender);
    expect(() => send_help_contact(ctx, { postId: 1n, message: 'x'.repeat(1001) })).toThrow(/1000/);
    expect(db.helpContactRequest.rows.size).toBe(0);
    send_help_contact(ctx, { postId: 1n, message: ' ' });
    expect(db.helpContactRequest.id.find(1n)?.message).toBe('');
  });
});
