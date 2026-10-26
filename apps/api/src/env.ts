/** Configuración del backend desde variables de entorno. Nunca se registran sus valores. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
  /** Supabase Auth: `https://<ref>.supabase.co/auth/v1`, audiencia `authenticated`. */
  oidcIssuer: () => required('OIDC_ISSUER'),
  oidcAudiences: () => required('OIDC_AUDIENCE').split(',').map((value) => value.trim()).filter(Boolean),
  oidcJwksUri: () => required('OIDC_JWKS_URI'),
  spacetimeUri: () => required('SPACETIMEDB_URI'),
  spacetimeModule: () => required('SPACETIMEDB_MODULE'),
  /** La API Node heredada es solo local; el despliegue nuevo usa SpacetimeDB + Cloudflare. */
  secretStore: process.env.SECRET_STORE ?? 'memory',
  byokEncryptionKey: () => required('BYOK_ENCRYPTION_KEY'),
  geminiModel: () => required('GEMINI_MODEL'),
};
