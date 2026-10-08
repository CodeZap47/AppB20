/** Configuración del backend desde variables de entorno. Nunca se registran sus valores. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
  oidcIssuer: process.env.OIDC_ISSUER ?? 'https://accounts.google.com',
  oidcAudience: () => required('OIDC_AUDIENCE'),
  byokEncryptionKey: () => required('BYOK_ENCRYPTION_KEY'),
  geminiModel: () => required('GEMINI_MODEL'),
};
