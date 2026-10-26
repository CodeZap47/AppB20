import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './guideWorker.ts';
import type { AiWorkerEnv } from './ai/database.ts';
import type { DeliveryMaintenanceEnv } from './scheduledMaintenance.ts';

const environment = {
  CORS_ORIGINS: 'https://app-b20.pages.dev',
  SPACETIMEDB_URI: 'https://database.example.test', SPACETIMEDB_MODULE: 'integration-test',
  AI_ENABLED: 'true', NOTIFICATIONS_ENABLED: 'false',
} as AiWorkerEnv & DeliveryMaintenanceEnv;

afterEach(() => { vi.restoreAllMocks(); });

describe('Worker de integración sin R2', () => {
  it('sirve la API y no programa servicios desactivados ni limpia archivos heredados', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected remote call'));
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await worker.fetch(new Request('https://integration.example.test/health'), environment, {} as ExecutionContext);
    expect(await response.json()).toEqual({ ok: true, files: 'unconfigured', ai: true });
    await worker.scheduled({} as ScheduledController, environment);
    expect(request).not.toHaveBeenCalled();
    expect(logs.mock.calls.flat().join(' ')).toContain('"task":"invitation-emails","ok":true,"enabled":false');
  });

  it('ejecuta el cron de bandeja sin VAPID, R2 ni una credencial de mantenimiento', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const calls: string[] = [];
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://database.example.test');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer notifications-only-test');
      const procedure = url.pathname.split('/').at(-1)!; calls.push(procedure);
      return Response.json(JSON.stringify(procedure === 'notification_reminder_context' ? { now: Date.now(), members: [] } : { processed: 0 }));
    });
    await worker.scheduled({} as ScheduledController, { ...environment, NOTIFICATIONS_ENABLED: 'true', NOTIFICATION_SERVICE_TOKEN: 'notifications-only-test' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(['notifications_sweep', 'notification_reminder_context']);
  });

  it('un fallo de avisos no impide el mantenimiento autorizado ni filtra el error', async () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const procedure = new URL(String(input)).pathname.split('/').at(-1)!; calls.push(procedure);
      return procedure === 'purge_due' ? Response.json(JSON.stringify({ processed: 0, remaining: 0 })) : new Response('private-error-must-not-be-logged', { status: 503 });
    });
    await worker.scheduled({} as ScheduledController, { ...environment, NOTIFICATIONS_ENABLED: 'true', NOTIFICATION_SERVICE_TOKEN: 'notifications-only-test', MAINTENANCE_SERVICE_TOKEN: 'maintenance-only-test' });
    expect(calls).toContain('notifications_sweep'); expect(calls).toContain('purge_due');
    expect(logs.mock.calls.flat().join(' ')).not.toContain('private-error-must-not-be-logged');
    expect(logs.mock.calls.flat().join(' ')).toContain('"task":"notifications","ok":false');
    expect(logs.mock.calls.flat().join(' ')).toContain('"task":"retention","ok":true');
  });

  it('registra un error si se activan invitaciones sin credenciales y conserva los otros servicios', async () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no remote calls'));
    await worker.scheduled({} as ScheduledController, { ...environment, INVITATION_EMAILS_ENABLED: 'true' });
    expect(request).not.toHaveBeenCalled();
    expect(logs.mock.calls.flat().join(' ')).toContain('"task":"invitation-emails","ok":false');
    expect(logs.mock.calls.flat().join(' ')).toContain('"task":"retention","ok":true');
  });

  it('registra los resultados del envío sin registrar destinatarios ni la clave', async () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.origin === 'https://api.resend.com') return Response.json({ id: 'email-test-1' });
      return Response.json(JSON.stringify(url.pathname.endsWith('/invitation_emails_claim')
        ? { jobs: [{ email: 'private@example.com', isCreator: false, inviterName: 'Ana', requestId: 'stable-test-1' }] }
        : {}));
    });
    await worker.scheduled({} as ScheduledController, {
      ...environment, INVITATION_EMAILS_ENABLED: 'true', INVITATION_EMAIL_FROM: 'B20 <invitaciones@b20.mx>',
      APP_URL: 'https://b20.mx', RESEND_API_KEY: 're_private_test_key', NOTIFICATION_SERVICE_TOKEN: 'test-service',
    });
    const output = logs.mock.calls.flat().join(' ');
    expect(output).toContain('"task":"invitation-emails","ok":true,"enabled":true,"sent":1,"retry":0,"failed":0');
    expect(output).not.toContain('private@example.com');
    expect(output).not.toContain('re_private_test_key');
  });
});
