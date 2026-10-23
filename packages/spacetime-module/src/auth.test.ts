import { describe, expect, it, vi } from 'vitest';

// Ejecutamos los handlers reales con una DB en memoria. Solo sustituimos el registro del SDK,
// que en producción depende del runtime del servidor SpacetimeDB.
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
  assert_active_member, invite_member, join_group, my_member, on_connect,
  remove_member, revoke_invitation, set_auth_config, subjects,
  link_auth_identity, unlink_auth_identity, update_profile,
} from './index';

const issuer = 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1';
const identity = (hex: string) => ({
  toHexString: () => hex,
  isEqual: (other: { toHexString(): string }) => other.toHexString() === hex,
});

function tableStore<Row extends Record<string, unknown>>(key: keyof Row, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [String(row[key]), row]));
  const rowKey = (value: unknown) =>
    value && typeof value === 'object' && 'toHexString' in value
      ? (value as ReturnType<typeof identity>).toHexString() : String(value);
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
  const student = identity('student');
  const db = {
    appConfig: tableStore('id', [{ id: 0, owner }]),
    authConfig: tableStore('id', [{ id: 0, issuer, audiences: ['web-client', 'android-client'] }]),
    fileServiceConfig: tableStore('id'),
    aiServiceConfig: tableStore('id'),
    notificationServiceConfig: tableStore('id'),
    maintenanceService: tableStore('id'),
    member: tableStore('identity'),
    authIdentityLink: tableStore('sessionIdentity'),
    invitation: tableStore('email'),
    invitationEmail: tableStore('email'),
    subject: tableStore('id', [{ id: 1, name: 'Privado del grupo' }]),
    studyRoom: { iter: () => [] },
    roomMember: { memberId: { filter: () => [] } },
    changeLog: { insert: vi.fn() },
  };
  const mutableCtx = {
    sender: student,
    identity: identity('module'),
    senderAuth: {
      jwt: {
        issuer,
        audience: ['web-client'],
        fullPayload: { email: 'Alumno@Example.com', email_verified: true },
      } as { issuer: string; audience: string[]; fullPayload: Record<string, unknown> } | null,
    },
    db,
    env: { B20_BOOTSTRAP_OWNER_IDENTITY: undefined as string | undefined },
    timestamp: 123n,
  };
  const ctx = mutableCtx as unknown as Parameters<typeof join_group>[0] & Parameters<typeof subjects>[0];
  const asOwner = () => { mutableCtx.sender = owner; };
  const asStudent = () => { mutableCtx.sender = student; };
  const invite = () => {
    asOwner();
    invite_member(ctx, { email: 'ALUMNO@example.com', isCreator: false });
    asStudent();
  };
  const join = () => { invite(); join_group(ctx, { displayName: 'Alumno' }); };
  return { ctx, mutableCtx, db, student, owner, asOwner, asStudent, invite, join };
}

describe('Supabase Auth y acceso por invitación en módulo', () => {
  it('Supabase es el único emisor: SpacetimeAuth y otros proyectos quedan fuera', () => {
    const { ctx, mutableCtx, asOwner, asStudent, join } = setup();
    join();
    expect(() => assert_active_member(ctx, {})).not.toThrow();
    for (const other of ['https://auth.spacetimedb.com/oidc', 'https://zyxwvutsrqponmlkjihg.supabase.co/auth/v1']) {
      mutableCtx.senderAuth.jwt!.issuer = other;
      expect(() => assert_active_member(ctx, {})).toThrow(/Emisor/);
    }
    asOwner();
    for (const bad of ['https://auth.spacetimedb.com/oidc', 'https://corto.supabase.co/auth/v1', 'https://tgtvvbqlmlljuufrutbk.supabase.co']) {
      expect(() => set_auth_config(ctx, { issuer: bad, audiences: ['authenticated'] })).toThrow(/emisor/);
    }
    asStudent();
  });
  it('admite Supabase con audiencia configurada, pero nunca confía en metadatos de correo editables', () => {
    const { ctx, mutableCtx, db, asOwner, asStudent, invite } = setup();
    invite(); asOwner();
    const supabaseIssuer = 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1';
    set_auth_config(ctx, { issuer: supabaseIssuer, audiences: ['authenticated'] });
    asStudent();
    Object.assign(mutableCtx.senderAuth.jwt!, { issuer: supabaseIssuer, audience: ['authenticated'],
      fullPayload: { email: 'alumno@example.com', user_metadata: { email_verified: true } } });
    expect(() => join_group(ctx, { displayName: 'Alumno' })).toThrow(/correo verificado/);
    mutableCtx.senderAuth.jwt!.fullPayload.email_verified = true;
    join_group(ctx, { displayName: 'Alumno' });
    expect(db.member.rows.size).toBe(1);
    expect(() => assert_active_member(ctx, {})).not.toThrow();
  });

  it('vincula el login nuevo a la membresía existente y conserva permisos y perfil', () => {
    const { ctx, mutableCtx, db, student, asOwner, join } = setup();
    join(); asOwner();
    const next = identity('supabase-login');
    link_auth_identity(ctx, { sessionIdentity: next, memberIdentity: student } as never);
    mutableCtx.sender = next;
    expect(my_member(ctx)[0]?.identity).toBe(student);
    expect(subjects(ctx)).toHaveLength(1);
    expect(() => assert_active_member(ctx, {})).not.toThrow();
    update_profile(ctx, { displayName: 'Mismo alumno', photoUrl: undefined });
    expect(db.member.rows.get('student')?.displayName).toBe('Mismo alumno');
    expect(db.member.rows.size).toBe(1);
    expect(() => link_auth_identity(ctx, { sessionIdentity: identity('other-login'), memberIdentity: student } as never)).toThrow(/propietario/);
    asOwner();
    unlink_auth_identity(ctx, { sessionIdentity: next } as never);
    mutableCtx.sender = next;
    expect(my_member(ctx)).toEqual([]);
    expect(subjects(ctx)).toEqual([]);
    expect(() => assert_active_member(ctx, {})).toThrow(/miembro activo/);
  });

  it('una vinculación no fusiona membresías, no forma cadenas y no concede control del propietario', () => {
    const { ctx, db, owner, student, asOwner, join } = setup();
    join(); asOwner();
    const next = identity('supabase-login');
    link_auth_identity(ctx, { sessionIdentity: next, memberIdentity: student } as never);
    expect(() => link_auth_identity(ctx, { sessionIdentity: identity('another'), memberIdentity: next } as never)).toThrow();
    expect(() => link_auth_identity(ctx, { sessionIdentity: student, memberIdentity: student } as never)).toThrow();
    expect(() => link_auth_identity(ctx, { sessionIdentity: owner, memberIdentity: student } as never)).toThrow(/propietario/);
    db.member.insert({ identity: owner, status: 'active' });
    expect(() => link_auth_identity(ctx, { sessionIdentity: identity('another'), memberIdentity: owner } as never)).toThrow(/propietario/);
  });
  it('una cuenta verificada sin invitación no se convierte en miembro ni lee contenido', () => {
    const { ctx, db } = setup();
    expect(() => join_group(ctx, { displayName: 'Alumno' })).toThrow(/lista autorizada/);
    expect(db.member.rows.size).toBe(0);
    expect(my_member(ctx)).toEqual([]);
    expect(subjects(ctx)).toEqual([]);
  });

  it('solo el correo verificado del token puede aceptar su invitación', () => {
    const { ctx, db, invite } = setup();
    invite();
    join_group(ctx, { displayName: 'Alumno' });
    expect(db.member.rows.size).toBe(1);
    expect(() => assert_active_member(ctx, {})).not.toThrow();
    expect(subjects(ctx)).toHaveLength(1);
  });

  it.each([
    ['sesión de Google directo', { issuer: 'https://accounts.google.com' }],
    ['cliente ajeno', { audience: ['unrelated-client'] }],
    ['correo sin verificar', { fullPayload: { email: 'alumno@example.com', email_verified: false } }],
    ['correo de otra persona', { fullPayload: { email: 'otro@example.com', email_verified: true } }],
  ])('rechaza %s aunque exista la invitación', (_reason, overrides) => {
    const { ctx, mutableCtx, db, invite } = setup();
    invite();
    Object.assign(mutableCtx.senderAuth.jwt!, overrides);
    expect(() => join_group(ctx, { displayName: 'Alumno' })).toThrow();
    expect(db.member.rows.size).toBe(0);
  });

  it('una baja impide nuevas operaciones, lectura de contenido y volver a unirse', () => {
    const { ctx, student, asOwner, asStudent, join } = setup();
    join();
    asOwner();
    remove_member(ctx, { identity: student as unknown as Parameters<typeof remove_member>[1]['identity'] });
    asStudent();
    expect(() => assert_active_member(ctx, {})).toThrow(/miembro activo/);
    expect(subjects(ctx)).toEqual([]);
    expect(() => join_group(ctx, { displayName: 'Alumno' })).toThrow(/baja/);
  });

  it('revocar una invitación antes de aceptar impide la entrada', () => {
    const { ctx, asOwner, asStudent, invite } = setup();
    invite();
    asOwner();
    revoke_invitation(ctx, { email: 'alumno@example.com' });
    asStudent();
    expect(() => join_group(ctx, { displayName: 'Alumno' })).toThrow(/lista autorizada/);
  });

  it('reinvitar con otro rol lo corrige y se respeta al unirse', () => {
    const { ctx, db, asOwner, asStudent, invite } = setup();
    invite();
    asOwner();
    invite_member(ctx, { email: 'alumno@example.com', isCreator: true });
    expect(db.invitation.rows.size).toBe(1);
    expect(db.invitation.rows.get('alumno@example.com')?.isCreator).toBe(true);
    asStudent();
    join_group(ctx, { displayName: 'Alumno' });
    expect(db.member.rows.get('student')?.isCreator).toBe(true);
  });

  it('rechaza correos mal escritos al invitar', () => {
    const { ctx, db, asOwner } = setup();
    asOwner();
    expect(() => invite_member(ctx, { email: 'sin-arroba', isCreator: false })).toThrow(/no es válido/);
    expect(db.invitation.rows.size).toBe(0);
  });

  it('al unirse la invitación deja de estar pendiente, también si la reinvitan', () => {
    const { ctx, db, asOwner, asStudent, join } = setup();
    join();
    expect(db.invitation.rows.size).toBe(0);
    asOwner();
    invite_member(ctx, { email: 'alumno@example.com', isCreator: false });
    asStudent();
    expect(() => join_group(ctx, { displayName: 'Alumno' })).not.toThrow();
    expect(db.invitation.rows.size).toBe(0);
  });

  it('al conectarse un miembro se limpia su invitación aceptada que quedó de antes', () => {
    const { ctx, db, owner, join } = setup();
    join();
    db.invitation.insert({ email: 'alumno@example.com', isCreator: false, invitedBy: owner, createdAt: 1n });
    on_connect(ctx, {});
    expect(db.invitation.rows.size).toBe(0);
  });

  it('vuelve a comprobar audiencia actual incluso para un miembro existente en cada reducer', () => {
    const { ctx, mutableCtx, join } = setup();
    join();
    mutableCtx.senderAuth.jwt!.audience = ['unrelated-client'];
    expect(() => assert_active_member(ctx, {})).toThrow(/otra aplicación/);
    expect(() => on_connect(ctx, {})).toThrow(/otra aplicación/);
  });

  it('también exige correo verificado en nuevas operaciones de un miembro existente', () => {
    const { ctx, mutableCtx, join } = setup();
    join();
    mutableCtx.senderAuth.jwt!.fullPayload.email_verified = false;
    expect(() => assert_active_member(ctx, {})).toThrow(/correo verificado/);
    expect(() => on_connect(ctx, {})).toThrow(/correo verificado/);
  });

  it('falla cerrado si no se ha configurado el acceso, pero permite bootstrap del owner', () => {
    const { ctx, db, asOwner } = setup();
    db.authConfig.rows.clear();
    expect(() => on_connect(ctx, {})).toThrow(/no está configurado/);
    asOwner();
    expect(() => on_connect(ctx, {})).not.toThrow();
    set_auth_config(ctx, { issuer, audiences: ['opaque-client-id'] });
    expect(db.authConfig.rows.get('0')?.audiences).toEqual(['opaque-client-id']);
  });

  it('solo creadores autorizados configuran y solo se acepta un emisor de Supabase', () => {
    const { ctx, asOwner, join } = setup();
    join();
    expect(() => set_auth_config(ctx, { issuer, audiences: ['some-client'] })).toThrow(/creadores/);
    asOwner();
    expect(() => set_auth_config(ctx, { issuer: 'https://accounts.google.com', audiences: ['some-client'] })).toThrow(/emisor/);
    expect(() => set_auth_config(ctx, { issuer, audiences: [] })).toThrow(/audiencias/);
  });

  it('una DB existente sin app_config falla cerrado sin owner de bootstrap explícito', () => {
    const { ctx, db, mutableCtx } = setup();
    db.appConfig.rows.clear();
    db.authConfig.rows.clear();
    expect(() => on_connect(ctx, {})).toThrow(/no está configurado/);
    expect(() => set_auth_config(ctx, { issuer, audiences: ['web-client'] })).toThrow();
    mutableCtx.env.B20_BOOTSTRAP_OWNER_IDENTITY = 'malformed';
    expect(() => set_auth_config(ctx, { issuer, audiences: ['web-client'] })).toThrow();
    expect(db.appConfig.rows.size).toBe(0);
  });

  it('solo owner de bootstrap fijado en el entorno adopta DB vacía al configurar auth', () => {
    const { ctx, db, mutableCtx } = setup();
    db.appConfig.rows.clear();
    db.authConfig.rows.clear();
    mutableCtx.env.B20_BOOTSTRAP_OWNER_IDENTITY = 'a'.repeat(64);
    expect(() => set_auth_config(ctx, { issuer, audiences: ['web-client'] })).toThrow();
    expect(db.appConfig.rows.size).toBe(0);
    mutableCtx.sender = identity('a'.repeat(64));
    mutableCtx.senderAuth.jwt = null;
    expect(() => on_connect(ctx, {})).not.toThrow();
    set_auth_config(ctx, { issuer, audiences: ['web-client'] });
    expect(db.appConfig.rows.get('0')?.owner).toBe(mutableCtx.sender);
    expect(db.authConfig.rows.get('0')?.audiences).toEqual(['web-client']);
    // El owner queda persistido: retirar el valor temporal no lo deja bloqueado.
    mutableCtx.env.B20_BOOTSTRAP_OWNER_IDENTITY = undefined;
    expect(() => on_connect(ctx, {})).not.toThrow();
    expect(() => invite_member(ctx, { email: 'alumno@example.com', isCreator: true })).not.toThrow();
  });

  it('una variable bootstrap no cambia el owner ya persistido', () => {
    const { ctx, db, mutableCtx, owner } = setup();
    mutableCtx.env.B20_BOOTSTRAP_OWNER_IDENTITY = 'b'.repeat(64);
    mutableCtx.sender = identity('b'.repeat(64));
    mutableCtx.senderAuth.jwt = null;
    expect(() => on_connect(ctx, {})).toThrow(/Inicia sesión/);
    expect(() => set_auth_config(ctx, { issuer, audiences: ['hijack-client'] })).toThrow();
    expect(db.appConfig.rows.get('0')?.owner).toBe(owner);
    expect(db.authConfig.rows.get('0')?.audiences).toEqual(['web-client', 'android-client']);
  });
});
