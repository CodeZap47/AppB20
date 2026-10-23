import { describe, expect, it, vi } from 'vitest';

// Igual que auth.test.ts: handlers reales con una DB en memoria y el registro del SDK sustituido.
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
import {
  invitation_email_statuses, invite_member, join_group, on_connect, resend_invitation_email, revoke_invitation,
} from './index';
import { claimInvitationEmails, finishInvitationEmail, invitationPending } from './invitationEmailHandlers';

const issuer = 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1';
const identity = (hex: string) => ({
  toHexString: () => hex,
  isEqual: (other: { toHexString(): string }) => other.toHexString() === hex,
});
const LEASE = '11111111-2222-4333-8444-555555555555';
const OTHER_LEASE = '11111111-2222-4333-8444-666666666666';
const minutes = (value: number) => new Timestamp(BigInt(value) * 60_000_000n);

function tableStore<Row extends Record<string, unknown>>(key: keyof Row, initial: Row[] = []) {
  const rowKey = (value: unknown) =>
    value && typeof value === 'object' && 'toHexString' in value
      ? (value as ReturnType<typeof identity>).toHexString() : String(value);
  const rows = new Map(initial.map((row) => [rowKey(row[key]), row]));
  return {
    rows,
    iter: () => rows.values(),
    insert: (row: Row) => { rows.set(rowKey(row[key]), row); return row; },
    [key]: {
      find: (value: unknown) => rows.get(rowKey(value)),
      update: (row: Row) => { rows.set(rowKey(row[key]), row); return row; },
      delete: (value: unknown) => rows.delete(rowKey(value)),
    },
  };
}

function setup() {
  const owner = identity('owner');
  const admin = identity('admin');
  const student = identity('student');
  const mailer = identity('mailer');
  const db = {
    appConfig: tableStore('id', [{ id: 0, owner }]),
    authConfig: tableStore('id', [{ id: 0, issuer, audiences: ['web-client'] }]),
    fileServiceConfig: tableStore('id'),
    aiServiceConfig: tableStore('id'),
    notificationServiceConfig: tableStore('id', [{ id: 0, identity: mailer, enabled: true }]),
    maintenanceService: tableStore('id'),
    member: tableStore('identity', [{ identity: admin, displayName: 'Ana', status: 'active', isCreator: true }]),
    invitation: tableStore('email'),
    invitationEmail: tableStore('email'),
    changeLog: { insert: vi.fn() },
  };
  const mutableCtx = {
    sender: admin,
    identity: identity('module'),
    senderAuth: {
      jwt: { issuer, audience: ['web-client'], fullPayload: { email: 'alumno@example.com', email_verified: true } },
    },
    db,
    env: {},
    timestamp: minutes(0),
  };
  const ctx = mutableCtx as unknown as Parameters<typeof invite_member>[0];
  const as = (who: ReturnType<typeof identity>) => { mutableCtx.sender = who; };
  const advance = (value: number) => { mutableCtx.timestamp = minutes(value); };
  const invite = (isCreator = false) => { as(admin); invite_member(ctx, { email: 'Alumno@Example.com', isCreator }); };
  const claim = (leaseId = LEASE) => { as(mailer); return claimInvitationEmails(ctx, { leaseId, limit: 10 }); };
  const finish = (outcome: string, leaseId = LEASE) => { as(mailer); finishInvitationEmail(ctx, { email: 'alumno@example.com', leaseId, outcome }); };
  const queued = () => db.invitationEmail.rows.get('alumno@example.com');
  return { ctx, db, owner, admin, student, mailer, as, advance, invite, claim, finish, queued };
}

describe('correo de invitación', () => {
  it('invitar encola el correo y el servicio lo reclama con quién invita y el rol', () => {
    const { invite, claim, queued } = setup();
    invite(true);
    expect(queued()?.status).toBe('pending');
    expect(claim().jobs).toEqual([{ email: 'alumno@example.com', isCreator: true, inviterName: 'Ana' }]);
    expect(queued()?.status).toBe('leased');
  });

  it('solo la identidad de notificaciones habilitada puede reclamar', () => {
    const { ctx, db, as, admin, student, invite, claim } = setup();
    invite();
    for (const who of [admin, student]) {
      as(who);
      expect(() => claimInvitationEmails(ctx, { leaseId: LEASE, limit: 10 })).toThrow(/notificaciones/);
    }
    db.notificationServiceConfig.rows.set('0', { ...db.notificationServiceConfig.rows.get('0')!, enabled: false });
    expect(() => claim()).toThrow(/notificaciones/);
  });

  it('un lease vigente no se reclama dos veces; uno vencido sí, contando el intento', () => {
    const { advance, invite, claim, queued } = setup();
    invite();
    expect(claim().jobs).toHaveLength(1);
    expect(claim(OTHER_LEASE).jobs).toHaveLength(0);
    advance(6);
    expect(claim(OTHER_LEASE).jobs).toHaveLength(1);
    expect(queued()?.attempts).toBe(1);
  });

  it('enviado queda registrado; un error temporal reintenta más tarde y uno definitivo falla', () => {
    const { advance, invite, claim, finish, queued } = setup();
    invite();
    claim(); finish('retry');
    expect(queued()).toMatchObject({ status: 'pending', attempts: 1 });
    expect(claim().jobs).toHaveLength(0); // aún no toca
    advance(1);
    claim(); finish('sent');
    expect(queued()?.status).toBe('sent');
    expect(queued()?.sentAt).toBeDefined();

    const other = setup();
    other.invite(); other.claim(); other.finish('failed');
    expect(other.queued()?.status).toBe('failed');
  });

  it('tras cinco intentos deja de reintentar', () => {
    const { advance, invite, claim, finish, queued } = setup();
    invite();
    for (let attempt = 0; attempt < 5; attempt++) { advance(attempt * 600); claim(); finish('retry'); }
    expect(queued()).toMatchObject({ status: 'failed', attempts: 5 });
  });

  it('un lease ajeno o vencido no puede cerrar el envío', () => {
    const { advance, invite, claim, finish, queued } = setup();
    invite();
    claim();
    finish('sent', OTHER_LEASE);
    expect(queued()?.status).toBe('leased');
    advance(6);
    expect(() => finish('sent')).toThrow(/venció/);
  });

  it('retirar la invitación o que la persona se una cancela el correo pendiente', () => {
    const { ctx, as, admin, student, invite, claim, queued } = setup();
    invite();
    as(admin); revoke_invitation(ctx, { email: 'alumno@example.com' });
    expect(queued()).toBeUndefined();

    invite();
    as(student); join_group(ctx, { displayName: 'Alumno' });
    expect(queued()).toBeUndefined();
    expect(claim().jobs).toHaveLength(0);
  });

  it('si la invitación desaparece antes del envío, el servicio descarta el trabajo', () => {
    const { db, invite, claim, queued } = setup();
    invite();
    db.invitation.rows.clear();
    expect(claim().jobs).toHaveLength(0);
    expect(queued()).toBeUndefined();
  });

  it('cambiar el rol vuelve a mandar el correo con el rol correcto', () => {
    const { invite, claim, finish, queued } = setup();
    invite(false);
    claim(); finish('sent');
    invite(false); // mismo rol: nada que avisar
    expect(queued()?.status).toBe('sent');
    invite(true);
    expect(queued()?.status).toBe('pending');
    expect(claim().jobs[0]?.isCreator).toBe(true);
  });

  it('reenviar exige esperar 10 minutos salvo que el envío haya fallado', () => {
    const { ctx, as, admin, advance, invite, claim, finish, queued } = setup();
    invite();
    claim(); finish('sent');
    as(admin);
    expect(() => resend_invitation_email(ctx, { email: 'alumno@example.com' })).toThrow(/Espera/);
    advance(11);
    as(admin); resend_invitation_email(ctx, { email: ' ALUMNO@example.com ' });
    expect(queued()?.status).toBe('pending');

    const other = setup();
    other.invite(); other.claim(); other.finish('failed');
    other.as(other.admin);
    resend_invitation_email(other.ctx, { email: 'alumno@example.com' });
    expect(other.queued()).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('reenviar solo lo hacen creadores y solo para invitaciones existentes', () => {
    const { ctx, db, as, admin, student, invite } = setup();
    db.member.insert({ identity: student, displayName: 'Alumno', status: 'active', isCreator: false });
    invite();
    as(student);
    expect(() => resend_invitation_email(ctx, { email: 'alumno@example.com' })).toThrow(/creadores/);
    as(admin);
    expect(() => resend_invitation_email(ctx, { email: 'nadie@example.com' })).toThrow(/ya no existe/);
  });

  it('el estado solo lo ven los creadores y sin datos internos del envío', () => {
    const { ctx, db, as, student, invite, claim } = setup();
    invite();
    claim();
    const viewCtx = ctx as unknown as Parameters<typeof invitation_email_statuses>[0];
    as(student);
    expect(invitation_email_statuses(viewCtx)).toEqual([]);
    as(db.member.rows.get('admin')!.identity as ReturnType<typeof identity>);
    const [row] = invitation_email_statuses(viewCtx) as { status: string; leaseId?: string }[];
    expect(row).toMatchObject({ status: 'leased', leaseId: undefined });
  });

  it('al conectarse un miembro se descarta un correo pendiente de su invitación vieja', () => {
    const { ctx, db, as, student, invite, queued } = setup();
    invite();
    db.member.insert({ identity: student, displayName: 'Alumno', status: 'active', isCreator: false });
    as(student); on_connect(ctx, {});
    expect(queued()).toBeUndefined();
  });

  it('el servicio comprueba si un correo tiene invitación pendiente para activar su cuenta', () => {
    const { ctx, db, as, admin, student, mailer, invite } = setup();
    as(mailer);
    expect(invitationPending(ctx, 'alumno@example.com')).toBe(false);
    invite();
    as(mailer);
    expect(invitationPending(ctx, ' Alumno@Example.com ')).toBe(true);
    for (const who of [admin, student]) {
      as(who);
      expect(() => invitationPending(ctx, 'alumno@example.com')).toThrow(/notificaciones/);
    }
    db.notificationServiceConfig.rows.set('0', { ...db.notificationServiceConfig.rows.get('0')!, enabled: false });
    as(mailer);
    expect(() => invitationPending(ctx, 'alumno@example.com')).toThrow(/notificaciones/);
  });
});
