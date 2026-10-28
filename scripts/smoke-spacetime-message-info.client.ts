import assert from 'node:assert/strict';
import { setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
import { SpacetimeMessageReceiptStore } from '../packages/app/src/data/messageReceiptStore';
import { formatChatPostReference } from '../packages/core/src/chatPosts';

export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>(), stores: SpacetimeMessageReceiptStore[] = [], checks: string[] = [];
  const connect = (token: string) => new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Conexión local vencida.')), 20000);
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none')
      .onConnect(ready => { clearTimeout(timer); resolve(ready); }).onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
    connections.add(connection);
  });
  const subscribe = (connection: DbConnection, views: string[]) => new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(views.map(name => `SELECT * FROM ${name}`));
  });
  const waitFor = async (predicate: () => boolean, message: string) => {
    const until = Date.now() + 7000;
    while (!predicate()) { if (Date.now() > until) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 15)); }
  };
  const base = ['group_messages', 'channel_messages', 'chat_channels', 'my_direct_conversations', 'my_direct_messages', 'my_message_receipts', 'subjects', 'feed_posts', 'notes'];
  const details = (connection: DbConnection, scope: string, id: bigint) => [...connection.db.messageReceiptDetails.iter()].filter(row => row.scope === scope && row.messageId === id);
  const makeStore = (connection: DbConnection) => { const store = new SpacetimeMessageReceiptStore(); stores.push(store); store.connect(connection); return store; };
  try {
    const owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({ issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
    for (const [name, isCreator] of [['owner', true], ['author', false], ['other', false]] as const) await owner.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator });
    await owner.reducers.joinGroup({ displayName: 'Synthetic administrator' });
    const author = await connect(options.tokens[1]!); await author.reducers.joinGroup({ displayName: 'Synthetic sender' });
    const other = await connect(options.tokens[2]!); await other.reducers.joinGroup({ displayName: 'Synthetic recipient' });
    const outsider = await connect(options.tokens[3]!);
    await subscribe(author, [...base, 'message_receipt_details', 'message_receipt_tracking']);
    await subscribe(owner, [...base, 'message_receipt_details']);
    await subscribe(outsider, ['message_receipt_details', 'message_receipt_tracking', 'my_message_receipts']);
    await author.reducers.sendGroupMessage({ text: 'Synthetic receipt message' });
    const groupId = [...author.db.groupMessages.iter()][0]!.id;
    await waitFor(() => details(author, 'group', groupId).length === 2, 'Destinatarios no fijados al enviar.');
    assert.ok(details(author, 'group', groupId).every(row => !row.deliveredAt && !row.readAt));
    assert.equal(details(owner, 'group', groupId).length, 0, 'Administrar no da acceso a recibos ajenos.');
    assert.equal([...outsider.db.messageReceiptDetails.iter()].length, 0);
    await assert.rejects(subscribe(author, ['message_receipt']));
    checks.push('destinatarios fijados al enviar, pendiente sin recepción y estados privados incluso frente al administrador');

    await subscribe(other, ['my_message_receipts']);
    const receiver = makeStore(other);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(details(author, 'group', groupId).some(row => row.deliveredAt), false, 'Recibir solo estados no equivale a recibir el mensaje.');
    await subscribe(other, base.filter(view => view !== 'my_message_receipts'));
    await waitFor(() => details(author, 'group', groupId).some(row => row.recipient.isEqual(other.identity!) && !!row.deliveredAt), 'La caché aplicada no confirmó la entrega.');
    assert.ok([...other.db.myMessageReceipts.iter()].every(row => row.recipient.isEqual(other.identity!)));
    const firstDelivery = details(author, 'group', groupId).find(row => row.recipient.isEqual(other.identity!))!.deliveredAt!.microsSinceUnixEpoch;
    assert.equal(details(author, 'group', groupId).some(row => row.readAt), false);
    await receiver.markSeen('group', 'general', [groupId.toString()]);
    await waitFor(() => !!details(author, 'group', groupId).find(row => row.recipient.isEqual(other.identity!))?.readAt, 'No confirmó lectura.');
    const firstRead = details(author, 'group', groupId).find(row => row.recipient.isEqual(other.identity!))!.readAt!.microsSinceUnixEpoch;
    const otherTab = await connect(options.tokens[2]!); await subscribe(otherTab, base);
    await otherTab.reducers.markMessagesSeen({ scope: 'group', conversationId: 'general', messageIds: [groupId] });
    await otherTab.reducers.acknowledgeMessageDelivery({ scope: 'group', conversationId: 'general', messageIds: [groupId] });
    await new Promise(resolve => setTimeout(resolve, 80));
    const repeated = details(author, 'group', groupId).find(row => row.recipient.isEqual(other.identity!))!;
    assert.equal(repeated.deliveredAt!.microsSinceUnixEpoch, firstDelivery); assert.equal(repeated.readAt!.microsSinceUnixEpoch, firstRead);
    checks.push('entrega únicamente tras aplicar el mensaje a la caché; primera entrega y lectura inmutables entre sesiones y reintentos');

    await owner.reducers.inviteMember({ email: 'outsider@b20-smoke.invalid', isCreator: false });
    await outsider.reducers.joinGroup({ displayName: 'Synthetic late member' });
    await outsider.reducers.markMessagesSeen({ scope: 'group', conversationId: 'general', messageIds: [groupId] });
    assert.equal(details(author, 'group', groupId).length, 2, 'Un alta posterior no pertenece a la cohorte.');
    await author.reducers.openDirectConversation({ other: other.identity! });
    await waitFor(() => [...author.db.myDirectConversations.iter()].length === 1, 'Falta el directo.');
    const directId = [...author.db.myDirectConversations.iter()][0]!.id;
    await author.reducers.sendDirectMessage({ conversationId: directId, text: 'Synthetic private receipt' });
    await waitFor(() => [...author.db.myDirectMessages.iter()].length === 1, 'Falta mensaje directo.');
    const directMessageId = [...author.db.myDirectMessages.iter()][0]!.id;
    await waitFor(() => details(author, 'direct', directMessageId).length === 1 && !!details(author, 'direct', directMessageId)[0]?.deliveredAt, 'No entregó el directo.');
    await assert.rejects(owner.reducers.markMessagesSeen({ scope: 'direct', conversationId: directId.toString(), messageIds: [directMessageId] }));
    assert.equal(details(owner, 'direct', directMessageId).length, 0);
    assert.equal([...outsider.db.myMessageReceipts.iter()].some(row => row.scope === 'direct'), false);
    await assert.rejects(other.reducers.markMessagesSeen({ scope: 'direct', conversationId: directId.toString(), messageIds: [groupId + 9999n] }));
    checks.push('altas posteriores sin pendientes retroactivos y aislamiento del directo por destinatario y conversación');

    await author.reducers.createChatChannel({ name: 'Synthetic channel', kind: 'topic' });
    await waitFor(() => [...author.db.chatChannels.iter()].length === 1, 'Falta canal.');
    const channelId = [...author.db.chatChannels.iter()][0]!.id;
    await author.reducers.createFeedPost({ text: 'Synthetic shareable publication', requestId: 'message-info-smoke-post' });
    await waitFor(() => [...author.db.feedPosts.iter()].length === 1, 'Falta publicación.');
    const postId = [...author.db.feedPosts.iter()][0]!.id.toString();
    const target = { kind: 'post' as const, id: postId };
    const resolvePosts = async (connection: DbConnection, targets: unknown[]) => JSON.parse(await connection.procedures.chatPostAction({ payload: JSON.stringify({ action: 'resolve', targets }) }));
    const preview = await resolvePosts(other, [target]);
    assert.equal(preview[0]?.available, true); assert.ok(preview[0]?.path?.includes(postId));
    const text = `Comentario conservado ${formatChatPostReference(target)}`;
    await author.reducers.sendGroupMessage({ text });
    await author.reducers.sendChannelMessage({ channelId, text });
    await author.reducers.sendDirectMessage({ conversationId: directId, text });
    await waitFor(() => [...other.db.groupMessages.iter()].some(row => row.text === text) && [...other.db.channelMessages.iter()].some(row => row.text === text) && [...other.db.myDirectMessages.iter()].some(row => row.text === text), 'La referencia no llegó a todos los tipos de chat.');
    await owner.reducers.createSubject({ name: 'Synthetic privacy subject', period: 1 });
    await waitFor(() => [...author.db.subjects.iter()].length === 1, 'Falta materia.');
    const subjectId = [...author.db.subjects.iter()][0]!.id;
    await author.reducers.saveNote({ subjectId, topic: 'Synthetic', title: 'Private synthetic note', body: 'Never leak this body', tags: [], visibility: 'personal', source: 'student' });
    await waitFor(() => [...author.db.notes.iter()].length === 1, 'Falta nota.');
    const noteId = [...author.db.notes.iter()][0]!.id.toString();
    assert.deepEqual((await resolvePosts(author, [{ kind: 'note', id: noteId }]))[0], { target: { kind: 'note', id: noteId }, available: false });
    assert.deepEqual((await resolvePosts(other, [{ kind: 'note', id: noteId }]))[0], { target: { kind: 'note', id: noteId }, available: false });
    assert.deepEqual((await resolvePosts(owner, [{ kind: 'note', id: noteId }]))[0], { target: { kind: 'note', id: noteId }, available: false });
    assert.equal((await resolvePosts(other, [{ kind: 'post', id: '999999' }]))[0]?.available, false);
    checks.push('tarjetas versionadas enviadas en salón/canal/directo, rutas autenticadas y rechazo de notas privadas sin excepción administrativa');
    for (const store of stores) store.disconnect();
    for (const connection of connections) connection.disconnect(); connections.clear();
    await options.restart();
    const restored = await connect(options.tokens[1]!); await subscribe(restored, ['message_receipt_details']);
    const persisted = details(restored, 'group', groupId).find(row => row.recipient.isEqual(other.identity!))!;
    assert.equal(persisted.deliveredAt!.microsSinceUnixEpoch, firstDelivery); assert.equal(persisted.readAt!.microsSinceUnixEpoch, firstRead);
    checks.push('confirmaciones persistidas tras reiniciar el servidor');
    return { checks };
  } finally { for (const store of stores) store.disconnect(); for (const connection of connections) connection.disconnect(); }
}
