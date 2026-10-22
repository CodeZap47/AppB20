import { describe, expect, it, vi } from 'vitest';
import { runInvitationEmailCron, type InvitationEmailMessage } from './emailRunner';
import { buildInvitationEmail } from './template';
import type { NotificationCall } from '../notifications/database';

const config = { INVITATION_EMAILS_ENABLED: 'true', INVITATION_EMAIL_FROM: 'avisos@example.com', APP_URL: 'https://app-b20.pages.dev', EMAIL: { send: vi.fn() } as unknown as SendEmail, NOTIFICATION_SERVICE_TOKEN: 'secret', SPACETIMEDB_URI: 'https://example.spacetimedb.com', SPACETIMEDB_MODULE: 'app' };
function sendError(code: string) { return Object.assign(new Error(`fallo ${code}`), { code }); }
function fixture(emails: string[]) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const call: NotificationCall = async <T>(name: string, input: Record<string, unknown>) => {
    calls.push({ name, input });
    if (name === 'invitation_emails_claim') return { jobs: emails.map((email, index) => ({ email, isCreator: index === 0, inviterName: 'Ana' })) } as T;
    return {} as T;
  };
  return { call, calls, finishes: () => calls.filter((row) => row.name === 'invitation_emails_finish').map((row) => row.input) };
}

describe('cron de correos de invitación', () => {
  it('se apaga sin configuración completa y no hace IO', async () => {
    const call = vi.fn(); const send = vi.fn();
    for (const missing of ['INVITATION_EMAILS_ENABLED', 'INVITATION_EMAIL_FROM', 'APP_URL', 'EMAIL', 'NOTIFICATION_SERVICE_TOKEN'] as const) {
      expect(await runInvitationEmailCron({ ...config, [missing]: undefined }, { call, send })).toEqual({ enabled: false });
    }
    expect(await runInvitationEmailCron({ ...config, INVITATION_EMAILS_ENABLED: 'false' }, { call, send })).toEqual({ enabled: false });
    expect(call).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it('envía, reclama con lease y límite, y cierra cada trabajo', async () => {
    const state = fixture(['a@example.com']); const send = vi.fn(async (_message: InvitationEmailMessage) => ({ messageId: 'm1' }));
    expect(await runInvitationEmailCron(config, { call: state.call, send })).toEqual({ enabled: true, sent: 1 });
    const claim = state.calls[0]!; expect(claim.name).toBe('invitation_emails_claim'); expect(claim.input.limit).toBe(10);
    expect(send.mock.calls[0]![0]).toMatchObject({ to: 'a@example.com', from: 'avisos@example.com', subject: 'Te invitaron a App B20' });
    expect(state.finishes()).toEqual([{ email: 'a@example.com', leaseId: claim.input.leaseId, outcome: 'sent' }]);
  });

  it('mapea los códigos de error a failed o retry', async () => {
    const codes = ['E_RECIPIENT_SUPPRESSED', 'E_RECIPIENT_NOT_ALLOWED', 'E_VALIDATION_ERROR', 'E_RATE_LIMIT_EXCEEDED', 'E_SENDER_NOT_VERIFIED', 'none'];
    const state = fixture(codes.map((code) => `${code}@example.com`));
    const send = vi.fn(async (message: InvitationEmailMessage) => { const code = message.to.split('@')[0]!; throw code === 'none' ? new Error('x'.repeat(500)) : sendError(code); });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runInvitationEmailCron(config, { call: state.call, send })).toEqual({ enabled: true, sent: 0 });
    expect(state.finishes().map((row) => row.outcome)).toEqual(['failed', 'failed', 'failed', 'retry', 'retry', 'retry']);
    expect(state.finishes().every((row) => typeof row.error === 'string' && (row.error as string).length <= 200)).toBe(true);
    expect(consoleError).toHaveBeenCalledTimes(1); expect(String(consoleError.mock.calls[0]![0])).toContain('E_SENDER_NOT_VERIFIED');
    consoleError.mockRestore();
  });
});

describe('plantilla de invitación', () => {
  it('escapa el HTML e incluye el enlace y el rol', () => {
    const mail = buildInvitationEmail({ email: 'x"<y>@example.com', isCreator: true, inviterName: '<script>alert(1)</script> & co', appUrl: 'https://app-b20.pages.dev/?a=1&b="2"' });
    expect(mail.subject).toBe('Te invitaron a App B20');
    expect(mail.html).not.toContain('<script>'); expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(mail.html).toContain('href="https://app-b20.pages.dev/?a=1&amp;b=&quot;2&quot;"'); expect(mail.html).toContain('x&quot;&lt;y&gt;@example.com');
    expect(mail.text).toContain('https://app-b20.pages.dev/?a=1&b="2"'); expect(mail.text).toContain('administración'); expect(mail.text).toContain('ignorar');
    expect(buildInvitationEmail({ email: 'a@example.com', isCreator: false, inviterName: 'Ana', appUrl: 'https://app-b20.pages.dev' }).text).toContain('integrante');
  });
});
