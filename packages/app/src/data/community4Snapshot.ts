import { cleanMuseum, cleanOpportunity } from '@b20/core';
import type { DbConnection } from '../module_bindings';
import type { Snapshot } from './types';
import { emptyCommunity4, type Community4Snapshot } from './community4Types';
type View = 'museumEntries' | 'museumRevisions' | 'opportunities' | 'opportunityRevisions' | 'opportunityInterests' | 'opportunityFeedback';
type Connection = { db: { [K in View]: Pick<DbConnection['db'][K], 'iter'> } };
export function readCommunity4Snapshot(c: Connection, base: Snapshot, identity: string): Community4Snapshot {
  if (base.me?.id !== identity || base.me.status !== 'active') return emptyCommunity4();
  const active = new Set(base.members.filter((r) => r.status === 'active').map((r) => r.id));
  const museumEntries = [...(c.db.museumEntries?.iter() ?? [])].filter((r) => base.questions.some((q) => q.id === r.questionId.toString() && !q.withdrawnAt)).map((r) => ({ ...cleanMuseum(JSON.parse(r.fields)),
    questionId: r.questionId.toString(), authorId: r.author.toHexString(), requestId: r.requestId, version: r.version, updatedBy: r.updatedBy.toHexString(), createdAt: r.createdAt.toDate(), updatedAt: r.updatedAt.toDate() }));
  const questions = new Set(museumEntries.map((r) => r.questionId));
  const opportunities = [...(c.db.opportunities?.iter() ?? [])].filter((r) => !r.withdrawn || r.author.toHexString() === identity || base.me?.isCreator).map((r) => ({ ...cleanOpportunity(JSON.parse(r.fields)),
    id: r.id.toString(), authorId: r.author.toHexString(), requestId: r.requestId, withdrawn: r.withdrawn, withdrawalReason: r.withdrawalReason, version: r.version,
    updatedBy: r.updatedBy.toHexString(), createdAt: r.createdAt.toDate(), updatedAt: r.updatedAt.toDate() }));
  const ids = new Set(opportunities.map((r) => r.id));
  return { museumEntries, opportunities,
    museumRevisions: [...(c.db.museumRevisions?.iter() ?? [])].filter((r) => questions.has(r.questionId.toString())).map((r) => ({ id: r.id.toString(), questionId: r.questionId.toString(), fields: cleanMuseum(JSON.parse(r.fields)), version: r.version, updatedBy: r.updatedBy.toHexString(), createdAt: r.createdAt.toDate() })),
    opportunityRevisions: [...(c.db.opportunityRevisions?.iter() ?? [])].filter((r) => ids.has(r.opportunityId.toString())).map((r) => ({ id: r.id.toString(), opportunityId: r.opportunityId.toString(), fields: cleanOpportunity(JSON.parse(r.fields)), withdrawn: r.withdrawn, version: r.version, updatedBy: r.updatedBy.toHexString(), createdAt: r.createdAt.toDate() })),
    opportunityInterests: [...(c.db.opportunityInterests?.iter() ?? [])].filter((r) => active.has(r.memberId.toHexString()) && (r.memberId.toHexString() === identity || (ids.has(r.opportunityId.toString()) && !opportunities.find((o) => o.id === r.opportunityId.toString())?.withdrawn && r.interested && r.seekingTeam && r.shareContact))).map((r) => ({ opportunityId: r.opportunityId.toString(), memberId: r.memberId.toHexString(), interested: r.interested, seekingTeam: r.seekingTeam, shareContact: r.shareContact, version: r.version, updatedAt: r.updatedAt.toDate() })),
    opportunityFeedback: [...(c.db.opportunityFeedback?.iter() ?? [])].filter((r) => ids.has(r.opportunityId.toString())).map((r) => {
      if (!['correction', 'broken_link', 'outdated'].includes(r.kind) || !['open', 'resolved'].includes(r.status)) throw new Error('Actualiza la aplicación para consultar los avisos.');
      return { id: r.id.toString(), opportunityId: r.opportunityId.toString(), authorId: r.author.toHexString(), kind: r.kind as 'correction' | 'broken_link' | 'outdated', text: r.text, status: r.status as 'open' | 'resolved', resolution: r.resolution, resolvedBy: r.resolvedBy?.toHexString(), version: r.version, createdAt: r.createdAt.toDate(), updatedAt: r.updatedAt.toDate() };
    }),
  };
}
