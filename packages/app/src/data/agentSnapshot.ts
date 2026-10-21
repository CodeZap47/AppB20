import { cleanAgentStage, type AgentSourceKind } from '@b20/core';
import type { DbConnection } from '../module_bindings';
import type { Snapshot } from './types';
import { emptyAgent, type AgentOriginalityMatch, type AgentSnapshot, type AgentSuggestionRow } from './agentTypes';

export const AGENT_VIEWS = ['my_agent_profile', 'my_agent_sources', 'my_agent_style_snapshots', 'my_agent_sessions', 'my_agent_suggestions', 'my_agent_originality_checks'] as const;
type View = 'myAgentProfile' | 'myAgentSources' | 'myAgentStyleSnapshots' | 'myAgentSessions' | 'myAgentSuggestions' | 'myAgentOriginalityChecks';
type Connection = { db: { [K in View]: Pick<DbConnection['db'][K], 'iter'> } };
const kind = (value: string) => { if (!['work', 'evidence', 'note'].includes(value)) throw new Error('Actualiza la aplicación para consultar tu agente.'); return value as AgentSourceKind; };

export function readAgentSnapshot(c: Connection, base: Snapshot, identity: string): AgentSnapshot {
  if (base.me?.id !== identity || base.me.status !== 'active') return emptyAgent();
  const mine = <T extends { owner: { toHexString(): string } }>(rows: Iterable<T> | undefined) => [...(rows ?? [])].filter((r) => r.owner.toHexString() === identity);
  const profile = mine(c.db.myAgentProfile?.iter())[0];
  return {
    agentProfile: profile && { premisesVersion: profile.premisesVersion, consentAt: profile.consentAt.toDate(), styleVersion: profile.styleVersion, version: profile.version },
    agentSources: mine(c.db.myAgentSources?.iter()).map((r) => ({ kind: kind(r.kind), refId: r.refId.toString(), refVersion: r.refVersion })),
    agentStyleSnapshots: mine(c.db.myAgentStyleSnapshots?.iter()).map((r) => ({ id: r.id.toString(), version: r.version, features: JSON.parse(r.features), examples: JSON.parse(r.examples),
      sources: (JSON.parse(r.sources) as { kind: string; refId: string; refVersion: number }[]).map((s) => ({ ...s, kind: kind(s.kind) })), createdAt: r.createdAt.toDate() })).sort((a, b) => a.version - b.version),
    agentSessions: mine(c.db.myAgentSessions?.iter()).map((r) => ({ id: r.id.toString(), assignmentId: r.assignmentId.toString(), requestId: r.requestId, stage: cleanAgentStage(r.stage),
      draft: r.draft, draftVersion: r.draftVersion, createdAt: r.createdAt.toDate(), updatedAt: r.updatedAt.toDate() })),
    agentSuggestions: mine(c.db.myAgentSuggestions?.iter()).map((r) => ({ id: r.id.toString(), sessionId: r.sessionId.toString(), draftVersion: r.draftVersion, reason: r.reason,
      original: r.original, replacement: r.replacement, state: r.state as AgentSuggestionRow['state'], createdAt: r.createdAt.toDate() })),
    agentOriginalityChecks: mine(c.db.myAgentOriginalityChecks?.iter()).map((r) => ({ id: r.id.toString(), sessionId: r.sessionId.toString(), draftVersion: r.draftVersion,
      matches: JSON.parse(r.matches) as AgentOriginalityMatch[], acknowledged: [...r.acknowledged], createdAt: r.createdAt.toDate() })),
  };
}
