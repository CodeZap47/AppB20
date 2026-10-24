import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createNotificationCall, type NotificationCall } from '../notifications/database.ts';

/** La clave secreta de Supabase solo vive como secreto del Worker; nunca llega al cliente. */
export interface AccountEnv {
  SPACETIMEDB_URI: string; SPACETIMEDB_MODULE: string;
  SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string; NOTIFICATION_SERVICE_TOKEN?: string;
}
/** `setup`: activada y sin contraseña. `inactive`: sin cuenta ni invitación pendiente. */
export type AccountState = 'password' | 'setup' | 'inactive';
export interface SupabaseAdmin {
  state(email: string): Promise<'password' | 'setup' | 'none'>;
  create(email: string): Promise<void>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Código del enlace de invitación: 32 bytes en base64url. */
const INVITE = /^[A-Za-z0-9_-]{43}$/;

/** El módulo solo conoce el hash del código, nunca el código. */
export async function inviteHash(code: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createSupabaseAdmin(url: string, secretKey: string, fetchFn: typeof fetch = fetch): SupabaseAdmin {
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.pathname !== '/' || !secretKey.startsWith('sb_secret_')) throw new Error('Supabase admin is not configured.');
  const request = (path: string, body: unknown) => fetchFn(new URL(path, base), {
    method: 'POST', headers: { apikey: secretKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(10_000),
  });
  return {
    async state(email) {
      const response = await request('/rest/v1/rpc/b20_account_state', { p_email: email });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Supabase account state failed (HTTP ${response.status}).`); }
      const value: unknown = await response.json();
      if (value !== 'password' && value !== 'setup' && value !== 'none') throw new Error('Unexpected Supabase account state.');
      return value;
    },
    async create(email) {
      // Confirmada desde el inicio: el primer acceso exige el código enviado a ese correo.
      const response = await request('/auth/v1/admin/users', { email, email_confirm: true });
      if (response.ok) return;
      const error = await response.json().catch(() => null) as { error_code?: string } | null;
      if (error?.error_code === 'email_exists') return;
      throw new Error(`Supabase account creation failed (HTTP ${response.status}).`);
    },
  };
}

/**
 * Activa la cuenta la primera vez que una persona invitada escribe su correo. Con un enlace de
 * invitación (`redeem`), el módulo crea antes la invitación de ese correo si el enlace sigue vigente.
 */
export async function accountState(email: string, deps: {
  admin: SupabaseAdmin; invited(email: string): Promise<boolean>; redeem?: (email: string) => Promise<boolean>;
}): Promise<AccountState> {
  const state = await deps.admin.state(email);
  const allowed = async () => await deps.invited(email) || (!!deps.redeem && await deps.redeem(email));
  if (state !== 'none') {
    // Una cuenta que ya existe también puede unirse con el enlace; su acceso no cambia.
    if (deps.redeem) await allowed();
    return state;
  }
  if (!await allowed()) return 'inactive';
  await deps.admin.create(email);
  return 'setup';
}

export function accountRoutes(options: { admin?: (env: AccountEnv) => SupabaseAdmin; call?: (env: AccountEnv) => NotificationCall } = {}) {
  const app = new Hono<{ Bindings: AccountEnv }>();
  app.post('/state', bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: 'Escribe un correo válido.' }, 400) }), async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await c.req.json<{ email?: unknown; invite?: unknown }>().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL.test(email) || email.length > 320) return c.json({ error: 'Escribe un correo válido.' }, 400);
    const invite = typeof body?.invite === 'string' && INVITE.test(body.invite) ? body.invite : undefined;
    const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, NOTIFICATION_SERVICE_TOKEN: serviceToken } = c.env;
    if (!options.admin && (!url || !key)) return c.json({ error: 'El acceso todavía no está configurado.' }, 503);
    if (!options.call && !serviceToken) return c.json({ error: 'El acceso todavía no está configurado.' }, 503);
    try {
      const admin = options.admin?.(c.env) ?? createSupabaseAdmin(url!, key!);
      const call = options.call?.(c.env) ?? createNotificationCall({ uri: c.env.SPACETIMEDB_URI, module: c.env.SPACETIMEDB_MODULE, serviceToken: serviceToken! });
      const tokenHash = invite ? await inviteHash(invite) : undefined;
      const state = await accountState(email, {
        admin,
        invited: (value) => call<boolean>('auth_activation_check', { email: value }),
        redeem: tokenHash ? (value) => call<boolean>('invite_link_redeem', { tokenHash, email: value }) : undefined,
      });
      return c.json({ state });
    } catch (error) {
      // El motivo no incluye secretos: solo el paso que falló y su código HTTP.
      console.error(JSON.stringify({ event: 'account_state_error', reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
      return c.json({ error: 'No pudimos comprobar tu cuenta. Inténtalo de nuevo.' }, 503);
    }
  });
  return app;
}
