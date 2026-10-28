/** Real multi-session checks against an isolated server with synthetic accounts. */
process.env.B20_SMOKE_SCENARIO = 'presence';
process.env.B20_SMOKE_ENGAGEMENT_PORT ??= '3372';
await import('./smoke-spacetime-engagement.mjs');
