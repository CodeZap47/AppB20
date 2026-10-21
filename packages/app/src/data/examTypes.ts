import type { AiGeneration, AiGenerationRequest, AiPreparation, AiPrepareInput, ExamActionRequest,
  ExamAttempt, ExamAttemptSummary, ExamDetail, ExamDraft, ExamGenerationSummary, ExamSummary } from '@b20/core';
export type ExamActionResponse<A extends ExamActionRequest['action']> = A extends 'listExams' ? ExamSummary[]
  : A extends 'getVersion' ? ExamDraft : A extends 'listGenerations' ? ExamGenerationSummary[]
  : A extends 'listAttempts' ? ExamAttemptSummary[] : A extends 'startAttempt' | 'getAttempt' | 'saveAnswer' | 'confirmAnswer' | 'finishAttempt' ? ExamAttempt : ExamDetail;
/** On-demand authorized reads keep questions, solutions and results out of shared subscriptions. */
export interface ExamActions {
  examAction<R extends ExamActionRequest>(request: R): Promise<ExamActionResponse<R['action']>>;
  prepareExamMaterial(input: AiPrepareInput): Promise<AiPreparation>;
  generateExamQuestions(input: AiGenerationRequest): Promise<AiGeneration>;
  getExamGeneration(id: string): Promise<AiGeneration>;
}
