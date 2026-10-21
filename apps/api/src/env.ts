/** Configuración del backend desde variables de entorno. Nunca se registran sus valores. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
  oidcIssuer: () => process.env.OIDC_ISSUER ?? 'https://auth.spacetimedb.com/oidc',
  oidcAudiences: () => required('OIDC_AUDIENCE').split(',').map((value) => value.trim()).filter(Boolean),
  oidcJwksUri: () => process.env.OIDC_JWKS_URI ?? 'https://auth.spacetimedb.com/oidc/jwks',
  spacetimeUri: () => required('SPACETIMEDB_URI'),
  spacetimeModule: () => required('SPACETIMEDB_MODULE'),
  /** La API Node heredada es solo local; el despliegue nuevo usa SpacetimeDB + Cloudflare. */
  secretStore: process.env.SECRET_STORE ?? 'memory',
  byokEncryptionKey: () => required('BYOK_ENCRYPTION_KEY'),
  geminiModel: () => required('GEMINI_MODEL'),
};
