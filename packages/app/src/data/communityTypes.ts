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
  /** Sin portada guardada se usa el degradado predeterminado. */
  cover?: ProfileCover;
  version: number;
  updatedAt: Date;
}

/** Degradado de `PROFILE_COVER_PRESETS` y, si la hay, la imagen vigente (archivo `profile_cover`). */
export interface ProfileCover {
  preset: string;
  fileId?: Id;
}

export interface ProfileCoverInput extends ProfileCover {
  /** Versión del perfil que se está viendo. */
  expectedVersion: number;
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
