import { SenderError } from 'spacetimedb/server';
import { memberIdentityFor } from './authIdentity';
import { activeMember, requireText, type Ctx } from './moduleContext';
import { contentVersion, readAdminContentEntries } from './contentInventory';
import { withdrawContent } from './communityHandlers';

/** Cada llamada es una transacción independiente; una baja anterior nunca depende de este resultado. */
export function moderateContentItem(ctx: Ctx, input: { operationId: string; kind: string; targetId: bigint; expectedVersion: number; withdrawn: boolean; reason: string; acknowledgeImpact: boolean; expectedImpact?: string }) {
  const me = activeMember(ctx);
  if (!me.isCreator) throw new SenderError('Solo un administrador puede gestionar el contenido.');
  const operationId = requireText(input.operationId, 'La operación', 128);
  if (input.reason.length > 1000) throw new SenderError('El motivo excede 1000 caracteres.');
  const actor = memberIdentityFor(ctx);
  const key = `${actor.toHexString()}:${operationId}:${input.kind}:${input.targetId}`;
  const previous = ctx.db.adminContentResult.key.find(key);
  if (previous) {
    if (previous.expectedVersion !== input.expectedVersion || previous.withdrawn !== input.withdrawn || previous.reason !== input.reason || previous.acknowledgeImpact !== input.acknowledgeImpact || previous.expectedImpact !== input.expectedImpact) {
      throw new SenderError('Esta operación ya se utilizó con otra decisión. Revisa el resultado antes de reintentar.');
    }
    return;
  }
  let status = 'completed', error = '';
  try {
    const entry = readAdminContentEntries(ctx.db, actor).find((row) => row.kind === input.kind && row.targetId === input.targetId);
    if (!entry) throw new SenderError('El aporte grupal ya no está disponible.');
    if (input.withdrawn && !entry.safeForBulk && !input.acknowledgeImpact) throw new SenderError('Revisa y acepta el impacto en coautores, dependencias o archivos conservados.');
    if (input.withdrawn && !entry.safeForBulk && input.expectedImpact !== `${Number(entry.collaborative)}:${entry.foreignDependencies}:${entry.sharedFiles}:${entry.reportReferences}`) throw new SenderError('El impacto en otros aportes cambió. Actualiza y vuelve a revisar la selección.');
    if (input.withdrawn && !input.reason.trim()) throw new SenderError('Indica el motivo de la retirada por moderación.');
    withdrawContent(ctx, { ...input, acknowledgeImpact: input.acknowledgeImpact, administrative: true });
  } catch (failure) {
    if (!(failure instanceof SenderError)) throw failure;
    status = 'failed'; error = failure.message;
  }
  ctx.db.adminContentResult.insert({ key, operationId, actor, kind: input.kind, targetId: input.targetId, expectedVersion: input.expectedVersion,
    withdrawn: input.withdrawn, reason: input.reason, acknowledgeImpact: input.acknowledgeImpact, expectedImpact: input.expectedImpact, status, error,
    version: contentVersion(ctx.db, input.kind, input.targetId), completedAt: ctx.timestamp });
}

export function readAdminContentResult(ctx: Ctx, input: { operationId: string; kind: string; targetId: bigint }) {
  if (!activeMember(ctx).isCreator) throw new SenderError('Solo un administrador puede consultar esta operación.');
  const row = ctx.db.adminContentResult.key.find(`${memberIdentityFor(ctx).toHexString()}:${input.operationId}:${input.kind}:${input.targetId}`);
  return JSON.stringify(row ? { operationId: row.operationId, kind: row.kind, targetId: row.targetId.toString(),
    status: row.status, error: row.error, version: row.version, completedAt: Number(row.completedAt.microsSinceUnixEpoch / 1000n) } : null);
}
