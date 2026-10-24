import assert from 'node:assert/strict';
import { setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';

export async function runSmoke(options: {
  address: string;
  database: string;
  tokens: string[];
  restart(): Promise<void>;
}) {
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>();
  const checks: string[] = [];
  const connect = (token: string) =>
    new Promise<DbConnection>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Conexión local vencida.')), 20_000);
      const connection = DbConnection.builder()
        .withUri(options.address)
        .withDatabaseName(options.database)
        .withToken(token)
        .withCompression('none')
        .onConnect((ready) => {
          clearTimeout(timeout);
          resolve(ready);
        })
        .onConnectError((_ctx, error) => {
          clearTimeout(timeout);
          reject(error);
        })
        .build();
      connections.add(connection);
    });
  const subscribe = (connection: DbConnection, views: string[]) =>
    new Promise<void>((resolve, reject) => {
      connection
        .subscriptionBuilder()
        .onApplied(() => resolve())
        .onError((_ctx, error) => reject(error))
        .subscribe(views.map((name) => `SELECT * FROM ${name}`));
    });
  const waitFor = async (predicate: () => boolean, message: string) => {
    const until = Date.now() + 6000;
    while (!predicate()) {
      if (Date.now() > until) throw new Error(message);
      await new Promise((done) => setTimeout(done, 15));
    }
  };
  const views = ['typing_presence', 'my_onboarding', 'my_direct_conversations', 'chat_channels'];
  const presence = (connection: DbConnection) => [...connection.db.typingPresence.iter()];
  const close = () => {
    for (const connection of connections) connection.disconnect();
    connections.clear();
  };
  try {
    let owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({
      issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1',
      audiences: ['b20-local-smoke'],
    });
    for (const [name, isCreator] of [
      ['owner', true],
      ['author', false],
      ['other', false],
    ] as const)
      await owner.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator });
    await owner.reducers.joinGroup({ displayName: 'Synthetic admin' });
    let author = await connect(options.tokens[1]!);
    await author.reducers.joinGroup({ displayName: 'Synthetic sender' });
    let other = await connect(options.tokens[2]!);
    await other.reducers.joinGroup({ displayName: 'Synthetic recipient' });
    const outsider = await connect(options.tokens[3]!);
    for (const connection of [owner, author, other, outsider]) await subscribe(connection, views);
    const authorId = author.identity!;
    const otherId = other.identity!;
    assert.equal([...author.db.myOnboarding.iter()].length, 0);
    await author.reducers.completeOnboarding({});
    await author.reducers.completeOnboarding({});
    assert.equal([...author.db.myOnboarding.iter()].length, 1);
    assert.equal([...owner.db.myOnboarding.iter()].length, 0);
    await assert.rejects(outsider.reducers.completeOnboarding({}));
    await assert.rejects(subscribe(author, ['member_onboarding']));
    checks.push('tutorial propio e idempotente, sin acceso para terceros ni invitados');

    await author.reducers.openDirectConversation({ other: otherId });
    const conversationId = [...author.db.myDirectConversations.iter()][0]!.id.toString();
    await author.reducers.setTyping({ scope: 'direct', conversationId, typing: true });
    await waitFor(
      () => presence(other).some((row) => row.scope === 'direct'),
      'El destinatario no recibió el estado de escritura.',
    );
    assert.equal(presence(owner).length, 0);
    assert.equal(presence(outsider).length, 0);
    assert.ok(presence(other)[0]!.expiresAt.toDate().getTime() <= Date.now() + 7500);
    assert.ok(
      !Object.keys(presence(other)[0]!).some((key) => ['text', 'draft', 'body'].includes(key)),
    );
    await assert.rejects(
      owner.reducers.setTyping({ scope: 'direct', conversationId, typing: true }),
    );
    await assert.rejects(subscribe(other, ['chat_typing']));
    checks.push(
      'escritura directa solo para participantes, sin excepción administrativa ni texto de borradores',
    );

    await other.reducers.setMemberBlocked({ memberId: authorId, blocked: true });
    await waitFor(() => presence(other).length === 0, 'El bloqueo no retiró la presencia.');
    await assert.rejects(
      author.reducers.setTyping({ scope: 'direct', conversationId, typing: true }),
    );
    await other.reducers.setMemberBlocked({ memberId: authorId, blocked: false });
    await author.reducers.setTyping({ scope: 'direct', conversationId, typing: false });
    await waitFor(() => presence(other).length === 0, 'No se retiró la presencia al parar.');
    checks.push('bloqueo revoca visibilidad y escritura; detener limpia la presencia');

    await author.reducers.setTyping({ scope: 'group', conversationId: 'general', typing: true });
    await waitFor(
      () => presence(owner).some((row) => row.scope === 'group'),
      'No llegó la presencia del grupo.',
    );
    await assert.rejects(
      outsider.reducers.setTyping({ scope: 'group', conversationId: 'general', typing: true }),
    );
    await assert.rejects(
      author.reducers.setTyping({
        scope: 'direct',
        conversationId: '18446744073709551616',
        typing: true,
      }),
    );
    await assert.rejects(
      author.reducers.setTyping({ scope: 'unknown', conversationId: 'general', typing: true }),
    );
    await author.reducers.setTyping({ scope: 'group', conversationId: 'general', typing: false });
    await author.reducers.createChatChannel({
      name: 'Synthetic topic',
      kind: 'topic',
      subjectId: undefined,
    });
    const channelId = [...author.db.chatChannels.iter()][0]!.id;
    await author.reducers.setTyping({
      scope: 'channel',
      conversationId: channelId.toString(),
      typing: true,
    });
    await waitFor(
      () => presence(other).some((row) => row.scope === 'channel'),
      'No llegó la presencia del canal.',
    );
    await owner.reducers.setChatChannelArchived({ channelId, archived: true });
    await waitFor(
      () => !presence(other).some((row) => row.scope === 'channel'),
      'Un canal archivado conserva presencia.',
    );
    await assert.rejects(
      author.reducers.setTyping({
        scope: 'channel',
        conversationId: channelId.toString(),
        typing: true,
      }),
    );
    checks.push('canales y grupo con membresía, validación de destino y revocación al archivar');

    close();
    await options.restart();
    owner = await connect(options.tokens[0]!);
    author = await connect(options.tokens[1]!);
    other = await connect(options.tokens[2]!);
    for (const connection of [owner, author, other]) await subscribe(connection, views);
    assert.equal([...author.db.myOnboarding.iter()].length, 1);
    assert.equal([...other.db.myOnboarding.iter()].length, 0);
    await author.reducers.setTyping({ scope: 'direct', conversationId, typing: true });
    await waitFor(
      () => presence(other).some((row) => row.scope === 'direct'),
      'No llegó la presencia después del reinicio.',
    );
    await owner.reducers.removeMember({ identity: authorId });
    await waitFor(() => presence(other).length === 0, 'La baja no revocó la presencia.');
    await waitFor(
      () => [...author.db.myOnboarding.iter()].length === 0,
      'La baja no vació la vista privada.',
    );
    await assert.rejects(
      author.reducers.setTyping({ scope: 'group', conversationId: 'general', typing: true }),
    );
    checks.push(
      'tutorial persiste tras reiniciar; la baja revoca inmediatamente vistas y acciones',
    );
    return { checks: checks.length, verified: checks };
  } finally {
    close();
  }
}
