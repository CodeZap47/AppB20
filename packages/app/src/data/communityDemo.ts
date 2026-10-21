import type { MemberProfile, MemberProfileInput } from './communityTypes';
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
  return { ...fields, id: current?.id ?? context.createId(), memberId: context.memberId, version: (current?.version ?? 0) + 1, updatedAt: context.now };
}
