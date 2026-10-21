import { SenderError } from 'spacetimedb/server';
import { activeMember, bumpMaterial, expectVersion, log, requireSubject, saveTargetBaseline, targetVersion, type Ctx } from './moduleContext';
import { canReadTarget, contentOwner } from './delivery2Handlers';

interface ProfileInput {
  preferredName: string; bio: string; interests: string[]; learningGoals: string;
  skills: string[]; helpTopics: string[]; portfolioLinks: string[]; subjectIds: bigint[];
  photoFileId?: string; expectedVersion: number;
}

function optionalText(value: string, field: string, max: number) {
  const cleaned = value.trim();
  if (cleaned.length > max) throw new SenderError(`${field} excede ${max} caracteres.`);
  return cleaned;
}

export function saveMemberProfile(ctx: Ctx, input: ProfileInput) {
  activeMember(ctx);
  const current = ctx.db.memberProfile.memberId.find(ctx.sender);
  expectVersion(current?.version ?? 0, input.expectedVersion);
  const list = (values: string[], label: string) => {
    const cleaned = [...new Set(values.map((value) => optionalText(value, label, 100)).filter(Boolean))];
    if (cleaned.length > 20) throw new SenderError(`${label}: máximo 20 elementos.`);
    return cleaned;
  };
  const subjectIds = [...new Set(input.subjectIds)];
  if (subjectIds.length > 100) throw new SenderError('Demasiadas materias en el perfil.');
  subjectIds.forEach((id) => requireSubject(ctx, id));
  if (input.portfolioLinks.length > 10) throw new SenderError('El máximo es de 10 enlaces de portafolio.');
  const portfolioLinks = [...new Set(input.portfolioLinks.map((value) => {
    const cleaned = optionalText(value, 'El enlace', 2048);
    // El runtime de módulos no incorpora el objeto URL del navegador. Aceptamos la
    // representación ASCII ya normalizada por el cliente y comprobamos el origen aquí.
    const match = /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[a-f0-9:.]+\])(?::([0-9]{1,5}))?(?:[/?#][^\s<>"\\]*)?$/i.exec(cleaned);
    if (!match || /[\u0000-\u0020\u007f]/.test(cleaned) || (match[2] && Number(match[2]) > 65535)) {
      throw new SenderError('Usa enlaces HTTPS completos y sin credenciales en el portafolio.');
    }
    return cleaned;
  }))];
  if (input.photoFileId !== undefined) {
    const file = ctx.db.resourceFile.id.find(input.photoFileId);
    const upload = ctx.db.resourceUpload.id.find(input.photoFileId);
    if (!current || !file || file.targetKind !== 'profile' || file.targetId !== current.id || file.removedAt !== undefined
      || !file.uploadedBy.isEqual(ctx.sender) || !upload || upload.state !== 'ready'
      || file.size === 0n || file.size > 5n * 1024n * 1024n
      || !['image/png', 'image/jpeg', 'image/webp'].includes(file.contentType)) {
      throw new SenderError('La foto debe ser una imagen privada activa de este perfil.');
    }
  }
  const row = {
    id: current?.id ?? 0n, memberId: ctx.sender,
    preferredName: optionalText(input.preferredName, 'El nombre preferido', 80),
    bio: optionalText(input.bio, 'La presentación', 1000),
    interests: list(input.interests, 'Intereses'), learningGoals: optionalText(input.learningGoals, 'Los objetivos de aprendizaje', 1000),
    skills: list(input.skills, 'Los conocimientos'), helpTopics: list(input.helpTopics, 'Los temas de ayuda'),
    portfolioLinks, subjectIds, photoFileId: input.photoFileId, version: (current?.version ?? 0) + 1, updatedAt: ctx.timestamp,
  };
  if (current) {
    ctx.db.memberProfile.id.update(row);
    log(ctx, 'update', 'member_profile', current.id);
  } else {
    const result = ctx.db.memberProfile.insert(row);
    log(ctx, 'update', 'member_profile', result.id);
  }
}

const WITHDRAWABLE = ['note', 'question', 'answer', 'guide', 'work', 'evidence'];
export function withdrawContent(ctx: Ctx, input: { kind: string; targetId: bigint; withdrawn: boolean; expectedVersion: number; reason: string }) {
  const member = activeMember(ctx);
  if (!WITHDRAWABLE.includes(input.kind)) throw new SenderError('Este tipo de contenido no se puede retirar.');
  const owner = contentOwner(ctx.db, input.kind, input.targetId);
  if (!owner) throw new SenderError('El contenido no está disponible.');
  const authors = input.kind === 'work'
    ? [...ctx.db.workAuthor.workId.filter(input.targetId)].map((row) => row.author)
    : [owner];
  const own = authors.some((author) => author.isEqual(ctx.sender));
  if (!own && !canReadTarget(ctx.db, ctx.sender, input.kind, input.targetId)) throw new SenderError('El contenido no está disponible.');
  if (!own && !member.isCreator) throw new SenderError('Solo su autor o un administrador pueden retirar este contenido.');
  // La membresía de administración no concede acceso a apuntes personales ajenos.
  if (input.kind === 'note' && ctx.db.note.id.find(input.targetId)?.visibility === 'personal' && !own) {
    throw new SenderError('Solo su autor puede retirar o restaurar un apunte personal.');
  }
  expectVersion(targetVersion(ctx, input.kind, input.targetId), input.expectedVersion);
  const key = `${input.kind}:${input.targetId}`;
  const previous = ctx.db.contentStatus.key.find(key);
  const wasWithdrawn = previous?.withdrawnAt !== undefined;
  if (wasWithdrawn === input.withdrawn) return;
  const reason = optionalText(input.reason, 'El motivo', 1000);
  if (input.withdrawn && !own && !reason) throw new SenderError('Indica el motivo de la retirada por moderación.');
  if (!input.withdrawn && previous?.withdrawnBy) {
    const moderation = !authors.some((author) => author.isEqual(previous.withdrawnBy!));
    if (moderation && !member.isCreator) throw new SenderError('Un administrador debe revisar esta retirada antes de restaurarla.');
    if (!moderation && !own) throw new SenderError('Solo sus autores pueden restaurar este aporte.');
  }
  saveTargetBaseline(ctx, input.kind, input.targetId);
  const row = { key, kind: input.kind, targetId: input.targetId,
    withdrawnAt: input.withdrawn ? ctx.timestamp : undefined,
    withdrawnBy: input.withdrawn ? ctx.sender : undefined,
    reason: input.withdrawn ? reason : '' };
  if (previous) ctx.db.contentStatus.key.update(row); else ctx.db.contentStatus.insert(row);
  bumpMaterial(ctx, input.kind, input.targetId);
  log(ctx, input.withdrawn ? 'withdraw' : 'restore', input.kind, input.targetId);
}
