import { Identity, Timestamp } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { activeMember, isActive, type Ctx, type ViewDb } from './moduleContext';
import { canReadTarget, withdrawn } from './delivery2Handlers';
import { addLocalDays, birthdayOnLocalDay, DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_KINDS, NOTIFICATION_TITLES, notificationPreferences, notificationRetrySeconds, notificationRoute, validLocalDay, validPushKeys, validatePushEndpointText, type NotificationKind, type NotificationPreferencesInput } from '../../core/src/notifications';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const now = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
const at = (value: number) => new Timestamp(BigInt(Math.floor(value)) * 1000n);
const hex = (identity: Identity) => identity.toHexString();
type InboxRow = NonNullable<ReturnType<Ctx['db']['notification']['id']['find']>>;
type EventRow = NonNullable<ReturnType<Ctx['db']['notificationEvent']['key']['find']>>;
const text = (value: string, max: number) => { const result = value.trim(); if (!result || result.length > max) throw new SenderError('Datos de notificación inválidos.'); return result; };
function exclusiveNotificationIdentity(ctx: Ctx, identity: Identity): boolean {
  const environmentIdentity = (value: string | undefined) => value?.trim().replace(/^0x/i, '').toLowerCase();
  return !ctx.db.appConfig.id.find(0)?.owner.isEqual(identity)
    && !ctx.db.fileServiceConfig.id.find(0)?.identity.isEqual(identity)
    && !ctx.db.aiServiceConfig.id.find(0)?.identity.isEqual(identity)
    && !ctx.db.maintenanceService.id.find(0)?.identity.isEqual(identity)
    && !ctx.db.member.identity.find(identity)
    && environmentIdentity(ctx.env.B20_FILE_SERVICE_IDENTITY) !== hex(identity)
    && environmentIdentity(ctx.env.B20_MAINTENANCE_IDENTITY) !== hex(identity);
}
export function isNotificationService(ctx: Ctx): boolean {
  return ctx.db.notificationServiceConfig.id.find(0)?.identity.isEqual(ctx.sender) === true && exclusiveNotificationIdentity(ctx, ctx.sender);
}
function service(ctx: Ctx) { if (!isNotificationService(ctx) || !ctx.db.notificationServiceConfig.id.find(0)?.enabled) throw new SenderError('El servicio de notificaciones no está habilitado.'); }
export function preferencesFor(db: ViewDb, memberId: Identity) { return db.notificationPreference.memberId.find(memberId) ?? { ...DEFAULT_NOTIFICATION_PREFERENCES, enabledKinds: [...DEFAULT_NOTIFICATION_PREFERENCES.enabledKinds], version: 0 }; }
export function setNotificationService(ctx: Ctx, input: { identity: Identity; enabled: boolean }) {
  if (!ctx.db.appConfig.id.find(0)?.owner.isEqual(ctx.sender) || !exclusiveNotificationIdentity(ctx, input.identity)) throw new SenderError('Configura una identidad técnica exclusiva para las notificaciones.');
  const row = { id: 0, ...input }; if (ctx.db.notificationServiceConfig.id.find(0)) ctx.db.notificationServiceConfig.id.update(row); else ctx.db.notificationServiceConfig.insert(row);
}
export function saveNotificationPreferences(ctx: Ctx, input: NotificationPreferencesInput) {
  activeMember(ctx); let fields: NotificationPreferencesInput;
  try { fields = notificationPreferences(input); } catch (error) { throw new SenderError((error as Error).message); }
  const previous = ctx.db.notificationPreference.memberId.find(ctx.sender);
  if ((input.expectedVersion ?? 0) !== (previous?.version ?? 0)) throw new SenderError('Las preferencias cambiaron. Actualiza antes de guardar.');
  const { expectedVersion: _expected, ...preferences } = fields;
  const row = { memberId: ctx.sender, ...preferences, version: (previous?.version ?? 0) + 1, updatedAt: ctx.timestamp };
  if (previous) ctx.db.notificationPreference.memberId.update(row); else ctx.db.notificationPreference.insert(row);
  if (previous?.timeZone !== row.timeZone) ctx.db.notificationReminderCursor.memberId.delete(ctx.sender);
}
export function registerPushInstallation(ctx: Ctx, input: { id: string; label: string; endpoint: string; p256dh: string; auth: string }) {
  activeMember(ctx);
  if (!UUID.test(input.id) || !validPushKeys(input.p256dh, input.auth)) throw new SenderError('Suscripción push inválida.');
  try { validatePushEndpointText(input.endpoint); } catch (error) { throw new SenderError((error as Error).message); }
  const previous = ctx.db.pushInstallation.id.find(input.id);
  if (previous && !previous.memberId.isEqual(ctx.sender)) throw new SenderError('La instalación no está disponible.');
  if (!previous?.enabled && [...ctx.db.pushInstallation.memberId.filter(ctx.sender)].filter((row) => row.enabled).length >= 5) throw new SenderError('El máximo es de cinco instalaciones activas por cuenta.');
  if ([...ctx.db.pushInstallation.iter()].some((row) => row.endpoint === input.endpoint && !row.memberId.isEqual(ctx.sender) && row.enabled)) throw new SenderError('Elimina la suscripción anterior de esta instalación antes de cambiar de cuenta.');
  const row = { ...input, label: text(input.label, 80), memberId: ctx.sender, enabled: true, createdAt: previous?.createdAt ?? ctx.timestamp, updatedAt: ctx.timestamp };
  if (previous) ctx.db.pushInstallation.id.update(row); else ctx.db.pushInstallation.insert(row);
}
export function removePushInstallation(ctx: Ctx, installationId: string) {
  activeMember(ctx); const row = ctx.db.pushInstallation.id.find(installationId);
  if (!row || !row.memberId.isEqual(ctx.sender)) throw new SenderError('La instalación no está disponible.');
  ctx.db.pushInstallation.id.update({ ...row, enabled: false, endpoint: '', p256dh: '', auth: '', updatedAt: ctx.timestamp });
}
function birthdayReadable(db: ViewDb, sender: Identity, id: string) {
  if (!/^[a-f0-9]{64}$/i.test(id)) return false;
  const person = Identity.fromString(id); return isActive(db, sender) && isActive(db, person) && db.birthday.identity.find(person)?.remind === true;
}
export function readableNotification(db: ViewDb, sender: Identity, row: Pick<InboxRow, 'memberId' | 'sourceKind' | 'sourceId'>): boolean {
  if (!row.memberId.isEqual(sender) || !isActive(db, sender)) return false;
  if (row.sourceKind === 'test') return row.sourceId === hex(sender);
  if (row.sourceKind === 'birthday') return birthdayReadable(db, sender, row.sourceId);
  if (!/^[1-9]\d{0,19}$/.test(row.sourceId)) return false;
  const id = BigInt(row.sourceId);
  if (row.sourceKind === 'room') { const room = db.studyRoom.id.find(id); const membership = db.roomMember.key.find(`${id}:${hex(sender)}`); return !!room && room.status !== 'cancelled' && (room.visibility === 'group' || room.organizer.isEqual(sender) || membership?.status === 'joined' || membership?.status === 'invited'); }
  if (row.sourceKind === 'poll') { const poll = db.poll.id.find(id); return !!poll && !poll.cancelledAt && poll.eligible.some((person) => person.isEqual(sender)); }
  if (row.sourceKind === 'spaced_review') {
    const collection = db.spacedCollection.id.find(id); return !!collection && !collection.archived && (collection.visibility === 'group' || collection.ownerId.isEqual(sender)) && [...db.spacedEnrollment.memberId.filter(sender)].some((enrollment) => enrollment.collectionId === id && enrollment.active);
  }
  return canReadTarget(db, sender, row.sourceKind, id);
}
function blocked(db: ViewDb, actor: Identity, member: Identity) { return !!db.memberBlock.key.find(`${hex(actor)}:${hex(member)}`) || !!db.memberBlock.key.find(`${hex(member)}:${hex(actor)}`); }
function eligible(db: ViewDb, row: InboxRow): boolean {
  if (row.readAt || !readableNotification(db, row.memberId, row)) return false;
  const prefs = preferencesFor(db, row.memberId);
  if (!prefs.enabledKinds.some((kind) => kind === row.kind)) return false;
  if (row.kind === 'assignment_reminder' || row.kind === 'activity_reminder') {
    if ([...db.personalProgress.owner.filter(row.memberId)].some((progress) => progress.targetKind === row.sourceKind && String(progress.targetId) === row.sourceId && progress.status === 'done')) return false;
  }
  if (row.reminderDay && row.sourceKind === 'room' && db.studyRoom.id.find(BigInt(row.sourceId))?.status === 'completed') return false;
  if (row.actor && blocked(db, row.actor, row.memberId) && (row.kind === 'direct_message' || row.kind === 'mention')) return false;
  if (row.conversationScope) {
    const state = db.conversationState.key.find(`${hex(row.memberId)}:${row.conversationScope}:${row.conversationId}`);
    if (state?.muted || (row.messageId !== undefined && state?.readThroughId !== undefined && state.readThroughId >= row.messageId)) return false;
  }
  return true;
}
export function markNotificationRead(ctx: Ctx, notificationId?: bigint) {
  activeMember(ctx);
  const rows = notificationId === undefined ? [...ctx.db.notification.memberId.filter(ctx.sender)] : [ctx.db.notification.id.find(notificationId)];
  if (notificationId !== undefined && (!rows[0] || !rows[0].memberId.isEqual(ctx.sender))) throw new SenderError('La notificación no está disponible.');
  for (const row of rows) if (row && !row.readAt) ctx.db.notification.id.update({ ...row, readAt: ctx.timestamp });
}
export interface NotificationEventInput {
  eventKey: string; kind: NotificationKind; sourceKind: string; sourceId: string | bigint;
  route: string; recipientIds?: Identity[]; actor?: Identity; conversationScope?: string; conversationId?: string; messageId?: bigint;
}
export function emitNotificationEvent(ctx: Ctx, input: NotificationEventInput) {
  if (!/^[A-Za-z0-9:_-]{1,180}$/.test(input.eventKey) || !(NOTIFICATION_KINDS as readonly string[]).includes(input.kind)) throw new SenderError('Evento de notificación inválido.');
  notificationRoute(input.route);
  if (ctx.db.notificationEvent.key.find(input.eventKey)) return;
  const ids = input.recipientIds ?? [...ctx.db.member.iter()].filter((member) => member.status === 'active').map((member) => member.identity);
  const unique = [...new Map(ids.filter((person) => !input.actor?.isEqual(person)).map((person) => [hex(person), person])).values()];
  const saved = ctx.db.notificationEvent.insert({ key: input.eventKey, kind: input.kind, route: input.route, sourceKind: input.sourceKind, sourceId: String(input.sourceId), recipientIds: unique, actor: input.actor, cursor: 0, conversationScope: input.conversationScope ?? '', conversationId: input.conversationId ?? '', messageId: input.messageId, createdAt: ctx.timestamp, completed: unique.length === 0 });
  const cursor = Math.min(100, unique.length);
  for (const recipient of unique.slice(0, cursor)) materialize(ctx, saved, recipient);
  ctx.db.notificationEvent.key.update({ ...saved, cursor, completed: cursor >= unique.length });
}
function materialize(ctx: Ctx, event: Pick<EventRow, 'key' | 'kind' | 'route' | 'sourceKind' | 'sourceId' | 'actor' | 'conversationScope' | 'conversationId' | 'messageId'>, memberId: Identity, reminderDay = '', pushAllowed = true) {
  const dedupeKey = `${hex(memberId)}:${event.key}`;
  if (ctx.db.notification.dedupeKey.find(dedupeKey)) return;
  const row = { id: 0n, memberId, dedupeKey, kind: event.kind, title: NOTIFICATION_TITLES[event.kind as NotificationKind], route: event.route, sourceKind: event.sourceKind, sourceId: event.sourceId, actor: event.actor, conversationScope: event.conversationScope, conversationId: event.conversationId, messageId: event.messageId, createdAt: ctx.timestamp, readAt: undefined, reminderDay };
  if (!eligible(ctx.db, row)) return;
  const saved = ctx.db.notification.insert(row);
  if (pushAllowed && preferencesFor(ctx.db, memberId).pushEnabled) for (const installation of ctx.db.pushInstallation.memberId.filter(memberId)) if (installation.enabled) {
    ctx.db.notificationDelivery.insert({ id: `${saved.id}:${installation.id}`, notificationId: saved.id, installationId: installation.id, memberId, status: 'pending', attempts: 0, nextAttemptAt: ctx.timestamp, leaseId: '', leaseUntil: undefined, installationUpdatedAt: undefined });
  }
}
export function emitMessageNotifications(ctx: Ctx, scope: 'group' | 'direct' | 'channel', messageId: bigint) {
  const message = scope === 'group' ? ctx.db.groupMessage.id.find(messageId) : scope === 'direct' ? ctx.db.directMessage.id.find(messageId) : ctx.db.channelMessage.id.find(messageId);
  if (!message || message.deletedAt) return;
  const direct = scope === 'direct' ? ctx.db.directMessage.id.find(messageId) : undefined;
  const channel = scope === 'channel' ? ctx.db.channelMessage.id.find(messageId) : undefined;
  const conversationId = direct?.conversationId.toString() ?? channel?.channelId.toString() ?? 'general';
  const route = scope === 'direct' ? `/m/mensajes/directos/${conversationId}` : scope === 'channel' ? `/m/mensajes/canales/${conversationId}` : '/m/mensajes';
  const mentioned = [...message.text.matchAll(/\[\[mencion:([a-f0-9]{64})\]\]/gi)].map((match) => Identity.fromString(match[1]));
  const base = { sourceKind: `${scope}_message`, sourceId: messageId, route, actor: message.sender, conversationScope: scope, conversationId, messageId };
  if (direct) {
    const chat = ctx.db.directConversation.id.find(direct.conversationId); if (!chat) return;
    emitNotificationEvent(ctx, { ...base, eventKey: `message:${scope}:${messageId}`, kind: mentioned.some((person) => !person.isEqual(message.sender)) ? 'mention' : 'direct_message', recipientIds: [chat.userA, chat.userB] });
  } else if (mentioned.length) emitNotificationEvent(ctx, { ...base, eventKey: `mention:${scope}:${messageId}`, kind: 'mention', recipientIds: mentioned });
}
export function suppressConversationNotifications(ctx: Ctx, scope: string, conversationId: string) {
  for (const row of ctx.db.notification.memberId.filter(ctx.sender)) if (row.conversationScope === scope && row.conversationId === conversationId && !eligible(ctx.db, row) && !row.readAt) ctx.db.notification.id.update({ ...row, readAt: ctx.timestamp });
}
export function requestNotificationTest(ctx: Ctx) {
  activeMember(ctx); const key = `test:${hex(ctx.sender)}:${ctx.timestamp.microsSinceUnixEpoch / 60_000_000n}`;
  materialize(ctx, { key, kind: 'test', route: '/m/avisos', sourceKind: 'test', sourceId: hex(ctx.sender), actor: undefined, conversationScope: '', conversationId: '', messageId: undefined }, ctx.sender);
}
export function sweepNotifications(ctx: Ctx, limit = 100) {
  service(ctx); let budget = Math.max(1, Math.min(100, limit)); let count = 0;
  for (const row of ctx.db.notificationEvent.iter()) {
    if (row.completed) continue;
    let cursor = row.cursor;
    while (cursor < row.recipientIds.length && budget > 0) { materialize(ctx, row, row.recipientIds[cursor++]); budget--; count++; }
    ctx.db.notificationEvent.key.update({ ...row, cursor, completed: cursor >= row.recipientIds.length });
    if (!budget) break;
  }
  return { processed: count };
}
export function claimNotifications(ctx: Ctx, input: { leaseId: string; limit: number }) {
  service(ctx); if (!UUID.test(input.leaseId)) throw new SenderError('Lease inválido.');
  const jobs = [];
  for (const row of ctx.db.notificationDelivery.iter()) {
    if (jobs.length >= Math.min(25, Math.max(1, input.limit))) break;
    if (['sent', 'failed', 'cancelled'].includes(row.status) || row.nextAttemptAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch) continue;
    if (row.status === 'leased' && row.leaseUntil && row.leaseUntil.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch && row.leaseId !== input.leaseId) continue;
    const notice = ctx.db.notification.id.find(row.notificationId); const installation = ctx.db.pushInstallation.id.find(row.installationId);
    if (!notice || !installation?.enabled || !installation.memberId.isEqual(row.memberId) || !eligible(ctx.db, notice) || !preferencesFor(ctx.db, row.memberId).pushEnabled) { ctx.db.notificationDelivery.id.update({ ...row, status: 'cancelled', leaseUntil: undefined }); continue; }
    const attempts = row.attempts + (row.status === 'leased' && row.leaseUntil && row.leaseUntil.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch ? 1 : 0);
    if (attempts >= 5) { ctx.db.notificationDelivery.id.update({ ...row, attempts, status: 'failed', leaseUntil: undefined }); continue; }
    ctx.db.notificationDelivery.id.update({ ...row, attempts, status: 'leased', leaseId: input.leaseId, leaseUntil: at(now(ctx) + 300_000), installationUpdatedAt: installation.updatedAt });
    const prefs = preferencesFor(ctx.db, row.memberId);
    jobs.push({ jobId: row.id, notificationId: notice.id.toString(), endpoint: installation.endpoint, p256dh: installation.p256dh, auth: installation.auth, title: notice.title, route: notice.route, preferences: { timeZone: prefs.timeZone, enabledKinds: prefs.enabledKinds, pushEnabled: prefs.pushEnabled, quietStartMinute: prefs.quietStartMinute, quietEndMinute: prefs.quietEndMinute, reminderMinute: prefs.reminderMinute } });
  }
  return { now: now(ctx), jobs };
}

/** Round robin survives partial cron failures; a member's day cursor advances only after commit. */
export function reminderContext(ctx: Ctx, limit = 4) {
  service(ctx);
  const members = [...ctx.db.member.iter()].filter((member) => member.status === 'active').sort((a, b) => hex(a.identity).localeCompare(hex(b.identity)));
  const previous = ctx.db.notificationPlannerState.id.find(0);
  const ordered = [...members.filter((member) => hex(member.identity) > (previous?.lastMember ?? '')), ...members.filter((member) => hex(member.identity) <= (previous?.lastMember ?? ''))].slice(0, Math.min(10, Math.max(1, limit)));
  const lastMember = ordered.at(-1)?.identity;
  if (lastMember) { const next = { id: 0, lastMember: hex(lastMember) }; if (previous) ctx.db.notificationPlannerState.id.update(next); else ctx.db.notificationPlannerState.insert(next); }
  return { now: now(ctx), members: ordered.map((member) => {
    const prefs = preferencesFor(ctx.db, member.identity);
    return { memberId: hex(member.identity), cursorDay: ctx.db.notificationReminderCursor.memberId.find(member.identity)?.day,
      preferences: { timeZone: prefs.timeZone, enabledKinds: prefs.enabledKinds, pushEnabled: prefs.pushEnabled, quietStartMinute: prefs.quietStartMinute, quietEndMinute: prefs.quietEndMinute, reminderMinute: prefs.reminderMinute } };
  }) };
}
export function commitReminders(ctx: Ctx, input: { memberId: string; day: string; startAt: number; endAt: number }) {
  service(ctx);
  if (!/^[a-f0-9]{64}$/i.test(input.memberId) || !validLocalDay(input.day)) throw new SenderError('Cursor de recordatorios inválido.');
  const memberId = Identity.fromString(input.memberId);
  if (!isActive(ctx.db, memberId)) return { complete: true, created: 0 };
  const previous = ctx.db.notificationReminderCursor.memberId.find(memberId);
  if (previous?.day && input.day <= previous.day) return { complete: true, created: 0 };
  if (previous?.day && input.day !== addLocalDays(previous.day, 1)) throw new SenderError('Procesa primero el siguiente día pendiente.');
  const utc = Date.parse(`${input.day}T00:00:00Z`);
  if (!Number.isSafeInteger(input.startAt) || !Number.isSafeInteger(input.endAt) || input.startAt < utc - 36 * 3_600_000 || input.startAt > utc + 36 * 3_600_000 || input.endAt < input.startAt || input.endAt - input.startAt > 48 * 3_600_000 || input.startAt > now(ctx) + 86_400_000) throw new SenderError('Intervalo de recordatorios inválido.');
  const candidates: Pick<EventRow, 'key' | 'kind' | 'route' | 'sourceKind' | 'sourceId' | 'actor' | 'conversationScope' | 'conversationId' | 'messageId'>[] = [];
  const add = (kind: NotificationKind, sourceKind: string, id: string | bigint, route: string) => candidates.push({ key: `reminder:${kind}:${id}:${kind === 'birthday' ? input.day.slice(0, 4) : input.day}`, kind, sourceKind, sourceId: String(id), route, actor: undefined, conversationScope: '', conversationId: '', messageId: undefined });
  const done = new Set([...ctx.db.personalProgress.owner.filter(memberId)].filter((row) => row.status === 'done').map((row) => `${row.targetKind}:${row.targetId}`));
  for (const assignment of ctx.db.assignment.iter()) if ([input.day, addLocalDays(input.day, 1)].includes(assignment.dueDate) && assignment.createdAt.microsSinceUnixEpoch <= BigInt(input.endAt) * 1000n && !done.has(`assignment:${assignment.id}`)) add('assignment_reminder', 'assignment', assignment.id, `/m/tareas/${assignment.id}`);
  for (const activity of ctx.db.activity.iter()) if ([input.day, addLocalDays(input.day, 1)].includes(activity.date) && activity.createdAt.microsSinceUnixEpoch <= BigInt(input.endAt) * 1000n && !done.has(`activity:${activity.id}`)) add('activity_reminder', 'activity', activity.id, `/m/actividades/${activity.id}`);
  for (const birthday of ctx.db.birthday.iter()) if (birthday.remind && !birthday.identity.isEqual(memberId) && isActive(ctx.db, birthday.identity) && birthday.sharedAt.microsSinceUnixEpoch <= BigInt(input.endAt) * 1000n && birthdayOnLocalDay(birthday.month, birthday.day, input.day)) add('birthday', 'birthday', hex(birthday.identity), '/m/cumpleanos');
  for (const enrollment of ctx.db.spacedEnrollment.memberId.filter(memberId)) {
    const collection = ctx.db.spacedCollection.id.find(enrollment.collectionId);
    if (!enrollment.active || !collection || collection.archived || (collection.visibility !== 'group' && !collection.ownerId.isEqual(memberId))) continue;
    const due = [...ctx.db.spacedCard.collectionId.filter(enrollment.collectionId)].some((card) => {
      if (card.archived || !canReadTarget(ctx.db, memberId, card.sourceKind, card.sourceId) || withdrawn(ctx.db, card.sourceKind, card.sourceId)) return false;
      const progress = ctx.db.spacedProgress.key.find(`${card.id}:${hex(memberId)}`);
      return !progress || progress.dueAt.microsSinceUnixEpoch < BigInt(input.endAt) * 1000n;
    });
    if (due) add('spaced_review', 'spaced_review', enrollment.collectionId, '/m/repaso');
  }
  for (const room of ctx.db.studyRoom.iter()) if (!['completed', 'cancelled'].includes(room.status) && Number(room.startsAt.microsSinceUnixEpoch / 1000n) >= input.startAt && Number(room.startsAt.microsSinceUnixEpoch / 1000n) < input.endAt && (room.organizer.isEqual(memberId) || ctx.db.roomMember.key.find(`${room.id}:${hex(memberId)}`)?.status === 'joined')) add('room', 'room', room.id, `/m/salas/${room.id}`);
  for (const poll of ctx.db.poll.iter()) if (!poll.cancelledAt && Number(poll.closesAt.microsSinceUnixEpoch / 1000n) >= input.startAt && Number(poll.closesAt.microsSinceUnixEpoch / 1000n) < input.endAt && poll.eligible.some((person) => person.isEqual(memberId))) add('poll', 'poll', poll.id, `/m/votaciones/${poll.id}`);
  const prefs = preferencesFor(ctx.db, memberId);
  const pending = candidates.filter((event) => prefs.enabledKinds.some((kind) => kind === event.kind) && readableNotification(ctx.db, memberId, { memberId, sourceKind: event.sourceKind, sourceId: event.sourceId }) && !ctx.db.notification.dedupeKey.find(`${hex(memberId)}:${event.key}`));
  const batch = pending.slice(0, 50);
  // Ineligible reminders also get a cursor: a disabled category cannot pin catch-up forever.
  for (const candidate of batch) materialize(ctx, candidate, memberId, input.day, input.endAt > now(ctx));
  const complete = pending.length <= 50;
  if (complete) { const row = { memberId, day: input.day, updatedAt: ctx.timestamp }; if (previous) ctx.db.notificationReminderCursor.memberId.update(row); else ctx.db.notificationReminderCursor.insert(row); }
  return { complete, created: batch.length };
}
export function finishNotification(ctx: Ctx, input: { jobId: string; leaseId: string; outcome: string; retryAfterSeconds?: number }) {
  service(ctx); const row = ctx.db.notificationDelivery.id.find(input.jobId);
  if (!row || row.leaseId !== input.leaseId || row.status !== 'leased') return;
  if (!row.leaseUntil || row.leaseUntil.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) throw new SenderError('El lease ya venció.');
  if (!['sent', 'retry', 'invalid', 'failed', 'deferred'].includes(input.outcome)) throw new SenderError('Resultado de envío inválido.');
  const attempts = row.attempts + (input.outcome === 'deferred' ? 0 : 1);
  if (input.outcome === 'invalid') { const installation = ctx.db.pushInstallation.id.find(row.installationId); if (installation && row.installationUpdatedAt?.microsSinceUnixEpoch === installation.updatedAt.microsSinceUnixEpoch) ctx.db.pushInstallation.id.update({ ...installation, enabled: false, endpoint: '', p256dh: '', auth: '', updatedAt: ctx.timestamp }); }
  const status = input.outcome === 'sent' ? 'sent' : ['invalid', 'failed'].includes(input.outcome) || attempts >= 5 ? 'failed' : 'pending';
  const delay = input.outcome === 'deferred' ? Math.max(60, Math.min(28_800, input.retryAfterSeconds ?? 60)) : notificationRetrySeconds(attempts, input.retryAfterSeconds);
  ctx.db.notificationDelivery.id.update({ ...row, attempts, status, nextAttemptAt: at(now(ctx) + delay * 1000), leaseUntil: undefined });
}
export function authorizeNotification(ctx: Ctx, input: { jobId: string; leaseId: string }): boolean {
  service(ctx); const row = ctx.db.notificationDelivery.id.find(input.jobId);
  if (!row || row.status !== 'leased' || row.leaseId !== input.leaseId || !row.leaseUntil || row.leaseUntil.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) return false;
  const installation = ctx.db.pushInstallation.id.find(row.installationId); const notice = ctx.db.notification.id.find(row.notificationId);
  const allowed = !!installation?.enabled && row.installationUpdatedAt?.microsSinceUnixEpoch === installation.updatedAt.microsSinceUnixEpoch && !!notice && eligible(ctx.db, notice) && preferencesFor(ctx.db, row.memberId).pushEnabled;
  if (!allowed) ctx.db.notificationDelivery.id.update({ ...row, status: 'cancelled', leaseUntil: undefined });
  return allowed;
}
