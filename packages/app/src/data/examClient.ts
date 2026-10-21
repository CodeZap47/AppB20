import type { AiGeneration, AiGenerationRequest, AiPreparation, AiPrepareInput, ExamActionRequest } from '@b20/core';
import { AiClient } from './aiClient';
import type { ExamActionResponse, ExamActions } from './examTypes';
export function createExamActions(client: AiClient): ExamActions {
  return {
    examAction: <R extends ExamActionRequest>(request: R) => client.request<ExamActionResponse<R['action']>>('/ai/exams', 'POST', request),
    prepareExamMaterial: (input: AiPrepareInput) => client.request<AiPreparation>('/ai/preparations', 'POST', input),
    generateExamQuestions: (input: AiGenerationRequest) => client.request<AiGeneration>('/ai/generations', 'POST', input),
    getExamGeneration: (id: string) => client.request<AiGeneration>(`/ai/generations/${encodeURIComponent(id)}`),
  };
}
