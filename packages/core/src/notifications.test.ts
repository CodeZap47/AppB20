import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFERENCES as defaults, addLocalDays, birthdayOnLocalDay, isQuietMinute, nextNotificationPushAt, notificationDayBounds, notificationLocalClock, notificationPreferences, notificationRetrySeconds, notificationRoute, reminderCatchupDays, validatePushEndpointText } from './notifications';
const at = (value: string) => Date.parse(value);
describe('preferencias y calendario de notificaciones', () => {
  it('valida IANA sin depender de Intl en el runtime de la base de datos', () => {
    vi.stubGlobal('Intl', undefined);
    try { expect(notificationPreferences({ ...defaults, timeZone: 'America/Tijuana' }).timeZone).toBe('America/Tijuana'); expect(() => notificationPreferences({ ...defaults, timeZone: 'Mars/Olympus' })).toThrow('IANA'); }
    finally { vi.unstubAllGlobals(); }
  });
  it('rechaza minutos fuera de rango y categorías desconocidas', () => {
    expect(() => notificationPreferences({ ...defaults, reminderMinute: 1440 })).toThrow('horarios');
    expect(() => notificationPreferences({ ...defaults, enabledKinds: ['unknown' as never] })).toThrow('Preferencias');
  });
  it('respeta descanso cruzando medianoche y la igualdad lo desactiva', () => {
    expect(isQuietMinute(30, 1320, 420)).toBe(true); expect(isQuietMinute(420, 1320, 420)).toBe(false); expect(isQuietMinute(30, 0, 0)).toBe(false);
  });
  it('resuelve la hora inexistente de primavera sin omitir el siguiente instante permitido', () => {
    const prefs = { ...defaults, timeZone: 'America/New_York', quietStartMinute: 0, quietEndMinute: 150 };
    expect(nextNotificationPushAt(at('2026-03-08T06:30:00Z'), prefs)).toBe(at('2026-03-08T07:00:00Z'));
    expect(notificationDayBounds('2026-03-08', prefs.timeZone)).toEqual({ startAt: at('2026-03-08T05:00:00Z'), endAt: at('2026-03-09T04:00:00Z') });
  });
  it('respeta la hora repetida de otoño y días de 25 horas', () => {
    const prefs = { ...defaults, timeZone: 'America/New_York', quietStartMinute: 0, quietEndMinute: 120 };
    expect(nextNotificationPushAt(at('2026-11-01T05:30:00Z'), prefs)).toBe(at('2026-11-01T07:00:00Z'));
    const bounds = notificationDayBounds('2026-11-01', prefs.timeZone); expect(bounds.endAt - bounds.startAt).toBe(25 * 3_600_000);
  });
  it('convierte también zonas con offset de media hora', () => { expect(notificationLocalClock(at('2026-10-21T00:00:00Z'), 'Asia/Kolkata')).toEqual({ day: '2026-10-21', minute: 330 }); });
  it('el catch-up continúa desde el primer día pendiente, aunque hayan pasado meses', () => {
    const first = reminderCatchupDays('2026-01-01', '2026-10-21', 2); expect(first).toEqual(['2026-01-02', '2026-01-03']);
    expect(reminderCatchupDays(first.at(-1), '2026-10-21', 2)).toEqual(['2026-01-04', '2026-01-05']);
    expect(reminderCatchupDays(undefined, '2026-10-21', 2)).toEqual(['2026-10-21']);
  });
  it('recuerda el 29 de febrero sin almacenar el año de nacimiento', () => {
    expect(birthdayOnLocalDay(2, 29, '2027-02-28')).toBe(true); expect(birthdayOnLocalDay(2, 29, '2028-02-28')).toBe(false); expect(birthdayOnLocalDay(2, 29, '2028-02-29')).toBe(true);
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29'); expect(() => addLocalDays('2027-02-29', 1)).toThrow();
  });
  it('limita reintentos y Retry-After', () => { expect(notificationRetrySeconds(1)).toBe(30); expect(notificationRetrySeconds(4, 300)).toBe(300); expect(notificationRetrySeconds(5, 999999)).toBe(28800); });
  it('valida endpoints sin URL e impide SSRF, credenciales y redirecciones de host', () => {
    vi.stubGlobal('URL', undefined);
    try {
      for (const endpoint of ['https://fcm.googleapis.com/fcm/send/token', 'https://updates.push.services.mozilla.com/wpush/v2/token', 'https://web.push.apple.com/token']) expect(validatePushEndpointText(endpoint)).toBe(endpoint);
      for (const endpoint of ['http://localhost/a', 'https://127.0.0.1/a', 'https://fcm.googleapis.com.evil.test/fcm/send/a', 'https://user@fcm.googleapis.com/fcm/send/a', 'https://fcm.googleapis.com:443/fcm/send/a', 'https://fcm.googleapis.com/fcm/send/a#fragment', 'https://fcm.googleapis.com/other/a']) expect(() => validatePushEndpointText(endpoint)).toThrow();
    } finally { vi.unstubAllGlobals(); }
  });
  it('sólo acepta rutas internas de la aplicación', () => { expect(notificationRoute('/m/avisos')).toBe('/m/avisos'); for (const route of ['https://evil.test', '//evil.test', '/m/%2f%2fevil.test']) expect(() => notificationRoute(route)).toThrow(); });
});
