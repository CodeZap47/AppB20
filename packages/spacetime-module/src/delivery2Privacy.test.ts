import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) };
});
import { change_history, create_teaching_practice, spaced_cards, spaced_unavailable_cards, stickers } from './index';
import type { Ctx } from './moduleContext';
import { extraWriter, withdrawnIncludingParent } from './delivery2Handlers';
import { toggleAnswerUsefulness } from './knowledgeHandlers';
const person = (value: string) => Identity.fromString(value.repeat(64));
const admin = person('a'), author = person('b'), peer = person('c');
const at = new Timestamp(1_700_000_000_000_000n);
type Row = Record<string, unknown>;
const keyOf = (value: unknown) => value && typeof value === 'object' && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function setup(extra: Record<string, Row[]> = {}) {
  const initial: Record<string, Row[]> = {
    member: [admin, author, peer].map((identity) => ({ identity, status: 'active', isCreator: identity === admin })),
    authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }], subject: [{ id: 1n }], ...extra,
  };
  const db = new Proxy({}, { get(_target, name: string) {
    const rows = initial[name] ?? [];
    return new Proxy({ iter: () => rows.values() }, { get(target, key: string) {
      if (key === 'iter') return target.iter;
      return { find: (value: unknown) => rows.find((row) => keyOf(row[key]) === keyOf(value)),
        filter: (value: unknown) => rows.filter((row) => keyOf(row[key]) === keyOf(value)) };
    } });
  } });
  const state = { db, sender: peer, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'local@example.com', email_verified: true } } } };
  return { ctx: state as unknown as Ctx & Parameters<typeof change_history>[0], as: (identity: Identity) => { state.sender = identity; } };
}

describe('privacidad entre módulos de la segunda entrega', () => {
  it('el historial no revela correos de invitación ni actividad o archivos de notas personales', () => {
    const { ctx, as } = setup({
      note: [{ id: 1n, author, visibility: 'personal' }, { id: 2n, author, visibility: 'group' }],
      resourceFile: [{ id: 'private-file', targetKind: 'note', targetId: 1n }],
      changeLog: [
        { id: 1n, entity: 'invitation', entityId: 'private@email.invalid', actor: admin },
        { id: 2n, entity: 'note', entityId: '1', actor: author },
        { id: 3n, entity: 'resource_file', entityId: 'private-file', actor: author },
        { id: 4n, entity: 'note', entityId: '2', actor: author },
      ],
    });
    expect(change_history(ctx).map((row) => row.id)).toEqual([4n]);
    as(admin); expect(change_history(ctx).map((row) => row.id)).toEqual([1n, 4n]);
    as(author); expect(change_history(ctx).map((row) => row.id)).toEqual([2n, 3n, 4n]);
  });

  it('un sticker usado en un directo permanece privado aunque quien consulta administre el grupo', () => {
    const { ctx, as } = setup({
      stickerPack: [{ id: 1n, owner: author, shared: false }],
      sticker: [1n, 2n, 3n].map((id) => ({ id, packId: 1n, used: true, storageKey: `data:image/png;base64,private-${id}` })),
      directConversation: [{ id: 10n, userA: author, userB: peer }],
      directMessage: [{ id: 20n, conversationId: 10n, text: '[[sticker:1]]' }],
      groupMessage: [{ id: 30n, text: '[[sticker:2]]' }, { id: 31n, text: '[[sticker:3]]', deletedAt: at }],
    });
    expect(stickers(ctx).map((row) => row.id)).toEqual([1n, 2n]);
    as(admin); expect(stickers(ctx).map((row) => row.id)).toEqual([2n]);
    as(author); expect(stickers(ctx).map((row) => row.id)).toEqual([1n, 2n, 3n]);
  });

  it('retirar la fuente oculta el contenido de tarjetas grupales y solo deja un aviso sin contenido', () => {
    const { ctx } = setup({
      note: [{ id: 1n, subjectId: 1n, author, visibility: 'group', version: 1 }],
      studyGuide: [{ id: 2n, subjectId: 1n, createdBy: author, version: 1 }],
      contentStatus: [{ key: 'note:1', withdrawnAt: at }, { key: 'guide:2', withdrawnAt: at }],
      spacedCollection: [{ id: 10n, subjectId: 1n, visibility: 'group', ownerId: author }],
      spacedCard: [{ id: 11n, collectionId: 10n, question: 'Secreto', explanation: 'Texto retirado', sourceKind: 'note', sourceId: 1n, version: 1, archived: false },
        { id: 12n, collectionId: 10n, question: 'Secreto guía', explanation: 'Texto retirado guía', sourceKind: 'guide', sourceId: 2n, version: 1, archived: false }],
    });
    expect(spaced_cards(ctx)).toEqual([]);
    expect(spaced_unavailable_cards(ctx)).toEqual([{ id: 11n, collectionId: 10n, version: 1, archived: false }, { id: 12n, collectionId: 10n, version: 1, archived: false }]);
    expect(JSON.stringify(spaced_unavailable_cards(ctx), (_key, value) => typeof value === 'bigint' ? String(value) : value)).not.toContain('Secreto');
  });

  it('una respuesta bajo una pregunta retirada no admite adjuntos ni nuevas valoraciones del autor', () => {
    const { ctx, as } = setup({ question: [{ id: 3n, author }], answer: [{ id: 4n, questionId: 3n, author }], contentStatus: [{ key: 'question:3', withdrawnAt: at }] });
    as(author);
    expect(withdrawnIncludingParent(ctx.db, 'answer', 4n)).toBe(true);
    expect(() => extraWriter(ctx, 'answer', 4n, author)).toThrow('disponible');
    expect(() => toggleAnswerUsefulness(ctx, { answerId: 4n })).toThrow('disponible');
  });

  it('una fuente retirada no puede iniciar una práctica nueva ni siquiera para el autor', () => {
    const { ctx, as } = setup({ note: [{ id: 1n, subjectId: 1n, author, visibility: 'group', version: 1 }], contentStatus: [{ key: 'note:1', withdrawnAt: at }] });
    as(author);
    expect(() => create_teaching_practice(ctx, { subjectId: 1n, topic: 'Repasar', concept: '', example: '', limits: '', sourceKind: 'note', sourceId: 1n })).toThrow('acceso');
  });
});
