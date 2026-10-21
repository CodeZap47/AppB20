import type { AgentSourceKind, AgentSourceRef, AgentStage, AgentSuggestionInput, OriginalityLevel, SimilarityPair, SimilarityResult, StyleDescription, StyleFeatures } from '@b20/core';
import type { Id, MaybePromise } from './types';

/** Agente personal (7.13, AG-3): todo es privado de quien consulta. */
export interface AgentProfileRow { premisesVersion: number; consentAt: Date; styleVersion: number; version: number }
export interface AgentStyleSourceRow { kind: AgentSourceKind; refId: Id; refVersion: number }
export interface AgentStyleSnapshotRow { id: Id; version: number; features: StyleFeatures & StyleDescription; examples: string[]; sources: AgentStyleSourceRow[]; createdAt: Date }
export interface AgentSessionRow { id: Id; assignmentId: Id; requestId: string; stage: AgentStage; draft: string; draftVersion: number; createdAt: Date; updatedAt: Date }
export interface AgentSuggestionRow { id: Id; sessionId: Id; draftVersion: number; reason: string; original: string; replacement: string; state: 'proposed' | 'accepted' | 'rejected'; createdAt: Date }
export interface AgentOriginalityMatch { refKey: string; title: string; authorName: string; status: SimilarityResult['status']; score: number | null; level: OriginalityLevel; pairs: SimilarityPair[]; excluded: SimilarityResult['excluded'] }
export interface AgentOriginalityCheckRow { id: Id; sessionId: Id; draftVersion: number; matches: AgentOriginalityMatch[]; acknowledged: string[]; createdAt: Date }

export interface AgentSnapshot {
  agentProfile: AgentProfileRow | undefined;
  agentSources: AgentStyleSourceRow[];
  agentStyleSnapshots: AgentStyleSnapshotRow[];
  agentSessions: AgentSessionRow[];
  agentSuggestions: AgentSuggestionRow[];
  agentOriginalityChecks: AgentOriginalityCheckRow[];
}
export interface AgentActions {
  enableAgent(input: { premisesVersion: number }): MaybePromise<void>;
  disableAgent(): MaybePromise<void>;
  trainAgent(input: { sources: AgentSourceRef[]; expectedStyleVersion: number }): MaybePromise<void>;
  startAgentSession(input: { assignmentId: Id; requestId: string }): MaybePromise<void>;
  saveAgentDraft(input: { sessionId: Id; expectedDraftVersion: number; stage: AgentStage; draft: string }): MaybePromise<void>;
  deleteAgentSession(input: { sessionId: Id }): MaybePromise<void>;
  proposeAgentSuggestions(input: { sessionId: Id; draftVersion: number; suggestions: AgentSuggestionInput[] }): MaybePromise<void>;
  resolveAgentSuggestion(input: { suggestionId: Id; accept: boolean }): MaybePromise<void>;
  checkAgentOriginality(input: { sessionId: Id; draftVersion: number }): MaybePromise<void>;
  acknowledgeAgentMatch(input: { checkId: Id; refKey: string }): MaybePromise<void>;
}
export function emptyAgent(): AgentSnapshot { return { agentProfile: undefined, agentSources: [], agentStyleSnapshots: [], agentSessions: [], agentSuggestions: [], agentOriginalityChecks: [] }; }
