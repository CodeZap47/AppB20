import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean, label: string) {
  const deadline = performance.now() + 20_000;
  while (!predicate()) { if (performance.now() >= deadline) throw new Error(`Tiempo agotado: ${label}`); await delay(25); }
}
const bounded = <T>(promise: Promise<T>, label: string) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Tiempo agotado: ${label}`)), 20_000);
  promise.then((result) => { clearTimeout(timer); resolve(result); }, (error) => { clearTimeout(timer); reject(error); });
});

export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  setGlobalLogLevel('error'); const connections = new Set<DbConnection>(); const checks: string[] = [];
  const connect = (token: string) => bounded(new Promise<DbConnection>((resolve, reject) => {
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none')
      .onConnect((ready) => resolve(ready)).onConnectError((_ctx, error) => reject(error)).build(); connections.add(connection);
  }), 'conectar');
  const subscribe = (connection: DbConnection) => bounded(new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(
      ['subjects', 'notes', 'note_details', 'note_versions', 'resource_files', 'my_trash_entries', 'contribution_origins', 'feed_posts', 'feed_comments', 'group_messages', 'chat_channels', 'channel_messages', 'resource_versions', 'admin_content_entries'].map((name) => `SELECT * FROM ${name}`));
  }), 'suscribir');
  const upload = async (connection: DbConnection, id: bigint, bytes: Uint8Array, targetKind = 'note') => {
    const uploadId = randomUUID();
    await connection.reducers.beginResourceUpload({ uploadId, targetKind, targetId: id, expectedVersion: 1,
      name: 'synthetic-retention.txt', mime: 'text/plain', bytes: BigInt(bytes.length), sha256: hash(bytes) });
    await connection.reducers.putResourceChunk({ uploadId, index: 0, bytes, sha256: hash(bytes) });
    await connection.reducers.finalizeResourceUpload({ uploadId }); return uploadId;
  };
  try {
    const owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({ issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['b20-local-smoke'] });
    for (const name of ['owner', 'author', 'outsider']) await owner.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator: name === 'owner' });
    await owner.reducers.joinGroup({ displayName: 'Synthetic retention owner' });
    const author = await connect(options.tokens[1]!); await author.reducers.joinGroup({ displayName: 'Synthetic retention author' });
    const peer = await connect(options.tokens[2]!); await peer.reducers.joinGroup({ displayName: 'Synthetic retention peer' });
    const maintenance = await connect(options.tokens[3]!);
    await owner.reducers.setMaintenanceService({ identity: maintenance.identity! });
    await subscribe(owner); await subscribe(author); await subscribe(peer);
    await author.reducers.createSubject({ name: 'Synthetic retention', period: 1 });
    const subjectId = [...author.db.subjects.iter()][0]!.id;
    const fields = { noteId: undefined, expectedVersion: undefined, subjectId, termId: undefined, session: '', topic: 'Retention',
      title: 'Synthetic private original', body: 'Synthetic original, published only by explicit copy', tags: [], visibility: 'personal', source: 'student', assignmentIds: [], activityIds: [], questionIds: [] };
    await author.reducers.saveNoteV2(fields);
    const original = [...author.db.notes.iter()][0]!.id;
    const bytes = new TextEncoder().encode('Synthetic bytes preserved by published alias');
    const fileId = await upload(author, original, bytes);
    await author.reducers.publishNoteVersion({ noteId: original, expectedVersion: 2 });
    await until(() => [...peer.db.notes.iter()].length === 1, 'publicación compartida');
    const published = [...peer.db.notes.iter()][0]!;
    await until(() => [...peer.db.resourceFiles.iter()].some((file) => file.targetId === published.id), 'alias publicado');
    const alias = [...peer.db.resourceFiles.iter()].find((file) => file.targetId === published.id)!;
    await assert.rejects(owner.procedures.readResourceChunk({ fileId, index: 0 }));
    await assert.rejects(owner.procedures.purgeDue({ batchSize: 20 }));
    checks.push('identidades sintéticas separadas; administrador sin descarga privada ni purga de servicio');

    await author.reducers.withdrawContent({ kind: 'note', targetId: original, withdrawn: true, expectedVersion: 2, reason: 'Synthetic own withdrawal' });
    const entry = [...author.db.myTrashEntries.iter()].find((row) => row.targetId === original)!;
    assert.equal(entry.expiresAt.microsSinceUnixEpoch - entry.withdrawnAt.microsSinceUnixEpoch, 4_000_000n);
    assert.equal(entry.canRestore, true);
    await author.reducers.withdrawContent({ kind: 'note', targetId: original, withdrawn: false, expectedVersion: 3, reason: '' });
    await delay(4_300);
    assert.equal([...author.db.notes.iter()].find((row) => row.id === original)?.version, 4);
    assert.equal(hash((await author.procedures.readResourceChunk({ fileId, index: 0 })).bytes), hash(bytes));
    checks.push('restauración del mismo ID/versiones/archivo y evento programado obsoleto sin efecto');

    await author.reducers.withdrawContent({ kind: 'note', targetId: original, withdrawn: true, expectedVersion: 4, reason: 'Synthetic final withdrawal' });
    await until(() => ![...author.db.notes.iter()].some((row) => row.id === original), 'expiración programada del original');
    assert.equal([...author.db.noteVersions.iter()].some((row) => row.noteId === original), false);
    assert.equal([...author.db.myTrashEntries.iter()].some((row) => row.targetId === original), false);
    await assert.rejects(author.reducers.withdrawContent({ kind: 'note', targetId: original, withdrawn: false, expectedVersion: 5, reason: '' }));
    await assert.rejects(author.procedures.readResourceChunk({ fileId, index: 0 }));
    assert.equal(hash((await peer.procedures.readResourceChunk({ fileId: alias.id, index: 0 })).bytes), hash(bytes));
    assert.deepEqual(await maintenance.procedures.purgeDue({ batchSize: 20 }), { processed: 0, remaining: 0 });
    assert.deepEqual(await maintenance.procedures.purgeDue({ batchSize: 20 }), { processed: 0, remaining: 0 });
    checks.push('scheduler real vence la retirada, elimina historial y descargas, conserva bytes del alias e idempotencia');

    await author.reducers.withdrawContent({ kind: 'note', targetId: published.id, withdrawn: true, expectedVersion: 1, reason: '' });
    await until(() => ![...author.db.notes.iter()].some((row) => row.id === published.id), 'expiración de última referencia');
    await assert.rejects(peer.procedures.readResourceChunk({ fileId: alias.id, index: 0 }));
    await author.reducers.saveNoteV2({ ...fields, visibility: 'group', title: published.title, body: published.body });
    const clone = [...author.db.notes.iter()].find((row) => row.title === published.title)!;
    const origin = [...author.db.contributionOrigins.iter()].find((row) => row.refId === clone.id);
    // El original publicado tenía archivo y el clon sin ese archivo es un aporte distinto.
    assert.equal(origin?.duplicateOf, undefined);
    const plain = { ...fields, visibility: 'group', title: 'Synthetic identical contribution', body: 'Exact synthetic contribution without files' };
    await author.reducers.saveNoteV2(plain); const first = [...author.db.notes.iter()].find((row) => row.title === plain.title)!;
    await author.reducers.withdrawContent({ kind: 'note', targetId: first.id, withdrawn: true, expectedVersion: 1, reason: '' });
    await until(() => ![...author.db.notes.iter()].some((row) => row.id === first.id), 'purga del primer crédito');
    await author.reducers.saveNoteV2(plain); const replacement = [...author.db.notes.iter()].find((row) => row.title === plain.title)!;
    const replacedOrigin = [...author.db.contributionOrigins.iter()].find((row) => row.refId === replacement.id)!;
    assert.equal(replacedOrigin.duplicateOf, first.id); assert.deepEqual(replacedOrigin.creditedAt, first.createdAt);
    checks.push('última referencia expira y la firma privada impide puntos nuevos por clonar un original purgado');
    await author.reducers.createFeedPost({ text: 'Synthetic feed parent with foreign dependency', subjectId: undefined, requestId: randomUUID() });
    const post = [...author.db.feedPosts.iter()].find(row => row.text === 'Synthetic feed parent with foreign dependency')!;
    await peer.reducers.commentFeedPost({ postId: post.id, text: 'Synthetic foreign comment', requestId: randomUUID() });
    await until(() => [...owner.db.feedComments.iter()].some(row => row.postId === post.id), 'comentario para revisión');
    const comment = [...owner.db.feedComments.iter()].find(row => row.postId === post.id)!;
    const postImpact = [...owner.db.adminContentEntries.iter()].find(row => row.kind === 'feed_post' && row.targetId === post.id)!;
    assert.equal(postImpact.safeForBulk, false); assert.equal(postImpact.foreignDependencies, 1);
    await assert.rejects(owner.reducers.withdrawContent({ kind: 'feed_post', targetId: post.id, withdrawn: true, expectedVersion: 1, reason: 'Synthetic moderation' }));
    await owner.reducers.withdrawContent({ kind: 'feed_comment', targetId: comment.id, withdrawn: true, expectedVersion: 1, reason: 'Synthetic individual moderation' });
    await owner.reducers.withdrawContent({ kind: 'feed_post', targetId: post.id, withdrawn: true, expectedVersion: 1, reason: 'Synthetic reviewed moderation', acknowledgeImpact: true });
    await until(() => ![...peer.db.feedPosts.iter()].some(row => row.id === post.id), 'feed retirado oculto desde servidor');
    assert.equal([...peer.db.feedComments.iter()].some(row => row.id === comment.id), false);
    await owner.reducers.withdrawContent({ kind: 'feed_post', targetId: post.id, withdrawn: false, expectedVersion: 2, reason: '' });
    await until(() => [...peer.db.feedPosts.iter()].some(row => row.id === post.id), 'feed restaurado');
    assert.equal([...peer.db.feedComments.iter()].some(row => row.id === comment.id), false);
    await owner.reducers.withdrawContent({ kind: 'feed_comment', targetId: comment.id, withdrawn: false, expectedVersion: 2, reason: '' });
    await until(() => [...peer.db.feedComments.iter()].some(row => row.id === comment.id), 'comentario independiente restaurado');
    checks.push('feed exige revisar dependencias ajenas y restaurar el padre conserva retiradas independientes de comentarios');

    await author.reducers.sendGroupMessage({ text: 'Synthetic retained general message', replyToId: undefined });
    const group = [...author.db.groupMessages.iter()].find(row => row.text === 'Synthetic retained general message')!;
    await peer.reducers.sendGroupMessage({ text: 'Synthetic preserved general reply', replyToId: group.id });
    const messageFile = await upload(author, group.id, new TextEncoder().encode('Synthetic private message attachment'), 'group_message');
    await author.reducers.createChatChannel({ name: 'Synthetic retention channel', kind: 'topic', subjectId: undefined });
    const channel = [...author.db.chatChannels.iter()].find(row => row.name === 'Synthetic retention channel')!;
    await author.reducers.sendChannelMessage({ channelId: channel.id, text: 'Synthetic retained channel message', replyToId: undefined });
    const channelMessage = [...author.db.channelMessages.iter()].find(row => row.text === 'Synthetic retained channel message')!;
    await peer.reducers.sendChannelMessage({ channelId: channel.id, text: 'Synthetic preserved channel reply', replyToId: channelMessage.id });
    await owner.reducers.withdrawContent({ kind: 'group_message', targetId: group.id, withdrawn: true, expectedVersion: 2, reason: 'Synthetic reviewed general moderation', acknowledgeImpact: true });
    await owner.reducers.withdrawContent({ kind: 'channel_message', targetId: channelMessage.id, withdrawn: true, expectedVersion: 1, reason: 'Synthetic reviewed channel moderation', acknowledgeImpact: true });
    await until(() => [...peer.db.groupMessages.iter()].find(row => row.id === group.id)?.text === '', 'marcador general sin texto');
    await until(() => [...peer.db.channelMessages.iter()].find(row => row.id === channelMessage.id)?.text === '', 'marcador canal sin texto');
    assert.ok([...peer.db.groupMessages.iter()].some(row => row.replyToId === group.id));
    assert.ok([...peer.db.channelMessages.iter()].some(row => row.replyToId === channelMessage.id));
    await assert.rejects(author.procedures.readResourceChunk({ fileId: messageFile, index: 0 }));
    await assert.rejects(owner.procedures.readResourceChunk({ fileId: messageFile, index: 0 }));
    await assert.rejects(peer.reducers.sendGroupMessage({ text: 'Cannot reply to withdrawn', replyToId: group.id }));
    await assert.rejects(author.reducers.editMessage({ scope: 'channel', messageId: channelMessage.id, text: 'Cannot edit withdrawn' }));
    await owner.reducers.withdrawContent({ kind: 'group_message', targetId: group.id, withdrawn: false, expectedVersion: 3, reason: '' });
    await owner.reducers.withdrawContent({ kind: 'channel_message', targetId: channelMessage.id, withdrawn: false, expectedVersion: 2, reason: '' });
    await until(() => [...peer.db.groupMessages.iter()].find(row => row.id === group.id)?.text === 'Synthetic retained general message', 'restauración general');
    await until(() => [...peer.db.channelMessages.iter()].find(row => row.id === channelMessage.id)?.text === 'Synthetic retained channel message', 'restauración canal');
    checks.push('clientes conectados reciben marcadores de ambos chats sin texto ni descargas; respuestas preservadas e interacciones bloqueadas');

    await owner.reducers.withdrawContent({ kind: 'group_message', targetId: group.id, withdrawn: true, expectedVersion: 4, reason: 'Synthetic final general moderation', acknowledgeImpact: true });
    await owner.reducers.withdrawContent({ kind: 'channel_message', targetId: channelMessage.id, withdrawn: true, expectedVersion: 3, reason: 'Synthetic final channel moderation', acknowledgeImpact: true });
    await owner.reducers.withdrawContent({ kind: 'feed_post', targetId: post.id, withdrawn: true, expectedVersion: 3, reason: 'Synthetic final feed moderation', acknowledgeImpact: true });
    await until(() => !![...peer.db.groupMessages.iter()].find(row => row.id === group.id)?.deletedAt, 'purga general deja marcador permanente');
    await until(() => !![...peer.db.channelMessages.iter()].find(row => row.id === channelMessage.id)?.deletedAt, 'purga canal deja marcador permanente');
    await until(() => ![...owner.db.myTrashEntries.iter()].some(row => row.kind === 'feed_post' && row.targetId === post.id), 'purga feed elimina padre y dependencias');
    assert.equal([...peer.db.groupMessages.iter()].find(row => row.id === group.id)?.text, '');
    assert.ok([...peer.db.groupMessages.iter()].some(row => row.replyToId === group.id));
    assert.ok([...peer.db.channelMessages.iter()].some(row => row.replyToId === channelMessage.id));
    assert.equal([...peer.db.feedComments.iter()].some(row => row.id === comment.id), false);
    await assert.rejects(owner.reducers.withdrawContent({ kind: 'group_message', targetId: group.id, withdrawn: false, expectedVersion: 5, reason: '' }));
    await assert.rejects(author.procedures.readResourceChunk({ fileId: messageFile, index: 0 }));
    checks.push('scheduler purga feed y adjuntos sin referencias mientras conserva marcadores mínimos e hilos de ambos chats');
    return { database: options.database, checks, acceleratedSeconds: 4, productionRetentionDays: 30 };
  } finally { for (const connection of connections) connection.disconnect(); }
}
