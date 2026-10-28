import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) };
});
import './index';
import { authorizeNotification, claimNotifications, commitReminders, emitMessageNotifications, emitNotificationEvent, finishNotification, isNotificationService, markNotificationRead, readableNotification, registerPushInstallation, removePushInstallation, requestNotificationTest, saveNotificationPreferences, setNotificationService, sweepNotifications, suppressContentNotifications } from './notificationHandlers';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../core/src/notifications';
import type { Ctx } from './moduleContext';
const person = (digit: string) => Identity.fromString(digit.repeat(64));
const admin = person('a'), author = person('b'), peer = person('c'), service = person('d');
type Row = Record<string, unknown>;
const keyOf = (value: unknown): string => value && typeof value === 'object' && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function setup() {
  const initial: Record<string, Row[]> = { member: [admin, author, peer].map((identity) => ({ identity, status: 'active', isCreator: identity === admin })), appConfig: [{ id: 0, owner: admin }], notificationServiceConfig: [{ id: 0, identity: service, enabled: true }], authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }] };
  const keys: Record<string, string> = { member: 'identity', birthday: 'identity', notificationPreference: 'memberId', notificationReminderCursor: 'memberId', notificationEvent: 'key', notificationDelivery: 'id', conversationState: 'key', memberBlock: 'key', roomMember: 'key' };
  const all = new Map<string, Row[]>(); let next = 1n;
  const rows = (name: string) => { if (!all.has(name)) all.set(name, initial[name] ?? []); return all.get(name)!; };
  const db = new Proxy({}, { get(_target, name: string) { const table = rows(name); const primary = keys[name] ?? 'id'; return new Proxy({ iter: () => table.values(), insert: (value: Row) => { const row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) }; table.push(row); return row; } }, { get(target, field: string) {
    if (field in target) return target[field as keyof typeof target];
    return { find: (value: unknown) => table.find((row) => keyOf(row[field]) === keyOf(value)), filter: (value: unknown) => table.filter((row) => keyOf(row[field]) === keyOf(value)), update: (row: Row) => { const index = table.findIndex((old) => keyOf(old[primary]) === keyOf(row[primary])); if (index < 0) throw new Error(`Missing ${name}`); table[index] = { ...row }; return row; }, delete: (value: unknown) => { const index = table.findIndex((row) => keyOf(row[field]) === keyOf(value)); if (index >= 0) table.splice(index, 1); } };
  } }); } });
  const state = { db, sender: author, timestamp: new Timestamp(BigInt(Date.parse('2026-10-21T16:00:00Z')) * 1000n), env: {} as Record<string, string>, senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'local@example.com', email_verified: true } } } };
  return { ctx: state as unknown as Ctx, rows, env: state.env, as: (sender: Identity) => { state.sender = sender; }, tick: (seconds: number) => { state.timestamp = new Timestamp(state.timestamp.microsSinceUnixEpoch + BigInt(seconds) * 1_000_000n); } };
}
const installation = { id: '10000000-0000-4000-8000-000000000001', label: 'Mi teléfono', endpoint: 'https://fcm.googleapis.com/fcm/send/example', p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) };
const lease = '20000000-0000-4000-8000-000000000001';
function pushSetup() { const state = setup(); saveNotificationPreferences(state.ctx, { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true }); registerPushInstallation(state.ctx, installation); requestNotificationTest(state.ctx); state.as(service); return state; }
describe('bandeja privada y cola de notificaciones', () => {
  it('materializa inmediatamente sin Worker ni push, con deduplicación', () => {
    const { ctx, rows } = setup(); requestNotificationTest(ctx); requestNotificationTest(ctx); expect(rows('notification')).toHaveLength(1); expect(rows('notificationDelivery')).toHaveLength(0);
    expect(rows('notification')[0]?.route).toBe('/m/avisos'); expect(readableNotification(ctx.db, peer, rows('notification')[0] as never)).toBe(false);
  });
  it('requiere versión de preferencias y rechaza una zona inválida', () => {
    const { ctx } = setup(); saveNotificationPreferences(ctx, DEFAULT_NOTIFICATION_PREFERENCES);
    expect(() => saveNotificationPreferences(ctx, DEFAULT_NOTIFICATION_PREFERENCES)).toThrow('cambiaron');
    expect(() => saveNotificationPreferences(ctx, { ...DEFAULT_NOTIFICATION_PREFERENCES, expectedVersion: 1, timeZone: 'Invalid/Zone' })).toThrow('IANA');
  });
  it('no permite que usuarios normales reclamen colas ni registren servicios compartidos', () => {
    const { ctx, as, rows } = setup(); expect(() => claimNotifications(ctx, { leaseId: lease, limit: 8 })).toThrow('servicio'); as(admin);
    rows('fileServiceConfig').push({ id: 0, identity: service }); expect(() => setNotificationService(ctx, { identity: service, enabled: true })).toThrow('exclusiva');
    expect(() => setNotificationService(ctx, { identity: author, enabled: true })).toThrow('exclusiva');
  });
  it('impide apropiarse de una instalación y reactivarla excediendo el límite', () => {
    const { ctx, as } = setup(); registerPushInstallation(ctx, installation); removePushInstallation(ctx, installation.id);
    for (let i = 2; i <= 6; i++) registerPushInstallation(ctx, { ...installation, id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`, endpoint: installation.endpoint + i });
    expect(() => registerPushInstallation(ctx, installation)).toThrow('cinco'); as(peer); expect(() => removePushInstallation(ctx, installation.id)).toThrow('disponible');
    expect(() => registerPushInstallation(ctx, { ...installation, endpoint: 'https://localhost/private' })).toThrow();
  });
  it('sólo los participantes reciben DMs y el aviso nunca contiene el texto', () => {
    const { ctx, rows, as } = setup(); rows('directConversation').push({ id: 7n, userA: author, userB: peer }); rows('directMessage').push({ id: 9n, conversationId: 7n, sender: author, text: 'secreto privado' });
    emitMessageNotifications(ctx, 'direct', 9n); expect(rows('notification')).toHaveLength(1); expect(rows('notification')[0]?.memberId).toEqual(peer); expect(JSON.stringify(rows('notification'), (_k, v) => typeof v === 'bigint' ? String(v) : v)).not.toContain('secreto');
    expect(readableNotification(ctx.db, admin, rows('notification')[0] as never)).toBe(false); as(admin); expect(() => markNotificationRead(ctx, rows('notification')[0]!.id as bigint)).toThrow('disponible');
  });
  it.each(['block', 'read', 'mute'])('revalida %s antes de enviar un DM', (reason) => {
    const { ctx, rows, as } = setup(); as(peer); saveNotificationPreferences(ctx, { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true }); registerPushInstallation(ctx, installation); as(author);
    rows('directConversation').push({ id: 7n, userA: author, userB: peer }); rows('directMessage').push({ id: 9n, conversationId: 7n, sender: author, text: 'hola' }); emitMessageNotifications(ctx, 'direct', 9n); as(service);
    const claim = claimNotifications(ctx, { leaseId: lease, limit: 8 }); expect(claim.jobs).toHaveLength(1);
    if (reason === 'block') rows('memberBlock').push({ key: `${author.toHexString()}:${peer.toHexString()}` });
    else rows('conversationState').push({ key: `${peer.toHexString()}:direct:7`, muted: reason === 'mute', readThroughId: reason === 'read' ? 9n : undefined });
    expect(authorizeNotification(ctx, { jobId: claim.jobs[0]!.jobId, leaseId: lease })).toBe(false);
  });
  it('un lease en curso no se roba y su reintento usa el mismo trabajo', () => {
    const { ctx, tick } = pushSetup(); const first = claimNotifications(ctx, { leaseId: lease, limit: 8 }); const other = '30000000-0000-4000-8000-000000000001';
    expect(claimNotifications(ctx, { leaseId: other, limit: 8 }).jobs).toHaveLength(0); expect(claimNotifications(ctx, { leaseId: lease, limit: 8 }).jobs[0]?.jobId).toBe(first.jobs[0]?.jobId);
    tick(301); expect(claimNotifications(ctx, { leaseId: other, limit: 8 }).jobs).toHaveLength(1);
  });
  it('una lectura o una baja de la instalación revoca un trabajo ya reclamado', () => {
    const state = pushSetup(); const job = claimNotifications(state.ctx, { leaseId: lease, limit: 8 }).jobs[0]!; state.as(author); removePushInstallation(state.ctx, installation.id); state.as(service);
    expect(authorizeNotification(state.ctx, { jobId: job.jobId, leaseId: lease })).toBe(false);
  });
  it('410 invalida la suscripción y los reintentos se espacian', () => {
    const { ctx, rows, tick } = pushSetup(); const job = claimNotifications(ctx, { leaseId: lease, limit: 8 }).jobs[0]!;
    finishNotification(ctx, { jobId: job.jobId, leaseId: lease, outcome: 'retry', retryAfterSeconds: 90 }); expect(claimNotifications(ctx, { leaseId: lease, limit: 8 }).jobs).toHaveLength(0); tick(91);
    expect(claimNotifications(ctx, { leaseId: lease, limit: 8 }).jobs).toHaveLength(1); finishNotification(ctx, { jobId: job.jobId, leaseId: lease, outcome: 'invalid' });
    expect(rows('pushInstallation')[0]?.enabled).toBe(false); expect(rows('pushInstallation')[0]?.endpoint).toBe('');
  });
  it('deja de recordar una tarea completada antes de enviar el push', () => {
    const state = pushSetup(); state.rows('notification').splice(0); state.rows('notificationDelivery').splice(0); state.rows('assignment').push({ id: 77n, dueDate: '2026-10-21', createdAt: state.ctx.timestamp });
    commitReminders(state.ctx, { memberId: author.toHexString(), day: '2026-10-21', startAt: Date.parse('2026-10-21T00:00:00Z'), endAt: Date.parse('2026-10-22T00:00:00Z') });
    const job = claimNotifications(state.ctx, { leaseId: lease, limit: 8 }).jobs[0]!; expect(job).toBeDefined(); state.rows('personalProgress').push({ owner: author, targetKind: 'assignment', targetId: 77n, status: 'done' });
    expect(authorizeNotification(state.ctx, { jobId: job.jobId, leaseId: lease })).toBe(false);
  });
  it('agota cinco intentos y nunca consume intentos durante el descanso', () => {
    const { ctx, rows, tick } = pushSetup(); let job = claimNotifications(ctx, { leaseId: lease, limit: 8 }).jobs[0]!;
    finishNotification(ctx, { jobId: job.jobId, leaseId: lease, outcome: 'deferred', retryAfterSeconds: 60 }); expect(rows('notificationDelivery')[0]?.attempts).toBe(0); tick(61);
    for (let attempt = 1; attempt <= 5; attempt++) { job = claimNotifications(ctx, { leaseId: lease, limit: 8 }).jobs[0]!; expect(job).toBeDefined(); finishNotification(ctx, { jobId: job.jobId, leaseId: lease, outcome: 'retry' }); tick(1000); }
    expect(rows('notificationDelivery')[0]?.status).toBe('failed'); expect(claimNotifications(ctx, { leaseId: lease, limit: 8 }).jobs).toHaveLength(0);
  });
  it('un 410 antiguo no elimina la suscripción renovada durante el envío', () => {
    const state = pushSetup(); const job = claimNotifications(state.ctx, { leaseId: lease, limit: 8 }).jobs[0]!; state.tick(1); state.as(author); registerPushInstallation(state.ctx, { ...installation, endpoint: installation.endpoint + 'new' }); state.as(service);
    finishNotification(state.ctx, { jobId: job.jobId, leaseId: lease, outcome: 'invalid' }); expect(state.rows('pushInstallation')[0]?.enabled).toBe(true);
  });
  it('los eventos grandes persisten un cursor y completan el fanout sin duplicar', () => {
    const { ctx, rows, as } = setup(); const ids = Array.from({ length: 105 }, (_, i) => Identity.fromString((i + 100).toString(16).padStart(64, '0'))); rows('member').push(...ids.map((identity) => ({ identity, status: 'active' })));
    rows('assignment').push({ id: 22n }); emitNotificationEvent(ctx, { eventKey: 'due:22:1', kind: 'due_change', sourceKind: 'assignment', sourceId: 22n, route: '/m/tareas/22', recipientIds: ids });
    expect(rows('notification')).toHaveLength(100); as(service); sweepNotifications(ctx); expect(rows('notification')).toHaveLength(105); sweepNotifications(ctx); expect(rows('notification')).toHaveLength(105);
  });
  it('retirar contenido cancela fanout y envíos pendientes de forma terminal aunque se restaure', () => {
    const { ctx, rows, as } = setup();
    rows('notificationEvent').push({ key: 'group-message:7', sourceKind: 'group_message', sourceId: '7', recipientIds: [author, peer], cursor: 1, completed: false });
    rows('notification').push({ id: 50n, sourceKind: 'group_message', sourceId: '7', dedupeKey: `${author.toHexString()}:group-message:7` });
    rows('notificationDelivery').push(...['pending', 'leased', 'sent'].map((status, index) => ({ id: `delivery-${index}`, notificationId: 50n, status, leaseId: lease, leaseUntil: ctx.timestamp })));
    suppressContentNotifications(ctx, 'group_message', 7n);
    expect(rows('notificationEvent')[0]).toMatchObject({ completed: true, cursor: 2 });
    expect(rows('notificationDelivery').map(row => row.status)).toEqual(['cancelled', 'cancelled', 'sent']);
    as(service); sweepNotifications(ctx);
    expect(rows('notification')).toHaveLength(1);
    expect(claimNotifications(ctx, { leaseId: lease, limit: 8 }).jobs).toHaveLength(0);
  });

  it('permite avisar de una invitación privada sin conceder acceso a otros miembros', () => {
    const { ctx, rows } = setup(); rows('studyRoom').push({ id: 8n, visibility: 'private', organizer: peer, status: 'scheduled' }); rows('roomMember').push({ key: `8:${author.toHexString()}`, status: 'invited' });
    expect(readableNotification(ctx.db, author, { memberId: author, sourceKind: 'room', sourceId: '8' })).toBe(true); expect(readableNotification(ctx.db, admin, { memberId: admin, sourceKind: 'room', sourceId: '8' })).toBe(false);
  });
  it('guarda cumpleaños sin año, omite tareas terminadas y avanza sólo al día contiguo', () => {
    const { ctx, as, rows } = setup(); rows('birthday').push({ identity: peer, month: 10, day: 21, remind: true, sharedAt: ctx.timestamp }); rows('assignment').push({ id: 22n, dueDate: '2026-10-21', createdAt: ctx.timestamp }); rows('personalProgress').push({ owner: author, targetKind: 'assignment', targetId: 22n, status: 'done' }); as(service);
    const day = { memberId: author.toHexString(), day: '2026-10-21', startAt: Date.parse('2026-10-21T00:00:00Z'), endAt: Date.parse('2026-10-22T00:00:00Z') };
    expect(commitReminders(ctx, day)).toEqual({ complete: true, created: 1 }); expect(commitReminders(ctx, day).created).toBe(0); expect(rows('notification')[0]?.kind).toBe('birthday');
    expect(() => commitReminders(ctx, { ...day, day: '2026-10-23' })).toThrow('siguiente');
    rows('birthday')[0]!.day = 22; expect(commitReminders(ctx, { ...day, day: '2026-10-22', startAt: Date.parse('2026-10-22T00:00:00Z'), endAt: Date.parse('2026-10-23T00:00:00Z') }).created).toBe(0);
    rows('birthday')[0]!.remind = false; expect(readableNotification(ctx.db, author, rows('notification')[0] as never)).toBe(false);
  });
});


describe('aislamiento de la identidad técnica de notificaciones', () => {
  it.each(['B20_FILE_SERVICE_IDENTITY', 'B20_MAINTENANCE_IDENTITY'])('rechaza registrar una identidad compartida por %s aunque no haya fila de servicio', (name) => {
    const { ctx, as, env, rows } = setup(); as(admin); env[name] = `  0x${service.toHexString().toUpperCase()}  `;
    expect(rows(name === 'B20_FILE_SERVICE_IDENTITY' ? 'fileServiceConfig' : 'maintenanceService')).toHaveLength(0);
    expect(() => setNotificationService(ctx, { identity: service, enabled: true })).toThrow('exclusiva');
  });
  it.each(['fileServiceConfig', 'aiServiceConfig', 'maintenanceService'])('rechaza registrar una identidad ya reservada en %s, aunque esté deshabilitada', (table) => {
    const { ctx, as, rows } = setup(); as(admin); rows(table).push({ id: 0, identity: service, enabled: false });
    expect(() => setNotificationService(ctx, { identity: service, enabled: true })).toThrow('exclusiva');
  });
  it.each(['owner', 'member', 'removed_member', 'fileServiceConfig', 'aiServiceConfig', 'maintenanceService', 'B20_FILE_SERVICE_IDENTITY', 'B20_MAINTENANCE_IDENTITY'])('revoca el servicio cuando aparece un conflicto posterior con %s', (conflict) => {
    const { ctx, as, rows, env } = setup(); as(admin); setNotificationService(ctx, { identity: service, enabled: true }); as(service);
    expect(isNotificationService(ctx)).toBe(true); expect(claimNotifications(ctx, { leaseId: lease, limit: 8 }).jobs).toHaveLength(0);
    if (conflict === 'owner') rows('appConfig')[0]!.owner = service;
    else if (conflict === 'member' || conflict === 'removed_member') rows('member').push({ identity: service, status: conflict === 'member' ? 'active' : 'removed' });
    else if (conflict.startsWith('B20_')) env[conflict] = `0x${service.toHexString().toUpperCase()}`;
    else rows(conflict).push({ id: 0, identity: service, enabled: false });
    expect(isNotificationService(ctx)).toBe(false);
    expect(() => claimNotifications(ctx, { leaseId: lease, limit: 8 })).toThrow('servicio');
    expect(() => sweepNotifications(ctx)).toThrow('servicio');
    expect(() => authorizeNotification(ctx, { jobId: 'private', leaseId: lease })).toThrow('servicio');
  });
  it('permite renovar una configuración exclusiva sin conceder autoridad a otra identidad', () => {
    const { ctx, as } = setup(); as(admin); setNotificationService(ctx, { identity: service, enabled: true }); as(service); expect(isNotificationService(ctx)).toBe(true);
    as(author); expect(isNotificationService(ctx)).toBe(false); expect(() => setNotificationService(ctx, { identity: service, enabled: true })).toThrow('exclusiva');
  });
});
