import type { Identity } from 'spacetimedb';
import { table, t } from 'spacetimedb/server';

/** Solo el propietario puede vincular una identidad de login a una membresía existente. */
export const authIdentityLink = table({ name: 'auth_identity_link' }, {
  sessionIdentity: t.identity().primaryKey(),
  memberIdentity: t.identity(),
  createdAt: t.timestamp(),
});

interface IdentityContext {
  sender: Identity;
  db: { readonly authIdentityLink?: { readonly sessionIdentity: { find(identity: Identity): { memberIdentity: Identity } | null | undefined } } };
}

/** La identidad de dominio permanece estable aunque cambie el proveedor de login. */
export function memberIdentityFor(ctx: IdentityContext): Identity {
  return ctx.db.authIdentityLink?.sessionIdentity.find(ctx.sender)?.memberIdentity ?? ctx.sender;
}

/** Supabase Auth es el único proveedor: proyectos alojados con OIDC y JWKS bajo /auth/v1. */
export function allowedAuthIssuer(issuer: string): boolean {
  return /^https:\/\/[a-z0-9]{20}\.supabase\.co\/auth\/v1$/.test(issuer);
}
