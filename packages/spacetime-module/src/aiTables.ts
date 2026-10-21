import { t, table } from 'spacetimedb/server';

/** No public views: even service credentials never grant table subscriptions. */
export const aiServiceConfig = table({ name: 'ai_service_config' }, {
  id: t.u32().primaryKey(), identity: t.identity(), enabled: t.bool(), dailyTokenBudget: t.u32(),
});
export const aiKey = table({ name: 'ai_key' }, {
  actor: t.identity().primaryKey(), keyId: t.string(), provider: t.string(),
  ciphertext: t.string(), iv: t.string(), masterVersion: t.string(), updatedAt: t.timestamp(),
});
export const aiKeyIntent = table({ name: 'ai_key_intent' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'), keyId: t.string(), provider: t.string(),
  status: t.string(), createdAt: t.timestamp(), expiresAt: t.timestamp(),
});
export const aiConsent = table({ name: 'ai_consent' }, {
  actor: t.identity().primaryKey(), version: t.string(), accepted: t.bool(), updatedAt: t.timestamp(),
});
/** JSON contains immutable, redacted snapshots including sources without native history. */
export const aiPreparation = table({ name: 'ai_preparation' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'), fingerprint: t.string(),
  model: t.string(), json: t.string(), requestJson: t.string(),
  createdAt: t.timestamp(), expiresAt: t.timestamp(),
});
export const aiGeneration = table({ name: 'ai_generation' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'), preparationId: t.string(),
  requestHash: t.string(), configJson: t.string(), keyId: t.string(), model: t.string(),
  status: t.string(), createdAt: t.timestamp(), claimedAt: t.timestamp().optional(),
  inputTokens: t.u32().optional(), outputTokens: t.u32().optional(),
  resultJson: t.string(), errorCode: t.string(), errorMessage: t.string(),
});
/** Rate reservations are immutable by UUID; uncertain provider submissions keep their budget. */
export const aiReservation = table({ name: 'ai_reservation' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'), estimatedTokens: t.u32(),
  status: t.string(), createdAt: t.timestamp(),
});
export const aiPublication = table({ name: 'ai_publication' }, {
  generationId: t.string().primaryKey(), actor: t.identity(), targetKind: t.string(), targetId: t.u64(), createdAt: t.timestamp(),
});
export const aiTables = { aiPublication, aiServiceConfig, aiKey, aiKeyIntent, aiConsent, aiPreparation, aiGeneration, aiReservation };
