import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import { env } from '../env.ts';

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export interface AuthUser {
  /** `sub` del token OIDC; identifica al usuario en el backend. */
  subject: string;
  email: string;
}

export type AuthVariables = { user: AuthUser };

/**
 * Valida el token OIDC de Google (emisor, audiencia y firma). La pertenencia al grupo la
 * comprueba además el módulo SpacetimeDB; aquí solo se aceptan correos verificados.
 * TODO(Etapa 0): consultar la membresía activa antes de permitir generaciones.
 */
export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return c.json({ error: 'Sesión requerida' }, 401);
  try {
    const { payload } = await jwtVerify(token, googleJwks, {
      issuer: [env.oidcIssuer, env.oidcIssuer.replace('https://', '')],
      audience: env.oidcAudience(),
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || payload.email_verified !== true) {
      return c.json({ error: 'Cuenta sin correo verificado' }, 401);
    }
    c.set('user', { subject: payload.sub, email: payload.email.toLowerCase() });
  } catch {
    return c.json({ error: 'Sesión inválida' }, 401);
  }
  await next();
};
