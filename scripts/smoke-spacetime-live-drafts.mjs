/** Real multi-connection acceptance test against a disposable local database. */
process.env.B20_SMOKE_SCENARIO = 'live-drafts';
process.env.B20_SMOKE_ENGAGEMENT_PORT ??= '3368';
await import('./smoke-spacetime-engagement.mjs');
