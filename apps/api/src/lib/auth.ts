import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Env, MiddlewareHandler } from 'hono';
import { env } from '../env.ts';
import { checkActiveMembership } from './membership.ts';

export interface AuthUser {
  /** `sub` del ID token OIDC de SpacetimeAuth. */
  subject: string;
  email: string;
}

export type AuthVariables = { user: AuthUser };

export interface AuthOptions {
  issuer: string;
  audiences: string[];
  jwks: JWTVerifyGetKey;
  isActiveMember: (token: string) => Promise<boolean>;
}

let defaultOptions: AuthOptions | undefined;
function configuredOptions(): AuthOptions {
  if (!defaultOptions) {
    const audiences = env.oidcAudiences();
    if (!audiences.length) throw new Error('Falta OIDC_AUDIENCE');
    defaultOptions = {
      issuer: env.oidcIssuer(),
      audiences,
      jwks: createRemoteJWKSet(new URL(env.oidcJwksUri())),
      isActiveMember: checkActiveMembership,
    };
  }
  return defaultOptions;
}

/** Firma, emisor, audiencia, caducidad, correo verificado y membresía activa, sin caché. */
export function createRequireAuth<E extends Env = { Variables: AuthVariables }>(options?: AuthOptions): MiddlewareHandler<E & { Variables: AuthVariables }> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    if (!token) return c.json({ error: 'Sesión requerida' }, 401);

    let config: AuthOptions;
    try {
      config = options ?? configuredOptions();
    } catch {
      return c.json({ error: 'Acceso todavía no configurado' }, 503);
    }

    try {
      const { payload } = await jwtVerify(token, config.jwks, {
        issuer: config.issuer,
        audience: config.audiences,
        algorithms: ['RS256', 'ES256'],
        requiredClaims: ['sub', 'iss', 'aud', 'exp', 'iat', 'email', 'email_verified'],
      });
      if (typeof payload.sub !== 'string' || !payload.sub ||
          typeof payload.email !== 'string' || !payload.email.trim() || payload.email_verified !== true) {
        return c.json({ error: 'Cuenta sin correo verificado' }, 401);
      }
      c.set('user', { subject: payload.sub, email: payload.email.trim().toLowerCase() });
    } catch {
      return c.json({ error: 'Sesión inválida' }, 401);
    }

    try {
      if (!await config.isActiveMember(token)) {
        return c.json({ error: 'Necesitas una invitación y membresía activa del grupo' }, 403);
      }
    } catch {
      // Fallar cerrado: ninguna lectura ni generación pasa si no se puede confirmar el acceso.
      return c.json({ error: 'No se pudo comprobar tu acceso al grupo. Intenta de nuevo.' }, 503);
    }
    await next();
  };
}

export const requireAuth = createRequireAuth();
