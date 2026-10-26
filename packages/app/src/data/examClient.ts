import type { ExamEvaluationActionRequest, ExamEvaluationActionResponse, AiGeneration, AiGenerationRequest, AiPreparation, AiPrepareInput, ExamActionRequest } from '@b20/core';
import { AiClient } from './aiClient';
import type { ExamActionResponse, ExamActions } from './examTypes';
export function createExamActions(client: AiClient): ExamActions {
  return {
    examEvaluationAction: <R extends ExamEvaluationActionRequest>(request: R) => { const { action, ...body } = request; const base = '/ai/exam-evaluations'; if (action === 'list') return client.request<ExamEvaluationActionResponse<R['action']>>(`${base}?attemptId=${encodeURIComponent((request as { attemptId: string }).attemptId)}`); if (action === 'prepare') return client.request<ExamEvaluationActionResponse<R['action']>>(`${base}/prepare`, 'POST', body); const id = encodeURIComponent((request as { id: string }).id); return action === 'get' ? client.request<ExamEvaluationActionResponse<R['action']>>(`${base}/${id}`) : client.request<ExamEvaluationActionResponse<R['action']>>(`${base}/${id}/${action}`, 'POST', body); },
    examAction: <R extends ExamActionRequest>(request: R) => client.request<ExamActionResponse<R['action']>>('/ai/exams', 'POST', request),
    prepareExamMaterial: (input: AiPrepareInput) => client.request<AiPreparation>('/ai/preparations', 'POST', input),
    generateExamQuestions: (input: AiGenerationRequest) => client.request<AiGeneration>('/ai/generations', 'POST', input),
    getExamGeneration: (id: string) => client.request<AiGeneration>(`/ai/generations/${encodeURIComponent(id)}`),
  };
}
