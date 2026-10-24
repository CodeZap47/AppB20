import { describe, expect, it, vi } from 'vitest';

// Igual que invitationEmail.test.ts: handlers reales con una DB en memoria y el registro del SDK sustituido.
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

import { Timestamp } from 'spacetimedb';
import { create_invite_link, invite_links, join_group, revoke_invite_link } from './index';
import { redeemInviteLink } from './inviteLinkHandlers';

const issuer = 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1';
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const identity = (hex: string) => ({
  toHexString: () => hex,
  isEqual: (other: { toHexString(): string }) => other.toHexString() === hex,
});
const days = (value: number) => new Timestamp(BigInt(value) * 86_400_000_000n);
const rowKey = (value: unknown) =>
  value && typeof value === 'object' && 'toHexString' in value ? (value as ReturnType<typeof identity>).toHexString() : String(value);

/** Tabla en memoria con clave primaria, índices únicos o btree y autoincremento opcional. */
function tableStore<Row extends Record<string, unknown>>(key: keyof Row, initial: Row[] = [], indexes: (keyof Row)[] = []) {
  const rows = new Map(initial.map((row) => [rowKey(row[key]), row]));
  let next = 1n;
  const store: Record<string, unknown> = {
    rows,
    iter: () => [...rows.values()],
    insert: (input: Row) => {
      const row = input[key] === 0n ? { ...input, [key]: next++ } : input;
      rows.set(rowKey(row[key]), row);
      return row;
    },
    [key]: {
      find: (value: unknown) => rows.get(rowKey(value)),
      update: (row: Row) => { rows.set(rowKey(row[key]), row); return row; },
      delete: (value: unknown) => rows.delete(rowKey(value)),
    },
  };
  for (const index of indexes) {
    store[index as string] = {
      find: (value: unknown) => [...rows.values()].find((row) => rowKey(row[index]) === rowKey(value)),
      filter: (value: unknown) => [...rows.values()].filter((row) => rowKey(row[index]) === rowKey(value)),
    };
  }
  return store as { rows: Map<string, Row> } & Record<string, never>;
}

function setup() {
  const owner = identity('owner');
  const admin = identity('admin');
  const student = identity('student');
  const mailer = identity('mailer');
  const db = {
    appConfig: tableStore('id', [{ id: 0, owner }]),
    authConfig: tableStore('id', [{ id: 0, issuer, audiences: ['authenticated'] }]),
    fileServiceConfig: tableStore('id'),
    aiServiceConfig: tableStore('id'),
    notificationServiceConfig: tableStore('id', [{ id: 0, identity: mailer, enabled: true }]),
    maintenanceService: tableStore('id'),
    member: tableStore('identity', [{ identity: admin, displayName: 'Ana', status: 'active', isCreator: true }]),
    invitation: tableStore('email'),
    invitationEmail: tableStore('email'),
    inviteLink: tableStore('id', [], ['tokenHash']),
    inviteLinkRedemption: tableStore('key', [], ['linkId']),
    changeLog: { insert: vi.fn() },
  };
  const mutableCtx = {
    sender: admin,
    identity: identity('module'),
    senderAuth: { jwt: { issuer, audience: ['authenticated'], fullPayload: { email: 'nuevo@example.com', email_verified: true } } },
    db, env: {}, timestamp: days(0),
  };
  const ctx = mutableCtx as unknown as Parameters<typeof create_invite_link>[0];
  const as = (who: ReturnType<typeof identity>) => { mutableCtx.sender = who; };
  const advance = (value: number) => { mutableCtx.timestamp = days(value); };
  const create = (input: Partial<{ tokenHash: string; expiresInDays: number; maxUses: number }> = {}) => {
    as(admin);
    create_invite_link(ctx, { tokenHash: HASH, expiresInDays: 7, maxUses: 2, ...input });
  };
  const redeem = (email: string, tokenHash = HASH) => { as(mailer); return redeemInviteLink(ctx, { tokenHash, email }); };
  const link = () => [...db.inviteLink.rows.values()][0] as { id: bigint; uses: number; revokedAt?: Timestamp };
  return { ctx, db, mutableCtx, owner, admin, student, mailer, as, advance, create, redeem, link };
}

describe('enlace de invitación', () => {
  it('solo los creadores lo crean, con vencimiento y usos dentro de los límites', () => {
    const { ctx, as, student, create, db } = setup();
    as(student);
    expect(() => create_invite_link(ctx, { tokenHash: HASH, expiresInDays: 7, maxUses: 5 })).toThrow();
    expect(() => create({ expiresInDays: 3 })).toThrow(/1, 7 o 30/);
    expect(() => create({ maxUses: 0 })).toThrow(/usos/);
    expect(() => create({ maxUses: 101 })).toThrow(/usos/);
    expect(() => create({ tokenHash: 'no-es-hash' })).toThrow(/no es válido/);
    create();
    expect(db.inviteLink.rows.size).toBe(1);
    expect(() => create()).toThrow(/no es válido/);
  });

  it('la vista muestra los enlaces a creadores y nunca el hash', () => {
    const { ctx, as, student, create } = setup();
    const viewCtx = ctx as unknown as Parameters<typeof invite_links>[0];
    create();
    const rows = invite_links(viewCtx) as { tokenHash: string; maxUses: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe('');
    expect(rows[0]!.maxUses).toBe(2);
    as(student);
    expect(invite_links(viewCtx)).toEqual([]);
  });

  it('canjear crea una invitación de integrante y gasta un uso por correo', () => {
    const { db, create, redeem, link } = setup();
    create();
    expect(redeem(' Nuevo@Example.com ')).toBe(true);
    expect(db.invitation.rows.get('nuevo@example.com')).toMatchObject({ isCreator: false });
    expect(link().uses).toBe(1);
    expect(redeem('nuevo@example.com')).toBe(true);
    expect(link().uses).toBe(1);
    expect(redeem('otra@example.com')).toBe(true);
    expect(link().uses).toBe(2);
    expect(redeem('tercera@example.com')).toBe(false);
    expect(db.invitation.rows.has('tercera@example.com')).toBe(false);
  });

  it('un enlace vencido, revocado o inexistente no sirve; una invitación previa no gasta uso', () => {
    const { db, create, redeem, link, advance, ctx, as, admin } = setup();
    create();
    expect(redeem('nadie@example.com', OTHER_HASH)).toBe(false);
    db.invitation.rows.set('previa@example.com', { email: 'previa@example.com', isCreator: true, invitedBy: admin, createdAt: days(0) } as never);
    expect(redeem('previa@example.com')).toBe(true);
    expect(link().uses).toBe(0);
    expect(db.invitation.rows.get('previa@example.com')).toMatchObject({ isCreator: true });
    advance(8);
    expect(redeem('tarde@example.com')).toBe(false);
    advance(0);
    as(admin); revoke_invite_link(ctx, { id: link().id });
    expect(redeem('revocado@example.com')).toBe(false);
  });

  it('solo la identidad técnica de avisos puede canjear', () => {
    const { ctx, create, as, admin, student, mailer, db } = setup();
    create();
    for (const who of [admin, student]) {
      as(who);
      expect(() => redeemInviteLink(ctx, { tokenHash: HASH, email: 'x@example.com' })).toThrow(/notificaciones/);
    }
    db.notificationServiceConfig.rows.set('0', { ...(db.notificationServiceConfig.rows.get('0') as object), enabled: false } as never);
    as(mailer);
    expect(() => redeemInviteLink(ctx, { tokenHash: HASH, email: 'x@example.com' })).toThrow(/notificaciones/);
  });

  it('revocar retira las invitaciones pendientes del enlace y deja a quien ya se unió', () => {
    const { ctx, db, create, redeem, link, as, admin, student } = setup();
    create();
    redeem('nuevo@example.com');
    redeem('pendiente@example.com');
    as(student);
    join_group(ctx, { displayName: 'Nuevo' });
    expect(db.member.rows.get('student')).toMatchObject({ status: 'active', isCreator: false });
    as(admin);
    revoke_invite_link(ctx, { id: link().id });
    expect(link().revokedAt).toBeDefined();
    expect(db.invitation.rows.has('pendiente@example.com')).toBe(false);
    expect(db.member.rows.get('student')).toMatchObject({ status: 'active' });
    expect(() => revoke_invite_link(ctx, { id: link().id })).not.toThrow();
  });

  it('como máximo diez enlaces vigentes a la vez', () => {
    const { create } = setup();
    for (let i = 0; i < 10; i++) create({ tokenHash: i.toString(16).padStart(64, '0') });
    expect(() => create({ tokenHash: 'f'.repeat(64) })).toThrow(/10 enlaces vigentes/);
  });
});
