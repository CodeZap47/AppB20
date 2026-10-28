import { table, t } from 'spacetimedb/server';
/** Actor-owned composer state; never subscribed or exposed as a public table/view. */
export const guideMaterialSelection = table({ name: 'guide_material_selection' }, {
  id: t.string().primaryKey(), actor: t.identity().index('btree'), revision: t.u32(), json: t.string(), updatedAt: t.timestamp(),
});
export const guideMaterialsTables = { guideMaterialSelection };
