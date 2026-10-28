/** Multi-account checks use a disposable local server and synthetic records only. */
process.env.B20_SMOKE_SCENARIO = 'message-info';
process.env.B20_SMOKE_ENGAGEMENT_PORT ??= '3370';
await import('./smoke-spacetime-engagement.mjs');
