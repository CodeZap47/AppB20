import type { Id } from './types';

/** Presentación voluntaria compartida únicamente con integrantes del grupo. */
export interface MemberProfile {
  id: Id;
  memberId: Id;
  preferredName: string;
  bio: string;
  interests: string[];
  learningGoals: string;
  skills: string[];
  helpTopics: string[];
  portfolioLinks: string[];
  subjectIds: Id[];
  photoFileId?: Id;
  version: number;
  updatedAt: Date;
}

export interface MemberProfileInput {
  preferredName: string;
  bio: string;
  interests: string[];
  learningGoals: string;
  skills: string[];
  helpTopics: string[];
  portfolioLinks: string[];
  subjectIds: Id[];
  photoFileId?: Id;
  /** Cero crea el perfil; las ediciones requieren la versión que se está viendo. */
  expectedVersion: number;
}
