import assert from 'node:assert/strict';
import { randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { Identity, setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
import { DEFAULT_NOTIFICATION_PREFERENCES, notificationDayBounds } from '../packages/core/src/notifications';

type Job = { jobId: string; notificationId: string; endpoint: string; p256dh: string; auth: string; title: string; route: string };
export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>(); const checks: string[] = [];
  const connect = (token: string) => new Promise<DbConnection>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Conexión local vencida.')), 20000);
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none')
      .onConnect((ready) => { clearTimeout(timeout); resolve(ready); })
      .onConnectError((_ctx, error) => { clearTimeout(timeout); reject(error); }).build();
    connections.add(connection);
  });
  const subscribe = (connection: DbConnection, views: string[]) => new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(views.map((name) => `SELECT * FROM ${name}`));
  });
  const waitFor = async (predicate: () => boolean, message: string) => { const until = Date.now() + 5000; while (!predicate()) { if (Date.now() > until) throw new Error(message); await new Promise((resolve) => setTimeout(resolve, 10)); } };
  const personalViews = ['my_notifications', 'my_notification_preferences', 'my_push_installations'];
  const chatViews = ['my_direct_conversations', 'my_direct_messages'];
  const close = () => { for (const connection of connections) connection.disconnect(); connections.clear(); };
  const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, enabledKinds: [...DEFAULT_NOTIFICATION_PREFERENCES.enabledKinds], timeZone: 'UTC', quietStartMinute: 0, quietEndMinute: 0 };
  const call = async <T>(connection: DbConnection, name: string, input: unknown): Promise<T> => JSON.parse(await (connection.procedures as unknown as Record<string, (args: { payload: string }) => Promise<string>>)[name]!({ payload: JSON.stringify(input) })) as T;
  const claim = (connection: DbConnection, leaseId: string) => call<{ now: number; jobs: Job[] }>(connection, 'notificationsClaim', { leaseId, limit: 25 });
  const authorize = (connection: DbConnection, leaseId: string, job: Job) => connection.procedures.notificationsAuthorize({ payload: JSON.stringify({ leaseId, jobId: job.jobId }) });
  const finish = (connection: DbConnection, leaseId: string, job: Job, outcome: string) => call(connection, 'notificationsFinish', { leaseId, jobId: job.jobId, outcome, retryAfterSeconds: 0 });
  try {
    let owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({ issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['b20-local-smoke'] });
    for (const [name, isCreator] of [['owner', true], ['author', true], ['other', false]] as const) await owner.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator });
    await owner.reducers.joinGroup({ displayName: 'Synthetic owner' });
    let author = await connect(options.tokens[1]!); await author.reducers.joinGroup({ displayName: 'Synthetic sender' });
    let other = await connect(options.tokens[2]!); await other.reducers.joinGroup({ displayName: 'Synthetic recipient' });
    const outsider = await connect(options.tokens[3]!);
    await subscribe(outsider, personalViews);
    assert.equal([...outsider.db.myNotifications.iter()].length, 0);
    await assert.rejects(outsider.reducers.joinGroup({ displayName: 'Not invited' }));
    await assert.rejects(outsider.reducers.saveNotificationPreferences({ ...prefs, expectedVersion: 0 }));
    for (const member of [owner, author, other]) {
      await subscribe(member, [...personalViews, ...chatViews]);
      await member.reducers.saveNotificationPreferences({ ...prefs, expectedVersion: 0 });
      const saved = [...member.db.myNotificationPreferences.iter()];
      assert.equal(saved.length, 1); assert.ok(saved[0]!.memberId.isEqual(member.identity!));
    }
    const otherId = other.identity!; const authorId = author.identity!;
    await author.reducers.sendGroupMessage({ text: `Hola [[mencion:${otherId.toHexString()}]]`, replyToId: undefined });
    await waitFor(() => [...other.db.myNotifications.iter()].some((row) => row.kind === 'mention'), 'No llegó la mención al destinatario.');
    assert.equal([...other.db.myNotifications.iter()].filter((row) => row.kind === 'mention').length, 1);
    assert.equal([...owner.db.myNotifications.iter()].length, 0);
    await author.reducers.openDirectConversation({ other: otherId });
    const conversationId = [...author.db.myDirectConversations.iter()][0]!.id;
    await author.reducers.sendDirectMessage({ conversationId, text: 'Contenido sintético privado que nunca aparece en el aviso', replyToId: undefined });
    await waitFor(() => [...other.db.myNotifications.iter()].some((row) => row.kind === 'direct_message'), 'No llegó el aviso privado.');
    assert.equal([...other.db.myNotifications.iter()].filter((row) => row.kind === 'direct_message').length, 1);
    assert.ok(!JSON.stringify([...other.db.myNotifications.iter()], (_key, value) => typeof value === 'bigint' ? value.toString() : value).includes('Contenido sintético privado'));
    assert.equal([...owner.db.myNotifications.iter()].length, 0);
    await assert.rejects(subscribe(author, ['notification']));
    await assert.rejects(subscribe(author, ['notification_delivery']));
    checks.push('tres miembros, vistas propias, mensajes y menciones inmediatos sin configurar push ni servicio');

    const serviceResponse = await fetch(`${options.address}/v1/identity`, { method: 'POST' }); assert.equal(serviceResponse.status, 200);
    const service = await serviceResponse.json() as { identity: string; token: string };
    await assert.rejects(author.reducers.setNotificationService({ identity: Identity.fromString(service.identity), enabled: true }));
    await assert.rejects(owner.reducers.setNotificationService({ identity: owner.identity!, enabled: true }));
    await owner.reducers.setNotificationService({ identity: Identity.fromString(service.identity), enabled: true });
    let technical = await connect(service.token);
    for (const member of [owner, author, other]) await assert.rejects(claim(member, randomUUID()));
    const keyPair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const p256dh = Buffer.from(await webcrypto.subtle.exportKey('raw', keyPair.publicKey)).toString('base64url');
    const installationId = randomUUID(); const endpoint = `https://fcm.googleapis.com/fcm/send/synthetic-${randomUUID()}`;
    await other.reducers.registerPushInstallation({ id: installationId, label: 'Synthetic browser', endpoint, p256Dh: p256dh, auth: randomBytes(16).toString('base64url') });
    await other.reducers.saveNotificationPreferences({ ...prefs, expectedVersion: 1, pushEnabled: true });
    const installations = [...other.db.myPushInstallations.iter()]; assert.equal(installations.length, 1);
    assert.deepEqual(Object.keys(installations[0]!).sort(), ['createdAt', 'enabled', 'id', 'label', 'updatedAt']);
    assert.equal([...owner.db.myPushInstallations.iter()].length, 0); assert.equal([...author.db.myPushInstallations.iter()].length, 0);
    await assert.rejects(owner.reducers.removePushInstallation({ installationId }));
    checks.push('instalación propia sin endpoint ni claves en DTO; operaciones técnicas y dispositivos aislados del administrador y compañeros');

    await author.reducers.sendDirectMessage({ conversationId, text: 'Aviso que se leerá antes del envío', replyToId: undefined });
    const lease = randomUUID(); const first = await claim(technical, lease); assert.equal(first.jobs.length, 1);
    const firstJob = first.jobs[0]!; assert.equal(firstJob.endpoint, endpoint); assert.equal(await authorize(technical, lease, firstJob), true);
    assert.deepEqual((await claim(technical, lease)).jobs.map((job) => job.jobId), [firstJob.jobId]);
    assert.equal((await claim(technical, randomUUID())).jobs.length, 0);
    await other.reducers.markNotificationRead({ notificationId: BigInt(firstJob.notificationId) });
    assert.equal(await authorize(technical, lease, firstJob), false);
    await finish(technical, lease, firstJob, 'sent');
    assert.equal(await authorize(technical, lease, firstJob), false);
    await author.reducers.sendDirectMessage({ conversationId, text: 'Aviso que será suprimido por bloqueo', replyToId: undefined });
    const blockedLease = randomUUID(); const blockedJob = (await claim(technical, blockedLease)).jobs[0]!; assert.ok(blockedJob);
    await other.reducers.setMemberBlocked({ memberId: authorId, blocked: true });
    assert.equal(await authorize(technical, blockedLease, blockedJob), false);
    await assert.rejects(author.reducers.sendDirectMessage({ conversationId, text: 'No se debe enviar', replyToId: undefined }));
    await other.reducers.setMemberBlocked({ memberId: authorId, blocked: false });
    await author.reducers.sendDirectMessage({ conversationId, text: 'Aviso leído por cursor de conversación', replyToId: undefined });
    const cursorLease = randomUUID(); const cursorJob = (await claim(technical, cursorLease)).jobs[0]!; assert.ok(cursorJob);
    await waitFor(() => [...other.db.myDirectMessages.iter()].some((row) => row.text === 'Aviso leído por cursor de conversación'), 'No llegó el mensaje del cursor.');
    const latestMessage = [...other.db.myDirectMessages.iter()].sort((a, b) => a.id < b.id ? 1 : -1)[0]!;
    await other.reducers.markConversationRead({ scope: 'direct', conversationId: conversationId.toString(), messageId: latestMessage.id });
    assert.equal(await authorize(technical, cursorLease, cursorJob), false);
    checks.push('lease idempotente y exclusivo; lectura, cursor y bloqueo revocan la autorización justo antes del envío');

    await author.reducers.sendGroupMessage({ text: `Segundo aviso [[mencion:${otherId.toHexString()}]]`, replyToId: undefined });
    const retryLease = randomUUID(); const retryJob = (await claim(technical, retryLease)).jobs[0]!; assert.ok(retryJob);
    await finish(technical, retryLease, retryJob, 'retry'); await finish(technical, retryLease, retryJob, 'sent');
    assert.equal(await authorize(technical, retryLease, retryJob), false); assert.equal((await claim(technical, randomUUID())).jobs.length, 0);
    assert.equal((await call<{ processed: number }>(technical, 'notificationsSweep', { limit: 100 })).processed, 0);
    assert.equal((await call<{ processed: number }>(technical, 'notificationsSweep', { limit: 100 })).processed, 0);
    const clock = (await call<{ now: number; members: { memberId: string; cursorDay?: string }[] }>(technical, 'notificationReminderContext', { limit: 10 })).now;
    const today = new Date(clock).toISOString().slice(0, 10); const bounds = notificationDayBounds(today, 'UTC');
    await other.reducers.shareBirthday({ day: Number(today.slice(8)), month: Number(today.slice(5, 7)), remind: true });
    const reminder = { memberId: authorId.toHexString(), day: today, ...bounds };
    const committed = await call<{ complete: boolean; created: number }>(technical, 'notificationCommitReminders', reminder);
    assert.equal(committed.complete, true); assert.ok(committed.created >= 1);
    assert.deepEqual(await call(technical, 'notificationCommitReminders', reminder), { complete: true, created: 0 });
    await waitFor(() => [...author.db.myNotifications.iter()].some((row) => row.kind === 'birthday'), 'No llegó el cumpleaños compartido.');
    checks.push('reintento conserva backoff, finish repetido no cambia el envío; sweep y cursor diario no duplican avisos');

    const count = [...other.db.myNotifications.iter()].length;
    close(); await options.restart();
    owner = await connect(options.tokens[0]!); author = await connect(options.tokens[1]!); other = await connect(options.tokens[2]!); technical = await connect(service.token);
    for (const member of [owner, author, other]) await subscribe(member, [...personalViews, ...chatViews]);
    assert.equal([...other.db.myNotifications.iter()].length, count);
    assert.equal([...other.db.myNotificationPreferences.iter()][0]!.version, 2);
    assert.equal([...other.db.myPushInstallations.iter()][0]!.id, installationId);
    const restored = await call<{ members: { memberId: string; cursorDay?: string }[] }>(technical, 'notificationReminderContext', { limit: 10 });
    assert.equal(restored.members.find((member) => member.memberId === authorId.toHexString())?.cursorDay, today);
    assert.deepEqual(await call(technical, 'notificationCommitReminders', reminder), { complete: true, created: 0 });
    checks.push('reinicio real conserva preferencias, dispositivos, avisos y cursor sin duplicar recordatorios');

    await author.reducers.sendDirectMessage({ conversationId, text: 'Aviso que debe desaparecer al revocar acceso', replyToId: undefined });
    const revokedLease = randomUUID(); const jobs = (await claim(technical, revokedLease)).jobs; assert.ok(jobs.length >= 1);
    await owner.reducers.removeMember({ identity: otherId });
    for (const job of jobs) assert.equal(await authorize(technical, revokedLease, job), false);
    await waitFor(() => [...other.db.myNotifications.iter()].length === 0, 'La baja dejó avisos visibles.');
    assert.equal([...other.db.myNotifications.iter()].length, 0);
    await assert.rejects(other.reducers.markAllNotificationsRead({}));
    await owner.reducers.setNotificationService({ identity: Identity.fromString(service.identity), enabled: false });
    await assert.rejects(claim(technical, randomUUID()));
    checks.push('baja de membresía retira avisos y permisos; servicio deshabilitado no puede reclamar envíos');
    return { checks, realWebPushCalls: 0, accounts: 3, technicalIdentities: 1 };
  } finally { close(); }
}
