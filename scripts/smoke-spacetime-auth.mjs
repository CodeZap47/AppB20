// Servidor, claves y usuarios sintéticos aislados; no toca Supabase ni Maincloud.
process.env.B20_SMOKE_SCENARIO = 'auth';
await import('./smoke-spacetime-engagement.mjs');
