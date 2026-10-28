import assert from 'node:assert/strict';
import { setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
import { SpacetimeAppPresenceStore, type AppPresenceEnvironment } from '../packages/app/src/data/appPresenceStore';

function foreground(initial = true) {
  let value = initial;
  const listeners = new Set<() => void>();
  const environment: AppPresenceEnvironment = {
    isForeground: () => value,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { environment, set(active: boolean) { value = active; listeners.forEach(listener => listener()); } };
}

export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>(), stores: SpacetimeAppPresenceStore[] = [];
  const checks: string[] = [];
  const connect = (token: string) => new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Conexión local vencida.')), 20000);
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none')
      .onConnect(ready => { clearTimeout(timer); resolve(ready); }).onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
    connections.add(connection);
  });
  const subscribe = (connection: DbConnection, views: string[]) => new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(views.map(name => `SELECT * FROM ${name}`));
  });
  const waitFor = async (predicate: () => boolean, message: string, timeout = 7000) => {
    const until = Date.now() + timeout;
    while (!predicate()) { if (Date.now() > until) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  const ids = (connection: DbConnection) => [...connection.db.onlineMembers.iter()].map(row => row.memberId.toHexString());
  const base = ['online_members', 'my_member', 'group_messages', 'typing_presence', 'live_drafts'];
  const register = (connection: DbConnection, env = foreground()) => {
    const store = new SpacetimeAppPresenceStore(env.environment); stores.push(store); store.connect(connection, connection.identity!.toHexString()); return { store, env };
  };
  try {
    const owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({ issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['b20-local-smoke', 'authenticated'] });
    for (const [name, isCreator] of [['owner', true], ['author', false], ['other', false]] as const) await owner.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator });
    await owner.reducers.joinGroup({ displayName: 'Synthetic administrator' });
    const author = await connect(options.tokens[1]!); await author.reducers.joinGroup({ displayName: 'Synthetic author' });
    const other = await connect(options.tokens[2]!); await other.reducers.joinGroup({ displayName: 'Synthetic recipient' });
    const outsider = await connect(options.tokens[3]!);
    for (const connection of [owner, author, other, outsider]) await subscribe(connection, base);
    assert.equal(ids(owner).length, 0, 'La conexión técnica o autenticación no demuestra primer plano.');
    await assert.rejects(subscribe(author, ['app_presence_session']));
    await assert.rejects(subscribe(author, ['app_presence_expiry']));
    await assert.rejects(outsider.reducers.setAppPresence({ active: true, revision: 1n }));
    assert.deepEqual(ids(outsider), []);
    register(owner);
    await waitFor(() => ids(owner).length === 1, 'El propio observador no figura activo.');
    const authorPresence = register(author, foreground(false));
    assert.equal(ids(owner).length, 1);
    const enterStarted = Date.now(); authorPresence.env.set(true);
    await waitFor(() => ids(owner).length === 2, 'No se propagó la entrada a primer plano.');
    const enterLatencyMs = Date.now() - enterStarted;
    assert.ok(enterLatencyMs < 500, `Entrada local demasiado lenta: ${enterLatencyMs} ms`);
    const otherPresence = register(other);
    await waitFor(() => ids(owner).length === 3, 'Falta el tercer integrante.');
    checks.push('registro explícito tras caché, incluye al observador, sin contar conexiones técnicas e invitados; tablas privadas');

    const authorTab = await connect(options.tokens[1]!); await subscribe(authorTab, base);
    await authorTab.reducers.setAppPresence({ active: true, revision: 10n });
    await waitFor(() => ids(authorTab).length === 3, 'La segunda sesión no recibió la lista.');
    assert.equal(ids(owner).filter(id => id === author.identity!.toHexString()).length, 1);
    authorPresence.store.disconnect(); author.disconnect(); connections.delete(author);
    await waitFor(() => ids(owner).length === 3, 'Cerrar una sesión retiró una persona con otra sesión abierta.');
    const leaveStarted = Date.now(); otherPresence.env.set(false);
    await waitFor(() => !ids(owner).includes(other.identity!.toHexString()), 'Ocultar la app no retiró su presencia.');
    const leaveLatencyMs = Date.now() - leaveStarted;
    assert.ok(leaveLatencyMs < 500, `Salida local demasiado lenta: ${leaveLatencyMs} ms`);
    otherPresence.env.set(true); await waitFor(() => ids(owner).length === 3, 'No volvió a primer plano.');
    await authorTab.reducers.setAppPresence({ active: false, revision: 12n });
    await authorTab.reducers.setAppPresence({ active: true, revision: 11n });
    await waitFor(() => ids(owner).length === 2, 'Un evento atrasado resucitó la presencia.');
    await authorTab.reducers.setAppPresence({ active: true, revision: 13n });
    await waitFor(() => ids(owner).length === 3, 'No aceptó la revisión nueva.');
    checks.push('una fila por persona entre sesiones; ocultar/reactivar <500 ms; revisiones atrasadas descartadas');

    await authorTab.reducers.setLiveDraft({ scope: 'group', conversationId: 'general', text: 'Synthetic provisional draft', revision: 1n });
    await authorTab.reducers.setTyping({ scope: 'group', conversationId: 'general', typing: true });
    await waitFor(() => [...owner.db.liveDrafts.iter()].some(row => row.text === 'Synthetic provisional draft'), 'No llegó el borrador de control.');
    const authorId = authorTab.identity!;
    const disconnectStarted = Date.now(); authorTab.disconnect(); connections.delete(authorTab);
    await waitFor(() => !ids(owner).includes(authorId.toHexString()) && ![...owner.db.liveDrafts.iter()].some(row => row.memberId.isEqual(authorId)), 'Desconectar dejó presencia o borradores.');
    const disconnectLatencyMs = Date.now() - disconnectStarted;
    assert.ok(disconnectLatencyMs < 500, `Desconexión local demasiado lenta: ${disconnectLatencyMs} ms`);
    assert.equal([...owner.db.typingPresence.iter()].some(row => row.memberId.isEqual(authorId)), false);
    checks.push('el mismo manejador de desconexión retira presencia, escritura y borradores sin interferencias');

    const alias = await connect(options.tokens[4]!);
    await owner.reducers.linkAuthIdentity({ sessionIdentity: alias.identity!, memberIdentity: authorId });
    await subscribe(alias, base);
    await alias.reducers.setAppPresence({ active: true, revision: 1n });
    await waitFor(() => ids(owner).includes(authorId.toHexString()), 'La identidad vinculada no usa la membresía canónica.');
    assert.equal(ids(owner).includes(alias.identity!.toHexString()), false);
    await owner.reducers.removeMember({ identity: authorId });
    await waitFor(() => !ids(owner).includes(authorId.toHexString()) && ids(alias).length === 0, 'Una cuenta dada de baja conserva presencia o acceso.');
    await assert.rejects(alias.reducers.setAppPresence({ active: true, revision: 2n }));
    checks.push('identidad canónica, baja inmediata y revocación de consulta/escritura');

    await owner.reducers.inviteMember({ email: 'outsider@b20-smoke.invalid', isCreator: false });
    await outsider.reducers.joinGroup({ displayName: 'Synthetic lease expiry' });
    await outsider.reducers.setAppPresence({ active: true, revision: 1n });
    const expiryId = outsider.identity!.toHexString();
    await waitFor(() => ids(owner).includes(expiryId), 'Falta la sesión que debe caducar.');
    const expiryStarted = Date.now();
    await waitFor(() => !ids(owner).includes(expiryId), 'La sesión sin pulsos no caducó sin eventos externos.', 18000);
    const expiryMs = Date.now() - expiryStarted;
    assert.ok(expiryMs >= 14000 && expiryMs < 17500, `Caducidad fuera de margen: ${expiryMs} ms`);
    assert.ok(ids(owner).includes(owner.identity!.toHexString()) && ids(owner).includes(other.identity!.toHexString()), 'La renovación de 5 s dejó caducar sesiones activas.');
    await outsider.reducers.setAppPresence({ active: true, revision: 1n });
    assert.equal(ids(owner).includes(expiryId), false, 'Un pulso viejo revivió la sesión caducada.');
    await outsider.reducers.setAppPresence({ active: true, revision: 2n });
    await waitFor(() => ids(owner).includes(expiryId), 'Una confirmación nueva no recuperó presencia.');
    assert.equal([...owner.db.groupMessages.iter()].length, 0, 'La presencia creó mensajes.');
    checks.push('renovación real cada 5 s y caducidad programada de 15 s; no crea historial de mensajes');
    for (const store of stores) store.disconnect();
    for (const connection of connections) connection.disconnect(); connections.clear();
    await options.restart();
    const restored = await connect(options.tokens[0]!); await subscribe(restored, ['online_members']);
    assert.deepEqual(ids(restored), [], 'Un reinicio recuperó conexiones cerradas como activas.');
    checks.push('limpieza de sesiones y reconexión tras reiniciar el servidor');
    return { checks, enterLatencyMs, leaveLatencyMs, disconnectLatencyMs, expiryMs };
  } finally { for (const store of stores) store.disconnect(); for (const connection of connections) connection.disconnect(); }
}
