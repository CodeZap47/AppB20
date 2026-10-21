import { t, table } from 'spacetimedb/server';

/** Agente personal (7.13, AG-3). Todas las tablas son privadas; las vistas `my_agent_*` filtran por dueño. */
export const agentProfile = table({ name: 'agent_profile' }, {
  owner: t.identity().primaryKey(), premisesVersion: t.u32(), consentAt: t.timestamp(), styleVersion: t.u32(),
  version: t.u32(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
export const agentStyleSource = table({ name: 'agent_style_source' }, {
  key: t.string().primaryKey(), owner: t.identity().index('btree'), kind: t.string(), refId: t.u64(), refVersion: t.u32(), addedAt: t.timestamp(),
});
export const agentStyleSnapshot = table({ name: 'agent_style_snapshot' }, {
  id: t.u64().primaryKey().autoInc(), owner: t.identity().index('btree'), version: t.u32(),
  /** JSON con `StyleFeatures` y `StyleDescription`; `examples` y `sources`, también JSON. */
  features: t.string(), examples: t.string(), sources: t.string(), createdAt: t.timestamp(),
});
export const agentSession = table({ name: 'agent_session' }, {
  id: t.u64().primaryKey().autoInc(), owner: t.identity().index('btree'), assignmentId: t.u64(), requestId: t.string(),
  stage: t.string(), draft: t.string(), draftVersion: t.u32(), generation: t.u32(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
export const agentSuggestion = table({ name: 'agent_suggestion' }, {
  id: t.u64().primaryKey().autoInc(), sessionId: t.u64().index('btree'), owner: t.identity().index('btree'), draftVersion: t.u32(),
  reason: t.string(), original: t.string(), replacement: t.string(), state: t.string(), createdAt: t.timestamp(), resolvedAt: t.timestamp().optional(),
});
export const agentOriginalityCheck = table({ name: 'agent_originality_check' }, {
  id: t.u64().primaryKey().autoInc(), sessionId: t.u64().index('btree'), owner: t.identity().index('btree'), draftVersion: t.u32(),
  /** JSON de coincidencias calculadas en el servidor contra lo publicado. */
  matches: t.string(), acknowledged: t.array(t.string()), createdAt: t.timestamp(),
});
/** Vencimiento de sesiones inactivas; `generation` evita borrar una sesión que se volvió a usar. */
export const agentExpiry = table({ name: 'agent_expiry' }, {
  id: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), sessionId: t.u64().index('btree'), generation: t.u32(),
});
export const agentTables = { agentProfile, agentStyleSource, agentStyleSnapshot, agentSession, agentSuggestion, agentOriginalityCheck, agentExpiry };
