export interface InvitationEmailMessage { to: string; from: string; subject: string; text: string; html: string }
export type InvitationEmailSend = (message: InvitationEmailMessage, idempotencyKey: string) => Promise<unknown>;

const ERROR_CODES = new Set([
  'invalid_idempotency_key', 'validation_error', 'missing_api_key', 'restricted_api_key',
  'invalid_api_key', 'invalid_permission', 'suspended_api_key', 'email_above_quota',
  'not_found', 'method_not_allowed', 'concurrent_idempotent_requests', 'invalid_idempotent_request',
  'resource_locked', 'invalid_attachment', 'invalid_parameter', 'missing_required_field',
  'missing_required_parameter', 'daily_quota_exceeded', 'monthly_quota_exceeded',
  'rate_limit_exceeded', 'application_error', 'service_unavailable',
]);
const TRANSIENT_CODES = new Set(['concurrent_idempotent_requests', 'resource_locked', 'rate_limit_exceeded', 'application_error', 'service_unavailable']);
const QUOTA_CODES = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded', 'email_above_quota']);

/** Provider messages can contain recipient addresses or credentials; retain only known codes. */
export class ResendEmailError extends Error {
  readonly code: string;
  readonly outcome: 'retry' | 'failed';
  readonly retryAfterSeconds?: number;

  constructor(code: string, status?: number, retryAfterSeconds?: number) {
    const safeCode = ERROR_CODES.has(code) || ['network_error', 'invalid_response'].includes(code)
      ? code : status !== undefined ? `http_${status}` : 'network_error';
    super(safeCode);
    this.name = 'ResendEmailError';
    this.code = safeCode;
    this.outcome = QUOTA_CODES.has(safeCode) ? 'failed'
      : TRANSIENT_CODES.has(safeCode) || status === undefined || status >= 500 || status === 408 || status === 429 ? 'retry' : 'failed';
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds! >= 0) this.retryAfterSeconds = Math.min(86_400, Math.ceil(retryAfterSeconds!));
  }
}

export function isResendEmailResult(value: unknown): value is { id: string } {
  return typeof value === 'object' && value !== null && 'id' in value
    && typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.id);
}

async function readResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 16_384) { await reader.cancel(); return undefined; }
      parts.push(part.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { await reader.cancel().catch(() => {}); return undefined; }
  finally { reader.releaseLock(); }
}

export function createResendEmailSend(apiKey: string, fetchFn: typeof fetch = fetch): InvitationEmailSend {
  return async (message, idempotencyKey) => {
    let response: Response;
    try {
      response = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ ...message, to: [message.to] }),
        redirect: 'manual', signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new ResendEmailError('network_error'); }
    const result = await readResponse(response);
    if (!response.ok) {
      const code = typeof result === 'object' && result !== null && 'name' in result && typeof result.name === 'string' ? result.name : '';
      const retryAfter = response.headers.get('retry-after');
      throw new ResendEmailError(code, response.status, retryAfter !== null && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : undefined);
    }
    if (!isResendEmailResult(result)) throw new ResendEmailError('invalid_response');
    return result;
  };
}
