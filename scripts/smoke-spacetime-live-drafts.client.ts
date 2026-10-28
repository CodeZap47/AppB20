import assert from 'node:assert/strict';
import { setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
import { SpacetimeLiveDraftStore } from '../packages/app/src/data/liveDraftStore';

export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>();
  const checks: string[] = [];
  const connect = (token: string) => new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Conexión local vencida.')), 20000);
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none')
      .onConnect((ready) => { clearTimeout(timer); resolve(ready); })
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
    connections.add(connection);
  });
  const subscribe = (connection: DbConnection, views: string[]) => new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error))
      .subscribe(views.map((name) => `SELECT * FROM ${name}`));
  });
  const waitFor = async (predicate: () => boolean, message: string, timeout = 6000) => {
    const until = Date.now() + timeout;
    while (!predicate()) { if (Date.now() > until) throw new Error(message); await new Promise((resolve) => setTimeout(resolve, 15)); }
  };
  const rows = (connection: DbConnection) => [...connection.db.liveDrafts.iter()];
  const base = ['my_live_draft_preference', 'my_direct_conversations', 'chat_channels', 'typing_presence', 'group_messages', 'available_chat_commands', 'chat_command_details', 'my_chat_commands'];
  const receiverStore = new SpacetimeLiveDraftStore();
  try {
    const owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({ issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
    for (const [name, isCreator] of [['owner', true], ['author', false], ['other', false]] as const)
      await owner.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator });
    await owner.reducers.joinGroup({ displayName: 'Synthetic admin' });
    const author = await connect(options.tokens[1]!); await author.reducers.joinGroup({ displayName: 'Synthetic sender' });
    const other = await connect(options.tokens[2]!); await other.reducers.joinGroup({ displayName: 'Synthetic recipient' });
    const outsider = await connect(options.tokens[3]!);
    for (const connection of [owner, author, outsider]) await subscribe(connection, [...base, 'live_drafts']);
    await subscribe(other, base);
    await author.reducers.saveChatCommand({ name: 'legado', description: 'Plantilla anterior', text: 'Texto conservado' });
    await waitFor(() => [...author.db.availableChatCommands.iter()].some((command) => command.name === 'legado'), 'No conservó el comando anterior.');
    const legacy = [...author.db.availableChatCommands.iter()].find((command) => command.name === 'legado')!;
    assert.equal([...other.db.availableChatCommands.iter()].length, 0);
    const sharedInput = { name: '/Saludó', description: 'Saludo compartido', text: 'Hola al salón', visibility: 'classroom', actionKind: 'text' };
    await author.reducers.saveChatCommandV2(sharedInput);
    await waitFor(() => [...other.db.availableChatCommands.iter()].some((command) => command.name === 'saludo'), 'No apareció el comando compartido normalizado.');
    const shared = [...other.db.availableChatCommands.iter()].find((command) => command.name === 'saludo')!;
    await assert.rejects(owner.reducers.saveChatCommandV2({ ...sharedInput, id: shared.id, text: 'No autorizado', expectedVersion: 1 }));
    await assert.rejects(other.reducers.saveChatCommandV2(sharedInput));
    await author.reducers.saveChatCommandV2({ name: 'nueva-pregunta', description: 'Crear recurso', text: '', visibility: 'classroom', actionKind: 'create', resourceKind: 'pregunta' });
    await waitFor(() => [...other.db.chatCommandDetails.iter()].some((detail) => detail.actionKind === 'create' && detail.resourceKind === 'pregunta'), 'No guardó la acción de creación.');
    await owner.reducers.removeChatCommand({ commandId: shared.id });
    await waitFor(() => ![...other.db.availableChatCommands.iter()].some((command) => command.id === shared.id), 'Retirar no ocultó el comando del salón.');
    assert.equal([...author.db.availableChatCommands.iter()].find((command) => command.id === shared.id)?.text, 'Hola al salón');
    assert.equal([...author.db.availableChatCommands.iter()].find((command) => command.name === 'legado')?.id, legacy.id);
    assert.equal([...outsider.db.availableChatCommands.iter()].length, 0);
    await assert.rejects(author.reducers.saveChatCommandV2({ ...sharedInput, name: 'tarea' }));
    checks.push('comandos reales: normalización, plantillas anteriores, creación de recursos, alcance privado/compartido y retiro administrativo sin borrar al autor');
    receiverStore.connect(other);
    await author.reducers.openDirectConversation({ other: other.identity! });
    await waitFor(() => [...author.db.myDirectConversations.iter()].length === 1, 'No se abrió el directo.');
    const conversationId = [...author.db.myDirectConversations.iter()][0]!.id.toString();
    let notifications = 0;
    const unwatchDirect = receiverStore.subscribe('direct', conversationId, () => notifications++);
    await author.reducers.setLiveDraft({ scope: 'group', conversationId: 'general', text: 'Borrador general', revision: 1n });
    await waitFor(() => rows(owner).some((row) => row.text === 'Borrador general'), 'El salón no recibió el borrador.');
    assert.equal(rows(other).length, 0, 'La suscripción enfocada no debe descargar otro chat.');
    const started = Date.now();
    await author.reducers.setLiveDraft({ scope: 'direct', conversationId, text: 'Texto provisional privado', revision: 2n });
    await waitFor(() => receiverStore.getSnapshot('direct', conversationId)[0]?.text === 'Texto provisional privado', 'No llegó el borrador directo.');
    const latencyMs = Date.now() - started;
    assert.ok(latencyMs < 500, `Actualización local demasiado lenta: ${latencyMs} ms`);
    assert.equal(rows(owner).some((row) => row.scope === 'direct'), false, 'Administrar no concede lectura de directos.');
    assert.equal(rows(outsider).length, 0);
    assert.ok(notifications > 0);
    await assert.rejects(owner.reducers.setLiveDraft({ scope: 'direct', conversationId, text: 'Intrusión', revision: 1n }));
    await assert.rejects(subscribe(author, ['chat_live_draft']));
    await assert.rejects(outsider.reducers.setLiveDraftSharing({ enabled: false }));
    checks.push('suscripción real por conversación, difusión <500 ms y directo privado sin excepción administrativa');

    const authorTab = await connect(options.tokens[1]!); await subscribe(authorTab, [...base, 'live_drafts']);
    await authorTab.reducers.setLiveDraftSharing({ enabled: false });
    await waitFor(() => receiverStore.getSnapshot('direct', conversationId).length === 0 && rows(owner).length === 0, 'Desactivar no limpió todas las conversaciones.');
    await waitFor(() => [...author.db.myLiveDraftPreference.iter()][0]?.enabled === false, 'La preferencia no se propagó a la otra pestaña.');
    await author.reducers.setLiveDraft({ scope: 'direct', conversationId, text: 'No publicar', revision: 3n });
    assert.equal(receiverStore.getSnapshot('direct', conversationId).length, 0);
    await authorTab.reducers.setLiveDraftSharing({ enabled: true });
    await author.reducers.setLiveDraft({ scope: 'direct', conversationId, text: 'Versión vigente', revision: 10n });
    await waitFor(() => receiverStore.getSnapshot('direct', conversationId)[0]?.text === 'Versión vigente', 'No reactivó el borrador.');
    await author.reducers.setLiveDraft({ scope: 'direct', conversationId, text: 'Viejo', revision: 9n });
    assert.equal(receiverStore.getSnapshot('direct', conversationId)[0]?.text, 'Versión vigente');
    await author.reducers.setLiveDraft({ scope: 'direct', conversationId, text: '', revision: 11n });
    await author.reducers.setLiveDraft({ scope: 'direct', conversationId, text: 'Viejo', revision: 10n });
    await waitFor(() => receiverStore.getSnapshot('direct', conversationId).length === 0, 'Una actualización atrasada resucitó texto borrado.');
    checks.push('preferencia de cuenta entre pestañas, limpieza global y revisiones contra eventos atrasados');

    await author.reducers.setLiveDraft({ scope: 'direct', conversationId, text: 'Pestaña uno', revision: 20n });
    await authorTab.reducers.setLiveDraft({ scope: 'direct', conversationId, text: 'Pestaña dos', revision: 1n });
    await waitFor(() => receiverStore.getSnapshot('direct', conversationId).length === 2, 'No conservó sesiones independientes.');
    author.disconnect(); connections.delete(author);
    await waitFor(() => receiverStore.getSnapshot('direct', conversationId).length === 1, 'Desconectar una pestaña borró sesiones equivocadas.');
    assert.equal(receiverStore.getSnapshot('direct', conversationId)[0]?.text, 'Pestaña dos');
    await other.reducers.setMemberBlocked({ memberId: authorTab.identity!, blocked: true });
    await waitFor(() => receiverStore.getSnapshot('direct', conversationId).length === 0, 'El bloqueo no revocó el texto.');
    await assert.rejects(authorTab.reducers.setLiveDraft({ scope: 'direct', conversationId, text: 'Bloqueado', revision: 2n }));
    await other.reducers.setMemberBlocked({ memberId: authorTab.identity!, blocked: false });
    await authorTab.reducers.setLiveDraft({ scope: 'direct', conversationId, text: 'Caducará', revision: 3n });
    await waitFor(() => receiverStore.getSnapshot('direct', conversationId)[0]?.text === 'Caducará', 'No recibió el texto para caducidad.');
    await waitFor(() => rows(authorTab).length === 0, 'El servidor no eliminó borradores sin más escrituras.', 10000);
    assert.equal(receiverStore.getSnapshot('direct', conversationId).length, 0);
    checks.push('sesiones independientes, desconexión inmediata, bloqueo y limpieza programada sin nuevas escrituras');
    unwatchDirect();
    const unwatchGroup = receiverStore.subscribe('group', 'general', () => {});
    await owner.reducers.setLiveDraft({ scope: 'group', conversationId: 'general', text: 'Uno', revision: 50n });
    await authorTab.reducers.setLiveDraft({ scope: 'group', conversationId: 'general', text: 'Dos', revision: 50n });
    await receiverStore.publish('group', 'general', 'Tres');
    await waitFor(() => receiverStore.getSnapshot('group', 'general').length === 3, 'No transmitió tres integrantes simultáneos.');
    assert.equal([...owner.db.groupMessages.iter()].length, 0, 'Escribir un borrador no debe crear mensajes.');
    const legacyPresence = [...owner.db.typingPresence.iter()];
    assert.ok(legacyPresence.every((row) => !Object.keys(row).some((key) => ['text', 'draft', 'body'].includes(key))));
    unwatchGroup();
    await authorTab.reducers.setLiveDraftSharing({ enabled: false });
    receiverStore.disconnect();
    for (const connection of connections) connection.disconnect(); connections.clear();
    await options.restart();
    const restored = await connect(options.tokens[1]!); await subscribe(restored, ['my_live_draft_preference']);
    assert.equal([...restored.db.myLiveDraftPreference.iter()][0]?.enabled, false);
    checks.push('tres integrantes simultáneos, historial intacto, presencia heredada sin texto y preferencia persistida tras reiniciar');
    return { checks, latencyMs };
  } finally {
    receiverStore.disconnect();
    for (const connection of connections) connection.disconnect();
  }
}
