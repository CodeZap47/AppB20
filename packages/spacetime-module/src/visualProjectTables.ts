import { t, table } from 'spacetimedb/server';

/** The owner and metadata stay private; visual_projects projects only authorized records. */
export const visualProject = table({ name: 'visual_project' }, {
  id: t.u64().primaryKey().autoInc(), author: t.identity().index('btree'),
  requestKey: t.string().unique(), requestId: t.string(), creationMetadata: t.string(), metadata: t.string(),
  visibility: t.string(), archived: t.bool(), version: t.u32(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
export const visualProjectViewRow = t.object('VisualProjectViewRow', { id: t.u64(), json: t.string(), requestId: t.string() });
export const visualProjectTables = { visualProject };
