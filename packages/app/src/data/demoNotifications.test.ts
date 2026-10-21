import { describe, expect, it } from 'vitest';
import { DemoDataSource, createDemoState } from './demo';
import { DemoNotificationsStore } from './demoNotifications';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../../core/src/notifications';
const now = new Date('2026-10-21T16:00:00Z');
const install = { id: '10000000-0000-4000-8000-000000000001', label: 'Teléfono', endpoint: 'https://fcm.googleapis.com/fcm/send/example', p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) };
function fixture() {
  const state = createDemoState(now); let viewer = 'demo-2'; let sequence = 99999;
  const source = () => new DemoDataSource(state, viewer, () => now);
  const base = () => { const data = source(); try { return data.getSnapshot(); } finally { data.dispose(); } };
  const store = () => new DemoNotificationsStore({ state: () => state, active: () => state.members.find((row) => row.id === viewer)!, current: base, now: () => now, id: () => String(sequence++), emit() {} });
  return { store, base, as: (id: string) => { viewer = id; } };
}
describe('notificaciones privadas de demostración', () => {
  it('persisten entre instancias de la misma comunidad y nunca se exponen a un tercero', () => {
    const state = fixture(); const first = state.store(); first.requestNotificationTest(); const second = state.store(); expect(second.snapshot(state.base()).notifications).toHaveLength(1); first.dispose(); expect(second.snapshot(state.base()).notifications).toHaveLength(1);
    state.as('demo-1'); expect(second.snapshot(state.base()).notifications).toHaveLength(0);
  });
  it('oculta endpoint y claves del snapshot de la propia instalación', () => {
    const state = fixture(); const store = state.store(); store.registerPushInstallation(install); const snapshot = store.snapshot(state.base()); expect(snapshot.pushInstallations).toHaveLength(1); expect(JSON.stringify(snapshot)).not.toContain(install.endpoint); expect(JSON.stringify(snapshot)).not.toContain(install.auth);
    state.as('demo-3'); expect(store.snapshot(state.base()).pushInstallations).toHaveLength(0); expect(() => store.removePushInstallation(install.id)).toThrow('disponible');
  });
  it('las preferencias son privadas, versionadas y categorías desactivadas no crean avisos', () => {
    const state = fixture(); const store = state.store(); store.saveNotificationPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, enabledKinds: [] }); store.requestNotificationTest(); expect(store.snapshot(state.base()).notifications).toHaveLength(0); expect(() => store.saveNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES)).toThrow('cambiaron');
    state.as('demo-3'); expect(store.snapshot(state.base()).notificationPreferences?.enabledKinds).toContain('test');
  });
  it('deduplica y sólo el propietario marca avisos leídos', () => {
    const state = fixture(); const store = state.store(); store.requestNotificationTest(); store.requestNotificationTest(); const notice = store.snapshot(state.base()).notifications[0]!; expect(store.snapshot(state.base()).notifications).toHaveLength(1);
    state.as('demo-3'); expect(() => store.markNotificationRead(notice.id)).toThrow(); state.as('demo-2'); store.markNotificationRead(notice.id); expect(store.snapshot(state.base()).notifications[0]?.readAt).toEqual(now);
  });
});

describe('integración de avisos en dos vistas de la comunidad', () => {
  it('el DM aparece una vez para el destinatario y una lectura lo descuenta sin exponer texto', () => {
    const state = createDemoState(now); const author = new DemoDataSource(state, 'demo-2', () => now); const recipient = new DemoDataSource(state, 'demo-3', () => now); const admin = new DemoDataSource(state, 'demo-1', () => now);
    try {
      let emissions = 0; const unsubscribe = author.subscribe(() => { emissions++; }); const before = emissions;
      const id = author.sendDirectMessage('c1', 'Este texto jamás debe viajar en push');
      expect(emissions - before).toBe(1); const notifications = recipient.getSnapshot().notifications; expect(notifications).toHaveLength(1); expect(JSON.stringify(notifications)).not.toContain('jamás'); expect(admin.getSnapshot().notifications).toHaveLength(0);
      recipient.markConversationRead('direct', 'c1', id); expect(recipient.getSnapshot().notifications.filter((row) => !row.readAt)).toHaveLength(0);
      const next = author.sendDirectMessage('c1', 'mensaje nuevo en el mismo milisegundo'); expect(next).not.toBe(id); expect(recipient.getSnapshot().notifications.filter((row) => !row.readAt)).toHaveLength(1); unsubscribe();
    } finally { author.dispose(); recipient.dispose(); admin.dispose(); }
  });
  it('un silencio y un bloqueo no generan avisos posteriores', () => {
    const state = createDemoState(now); const author = new DemoDataSource(state, 'demo-2', () => now); const recipient = new DemoDataSource(state, 'demo-3', () => now);
    try {
      recipient.setConversationMuted('direct', 'c1', true); recipient.getSnapshot(); author.sendDirectMessage('c1', 'No avisar'); expect(recipient.getSnapshot().notifications.filter((row) => !row.readAt)).toHaveLength(0);
      recipient.setMemberBlocked('demo-2', true); recipient.getSnapshot(); expect(() => recipient.sendDirectMessage('c1', 'Bloqueado')).toThrow();
    } finally { author.dispose(); recipient.dispose(); }
  });
});
