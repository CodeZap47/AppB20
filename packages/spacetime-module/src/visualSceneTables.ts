import { t, table } from 'spacetimedb/server';

export const visualScene = table({ name: 'visual_scene' }, {
  projectId: t.u64().primaryKey(), schemaVersion: t.u32(), document: t.string(), version: t.u32(),
  requestKey: t.string(), requestPayload: t.string(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
export const visualModelAsset = table({ name: 'visual_model_asset' }, {
  id: t.u64().primaryKey().autoInc(), projectId: t.u64().index('btree'), requestKey: t.string().unique(),
  name: t.string(), state: t.string(), version: t.u32(), fileId: t.string().optional(),
  sha256: t.string().optional(), bytes: t.u64().optional(), manifest: t.string().optional(),
  createdAt: t.timestamp(), unreferencedSince: t.timestamp().optional(), generation: t.u32(),
});
export const visualAssetExpiry = table({ name: 'visual_asset_expiry' }, {
  id: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), assetId: t.u64(), generation: t.u32(),
});
export const visualSceneTables = { visualScene, visualModelAsset, visualAssetExpiry };
