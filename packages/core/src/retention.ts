/** Treinta días completos de 24 horas, medidos por el reloj del servidor. */
export const RETENTION_DAYS = 30;
export const RETENTION_MICROS = 30n * 24n * 60n * 60n * 1_000_000n;
export function retentionDeadline(withdrawnAt: bigint): bigint { return withdrawnAt + RETENTION_MICROS; }
export function retentionExpired(now: bigint, expiresAt: bigint): boolean { return now >= expiresAt; }
