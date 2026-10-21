import { describe, expect, it } from 'vitest';
import type { DbConnection } from '../module_bindings';
import type { Snapshot } from './types';
import { emptySnapshot } from './spacetimeSnapshot';
import { enrichNotificationsSnapshot } from './notificationSnapshot';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@b20/core';

const me = 'a'.repeat(64), other = 'b'.repeat(64);
const identity = (value: string) => ({ toHexString: () => value });
const at = new Date('2026-10-21T12:00:00Z'); const timestamp = { toDate: () => new Date(at) };
function base(id = me, status: 'active' | 'removed' = 'active'): Snapshot {
  return { ...emptySnapshot('connecting'), me: { id, status, displayName: 'Persona', isCreator: false, joinedAt: at } };
}
function connection(rows: Record<string, unknown[]>): Pick<DbConnection, 'db'> {
  return { db: new Proxy({}, { get(_target, key: string) { return { iter: () => (rows[key] ?? []).values() }; } }) } as unknown as Pick<DbConnection, 'db'>;
}
const preference = (member: string) => ({ ...DEFAULT_NOTIFICATION_PREFERENCES, memberId: identity(member), version: member === me ? 7 : 99 });
const notice = (member: string, id = 18_446_744_073_709_551_615n) => ({ id, memberId: identity(member), kind: 'direct_message', title: 'Nuevo mensaje privado', route: '/m/mensajes/directos/18446744073709551614', createdAt: timestamp, readAt: timestamp });

describe('adaptador privado de notificaciones', () => {
  it.each(['otra cuenta', 'cuenta inactiva', 'sin cuenta'])('borra todos los avisos y preferencias anteriores con %s sin leer la conexión', (scenario) => {
    const stale = { ...base(scenario === 'otra cuenta' ? other : me, scenario === 'cuenta inactiva' ? 'removed' : 'active'), notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, version: 5 }, notifications: [{ id: 'private-id', kind: 'test' as const, title: 'Aviso anterior', route: '/m/avisos', createdAt: at }], pushInstallations: [{ id: 'private-installation', label: 'Mío', enabled: true, createdAt: at, updatedAt: at }] };
    if (scenario === 'sin cuenta') stale.me = undefined;
    const unsafeConnection = new Proxy({}, { get() { throw new Error('No debe leer una conexión de otra sesión'); } }) as Pick<DbConnection, 'db'>;
    const result = enrichNotificationsSnapshot(unsafeConnection, stale, me);
    expect(result.notifications).toEqual([]); expect(result.pushInstallations).toEqual([]); expect(result.notificationPreferences).toBeUndefined(); expect(JSON.stringify(result)).not.toContain('private-');
  });
  it('sólo incorpora preferencias y avisos del miembro actual aun con filas antiguas en caché', () => {
    const result = enrichNotificationsSnapshot(connection({ myNotificationPreferences: [preference(other), preference(me)], myNotifications: [notice(other), notice(me)] }), base(), me);
    expect(result.notificationPreferences?.version).toBe(7); expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]?.id).toBe('18446744073709551615'); expect(result.notifications[0]?.route).toBe('/m/mensajes/directos/18446744073709551614');
    expect(result.notifications[0]?.createdAt).toEqual(at); expect(result.notifications[0]?.readAt).toEqual(at);
  });
  it('construye DTO por lista permitida sin filtrar endpoint ni claves de transporte', () => {
    const credentials = { endpoint: 'https://fcm.googleapis.com/fcm/send/private-endpoint', p256dh: 'private-public-key', auth: 'private-auth-secret' };
    const result = enrichNotificationsSnapshot(connection({ myNotificationPreferences: [{ ...preference(me), ...credentials }], myNotifications: [{ ...notice(me), ...credentials, text: 'Texto privado que no pertenece al DTO' }],
      myPushInstallations: [{ id: 'install-1', label: 'Teléfono', enabled: true, createdAt: timestamp, updatedAt: timestamp, ...credentials }] }), base(), me);
    expect(result.pushInstallations).toEqual([{ id: 'install-1', label: 'Teléfono', enabled: true, createdAt: at, updatedAt: at }]);
    const serialized = JSON.stringify(result); for (const secret of [...Object.values(credentials), 'endpoint', 'p256dh', 'auth', 'Texto privado']) expect(serialized).not.toContain(secret);
  });
  it('rechaza destinos externos y categorías desconocidas en vez de mostrarlos', () => {
    expect(() => enrichNotificationsSnapshot(connection({ myNotifications: [{ ...notice(me), route: 'https://external.example/private' }] }), base(), me)).toThrow('Destino');
    expect(() => enrichNotificationsSnapshot(connection({ myNotifications: [{ ...notice(me), kind: 'future_unknown_kind' }] }), base(), me)).toThrow('Actualiza');
  });
});
