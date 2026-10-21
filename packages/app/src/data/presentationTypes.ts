import type { PresentationConfiguration, PresentationObservations, PresentationQuestionKind, PresentationSourceKind, PresentationStatus } from '@b20/core';
import type { Id, MaybePromise } from './types';

export interface PresentationPractice extends PresentationConfiguration {
  id: Id; ownerId: Id; subjectId: Id; termId?: Id; reviewerId?: Id;
  sourceKind?: PresentationSourceKind; sourceId?: Id; sourceVersion?: number;
  archived: boolean; version: number; createdAt: Date; updatedAt: Date;
}
/** Cada intento conserva la configuración y referencia que tenía al crearse. */
export interface PresentationAttempt extends PresentationConfiguration {
  id: Id; practiceId: Id; subjectId: Id; termId?: Id; number: number; status: PresentationStatus; body: string;
  sourceKind?: PresentationSourceKind; sourceId?: Id; sourceVersion?: number;
  version: number; createdAt: Date; updatedAt: Date; completedAt?: Date;
}
/** Solo el autor; el revisor y los administradores nunca reciben estos campos. */
export interface PresentationPersonal extends PresentationObservations { attemptId: Id; nextSteps: string; }
export interface PresentationQuestion {
  id: Id; attemptId: Id; authorId: Id; kind: PresentationQuestionKind;
  text: string; answer: string; version: number; createdAt: Date; answeredAt?: Date;
}
export interface PresentationFeedback extends PresentationObservations {
  id: Id; attemptId: Id; authorId: Id; comment: string; version: number; createdAt: Date; updatedAt: Date;
}
export interface PresentationPracticeInput extends PresentationConfiguration {
  id?: Id; subjectId: Id; termId?: Id;
  source?: { kind: PresentationSourceKind; id: Id };
  expectedVersion?: number; requestId: string;
}
export interface PresentationAttemptInput extends PresentationObservations { body: string; nextSteps: string; }
export interface PresentationFeedbackInput extends PresentationObservations { comment: string; }
export interface PresentationsSnapshot {
  presentationPractices: PresentationPractice[]; presentationAttempts: PresentationAttempt[];
  presentationPersonal: PresentationPersonal[]; presentationQuestions: PresentationQuestion[];
  presentationFeedback: PresentationFeedback[];
}
export interface PresentationActions {
  savePresentationPractice(input: PresentationPracticeInput): MaybePromise<Id>;
  setPresentationReviewer(practiceId: Id, reviewerId: Id | undefined, expectedVersion: number): MaybePromise<void>;
  archivePresentationPractice(practiceId: Id, archived: boolean, expectedVersion: number): MaybePromise<void>;
  createPresentationAttempt(practiceId: Id, requestId: string, expectedVersion: number): MaybePromise<Id>;
  savePresentationAttempt(attemptId: Id, input: PresentationAttemptInput, expectedVersion: number): MaybePromise<void>;
  completePresentationAttempt(attemptId: Id, expectedVersion: number): MaybePromise<void>;
  askPresentationQuestion(attemptId: Id, text: string, requestId: string): MaybePromise<Id>;
  answerPresentationQuestion(questionId: Id, answer: string, expectedVersion: number): MaybePromise<void>;
  savePresentationFeedback(attemptId: Id, input: PresentationFeedbackInput, expectedVersion?: number): MaybePromise<void>;
}
