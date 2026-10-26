import type { ExamEvaluationActionRequest, ExamEvaluationActionResponse, AiGeneration, AiGenerationRequest, AiPreparation, AiPrepareInput, ExamActionRequest,
  ExamBankSummary, ExamBankDetail, ExamVariantPreview, ExamAttempt, ExamAttemptSummary, ExamDetail, ExamDraft, ExamGenerationSummary, ExamSummary } from '@b20/core';
export type ExamActionResponse<A extends ExamActionRequest['action']> = A extends 'sendToSpaced' ? {collectionId:string;cardId:string;created:boolean} : A extends 'listBank' ? ExamBankSummary[] : A extends 'getBankQuestion' | 'saveToBank' | 'setBankVisibility' ? ExamBankDetail : A extends 'previewVariant' ? ExamVariantPreview : A extends 'listExams' ? ExamSummary[]
  : A extends 'getVersion' ? ExamDraft : A extends 'listGenerations' ? ExamGenerationSummary[]
  : A extends 'listAttempts' ? ExamAttemptSummary[] : A extends 'startAttempt' | 'getAttempt' | 'saveAnswer' | 'confirmAnswer' | 'finishAttempt' | 'evaluateOpenAnswer' ? ExamAttempt : ExamDetail;
/** On-demand authorized reads keep questions, solutions and results out of shared subscriptions. */
export interface ExamActions {
  examEvaluationAction<R extends ExamEvaluationActionRequest>(request: R): Promise<ExamEvaluationActionResponse<R['action']>>;
  examAction<R extends ExamActionRequest>(request: R): Promise<ExamActionResponse<R['action']>>;
  prepareExamMaterial(input: AiPrepareInput): Promise<AiPreparation>;
  generateExamQuestions(input: AiGenerationRequest): Promise<AiGeneration>;
  getExamGeneration(id: string): Promise<AiGeneration>;
}
