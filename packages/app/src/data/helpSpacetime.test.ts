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
function setup(initial: Record<string, unknown[]> = {}, reducers: Record<string, unknown> = {}, procedures: Record<string, unknown> = {}) {
  const rows = { myMember: [member()], members: [member(), member(OTHER), member(THIRD)], ...initial };
  const db = new Proxy({}, {
    get: (_target, name: string) => ({ iter: () => (rows[name as keyof typeof rows] ?? []).values() }),
  });
  const connection = { db, reducers, procedures } as unknown as DbConnection;
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
      availability: 'Martes después de clase', status: 'withdrawn', authorId: SELF, version: 1,
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
  const success = (id = HIGH.toString(), version = 1) => JSON.stringify({ ok: true, data: { id, version } });
  it('envía IDs sin pérdida, versión esperada e intención a los procedimientos autorizados', async () => {
    const helpMutate = vi.fn(async (_input: { payload: string }) => success());
    const reducers = { respondHelpContact: vi.fn(async () => {}), cancelHelpContact: vi.fn(async () => {}), closeHelpContact: vi.fn(async () => {}) };
    const { actions } = setup({ helpPostVersions: [{ postId: HIGH, version: 7 }] }, reducers, { helpMutate });
    await expect(actions.saveHelpPost(input({ id: HIGH.toString(), expectedVersion: 6, requestId: 'edit' }))).resolves.toBe(HIGH.toString());
    expect(JSON.parse(helpMutate.mock.calls[0]![0].payload)).toEqual({ action: 'save', id: HIGH.toString(), expectedVersion: 6, requestId: 'edit', fields: input() });
    await actions.setHelpPostStatus(HIGH.toString(), 'closed');
    await actions.setHelpPostStatus(HIGH.toString(), 'open', 8);
    await actions.withdrawHelpPost(HIGH.toString(), 'Motivo privado', 9);
    expect(helpMutate.mock.calls.slice(1).map(call => JSON.parse(call[0].payload))).toMatchObject([
      { action: 'status', id: HIGH.toString(), status: 'closed', expectedVersion: 7 },
      { action: 'status', id: HIGH.toString(), status: 'open', expectedVersion: 8 },
      { action: 'withdraw', id: HIGH.toString(), reason: 'Motivo privado', expectedVersion: 9 },
    ]);
    await actions.respondHelpContact(HIGH.toString(), 'accepted'); await actions.cancelHelpContact(HIGH.toString()); await actions.closeHelpContact(HIGH.toString());
    expect(reducers.respondHelpContact).toHaveBeenCalledWith({ requestId: HIGH, decision: 'accepted' });
    expect(reducers.cancelHelpContact).toHaveBeenCalledWith({ requestId: HIGH }); expect(reducers.closeHelpContact).toHaveBeenCalledWith({ requestId: HIGH });
  });
  it('usa el recibo de la transacción sin inferir el alta entre otras publicaciones en caché', async () => {
    const helpMutate = vi.fn(async () => success());
    const { actions } = setup({ helpPosts: [post(), post({ id: 1n, author: person() })] }, {}, { helpMutate });
    await expect(actions.saveHelpPost(input({ requestId: 'create' }))).resolves.toBe(HIGH.toString());
  });
  it('identifica el contacto enviado por la cuenta actual y preserva mensaje vacío o explícito', async () => {
    const sendHelpContact = vi.fn(async ({ postId }: { postId: bigint; message: string }) => {
      rows.myHelpContactRequests!.push(contact({ id: HIGH - 1n, postId, sender: person(OTHER), recipient: person() }));
      rows.myHelpContactRequests!.push(contact({ id: HIGH, postId }));
    });
    const { actions, rows } = setup({ myHelpContactRequests: [] }, { sendHelpContact });
    await expect(actions.sendHelpContact(HIGH.toString())).resolves.toBe(HIGH.toString());
    expect(sendHelpContact).toHaveBeenCalledWith({ postId: HIGH, message: '' }); rows.myHelpContactRequests = [];
    await expect(actions.sendHelpContact(SUBJECT.toString(), '¿Repasamos?')).resolves.toBe(HIGH.toString());
    expect(sendHelpContact).toHaveBeenLastCalledWith({ postId: SUBJECT, message: '¿Repasamos?' });
  });
  it('conserva el mensaje de conflicto y permite reintentar la misma intención después de un error', async () => {
    const helpMutate = vi.fn().mockResolvedValueOnce(JSON.stringify({ ok: false, message: 'La publicación cambió.' })).mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValue(success());
    const { actions } = setup({}, {}, { helpMutate }); const data = input({ requestId: 'same-intent' });
    await expect(actions.saveHelpPost(data)).rejects.toThrow('cambió'); await expect(actions.saveHelpPost(data)).rejects.toThrow('Sin conexión');
    await expect(actions.saveHelpPost(data)).resolves.toBe(HIGH.toString());
    expect(new Set(helpMutate.mock.calls.map(call => JSON.parse(call[0].payload).requestId))).toEqual(new Set(['same-intent']));
  });
  it('asocia respuestas fuera de orden a su intención y transforma fechas del historial privado', async () => {
    let finish: ((value: string) => void) | undefined;
    const helpMutate = vi.fn(async ({ payload }: { payload: string }) => {
      const value = JSON.parse(payload) as { requestId: string }; if (value.requestId === 'first') return new Promise<string>(resolve => { finish = resolve; }); return success((HIGH - 1n).toString());
    });
    const helpReadHistory = vi.fn(async () => JSON.stringify({ ok: true, data: [{ version: 7, status: 'open', fields: input(), at: at.getTime() }] }));
    const { actions } = setup({}, {}, { helpMutate, helpReadHistory });
    const first = actions.saveHelpPost(input({ requestId: 'first' }));
    await expect(actions.saveHelpPost(input({ requestId: 'second' }))).resolves.toBe((HIGH - 1n).toString()); finish!(success());
    await expect(first).resolves.toBe(HIGH.toString());
    await expect(actions.getHelpPostHistory(HIGH.toString())).resolves.toMatchObject([{ version: 7, at }]);
    expect(helpReadHistory).toHaveBeenCalledWith({ postId: HIGH });
  });
});
