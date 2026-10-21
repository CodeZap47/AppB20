import { aiHash, aiTopicDistribution, type AiGenerationConfig, type AiGenerationState, type AiPreparation } from './ai';
import type { AiQuestion } from './exam';

export type ExamVisibility = 'personal' | 'group';
export type ExamMode = 'practice' | 'simulation';
export interface ExamSourceIssue { kind: string; refId: string; state: 'outdated' | 'unavailable'; message: string }
export interface ExamEditableQuestion extends AiQuestion { issue?: string }
export interface ExamVersionSummary {
  version: number; state: 'draft' | 'ready'; questionCount: number; model: string; createdAt: number; approvedAt?: number;
  hasPersonalSources: boolean; sourceIssues: ExamSourceIssue[];
}
export interface ExamSummary {
  id: string; revision: number; title: string; subjectId: string; termId?: string; ownerId: string; visibility: ExamVisibility;
  archived: boolean; readyVersion?: number; draftVersion?: number; questionCount: number; topics: string[];
  createdAt: number; updatedAt: number; canEdit: boolean; sourceIssues: ExamSourceIssue[];
}
export interface ExamDraft extends ExamVersionSummary {
  examId: string; title: string; config: AiGenerationConfig; timeLimitSeconds?: number; preparation: AiPreparation;
  questions: ExamEditableQuestion[];
}
export interface ExamDetail extends ExamSummary { versions: ExamVersionSummary[]; draft?: ExamDraft }
export interface ExamCitation { id: string; text: string; origins: AiPreparation['fragments'][number]['origins'] }
export interface ExamSolution { correctOptionId: string; explanation: string; citations: ExamCitation[] }
export interface ExamAttemptQuestion { id: string; type: 'single' | 'boolean'; text: string; topic: string; options: { id: string; text: string }[]; unavailable?: boolean; solution?: ExamSolution }
export interface ExamAttemptAnswer { questionId: string; optionId?: string; confirmed: boolean; correct?: boolean }
export interface ExamScore { correct: number; total: number; percentage: number; topics: { topic: string; correct: number; total: number }[] }
export interface ExamAttemptSummary {
  id: string; examId: string; examVersion: number; title: string; mode: ExamMode; state: 'active' | 'closed'; revision: number;
  startedAt: number; deadlineAt?: number; closedAt?: number; closeReason?: 'submitted' | 'timeout'; result?: ExamScore;
}
export interface ExamAttempt extends ExamAttemptSummary {
  questions: ExamAttemptQuestion[]; answers: ExamAttemptAnswer[]; sourceIssues: ExamSourceIssue[]; contentUnavailable: boolean;
}
export interface ExamGenerationSummary { id: string; state: AiGenerationState; preparationId: string; createdAt: number; error?: string; importedExamId?: string }

export const EXAM_ACTIONS = ['listExams', 'getExam', 'getVersion', 'listGenerations', 'importGeneration', 'saveDraft', 'replaceQuestions', 'forkVersion', 'approveVersion', 'setVisibility', 'setArchived', 'startAttempt', 'listAttempts', 'getAttempt', 'saveAnswer', 'confirmAnswer', 'finishAttempt'] as const;
export type ExamAction = typeof EXAM_ACTIONS[number];
export type ExamActionRequest =
  | { action: 'listExams'; includeArchived?: boolean }
  | { action: 'getExam'; examId: string }
  | { action: 'getVersion'; examId: string; version: number }
  | { action: 'listGenerations' }
  | { action: 'importGeneration'; requestId: string; generationId: string; title: string; timeLimitSeconds?: number }
  | { action: 'saveDraft'; examId: string; expectedRevision: number; version: number; title: string; config: AiGenerationConfig; timeLimitSeconds?: number; questions: ExamEditableQuestion[] }
  | { action: 'replaceQuestions'; examId: string; expectedRevision: number; version: number; requestId: string; generationId: string; questionIds: string[] }
  | { action: 'forkVersion'; examId: string; expectedRevision: number; version: number; requestId: string }
  | { action: 'approveVersion'; examId: string; expectedRevision: number; version: number; reviewedQuestionIds: string[] }
  | { action: 'setVisibility'; examId: string; expectedRevision: number; visibility: ExamVisibility }
  | { action: 'setArchived'; examId: string; expectedRevision: number; archived: boolean }
  | { action: 'startAttempt'; examId: string; version: number; mode: ExamMode; requestId: string }
  | { action: 'listAttempts'; examId?: string }
  | { action: 'getAttempt'; attemptId: string }
  | { action: 'saveAnswer' | 'confirmAnswer'; attemptId: string; expectedRevision: number; requestId: string; questionId: string; optionId: string }
  | { action: 'finishAttempt'; attemptId: string; expectedRevision: number; requestId: string };

/** Largest remainders; ties preserve the explicitly selected topic order. */
export function examTopicDistribution(topics: readonly string[], count: number, weights?: readonly { topic: string; weight: number }[]) {
  return aiTopicDistribution(topics, count, weights);
}
export function scoreExam(questions: readonly AiQuestion[], answers: Readonly<Record<string, string | undefined>>): ExamScore {
  const topics: ExamScore['topics'] = [];
  for (const question of questions) {
    let topic = topics.find((item) => item.topic === question.topic); if (!topic) { topic = { topic: question.topic, correct: 0, total: 0 }; topics.push(topic); }
    topic.total++; if (answers[question.id] === question.correctOptionId) topic.correct++;
  }
  const correct = topics.reduce((sum, topic) => sum + topic.correct, 0); const total = questions.length;
  return { correct, total, percentage: total ? Math.round(correct * 10000 / total) / 100 : 0, topics };
}
/** Deterministic per attempt; question and option identities never change when shuffled. */
export function examAttemptOrder(questions: readonly AiQuestion[], seed: string): { questionId: string; optionIds: string[] }[] {
  return [...questions].sort((a, b) => aiHash([seed, a.id]).localeCompare(aiHash([seed, b.id])))
    .map((question) => ({ questionId: question.id, optionIds: [...question.options].sort((a, b) => aiHash([seed, question.id, a.id]).localeCompare(aiHash([seed, question.id, b.id]))).map((option) => option.id) }));
}
