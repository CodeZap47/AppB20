import { AiError, aiRecord, aiHash, aiTopicDistribution, type AiGenerationConfig, type AiGenerationState, type AiPreparation } from './ai';
import type { AiQuestion, ExamRubric } from './exam';

export type ExamVisibility = 'personal' | 'group';
export type ExamMode = 'practice' | 'simulation';
/** Sources with the same record can carry different reviewed selections or snapshots. */
export function examPreparedSourceKey(source: AiPreparation['sources'][number]): string {
  return `${source.kind}:${source.refId}:${aiHash({ version: source.version, fingerprint: source.fingerprint,
    answerIds: source.answerIds ?? [], transcriptionIds: source.transcriptionIds ?? [], segmentIds: source.segmentIds ?? [] })}`;
}

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
export interface ExamSolution { correctOptionId: string; explanation: string; citations: ExamCitation[]; referenceAnswer?: string; rubric?: ExamRubric }
export interface ExamAttemptQuestion { id: string; type: AiQuestion['type']; text: string; topic: string; options: { id: string; text: string }[]; unavailable?: boolean; solution?: ExamSolution }
export interface ExamAttemptAnswer { questionId: string; optionId?: string; text?: string; confirmed: boolean; correct?: boolean; evaluation?: ExamOpenEvaluation }
export interface ExamScore { correct: number; total: number; percentage: number; topics: { topic: string; correct: number; total: number }[] }
export interface ExamAttemptSummary {
  id: string; examId: string; examVersion: number; title: string; mode: ExamMode; state: 'active' | 'closed'; revision: number;
  startedAt: number; deadlineAt?: number; closedAt?: number; closeReason?: 'submitted' | 'timeout'; result?: ExamScore; openResult?: ExamOpenScore;
}
export interface ExamAttempt extends ExamAttemptSummary {
  questions: ExamAttemptQuestion[]; answers: ExamAttemptAnswer[]; sourceIssues: ExamSourceIssue[]; contentUnavailable: boolean;
}
export interface ExamGenerationSummary { id: string; state: AiGenerationState; preparationId: string; createdAt: number; error?: string; importedExamId?: string }

export interface ExamOpenEvaluation { rubricVersion: number; criteria: { criterionId: string; points: number; feedback: string }[]; feedback: string; evaluatedAt: number; origin: 'manual' | 'assisted' }
export interface ExamOpenScore { evaluated: number; pending: number; points: number; maxPoints: number; percentage?: number }
export interface ExamBankSummary { id: string; version: number; ownerId: string; visibility: ExamVisibility; subjectId: string; termId?: string; topic: string; type: AiQuestion['type']; difficulty: AiGenerationConfig['difficulty']; text: string; updatedAt: number; canEdit: boolean; sourceIssues: ExamSourceIssue[] }
export interface ExamBankDetail extends ExamBankSummary { question?: ExamEditableQuestion; preparation?: AiPreparation }
export interface ExamVariantPlan { subjectId: string; termId?: string; topics: string[]; questionCount: number; types: AiQuestion['type'][]; difficulty: AiGenerationConfig['difficulty']; topicWeights?: { topic: string; weight: number }[]; seed: string; bankIds?: string[] }
export interface ExamVariantPreview { selected: ExamBankSummary[]; deficits: { topic: string; requested: number; available: number }[] }
export const EXAM_ACTIONS = ['sendToSpaced', 'listBank', 'getBankQuestion', 'saveToBank', 'setBankVisibility', 'previewVariant', 'createVariant', 'evaluateOpenAnswer', 'listExams', 'getExam', 'getVersion', 'listGenerations', 'importGeneration', 'saveDraft', 'replaceQuestions', 'forkVersion', 'approveVersion', 'setVisibility', 'setArchived', 'startAttempt', 'listAttempts', 'getAttempt', 'saveAnswer', 'confirmAnswer', 'finishAttempt'] as const;
export type ExamAction = typeof EXAM_ACTIONS[number];
export type ExamActionRequest =
  | { action: 'sendToSpaced'; attemptId: string; questionId: string; requestId: string; question: string; explanation: string; hint?: string }
  | { action: 'listBank'; subjectId?: string; termId?: string }
  | { action: 'getBankQuestion'; bankId: string; version?: number }
  | { action: 'saveToBank'; examId: string; version: number; questionId: string; requestId: string; bankId?: string; expectedVersion?: number }
  | { action: 'setBankVisibility'; bankId: string; expectedVersion: number; visibility: ExamVisibility }
  | { action: 'previewVariant'; plan: ExamVariantPlan }
  | { action: 'createVariant'; plan: ExamVariantPlan; title: string; requestId: string; timeLimitSeconds?: number }
  | { action: 'evaluateOpenAnswer'; attemptId: string; expectedRevision: number; requestId: string; questionId: string; criteria: ExamOpenEvaluation['criteria']; feedback: string; suggestionId?: string }
  | { action: 'listExams'; includeArchived?: boolean; sharedOnly?: boolean }
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
  | { action: 'saveAnswer' | 'confirmAnswer'; attemptId: string; expectedRevision: number; requestId: string; questionId: string; optionId?: string; text?: string }
  | { action: 'finishAttempt'; attemptId: string; expectedRevision: number; requestId: string };

/** Largest remainders; ties preserve the explicitly selected topic order. */
export function examTopicDistribution(topics: readonly string[], count: number, weights?: readonly { topic: string; weight: number }[]) {
  return aiTopicDistribution(topics, count, weights);
}
export function scoreExam(questions: readonly AiQuestion[], answers: Readonly<Record<string, string | undefined>>): ExamScore {
  const topics: ExamScore['topics'] = [];
  for (const question of questions.filter((question) => question.type !== 'open')) {
    let topic = topics.find((item) => item.topic === question.topic); if (!topic) { topic = { topic: question.topic, correct: 0, total: 0 }; topics.push(topic); }
    topic.total++; if (answers[question.id] === question.correctOptionId) topic.correct++;
  }
  const correct = topics.reduce((sum, topic) => sum + topic.correct, 0); const total = questions.filter((question) => question.type !== 'open').length;
  return { correct, total, percentage: total ? Math.round(correct * 10000 / total) / 100 : 0, topics };
}
/** Deterministic per attempt; question and option identities never change when shuffled. */
export function examAttemptOrder(questions: readonly AiQuestion[], seed: string): { questionId: string; optionIds: string[] }[] {
  return [...questions].sort((a, b) => aiHash([seed, a.id]).localeCompare(aiHash([seed, b.id])))
    .map((question) => ({ questionId: question.id, optionIds: [...question.options].sort((a, b) => aiHash([seed, question.id, a.id]).localeCompare(aiHash([seed, question.id, b.id]))).map((option) => option.id) }));
}

/** A seed fixes membership and order; duplicate bank identities can never satisfy two slots. */
export function selectExamVariant(candidates: readonly ExamBankSummary[], plan: ExamVariantPlan): ExamVariantPreview {
  if (!plan.seed.trim() || plan.seed.length > 200 || !plan.types.length || plan.types.some((type) => !['single', 'boolean', 'open'].includes(type))) throw new Error('Selecciona semilla y tipos válidos.');
  const eligible = [...new Map(candidates.filter((row) => row.subjectId === plan.subjectId && (!plan.termId || row.termId === plan.termId) && row.difficulty === plan.difficulty && plan.types.includes(row.type) && (!plan.bankIds || plan.bankIds.includes(row.id)) && !row.sourceIssues.some((issue) => issue.state === 'unavailable')).map((row) => [row.id, row])).values()];
  const selected: ExamBankSummary[] = []; const deficits: ExamVariantPreview['deficits'] = [];
  for (const slot of examTopicDistribution(plan.topics, plan.questionCount, plan.topicWeights)) {
    const seen = new Set<string>(); const available = eligible.filter((row) => row.topic === slot.topic).sort((a, b) => aiHash([plan.seed, a.id, a.version]).localeCompare(aiHash([plan.seed, b.id, b.version]))).filter((row) => { const content = aiHash([row.type, row.topic, row.text.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('es')]); if (seen.has(content)) return false; seen.add(content); return true; });
    selected.push(...available.slice(0, slot.count)); if (available.length < slot.count) deficits.push({ topic: slot.topic, requested: slot.count, available: available.length });
  } return { selected, deficits };
}
export function scoreOpenExam(questions: readonly AiQuestion[], answers: readonly ExamAttemptAnswer[]): ExamOpenScore {
  const open = questions.filter((question) => question.type === 'open'); let evaluated = 0; let points = 0; let maxPoints = 0;
  for (const question of open) { const answer = answers.find((answer) => answer.questionId === question.id); if (!answer?.evaluation) continue; evaluated++; points += answer.evaluation.criteria.reduce((sum, criterion) => sum + criterion.points, 0); maxPoints += question.rubric?.criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0) ?? 0; }
  return { evaluated, pending: open.length - evaluated, points, maxPoints, ...(maxPoints ? { percentage: Math.round(points * 10000 / maxPoints) / 100 } : {}) };
}
export function validateOpenEvaluation(question: AiQuestion, criteria: ExamOpenEvaluation['criteria'], feedback: string): void {
  const rubric = question.rubric; if (question.type !== 'open' || !rubric || !Array.isArray(criteria) || criteria.length !== rubric.criteria.length || new Set(criteria.map((entry) => entry.criterionId)).size !== criteria.length || typeof feedback !== 'string' || feedback.length > 4000 || criteria.some((entry) => { if (!aiRecord(entry)) return true; const criterion = rubric.criteria.find((row) => row.id === entry.criterionId); return !criterion || !Number.isFinite(entry.points) || entry.points < 0 || entry.points > criterion.maxPoints || typeof entry.feedback !== 'string' || entry.feedback.length > 2000; })) throw new AiError('invalid', 'Evalúa cada criterio dentro del máximo de su rúbrica.');
}
