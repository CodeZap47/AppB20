import { isProfileCoverPreset } from '@b20/core';
import type { MemberProfile, MemberProfileInput, ProfileCoverInput } from './communityTypes';
import type { Id, ResourceFile, Subject } from './types';
import { cleanMemberProfile } from '../lib/profiles';

/** Reglas del perfil compartidas por la demo; el módulo aplica los mismos permisos. */
export function saveDemoMemberProfile(
  input: MemberProfileInput,
  context: { memberId: Id; profiles: MemberProfile[]; subjects: Subject[]; resourceFiles: ResourceFile[]; createId: () => Id; now: Date },
): MemberProfile {
  const current = context.profiles.find((profile) => profile.memberId === context.memberId);
  if ((current?.version ?? 0) !== input.expectedVersion) throw new Error('El perfil cambió. Actualiza la página antes de guardar.');
  const cleaned = cleanMemberProfile(input);
  if (cleaned.subjectIds.some((id) => !context.subjects.some((subject) => subject.id === id))) throw new Error('Una de las materias no existe.');
  if (cleaned.photoFileId && !context.resourceFiles.some((file) => file.id === cleaned.photoFileId && file.targetKind === 'profile' && file.targetId === current?.id && !file.removedAt)) throw new Error('La foto no pertenece a este perfil.');
  const { expectedVersion: _version, ...fields } = cleaned;
  return { ...fields, cover: current?.cover, id: current?.id ?? context.createId(), memberId: context.memberId, version: (current?.version ?? 0) + 1, updatedAt: context.now };
}

/** Portada del perfil propio en la demo, con las mismas validaciones que `save_profile_cover`. */
export function saveDemoProfileCover(
  input: ProfileCoverInput,
  context: { memberId: Id; profiles: MemberProfile[]; resourceFiles: ResourceFile[]; now: Date },
): MemberProfile {
  const current = context.profiles.find((profile) => profile.memberId === context.memberId);
  if (!current) throw new Error('Guarda tu presentación antes de elegir una portada.');
  if (current.version !== input.expectedVersion) throw new Error('El perfil cambió. Actualiza la página antes de guardar.');
  if (!isProfileCoverPreset(input.preset)) throw new Error('Elige una de las portadas disponibles.');
  if (input.fileId && !context.resourceFiles.some((file) => file.id === input.fileId && file.targetKind === 'profile_cover' && file.targetId === current.id && !file.removedAt)) throw new Error('La portada no pertenece a este perfil.');
  return { ...current, cover: { preset: input.preset, fileId: input.fileId }, version: current.version + 1, updatedAt: context.now };
}
