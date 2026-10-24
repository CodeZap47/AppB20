import { describe, expect, it, vi } from 'vitest';
import { accountRoutes, accountState, createSupabaseAdmin, inviteHash, type SupabaseAdmin } from './accountRoutes.ts';

const env = { SPACETIMEDB_URI: 'https://maincloud.spacetimedb.com', SPACETIMEDB_MODULE: 'b20' };
function admin(state: 'password' | 'setup' | 'none'): SupabaseAdmin & { create: ReturnType<typeof vi.fn> } {
  return { state: vi.fn(async () => state), create: vi.fn(async () => {}) };
}
function post(app: ReturnType<typeof accountRoutes>, body: unknown) {
  return app.request('/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
}

describe('estado de la cuenta para el acceso', () => {
  it('una cuenta con contraseña o ya activada no consulta invitaciones', async () => {
    for (const state of ['password', 'setup'] as const) {
      const invited = vi.fn();
      const supabase = admin(state);
      expect(await accountState('a@b.mx', { admin: supabase, invited })).toBe(state);
      expect(invited).not.toHaveBeenCalled();
      expect(supabase.create).not.toHaveBeenCalled();
    }
  });

  it('activa la cuenta solo si el correo tiene una invitación pendiente', async () => {
    const supabase = admin('none');
    expect(await accountState('a@b.mx', { admin: supabase, invited: async () => true })).toBe('setup');
    expect(supabase.create).toHaveBeenCalledWith('a@b.mx');
    const other = admin('none');
    expect(await accountState('x@b.mx', { admin: other, invited: async () => false })).toBe('inactive');
    expect(other.create).not.toHaveBeenCalled();
  });

  it('la ruta normaliza el correo, consulta al módulo y no expone errores internos', async () => {
    const supabase = admin('none');
    const call = vi.fn(async () => true);
    const app = accountRoutes({ admin: () => supabase, call: () => call as never });
    const response = await post(app, { email: '  Alumno@Example.com ' });
    expect(await response.json()).toEqual({ state: 'setup' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(call).toHaveBeenCalledWith('auth_activation_check', { email: 'alumno@example.com' });
    expect((await post(app, { email: 'sin-arroba' })).status).toBe(400);
    const failing = accountRoutes({ admin: () => ({ state: async () => { throw new Error('secreto'); }, create: async () => {} }), call: () => call as never });
    const failed = await post(failing, { email: 'a@b.mx' });
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain('secreto');
  });

  it('sin la configuración de Supabase responde que el acceso no está listo', async () => {
    expect((await post(accountRoutes(), { email: 'a@b.mx' })).status).toBe(503);
  });
});

describe('enlace de invitación en el estado de la cuenta', () => {
  const code = 'A'.repeat(43);

  it('sin invitación, el enlace vigente activa la cuenta; uno inválido no', async () => {
    const supabase = admin('none');
    const redeem = vi.fn(async () => true);
    expect(await accountState('a@b.mx', { admin: supabase, invited: async () => false, redeem })).toBe('setup');
    expect(redeem).toHaveBeenCalledWith('a@b.mx');
    expect(supabase.create).toHaveBeenCalledWith('a@b.mx');
    const other = admin('none');
    expect(await accountState('a@b.mx', { admin: other, invited: async () => false, redeem: async () => false })).toBe('inactive');
    expect(other.create).not.toHaveBeenCalled();
  });

  it('con invitación por correo no gasta el enlace; una cuenta existente también lo canjea', async () => {
    const redeem = vi.fn(async () => true);
    expect(await accountState('a@b.mx', { admin: admin('none'), invited: async () => true, redeem })).toBe('setup');
    expect(redeem).not.toHaveBeenCalled();
    expect(await accountState('a@b.mx', { admin: admin('password'), invited: async () => false, redeem })).toBe('password');
    expect(redeem).toHaveBeenCalledWith('a@b.mx');
  });

  it('la ruta envía al módulo solo el hash del código, y descarta códigos mal formados', async () => {
    const call = vi.fn(async (name: string) => name === 'invite_link_redeem');
    const app = accountRoutes({ admin: () => admin('none'), call: () => call as never });
    expect(await (await post(app, { email: 'a@b.mx', invite: code })).json()).toEqual({ state: 'setup' });
    expect(call).toHaveBeenCalledWith('invite_link_redeem', { tokenHash: await inviteHash(code), email: 'a@b.mx' });
    expect(JSON.stringify(call.mock.calls)).not.toContain(code);
    call.mockClear();
    expect(await (await post(app, { email: 'a@b.mx', invite: 'corto' })).json()).toEqual({ state: 'inactive' });
    expect(call).not.toHaveBeenCalledWith('invite_link_redeem', expect.anything());
  });

  it('el hash es SHA-256 en hexadecimal', async () => {
    expect(await inviteHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('cliente administrativo de Supabase', () => {
  it('usa solo la clave secreta y trata una cuenta existente como activada', async () => {
    const fetchFn = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).apikey).toBe('sb_secret_x');
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
      if (String(url).endsWith('/rest/v1/rpc/b20_account_state')) return Response.json('setup');
      return Response.json({ error_code: 'email_exists' }, { status: 422 });
    });
    const supabase = createSupabaseAdmin('https://ref.supabase.co', 'sb_secret_x', fetchFn as typeof fetch);
    expect(await supabase.state('a@b.mx')).toBe('setup');
    await expect(supabase.create('a@b.mx')).resolves.toBeUndefined();
    expect(JSON.parse(String(fetchFn.mock.calls[1]![1]!.body))).toEqual({ email: 'a@b.mx', email_confirm: true });
  });

  it('rechaza claves que no son secretas y respuestas inesperadas', async () => {
    expect(() => createSupabaseAdmin('https://ref.supabase.co', 'sb_publishable_x')).toThrow();
    const supabase = createSupabaseAdmin('https://ref.supabase.co', 'sb_secret_x', (async () => Response.json({ rows: [] })) as typeof fetch);
    await expect(supabase.state('a@b.mx')).rejects.toThrow();
  });
});
