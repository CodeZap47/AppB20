import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT, type JWTPayload } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { createRequireAuth, type AuthOptions, type AuthVariables } from './auth.ts';
import { createApp } from '../app.ts';
import { EncryptedMemoryStore } from './secrets.ts';

const issuer = 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1';
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: AuthOptions['jwks'];

beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  const publicKey = await exportJWK(keys.publicKey);
  jwks = createLocalJWKSet({ keys: [{ ...publicKey, kid: 'test', alg: 'RS256', use: 'sig' }] });
});

async function token(claims: JWTPayload = {}, key = keys.privateKey) {
  return new SignJWT({ email: 'Alumno@Example.com', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setSubject(String(claims.sub ?? 'student-1'))
    .setIssuer(String(claims.iss ?? issuer))
    .setAudience(claims.aud ?? 'client_web')
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? '5m')
    .sign(key);
}

function setup(isActiveMember = vi.fn(async () => true)) {
  const options: AuthOptions = { issuer, audiences: ['client_web', 'client_android'], jwks, isActiveMember };
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', createRequireAuth(options));
  app.get('/', (c) => c.json(c.get('user')));
  return { app, options, isActiveMember };
}

describe('Supabase Auth en API', () => {
  it('valida el token ES256 de Supabase y exige el claim verificado del hook', async () => {
    const pair = await generateKeyPair('ES256');
    const publicKey = await exportJWK(pair.publicKey);
    const supabaseIssuer = 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1';
    const isActiveMember = vi.fn(async () => true);
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use('*', createRequireAuth({ issuer: supabaseIssuer, audiences: ['authenticated'],
      jwks: createLocalJWKSet({ keys: [{ ...publicKey, kid: 'supabase', alg: 'ES256' }] }), isActiveMember }));
    app.get('/', (c) => c.json(c.get('user')));
    const signed = (verified: boolean | undefined) => new SignJWT({ email: 'alumno@example.com', email_verified: verified,
      user_metadata: { email_verified: true } }).setProtectedHeader({ alg: 'ES256', kid: 'supabase' })
      .setSubject('supabase-user').setIssuer(supabaseIssuer).setAudience('authenticated').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    expect((await app.request('/', { headers: { Authorization: `Bearer ${await signed(true)}` } })).status).toBe(200);
    expect((await app.request('/', { headers: { Authorization: `Bearer ${await signed(undefined)}` } })).status).toBe(401);
    expect(isActiveMember).toHaveBeenCalledTimes(1);
  });
  it('valida una firma real, normaliza correo y consulta membresía con el mismo ID token', async () => {
    const { app, isActiveMember } = setup();
    const idToken = await token();
    const response = await app.request('/', { headers: { Authorization: `Bearer ${idToken}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ subject: 'student-1', email: 'alumno@example.com' });
    expect(isActiveMember).toHaveBeenCalledWith(idToken);
  });

  it.each([
    ['Google directo', { iss: 'https://accounts.google.com' }],
    ['otro cliente', { aud: 'client_unrelated' }],
    ['caducado', { exp: Math.floor(Date.now() / 1000) - 30 }],
    ['correo no verificado', { email_verified: false }],
    ['claim no booleano', { email_verified: 'true' }],
    ['correo vacío', { email: '' }],
  ])('rechaza token %s antes de consultar membresía', async (_label, claims) => {
    const { app, isActiveMember } = setup();
    const response = await app.request('/', { headers: { Authorization: `Bearer ${await token(claims)}` } });
    expect(response.status).toBe(401);
    expect(isActiveMember).not.toHaveBeenCalled();
  });

  it('rechaza una firma de otra clave', async () => {
    const otherKeys = await generateKeyPair('RS256');
    const { app, isActiveMember } = setup();
    const response = await app.request('/', { headers: { Authorization: `Bearer ${await token({}, otherKeys.privateKey)}` } });
    expect(response.status).toBe(401);
    expect(isActiveMember).not.toHaveBeenCalled();
  });

  it('acepta los otros clientes autorizados', async () => {
    const { app } = setup();
    const response = await app.request('/', { headers: { Authorization: `Bearer ${await token({ aud: 'client_android' })}` } });
    expect(response.status).toBe(200);
  });

  it('rechaza invitado que aún no se une o miembro dado de baja', async () => {
    const { app } = setup(vi.fn(async () => false));
    const response = await app.request('/', { headers: { Authorization: `Bearer ${await token()}` } });
    expect(response.status).toBe(403);
  });

  it('falla cerrado ante error de SpacetimeDB y no expone detalles', async () => {
    const { app } = setup(vi.fn(async () => { throw new Error('secret-token-private-db'); }));
    const response = await app.request('/', { headers: { Authorization: `Bearer ${await token()}` } });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret-token');
  });

  it('revalida membresía en cada petición: una baja se aplica sin esperar al vencimiento', async () => {
    const membership = vi.fn(async () => true);
    const { app } = setup(membership);
    const headers = { Authorization: `Bearer ${await token()}` };
    expect((await app.request('/', { headers })).status).toBe(200);
    membership.mockResolvedValue(false);
    expect((await app.request('/', { headers })).status).toBe(403);
  });

  it.each([
    ['GET', '/ai/key'], ['PUT', '/ai/key'], ['DELETE', '/ai/key'], ['POST', '/ai/generate'],
  ])('protege %s %s antes de leer o modificar claves', async (method, path) => {
    const { options } = setup(vi.fn(async () => false));
    const store = new EncryptedMemoryStore(randomBytes(32).toString('base64'));
    const getSpy = vi.spyOn(store, 'get');
    const putSpy = vi.spyOn(store, 'put');
    const deleteSpy = vi.spyOn(store, 'delete');
    const hasSpy = vi.spyOn(store, 'has');
    const app = createApp(store, options);
    const response = await app.request(path, { method, headers: { Authorization: `Bearer ${await token()}` } });
    expect(response.status).toBe(403);
    for (const spy of [getSpy, putSpy, deleteSpy, hasSpy]) expect(spy).not.toHaveBeenCalled();
  });
});
