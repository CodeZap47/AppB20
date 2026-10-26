import { describe, expect, it, vi } from 'vitest';
import { runInvitationEmailCron, type InvitationEmailMessage } from './emailRunner';
import { buildInvitationEmail } from './template';
import type { NotificationCall } from '../notifications/database';
import { ResendEmailError } from './resend';

const config = { INVITATION_EMAILS_ENABLED: 'true', INVITATION_EMAIL_FROM: 'avisos@example.com', APP_URL: 'https://app-b20.pages.dev', RESEND_API_KEY: 're_test', NOTIFICATION_SERVICE_TOKEN: 'secret', SPACETIMEDB_URI: 'https://example.spacetimedb.com', SPACETIMEDB_MODULE: 'app' };
function fixture(emails: string[], requestVersion = '123') {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const call: NotificationCall = async <T>(name: string, input: Record<string, unknown>) => {
    calls.push({ name, input });
    if (name === 'invitation_emails_claim') return { jobs: emails.map((email, index) => ({ email, isCreator: index === 0, inviterName: 'Ana', requestId: `${email}/${requestVersion}` })) } as T;
    return {} as T;
  };
  return { call, calls, finishes: () => calls.filter((row) => row.name === 'invitation_emails_finish').map((row) => row.input) };
}

describe('cron de correos de invitación', () => {
  it('se apaga sin habilitación y no hace IO', async () => {
    const call = vi.fn(); const send = vi.fn();
    expect(await runInvitationEmailCron({ ...config, INVITATION_EMAILS_ENABLED: undefined }, { call, send })).toEqual({ enabled: false });
    expect(await runInvitationEmailCron({ ...config, INVITATION_EMAILS_ENABLED: 'false' }, { call, send })).toEqual({ enabled: false });
    expect(call).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it('si está habilitado, la configuración incompleta falla antes de reclamar trabajos', async () => {
    const call = vi.fn(); const send = vi.fn();
    for (const missing of ['INVITATION_EMAIL_FROM', 'APP_URL', 'RESEND_API_KEY', 'NOTIFICATION_SERVICE_TOKEN', 'SPACETIMEDB_URI', 'SPACETIMEDB_MODULE'] as const) {
      await expect(runInvitationEmailCron({ ...config, [missing]: '' }, { call, send })).rejects.toThrow('Invitation email service is not configured.');
    }
    expect(call).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it('envía, reclama con lease y límite, y cierra cada trabajo', async () => {
    const state = fixture(['a@example.com']); const send = vi.fn(async (_message: InvitationEmailMessage, _key: string) => ({ id: 'm1' }));
    expect(await runInvitationEmailCron(config, { call: state.call, send })).toEqual({ enabled: true, sent: 1, retry: 0, failed: 0 });
    const claim = state.calls[0]!; expect(claim.name).toBe('invitation_emails_claim'); expect(claim.input.limit).toBe(10);
    expect(send.mock.calls[0]![0]).toMatchObject({ to: 'a@example.com', from: 'avisos@example.com', subject: 'Te invitaron a B20' });
    expect(send.mock.calls[0]![1]).toMatch(/^b20-invitation\/[a-f0-9]{64}$/);
    expect(state.finishes()).toEqual([{ email: 'a@example.com', leaseId: claim.input.leaseId, outcome: 'sent' }]);
  });

  it('mapea los códigos de error sin filtrar información privada y propaga Retry-After', async () => {
    const failures = [new ResendEmailError('validation_error', 403), new ResendEmailError('daily_quota_exceeded', 429), new ResendEmailError('invalid_idempotent_request', 409), new ResendEmailError('rate_limit_exceeded', 429, 90), new ResendEmailError('concurrent_idempotent_requests', 409), new Error('a@example.com re_secret')];
    const state = fixture(failures.map((_, index) => `${index}@example.com`)); let index = 0;
    const send = vi.fn(async () => { throw failures[index++]; });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runInvitationEmailCron(config, { call: state.call, send })).toEqual({ enabled: true, sent: 0, retry: 3, failed: 3 });
    expect(state.finishes().map((row) => row.outcome)).toEqual(['failed', 'failed', 'failed', 'retry', 'retry', 'retry']);
    expect(state.finishes()[3]).toMatchObject({ retryAfterSeconds: 90 });
    expect(state.finishes()[5]).toMatchObject({ error: 'network_error' });
    expect(consoleError).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/example\.com|re_secret/);
    consoleError.mockRestore();
  });

  it('una respuesta sin identificador nunca se marca como enviada', async () => {
    const state = fixture(['a@example.com']); const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runInvitationEmailCron(config, { call: state.call, send: async () => ({ accepted: true }) });
    expect(state.finishes()[0]).toMatchObject({ outcome: 'retry', error: 'invalid_response' });
    error.mockRestore();
  });

  it('recupera un cierre interrumpido con otra lease y la misma clave; reenviar usa otra clave', async () => {
    const first = fixture(['a@example.com']);
    const send = vi.fn(async (_message: InvitationEmailMessage, _key: string) => ({ id: 'm1' }));
    const interruptedCall: NotificationCall = (name, input) => name === 'invitation_emails_finish' ? Promise.reject(new Error('database unavailable')) : first.call(name, input);
    await expect(runInvitationEmailCron(config, { call: interruptedCall, send })).rejects.toThrow('database unavailable');
    const recovered = fixture(['a@example.com']);
    await runInvitationEmailCron(config, { call: recovered.call, send });
    expect(first.calls[0]!.input.leaseId).not.toBe(recovered.calls[0]!.input.leaseId);
    expect(send.mock.calls[0]![1]).toBe(send.mock.calls[1]![1]);
    await runInvitationEmailCron(config, { call: fixture(['a@example.com'], '456').call, send });
    expect(send.mock.calls[2]![1]).not.toBe(send.mock.calls[0]![1]);
  });

  it('se niega a enviar si el módulo no proporciona un identificador estable', async () => {
    const send = vi.fn();
    const call: NotificationCall = async <T>() => ({ jobs: [{ email: 'a@example.com', isCreator: false, inviterName: 'Ana' }] }) as T;
    await expect(runInvitationEmailCron(config, { call, send })).rejects.toThrow('protocol');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('plantilla de invitación', () => {
  it('escapa el HTML e incluye el enlace y el rol', () => {
    const mail = buildInvitationEmail({ email: 'x"<y>@example.com', isCreator: true, inviterName: '<script>alert(1)</script> & co', appUrl: 'https://app-b20.pages.dev/?a=1&b="2"' });
    expect(mail.subject).toBe('Te invitaron a B20');
    expect(mail.html).not.toContain('<script>'); expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(mail.html).toContain('href="https://app-b20.pages.dev/?a=1&amp;b=&quot;2&quot;"'); expect(mail.html).toContain('x&quot;&lt;y&gt;@example.com');
    expect(mail.text).toContain('https://app-b20.pages.dev/?a=1&b="2"'); expect(mail.text).toContain('administración'); expect(mail.text).toContain('ignorar');
    expect(buildInvitationEmail({ email: 'a@example.com', isCreator: false, inviterName: 'Ana', appUrl: 'https://app-b20.pages.dev' }).text).toContain('integrante');
  });

  it('explica el acceso con código y contraseña, con el diseño de B20', () => {
    const mail = buildInvitationEmail({ email: 'a@example.com', isCreator: false, inviterName: 'Ana', appUrl: 'https://b20.mx/#/m' });
    for (const body of [mail.html, mail.text]) {
      expect(body).not.toContain('SpacetimeAuth');
      expect(body).toContain('código');
      expect(body).toContain('contraseña');
    }
    expect(mail.html).toContain('href="https://b20.mx/#/m"');
    expect(mail.html).toContain('src="https://b20.mx/email/estrella.png"');
    expect(mail.html).toContain('#193657');
    expect(new TextEncoder().encode(mail.html).length).toBeLessThan(100_000);
  });
});
