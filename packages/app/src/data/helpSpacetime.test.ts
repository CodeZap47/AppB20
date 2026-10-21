import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import type { DbConnection } from '../module_bindings';
import type { HelpPostInput } from './types';
import { createSpacetimeActions } from './spacetimeActions';
import { emptySnapshot, PUBLIC_VIEWS, readSnapshot } from './spacetimeSnapshot';

const SELF = '00000000000000000000000000000000000000000000000000000000000000aa';
const OTHER = '00000000000000000000000000000000000000000000000000000000000000bb';
const THIRD = '00000000000000000000000000000000000000000000000000000000000000cc';
const HIGH = 18_446_744_073_709_551_614n;
const SUBJECT = 9_007_199_254_740_993n;
const at = new Date('2026-10-21T12:34:00Z');
const timestamp = Timestamp.fromDate(at);
const person = (value = SELF) => Identity.fromString(value);
const member = (value = SELF, fields: Record<string, unknown> = {}) => ({
  identity: person(value), displayName: value === SELF ? 'Luis' : 'Ana', photoUrl: undefined,
  status: 'active', isCreator: false, joinedAt: timestamp, ...fields,
});
const post = (fields: Record<string, unknown> = {}) => ({
  id: HIGH, kind: 'offer', subjectId: SUBJECT, title: 'Ciclos', topic: 'Bucles',
  description: 'Repasamos con ejemplos.', level: 'initial', modality: 'messages', availability: '',
  status: 'open', author: person(OTHER), createdAt: timestamp, updatedAt: timestamp,
  withdrawnBy: undefined, withdrawalReason: undefined, ...fields,
});
const contact = (fields: Record<string, unknown> = {}) => ({
  id: HIGH - 1n, postId: HIGH, sender: person(), recipient: person(OTHER), subjectId: SUBJECT,
  postTitle: 'Ciclos antes de la retirada', postTopic: 'Bucles', postKind: 'offer',
  message: '¿Repasamos?', status: 'accepted', conversationId: HIGH - 2n,
  createdAt: timestamp, updatedAt: timestamp, closedBy: undefined, closeReason: undefined,
  ...fields,
});
const input = (fields: Partial<HelpPostInput> = {}): HelpPostInput => ({
  kind: 'offer', subjectId: SUBJECT.toString(), title: ' Ciclos ', topic: 'Bucles',
  description: 'Repasamos con ejemplos.', level: 'initial', modality: 'messages', availability: '',
  ...fields,
});

/** Empty tables remain available as other modules add permission-filtered views. */
function setup(initial: Record<string, unknown[]> = {}, reducers: Record<string, unknown> = {}) {
  const rows = { myMember: [member()], members: [member(), member(OTHER), member(THIRD)], ...initial };
  const db = new Proxy({}, {
    get: (_target, name: string) => ({ iter: () => (rows[name as keyof typeof rows] ?? []).values() }),
  });
  const connection = { db, reducers } as unknown as DbConnection;
  return { rows: rows as Record<string, unknown[]>, connection,
    actions: createSpacetimeActions(() => connection, () => SELF) };
}

describe('ayuda: adaptación de vistas de SpacetimeDB', () => {
  it('conserva los IDs u64, fechas y contexto privado aunque la publicación ya no esté visible', () => {
    const { connection } = setup({
      helpPosts: [post({ author: person(), status: 'withdrawn', withdrawnBy: person(THIRD),
        withdrawalReason: 'Motivo para el autor', availability: 'Martes después de clase' })],
      myHelpContactRequests: [contact({ status: 'closed', closedBy: person(OTHER), closeReason: 'participant' })],
    });
    const data = readSnapshot(connection, SELF);
    expect(data.helpPosts[0]).toEqual({
      id: HIGH.toString(), kind: 'offer', subjectId: SUBJECT.toString(), title: 'Ciclos', topic: 'Bucles',
      description: 'Repasamos con ejemplos.', level: 'initial', modality: 'messages',
      availability: 'Martes después de clase', status: 'withdrawn', authorId: SELF,
      createdAt: at, updatedAt: at, withdrawnBy: THIRD, withdrawalReason: 'Motivo para el autor',
    });
    expect(data.helpContacts[0]).toMatchObject({
      id: (HIGH - 1n).toString(), postId: HIGH.toString(), senderId: SELF, recipientId: OTHER,
      subjectId: SUBJECT.toString(), postTitle: 'Ciclos antes de la retirada', postTopic: 'Bucles',
      postKind: 'offer', message: '¿Repasamos?', status: 'closed',
      conversationId: (HIGH - 2n).toString(), closedBy: OTHER, closeReason: 'participant',
      createdAt: at, updatedAt: at,
    });
  });

  it.each([false, true])('filtra caché ajena y retiradas incluso si administra=%s', (isCreator) => {
    const { connection } = setup({
      myMember: [member(SELF, { isCreator })],
      members: [member(SELF, { isCreator }), member(OTHER), member(THIRD, { status: 'removed' })],
      helpPosts: [
        post({ id: 1n }),
        post({ id: 2n, status: 'withdrawn', withdrawalReason: 'Privado', kind: 'enum futuro' }),
        post({ id: 3n, author: person(THIRD), kind: 'enum futuro' }),
        post({ id: 4n, author: person(), status: 'withdrawn', withdrawalReason: 'Mi motivo' }),
      ],
      myHelpContactRequests: [
        contact({ id: 1n }),
        contact({ id: 2n, sender: person(OTHER), recipient: person() }),
        contact({ id: 3n, sender: person(OTHER), recipient: person(THIRD), status: 'enum futuro', message: 'Mensaje ajeno' }),
      ],
    });
    const data = readSnapshot(connection, SELF);
    expect(data.helpPosts.map((row) => row.id)).toEqual(['1', '4']);
    expect(data.helpPosts[1]?.withdrawalReason).toBe('Mi motivo');
    expect(data.helpContacts.map((row) => row.id)).toEqual(['1', '2']);
    expect(JSON.stringify(data)).not.toContain('Mensaje ajeno');
    expect(JSON.stringify(data)).not.toContain('"withdrawalReason":"Privado"');
  });

  it('descarta publicaciones y contactos en caché al perder la membresía o cambiar de cuenta', () => {
    const { connection } = setup({ myMember: [member(SELF, { status: 'removed' })],
      helpPosts: [{ invalid: 'No evaluar filas que ya no se pueden leer' }],
      myHelpContactRequests: [{ invalid: 'Mensaje privado anterior' }],
    });
    expect(readSnapshot(connection, SELF)).toMatchObject({ me: { status: 'removed' }, helpPosts: [], helpContacts: [] });
    expect(readSnapshot(connection, THIRD)).toEqual(emptySnapshot('ready'));
  });

  it('rechaza estados desconocidos en filas propias para no presentar acciones incompatibles', () => {
    expect(() => readSnapshot(setup({ helpPosts: [post({ status: 'future' })] }).connection, SELF)).toThrow('versión de B20');
    expect(() => readSnapshot(setup({ myHelpContactRequests: [contact({ status: 'future' })] }).connection, SELF)).toThrow('versión de B20');
  });

  it('suscribe las dos vistas permitidas y nunca las tablas privadas de ayuda', () => {
    expect(PUBLIC_VIEWS).toContain('help_posts');
    expect(PUBLIC_VIEWS).toContain('my_help_contact_requests');
    expect(PUBLIC_VIEWS).not.toContain('help_post');
    expect(PUBLIC_VIEWS).not.toContain('help_contact_request');
    expect(emptySnapshot('offline')).toMatchObject({ helpPosts: [], helpContacts: [] });
  });
});

describe('ayuda: acciones de SpacetimeDB', () => {
  it('conecta edición y todos los cambios de estado con IDs u64 y campos opcionales correctos', async () => {
    const reducers = {
      saveHelpPost: vi.fn(async () => {}), setHelpPostStatus: vi.fn(async () => {}),
      withdrawHelpPost: vi.fn(async () => {}), respondHelpContact: vi.fn(async () => {}),
      cancelHelpContact: vi.fn(async () => {}), closeHelpContact: vi.fn(async () => {}),
    };
    const { actions } = setup({}, reducers);
    await expect(actions.saveHelpPost(input({ id: HIGH.toString() }))).resolves.toBe(HIGH.toString());
    expect(reducers.saveHelpPost).toHaveBeenCalledWith({ ...input(), id: HIGH, subjectId: SUBJECT });
    await actions.setHelpPostStatus(HIGH.toString(), 'closed');
    await actions.setHelpPostStatus(HIGH.toString(), 'open');
    expect(reducers.setHelpPostStatus.mock.calls).toEqual([
      [{ postId: HIGH, status: 'closed' }], [{ postId: HIGH, status: 'open' }],
    ]);
    await actions.withdrawHelpPost(HIGH.toString());
    await actions.withdrawHelpPost(HIGH.toString(), 'Motivo privado');
    expect(reducers.withdrawHelpPost.mock.calls).toEqual([
      [{ postId: HIGH, reason: '' }], [{ postId: HIGH, reason: 'Motivo privado' }],
    ]);
    await actions.respondHelpContact(HIGH.toString(), 'accepted');
    await actions.respondHelpContact(HIGH.toString(), 'rejected');
    expect(reducers.respondHelpContact.mock.calls).toEqual([
      [{ requestId: HIGH, decision: 'accepted' }], [{ requestId: HIGH, decision: 'rejected' }],
    ]);
    await actions.cancelHelpContact(HIGH.toString());
    await actions.closeHelpContact(HIGH.toString());
    expect(reducers.cancelHelpContact).toHaveBeenCalledWith({ requestId: HIGH });
    expect(reducers.closeHelpContact).toHaveBeenCalledWith({ requestId: HIGH });
  });

  it('recupera el alta propia entre publicaciones concurrentes sin confundir autor, materia o tipo', async () => {
    const saveHelpPost = vi.fn(async () => {
      rows.helpPosts!.push(post({ id: HIGH - 4n, author: person(OTHER) }));
      rows.helpPosts!.push(post({ id: HIGH - 3n, author: person(), subjectId: 99n }));
      rows.helpPosts!.push(post({ id: HIGH - 2n, author: person(), kind: 'request' }));
      rows.helpPosts!.push(post({ id: HIGH - 1n, author: person(), title: 'Otro tema' }));
      rows.helpPosts!.push(post({ id: HIGH, author: person() }));
    });
    const { actions, rows } = setup({ helpPosts: [post({ id: 1n, author: person() })] }, { saveHelpPost });
    await expect(actions.saveHelpPost(input())).resolves.toBe(HIGH.toString());
    expect(saveHelpPost).toHaveBeenCalledWith({ ...input(), id: undefined, subjectId: SUBJECT });
  });

  it('identifica el contacto enviado por la cuenta actual y preserva mensaje vacío o explícito', async () => {
    const sendHelpContact = vi.fn(async ({ postId }: { postId: bigint; message: string }) => {
      rows.myHelpContactRequests!.push(contact({ id: HIGH - 1n, postId, sender: person(OTHER), recipient: person() }));
      rows.myHelpContactRequests!.push(contact({ id: HIGH, postId }));
    });
    const { actions, rows } = setup({ myHelpContactRequests: [] }, { sendHelpContact });
    await expect(actions.sendHelpContact(HIGH.toString())).resolves.toBe(HIGH.toString());
    expect(sendHelpContact).toHaveBeenCalledWith({ postId: HIGH, message: '' });
    rows.myHelpContactRequests = [];
    await expect(actions.sendHelpContact(SUBJECT.toString(), '¿Repasamos?')).resolves.toBe(HIGH.toString());
    expect(sendHelpContact).toHaveBeenLastCalledWith({ postId: SUBJECT, message: '¿Repasamos?' });
  });

  it('no devuelve un alta ajena ni una ambigua, y conserva utilizable la cola tras fallar', async () => {
    let attempt = 0;
    const saveHelpPost = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) rows.helpPosts!.push(post({ id: 1n }));
      if (attempt === 2) rows.helpPosts!.push(post({ id: 2n, author: person() }), post({ id: 3n, author: person() }));
      if (attempt === 3) throw new Error('Acceso revocado');
      if (attempt === 4) rows.helpPosts!.push(post({ id: HIGH, author: person() }));
    });
    const { actions, rows } = setup({ helpPosts: [] }, { saveHelpPost });
    await expect(actions.saveHelpPost(input())).rejects.toThrow('identificar');
    await expect(actions.saveHelpPost(input())).rejects.toThrow('identificar');
    await expect(actions.saveHelpPost(input())).rejects.toThrow('Acceso revocado');
    await expect(actions.saveHelpPost(input())).resolves.toBe(HIGH.toString());
  });

  it('serializa dos publicaciones propias para asociar cada resultado con su solicitud', async () => {
    let finish: (() => void) | undefined;
    const saveHelpPost = vi.fn(async ({ title }: { title: string }) => {
      if (title === 'Primera') await new Promise<void>((resolve) => { finish = resolve; });
      rows.helpPosts!.push(post({ id: HIGH - BigInt(rows.helpPosts!.length), author: person(), title }));
    });
    const { actions, rows } = setup({ helpPosts: [] }, { saveHelpPost });
    const first = actions.saveHelpPost(input({ title: 'Primera' }));
    const second = actions.saveHelpPost(input({ title: 'Segunda' }));
    await vi.waitFor(() => expect(saveHelpPost).toHaveBeenCalledTimes(1));
    finish?.();
    await expect(first).resolves.toBe(HIGH.toString());
    await expect(second).resolves.toBe((HIGH - 1n).toString());
  });
});
