import { t, table } from 'spacetimedb/server';
export const museumEntry = table({ name: 'museum_entry' }, {
  questionId: t.u64().primaryKey(), author: t.identity().index('btree'), requestId: t.string(), creationRequestId: t.string(), fields: t.string(),
  version: t.u32(), updatedBy: t.identity(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
export const museumRevision = table({ name: 'museum_revision' }, {
  id: t.u64().primaryKey().autoInc(), questionId: t.u64().index('btree'), fields: t.string(), version: t.u32(),
  updatedBy: t.identity(), createdAt: t.timestamp(),
});
export const opportunity = table({ name: 'opportunity' }, {
  id: t.u64().primaryKey().autoInc(), author: t.identity().index('btree'), requestId: t.string(), fields: t.string(),
  withdrawn: t.bool(), withdrawalReason: t.string(), version: t.u32(), updatedBy: t.identity(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
export const opportunityRevision = table({ name: 'opportunity_revision' }, {
  id: t.u64().primaryKey().autoInc(), opportunityId: t.u64().index('btree'), fields: t.string(), withdrawn: t.bool(),
  version: t.u32(), updatedBy: t.identity(), createdAt: t.timestamp(),
});
export const opportunityInterest = table({ name: 'opportunity_interest' }, {
  key: t.string().primaryKey(), opportunityId: t.u64().index('btree'), memberId: t.identity().index('btree'),
  interested: t.bool(), seekingTeam: t.bool(), shareContact: t.bool(), version: t.u32(), updatedAt: t.timestamp(),
});
export const opportunityFeedback = table({ name: 'opportunity_feedback_entry' }, {
  id: t.u64().primaryKey().autoInc(), opportunityId: t.u64().index('btree'), author: t.identity(), requestId: t.string(),
  kind: t.string(), text: t.string(), status: t.string(), resolution: t.string(), resolvedBy: t.identity().optional(),
  version: t.u32(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
export const community4Tables = { museumEntry, museumRevision, opportunity, opportunityRevision, opportunityInterest, opportunityFeedback };
