import { createNotificationCall, type NotificationCall } from '../notifications/database.ts';
import { buildInvitationEmail } from './template.ts';
import { createResendEmailSend, isResendEmailResult, ResendEmailError, type InvitationEmailSend } from './resend.ts';

export type { InvitationEmailMessage, InvitationEmailSend } from './resend.ts';
export interface InvitationEmailRuntimeConfiguration {
  INVITATION_EMAILS_ENABLED?: string; INVITATION_EMAIL_FROM?: string; APP_URL?: string;
  RESEND_API_KEY?: string; NOTIFICATION_SERVICE_TOKEN?: string;
  SPACETIMEDB_URI: string; SPACETIMEDB_MODULE: string;
}
interface Job { email: string; isCreator: boolean; inviterName: string; requestId: string }
type Outcome = 'sent' | 'retry' | 'failed';

export function classifySendError(error: unknown): { outcome: Exclude<Outcome, 'sent'>; code: string; error: string; retryAfterSeconds?: number } {
  const failure = error instanceof ResendEmailError ? error : new ResendEmailError('network_error');
  return { outcome: failure.outcome, code: failure.code, error: failure.code,
    ...(failure.retryAfterSeconds !== undefined ? { retryAfterSeconds: failure.retryAfterSeconds } : {}) };
}

async function idempotencyKey(requestId: string): Promise<string> {
  if (typeof requestId !== 'string' || !requestId || requestId.length > 1024) throw new Error('Invitation email protocol is not configured.');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestId)));
  return `b20-invitation/${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function runInvitationEmailCron(configuration: InvitationEmailRuntimeConfiguration, options: { call?: NotificationCall; send?: InvitationEmailSend } = {}) {
  if (configuration.INVITATION_EMAILS_ENABLED !== 'true') return { enabled: false as const };
  const { INVITATION_EMAIL_FROM: from, APP_URL: appUrl, NOTIFICATION_SERVICE_TOKEN: serviceToken, RESEND_API_KEY: apiKey } = configuration;
  if (!apiKey?.trim() || !from?.trim() || !appUrl?.trim() || !serviceToken?.trim()
    || !configuration.SPACETIMEDB_URI?.trim() || !configuration.SPACETIMEDB_MODULE?.trim()) {
    throw new Error('Invitation email service is not configured.');
  }
  const call = options.call ?? createNotificationCall({ uri: configuration.SPACETIMEDB_URI, module: configuration.SPACETIMEDB_MODULE, serviceToken });
  const send = options.send ?? createResendEmailSend(apiKey);
  const leaseId = crypto.randomUUID();
  const claimed = await call<{ jobs: Job[] }>('invitation_emails_claim', { leaseId, limit: 10 });
  const keys = await Promise.all(claimed.jobs.slice(0, 10).map((job) => idempotencyKey(job.requestId)));
  const counts = { sent: 0, retry: 0, failed: 0 };
  for (const [index, job] of claimed.jobs.slice(0, 10).entries()) {
    let result: { outcome: Outcome; error?: string; retryAfterSeconds?: number };
    try {
      const response = await send({ to: job.email, from, ...buildInvitationEmail({ ...job, appUrl }) }, keys[index]!);
      if (!isResendEmailResult(response)) throw new ResendEmailError('invalid_response');
      result = { outcome: 'sent' };
    } catch (error) {
      const { code, ...failure } = classifySendError(error);
      console.error(JSON.stringify({ event: 'invitation_email_send_error', code, outcome: failure.outcome }));
      result = failure;
    }
    await call('invitation_emails_finish', { email: job.email, leaseId, ...result });
    counts[result.outcome]++;
  }
  return { enabled: true as const, ...counts };
}
