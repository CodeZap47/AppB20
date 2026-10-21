import { DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_TITLES, notificationPreferences, validPushKeys, validatePushEndpointText, type NotificationKind, type NotificationPreferencesInput } from '../../../core/src/notifications';
import type { Member, Snapshot } from './types';
import type { InboxNotification, NotificationPreferences, NotificationsSnapshot, PushInstallation, RegisterPushInstallationInput } from './notificationTypes';
import { mentionedMembers } from '../lib/chat';

interface Context { state(): object; active(): Member; current(): Snapshot; now(): Date; id(): string; emit(): void }
interface Notice extends InboxNotification { ownerId: string; eventKey: string; sourceKind: string; sourceId: string; actorId?: string; conversationScope?: string; conversationId?: string; messageId?: string }
function readable(base: Snapshot, row: Notice) {
  if (!base.me || row.ownerId !== base.me.id || base.me.status !== 'active') return false;
  if (row.sourceKind === 'test') return true;
  if (row.sourceKind === 'direct_message') return base.directMessages.some((message) => message.id === row.sourceId && !message.deletedAt);
  if (row.sourceKind === 'group_message') return base.groupMessages.some((message) => message.id === row.sourceId && !message.deletedAt);
  if (row.sourceKind === 'channel_message') return base.channelMessages.some((message) => message.id === row.sourceId && !message.deletedAt);
  if (row.sourceKind === 'birthday') return base.birthdays.some((birthday) => birthday.memberId === row.sourceId);
  if (row.sourceKind === 'assignment') return base.assignments.some((entry) => entry.id === row.sourceId);
  if (row.sourceKind === 'activity') return base.activities.some((entry) => entry.id === row.sourceId);
  if (row.sourceKind === 'work') return base.works.some((entry) => entry.id === row.sourceId && !entry.withdrawnAt);
  if (row.sourceKind === 'guide') return base.guides.some((entry) => entry.id === row.sourceId && !entry.withdrawnAt);
  if (row.sourceKind === 'answer') return base.answers.some((entry) => entry.id === row.sourceId && !entry.withdrawnAt);
  if (row.sourceKind === 'room') return base.studyRooms.some((entry) => entry.id === row.sourceId && entry.status !== 'cancelled');
  if (row.sourceKind === 'poll') return base.polls.some((entry) => entry.id === row.sourceId && !entry.cancelledAt);
  if (row.sourceKind === 'spaced_review') return base.spacedEnrollments.some((entry) => entry.collectionId === row.sourceId && entry.active);
  return false;
}
interface SharedNotifications { preferences: Map<string, NotificationPreferences>; notices: Notice[]; installations: Map<string, RegisterPushInstallationInput & PushInstallation & { ownerId: string }>; controls: Map<string, { blocked: string[]; states: { scope: string; conversationId: string; muted: boolean; readIds: string[] }[] }> }
const stores = new WeakMap<object, SharedNotifications>();
/** Simulation only: no endpoints/keys leave the instance or enter the community snapshot. */
export class DemoNotificationsStore {
  private get shared() { const state = this.ctx.state(); let store = stores.get(state); if (!store) { store = { preferences: new Map(), notices: [], installations: new Map(), controls: new Map() }; stores.set(state, store); } return store; }
  private get preferences() { return this.shared.preferences; }
  private get notices() { return this.shared.notices; }
  private get installations() { return this.shared.installations; }
  constructor(private ctx: Context) {}
  snapshot(base: Snapshot): NotificationsSnapshot {
    if (!base.me || base.me.status !== 'active') return { notifications: [], pushInstallations: [], notificationPreferences: undefined };
    const owner = base.me.id;
    const messages = [...base.groupMessages, ...base.directMessages, ...base.channelMessages];
    this.shared.controls.set(owner, { blocked: base.blockedMembers.map((entry) => entry.memberId), states: base.conversationStates.map((entry) => { const conversation = messages.filter((message) => entry.scope === 'group' ? base.groupMessages.includes(message) : entry.scope === 'direct' ? base.directMessages.some((direct) => direct.id === message.id && direct.conversationId === entry.conversationId) : base.channelMessages.some((channel) => channel.id === message.id && channel.channelId === entry.conversationId)); const index = conversation.findIndex((message) => message.id === entry.readThroughId); return { scope: entry.scope, conversationId: entry.conversationId, muted: entry.muted, readIds: index < 0 ? [] : conversation.slice(0, index + 1).map((message) => message.id) }; }) });
    return { notificationPreferences: this.preferences.get(owner) ?? { ...DEFAULT_NOTIFICATION_PREFERENCES, enabledKinds: [...DEFAULT_NOTIFICATION_PREFERENCES.enabledKinds], version: 0 },
      notifications: this.notices.filter((row) => readable(base, row)).map((row) => {
        if (this.suppressed(row)) row.readAt ??= this.ctx.now();
        return row;
      }).map(({ id, kind, title, route, createdAt, readAt }) => ({ id, kind, title, route, createdAt, readAt })),
      pushInstallations: [...this.installations.values()].filter((row) => row.ownerId === owner).map(({ id, label, enabled, createdAt, updatedAt }) => ({ id, label, enabled, createdAt, updatedAt })) };
  }
  saveNotificationPreferences(input: NotificationPreferencesInput) {
    const me = this.ctx.active(); const previous = this.preferences.get(me.id);
    if ((input.expectedVersion ?? 0) !== (previous?.version ?? 0)) throw new Error('Las preferencias cambiaron. Actualiza antes de guardar.');
    this.preferences.set(me.id, { ...notificationPreferences(input), version: (previous?.version ?? 0) + 1 }); this.ctx.emit();
  }
  markNotificationRead(id: string) { const me = this.ctx.active(); const notice = this.notices.find((row) => row.id === id && row.ownerId === me.id); if (!notice) throw new Error('La notificación no está disponible.'); notice.readAt ??= this.ctx.now(); this.ctx.emit(); }
  markAllNotificationsRead() { const me = this.ctx.active(); for (const row of this.notices) if (row.ownerId === me.id) row.readAt ??= this.ctx.now(); this.ctx.emit(); }
  registerPushInstallation(input: RegisterPushInstallationInput) {
    const me = this.ctx.active(); validatePushEndpointText(input.endpoint);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id) || !validPushKeys(input.p256dh, input.auth)) throw new Error('Suscripción push inválida.');
    const previous = this.installations.get(input.id);
    if (previous && previous.ownerId !== me.id) throw new Error('La instalación no está disponible.');
    if (!previous?.enabled && [...this.installations.values()].filter((row) => row.ownerId === me.id && row.enabled).length >= 5) throw new Error('Máximo de cinco instalaciones activas.');
    if (!input.label.trim() || input.label.trim().length > 80) throw new Error('Nombre de instalación inválido.');
    if ([...this.installations.values()].some((row) => row.endpoint === input.endpoint && row.ownerId !== me.id && row.enabled)) throw new Error('Elimina la suscripción anterior antes de cambiar de cuenta.');
    this.installations.set(input.id, { ...input, label: input.label.trim(), ownerId: me.id, enabled: true, createdAt: previous?.createdAt ?? this.ctx.now(), updatedAt: this.ctx.now() }); this.ctx.emit();
  }
  removePushInstallation(id: string) { const me = this.ctx.active(); const row = this.installations.get(id); if (!row || row.ownerId !== me.id) throw new Error('La instalación no está disponible.'); this.installations.set(id, { ...row, enabled: false, endpoint: '', p256dh: '', auth: '', updatedAt: this.ctx.now() }); this.ctx.emit(); }
  emit(input: { eventKey: string; kind: NotificationKind; sourceKind: string; sourceId: string; route: string; recipientIds: string[]; actorId?: string; conversationScope?: string; conversationId?: string; messageId?: string }) {
    let created = 0;
    for (const ownerId of [...new Set(input.recipientIds)]) {
      if (ownerId === input.actorId || this.notices.some((row) => row.ownerId === ownerId && row.eventKey === input.eventKey)) continue;
      const prefs = this.preferences.get(ownerId) ?? DEFAULT_NOTIFICATION_PREFERENCES;
      if (!prefs.enabledKinds.includes(input.kind)) continue;
      const notice = { ...input, id: this.ctx.id(), ownerId, title: NOTIFICATION_TITLES[input.kind], createdAt: this.ctx.now() };
      if (this.suppressed(notice)) continue;
      this.notices.push(notice); created++;
    }
    if (created) this.ctx.emit();
  }
  private suppressed(row: Notice) {
    const controls = this.shared.controls.get(row.ownerId);
    const state = controls?.states.find((entry) => entry.scope === row.conversationScope && entry.conversationId === row.conversationId);
    const blocked = row.actorId && (controls?.blocked.includes(row.actorId) || this.shared.controls.get(row.actorId)?.blocked.includes(row.ownerId));
    return !!row.conversationScope && (state?.muted === true || (row.messageId !== undefined && state?.readIds.includes(row.messageId)) || !!blocked);
  }
  suppressConversationNotifications(scope: string, conversationId: string) {
    const base = this.ctx.current(); this.snapshot(base);
    const owner = this.ctx.active().id; let changed = false;
    for (const row of this.notices) if (row.ownerId === owner && row.conversationScope === scope && row.conversationId === conversationId && !row.readAt && this.suppressed(row)) { row.readAt = this.ctx.now(); changed = true; }
    if (changed) this.ctx.emit();
  }
  notifyMessage(scope: 'group' | 'direct' | 'channel', id: string) {
    const data = this.ctx.current(); const message = (scope === 'group' ? data.groupMessages : scope === 'direct' ? data.directMessages : data.channelMessages).find((row) => row.id === id);
    if (!message) return;
    const direct = scope === 'direct' ? data.directMessages.find((row) => row.id === id) : undefined;
    const channel = scope === 'channel' ? data.channelMessages.find((row) => row.id === id) : undefined;
    const conversationId = direct?.conversationId ?? channel?.channelId ?? 'general';
    const recipients = direct ? data.directConversations.find((row) => row.id === direct.conversationId)?.participantIds ?? [] : mentionedMembers(message.text);
    const kind = scope === 'direct' && !mentionedMembers(message.text).some((person) => person !== message.senderId) ? 'direct_message' : 'mention';
    this.emit({ eventKey: `${scope}:${id}`, kind, sourceKind: `${scope}_message`, sourceId: id, actorId: message.senderId, recipientIds: recipients, conversationScope: scope, conversationId, messageId: id,
      route: scope === 'direct' ? `/m/mensajes/directos/${conversationId}` : scope === 'channel' ? `/m/mensajes/canales/${conversationId}` : '/m/mensajes' });
  }
  requestNotificationTest() { const me = this.ctx.active(); this.emit({ eventKey: `test:${Math.floor(this.ctx.now().getTime() / 60_000)}`, kind: 'test', sourceKind: 'test', sourceId: me.id, route: '/m/avisos', recipientIds: [me.id] }); }
  dispose() { /* Shared state belongs to the demo community, not to this viewer. */ }
}
