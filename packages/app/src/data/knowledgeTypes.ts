import type { GuideSourceKind, GuideSourceStatus } from '@b20/core';
import type { Id, NoteSource, NoteVisibility } from './types';

/** Una versión conserva clasificación, texto, relaciones y adjuntos juntos. */
export interface NoteVersion {
  id: Id;
  noteId: Id;
  version: number;
  isFinal?: boolean;
  subjectId: Id;
  termId?: Id;
  session?: string;
  topic: string;
  title: string;
  body: string;
  tags: string[];
  visibility: NoteVisibility;
  source: NoteSource;
  authorId: Id;
  assignmentIds: Id[];
  activityIds: Id[];
  questionIds: Id[];
  attachmentIds: Id[];
  editedBy?: Id;
  editedAt: Date;
  restoredFromVersion?: number;
}

export interface GuideVersionSource {
  kind: GuideSourceKind;
  refId: Id;
  sourceVersion: number;
  status: GuideSourceStatus;
  reason: string;
  topics: string[];
  addedBy?: Id;
  addedAt?: Date;
}

export interface GuideVersion {
  id: Id;
  guideId: Id;
  version: number;
  subjectId: Id;
  termId?: Id;
  title: string;
  topics: string[];
  sections: string[];
  sources: GuideVersionSource[];
  attachmentIds: Id[];
  editedBy?: Id;
  editedAt: Date;
  restoredFromVersion?: number;
}

/** Pedir una aclaración no crea una respuesta ni resuelve la pregunta. */
export interface QuestionComment {
  id: Id;
  questionId: Id;
  answerId?: Id;
  authorId: Id;
  text: string;
  createdAt: Date;
}

/** Un integrante puede dar una única señal de utilidad por respuesta. */
export interface AnswerUsefulness {
  answerId: Id;
  memberId: Id;
  createdAt: Date;
}

export interface QuestionLink {
  id: Id;
  questionId: Id;
  targetKind: 'note' | 'guide';
  targetId: Id;
  addedBy: Id;
  createdAt: Date;
}
