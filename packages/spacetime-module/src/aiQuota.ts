import { AI_CONSENT_VERSION, AI_LIMITS, aiUuid } from '../../core/src/ai';
import type { Identity } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { isActive, type Ctx } from './moduleContext';

const HOUR = 3_600_000_000n;
const DAY = 86_400_000_000n;
function fail(code: string, message: string): never { throw new SenderError(`${code}:${message}`); }
export interface AiQuotaOperation {
  preparationId: string; model: string; purpose: string; requestHash: string;
  acknowledgeUnknown?: boolean;
}
/** All AI modules share the same ledger, rate limit, budget and concurrent slot. */
export function reserveAiQuota(ctx: Ctx, actor: Identity, requestId: string, estimatedTokens: number, operation: AiQuotaOperation) {
  if (!aiUuid(requestId) || !Number.isSafeInteger(estimatedTokens) || estimatedTokens < 1 || estimatedTokens > 10_000_000) fail('invalid', 'La reserva de consumo no es válida.');
  if (!isActive(ctx.db, actor)) fail('unauthorized', 'La membresía ya no está activa.');
  if (!ctx.db.aiServiceConfig.id.find(0)?.enabled) fail('disabled', 'La IA no está habilitada.');
  const consent = ctx.db.aiConsent.actor.find(actor);
  if (!consent?.accepted || consent.version !== AI_CONSENT_VERSION) fail('consent', 'Confirma el consentimiento vigente.');
  const key = ctx.db.aiKey.actor.find(actor);
  if (!key) fail('key_required', 'Configura tu clave personal antes de generar.');
  const previous = ctx.db.aiGeneration.id.find(requestId);
  if (previous) {
    if (!previous.actor.isEqual(actor) || previous.requestHash !== operation.requestHash || previous.preparationId !== operation.preparationId) fail('conflict', 'El envío pertenece a otra operación.');
    return { claimed: false as const, generation: previous, key };
  }
  for (const generation of ctx.db.aiGeneration.actor.filter(actor)) {
    if (generation.status === 'running' && generation.claimedAt && generation.claimedAt.microsSinceUnixEpoch + 90_000_000n <= ctx.timestamp.microsSinceUnixEpoch) {
      ctx.db.aiGeneration.id.update({ ...generation, status: 'unknown', errorCode: 'unknown', errorMessage: 'Resultado incierto; consulta el estado antes de otro envío.' });
    } else if (generation.status === 'queued' && generation.createdAt.microsSinceUnixEpoch + 300_000_000n <= ctx.timestamp.microsSinceUnixEpoch) {
      ctx.db.aiGeneration.id.update({ ...generation, status: 'failed', errorCode: 'expired', errorMessage: 'El envío no se inició antes de vencer.' });
      const reservation = ctx.db.aiReservation.id.find(generation.id);
      if (reservation) ctx.db.aiReservation.id.update({ ...reservation, status: 'released' });
    } else if (generation.status === 'queued' || generation.status === 'running') fail('quota', 'Ya tienes una operación de IA en curso.');
  }
  if (!operation.acknowledgeUnknown && [...ctx.db.aiGeneration.actor.filter(actor)].some((entry) => entry.status === 'unknown' && entry.createdAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch - DAY)) fail('unknown_confirmation_required', 'Confirma el posible consumo adicional del envío incierto.');
  const reservations = [...ctx.db.aiReservation.actor.filter(actor)];
  const daily = reservations.filter((entry) => entry.createdAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch - DAY);
  if (reservations.filter((entry) => entry.createdAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch - HOUR).length >= AI_LIMITS.requestsPerHour || daily.length >= AI_LIMITS.requestsPerDay) fail('quota', 'Alcanzaste el límite compartido de solicitudes de IA.');
  const spent = daily.filter((entry) => entry.status !== 'released').reduce((sum, entry) => sum + entry.estimatedTokens, 0);
  if (spent + estimatedTokens > (ctx.db.aiServiceConfig.id.find(0)?.dailyTokenBudget ?? AI_LIMITS.dailyEstimatedTokens)) fail('quota', 'La operación supera tu presupuesto diario disponible.');
  ctx.db.aiReservation.insert({ id: requestId, actor, estimatedTokens, status: 'reserved', createdAt: ctx.timestamp });
  const generation = ctx.db.aiGeneration.insert({ id: requestId, actor, preparationId: operation.preparationId, requestHash: operation.requestHash,
    configJson: JSON.stringify({ purpose: operation.purpose }), keyId: key.keyId, model: operation.model, status: 'running', createdAt: ctx.timestamp, claimedAt: ctx.timestamp,
    inputTokens: undefined, outputTokens: undefined, resultJson: '', errorCode: '', errorMessage: '' });
  return { claimed: true as const, generation, key };
}

export function settleAiQuota(ctx: Ctx, actor: Identity, requestId: string, usage: { inputTokens: number; outputTokens: number } | undefined, state: 'succeeded' | 'failed' | 'unknown') {
  const row = ctx.db.aiGeneration.id.find(requestId);
  if (!row || !row.actor.isEqual(actor)) fail('unavailable', 'La reserva no está disponible.');
  if (usage && ![usage.inputTokens, usage.outputTokens].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000)) fail('invalid', 'El consumo reportado no es válido.');
  if (row.status !== 'running' && row.status !== 'unknown') return;
  ctx.db.aiGeneration.id.update({ ...row, status: state, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
    errorCode: state === 'succeeded' ? '' : state, errorMessage: state === 'unknown' ? 'No se conoce el resultado; no se reenvía automáticamente.' : '' });
  const reservation = ctx.db.aiReservation.id.find(requestId);
  if (reservation) ctx.db.aiReservation.id.update({ ...reservation, status: state === 'unknown' ? 'reserved' : 'consumed', estimatedTokens: Math.max(reservation.estimatedTokens, (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)) });
}
