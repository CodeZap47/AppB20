import { createNotificationCall, type NotificationCall } from '../notifications/database.ts';
import { buildInvitationEmail } from './template.ts';

export interface InvitationEmailMessage { to: string; from: string; subject: string; text: string; html: string }
export type InvitationEmailSend = (message: InvitationEmailMessage) => Promise<unknown>;
export interface InvitationEmailRuntimeConfiguration {
  INVITATION_EMAILS_ENABLED?: string; INVITATION_EMAIL_FROM?: string; APP_URL?: string;
  EMAIL?: SendEmail; NOTIFICATION_SERVICE_TOKEN?: string;
  SPACETIMEDB_URI: string; SPACETIMEDB_MODULE: string;
}
interface Job { email: string; isCreator: boolean; inviterName: string }
type Outcome = 'sent' | 'retry' | 'failed';

const PERMANENT_ERROR_CODES = new Set(['E_RECIPIENT_SUPPRESSED', 'E_RECIPIENT_NOT_ALLOWED', 'E_VALIDATION_ERROR']);
export function classifySendError(error: unknown): { outcome: Exclude<Outcome, 'sent'>; code?: string; error: string } {
  const code = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return { outcome: code && PERMANENT_ERROR_CODES.has(code) ? 'failed' : 'retry', code, error: (code ? `${code}: ${message}` : message).slice(0, 200) };
}

export async function runInvitationEmailCron(configuration: InvitationEmailRuntimeConfiguration, options: { call?: NotificationCall; send?: InvitationEmailSend } = {}) {
  const { EMAIL: binding, INVITATION_EMAIL_FROM: from, APP_URL: appUrl, NOTIFICATION_SERVICE_TOKEN: serviceToken } = configuration;
  if (configuration.INVITATION_EMAILS_ENABLED !== 'true' || !binding || !from || !appUrl || !serviceToken) return { enabled: false as const };
  const call = options.call ?? createNotificationCall({ uri: configuration.SPACETIMEDB_URI, module: configuration.SPACETIMEDB_MODULE, serviceToken });
  const send = options.send ?? ((message: InvitationEmailMessage) => binding.send(message));
  const leaseId = crypto.randomUUID();
  const claimed = await call<{ jobs: Job[] }>('invitation_emails_claim', { leaseId, limit: 10 });
  let sent = 0;
  for (const job of claimed.jobs.slice(0, 10)) {
    let result: { outcome: Outcome; error?: string };
    try {
      await send({ to: job.email, from, ...buildInvitationEmail({ ...job, appUrl }) });
      result = { outcome: 'sent' };
    } catch (error) {
      const failure = classifySendError(error);
      if (failure.code?.startsWith('E_SENDER_')) console.error(JSON.stringify({ event: 'invitation_email_sender_error', code: failure.code }));
      result = { outcome: failure.outcome, error: failure.error };
    }
    await call('invitation_emails_finish', { email: job.email, leaseId, ...result });
    if (result.outcome === 'sent') sent++;
  }
  return { enabled: true as const, sent };
}
