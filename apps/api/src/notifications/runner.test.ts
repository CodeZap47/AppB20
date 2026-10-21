import { webcrypto as crypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@b20/core';
import { runNotificationCron } from './runner';
import type { NotificationCall } from './database';
import { encodePushBase64 } from './webPush';
async function config() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']); const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)); const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { NOTIFICATIONS_ENABLED: 'true', NOTIFICATION_SERVICE_TOKEN: 'secret', VAPID_PUBLIC_KEY: encodePushBase64(raw), VAPID_PRIVATE_KEY: privateJwk.d!, VAPID_SUBJECT: 'mailto:test@example.com', SPACETIMEDB_URI: 'https://example.spacetimedb.com', SPACETIMEDB_MODULE: 'app' };
}
const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, timeZone: 'UTC', pushEnabled: true, quietStartMinute: 0, quietEndMinute: 0 };
const now = Date.parse('2026-10-21T16:00:00Z');
function fixture(options: { quiet?: boolean; authorized?: boolean; cursor?: string; incomplete?: boolean } = {}) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const call: NotificationCall = async <T>(name: string, input: Record<string, unknown>) => {
    calls.push({ name, input });
    if (name === 'notification_reminder_context') return { now, members: [{ memberId: 'b'.repeat(64), cursorDay: options.cursor ?? '2026-01-01', preferences: prefs }] } as T;
    if (name === 'notification_commit_reminders') return { complete: !options.incomplete } as T;
    if (name === 'notifications_claim') return { now, jobs: [{ jobId: '1:installation', notificationId: '1', endpoint: 'https://fcm.googleapis.com/fcm/send/token', p256dh: 'invalid', auth: 'invalid', title: 'Nuevo mensaje privado', route: '/m/avisos', preferences: options.quiet ? { ...prefs, quietStartMinute: 0, quietEndMinute: 23 * 60 } : prefs }] } as T;
    if (name === 'notifications_authorize') return (options.authorized !== false) as T;
    return {} as T;
  };
  return { call, calls };
}
describe('cron acotado de notificaciones', () => {
  it('desactivado no realiza IO ni requiere secretos', async () => { const call = vi.fn(); expect(await runNotificationCron({ SPACETIMEDB_URI: '', SPACETIMEDB_MODULE: '' }, { call })).toEqual({ enabled: false, sent: 0 }); expect(call).not.toHaveBeenCalled(); });
  it('recupera las primeras fechas pendientes sin saltar meses y limita cada ejecución', async () => {
    const state = fixture(); await runNotificationCron(await config(), state); expect(state.calls.filter((row) => row.name === 'notification_commit_reminders').map((row) => row.input.day)).toEqual(['2026-01-02', '2026-01-03']);
    expect(state.calls.find((row) => row.name === 'notifications_claim')?.input.limit).toBe(8); expect(state.calls.at(-1)?.input.outcome).toBe('invalid');
  });
  it('no avanza al día siguiente si falta materializar parte del día actual', async () => { const state = fixture({ incomplete: true }); await runNotificationCron(await config(), state); expect(state.calls.filter((row) => row.name === 'notification_commit_reminders')).toHaveLength(1); });
  it('descanso difiere sin intento de envío ni autorización HTTP', async () => { const state = fixture({ quiet: true }); const fetchFn = vi.fn(); await runNotificationCron(await config(), { ...state, fetch: fetchFn }); expect(state.calls.at(-1)?.input.outcome).toBe('deferred'); expect(fetchFn).not.toHaveBeenCalled(); expect(state.calls.some((row) => row.name === 'notifications_authorize')).toBe(false); });
  it('una revocación posterior al claim evita la petición push', async () => { const state = fixture({ authorized: false }); const fetchFn = vi.fn(); await runNotificationCron(await config(), { ...state, fetch: fetchFn }); expect(fetchFn).not.toHaveBeenCalled(); expect(state.calls.at(-1)?.name).toBe('notifications_authorize'); });
  it('sin VAPID materializa bandeja y calendario sin reclamar push', async () => { const state = fixture(); const configuration = { ...await config(), VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined }; expect(await runNotificationCron(configuration, state)).toEqual({ enabled: true, pushConfigured: false, sent: 0 }); expect(state.calls.some((row) => row.name === 'notification_commit_reminders')).toBe(true); expect(state.calls.some((row) => row.name === 'notifications_claim')).toBe(false); });
  it('una configuración VAPID inválida falla antes de reclamar o consumir trabajos', async () => { const state = fixture(); await expect(runNotificationCron({ ...await config(), VAPID_PRIVATE_KEY: 'invalid' }, state)).rejects.toThrow(); expect(state.calls.some((row) => row.name === 'notifications_claim')).toBe(false); });
});
