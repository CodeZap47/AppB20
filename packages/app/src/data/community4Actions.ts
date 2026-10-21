import type { DbConnection } from '../module_bindings';
import type { Community4Actions } from './community4Types';
type Connection = { reducers: Pick<DbConnection['reducers'], keyof Community4Actions> };
export function createCommunity4Actions(getConnection: () => Connection): Community4Actions {
  return {
    createMuseum: (input) => getConnection().reducers.createMuseum({ ...input, subjectId: BigInt(input.subjectId), fields: JSON.stringify(input.fields) }),
    saveMuseum: (input) => getConnection().reducers.saveMuseum({ ...input, questionId: BigInt(input.questionId), fields: JSON.stringify(input.fields) }),
    createOpportunity: (input) => getConnection().reducers.createOpportunity({ ...input, fields: JSON.stringify(input.fields) }),
    updateOpportunity: (input) => getConnection().reducers.updateOpportunity({ ...input, opportunityId: BigInt(input.opportunityId), fields: JSON.stringify(input.fields) }),
    withdrawOpportunity: (input) => getConnection().reducers.withdrawOpportunity({ ...input, opportunityId: BigInt(input.opportunityId) }),
    setOpportunityInterest: (input) => getConnection().reducers.setOpportunityInterest({ ...input, opportunityId: BigInt(input.opportunityId) }),
    sendOpportunityFeedback: (input) => getConnection().reducers.sendOpportunityFeedback({ ...input, opportunityId: BigInt(input.opportunityId) }),
    resolveOpportunityFeedback: (input) => getConnection().reducers.resolveOpportunityFeedback({ ...input, feedbackId: BigInt(input.feedbackId) }),
  };
}
