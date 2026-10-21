import type { DbConnection } from '../module_bindings';
import type { AgentActions } from './agentTypes';
type Connection = { reducers: Pick<DbConnection['reducers'], keyof AgentActions> };
export function createAgentActions(getConnection: () => Connection): AgentActions {
  return {
    enableAgent: (input) => getConnection().reducers.enableAgent(input),
    disableAgent: () => getConnection().reducers.disableAgent({}),
    trainAgent: (input) => getConnection().reducers.trainAgent({ ...input, sources: JSON.stringify(input.sources) }),
    startAgentSession: (input) => getConnection().reducers.startAgentSession({ ...input, assignmentId: BigInt(input.assignmentId) }),
    saveAgentDraft: (input) => getConnection().reducers.saveAgentDraft({ ...input, sessionId: BigInt(input.sessionId) }),
    deleteAgentSession: (input) => getConnection().reducers.deleteAgentSession({ sessionId: BigInt(input.sessionId) }),
    proposeAgentSuggestions: (input) => getConnection().reducers.proposeAgentSuggestions({ ...input, sessionId: BigInt(input.sessionId), suggestions: JSON.stringify(input.suggestions) }),
    resolveAgentSuggestion: (input) => getConnection().reducers.resolveAgentSuggestion({ ...input, suggestionId: BigInt(input.suggestionId) }),
    checkAgentOriginality: (input) => getConnection().reducers.checkAgentOriginality({ ...input, sessionId: BigInt(input.sessionId) }),
    acknowledgeAgentMatch: (input) => getConnection().reducers.acknowledgeAgentMatch({ ...input, checkId: BigInt(input.checkId) }),
  };
}
