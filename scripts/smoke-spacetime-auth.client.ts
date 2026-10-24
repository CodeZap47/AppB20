import assert from 'node:assert/strict';
import { setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';

export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>();
  const checks: string[] = [];
  const connect = (token: string) => new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Conexión local vencida.')), 15_000);
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none')
      .onConnect((ready) => { clearTimeout(timer); resolve(ready); })
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
    connections.add(connection);
  });
  const subscribe = (connection: DbConnection, names = ['my_member','my_auth_identity','members','group_messages','my_direct_conversations','my_direct_messages','my_onboarding','typing_presence']) => new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx,error) => reject(error)).subscribe(names.map((name) => `SELECT * FROM ${name}`));
  });
  const waitFor = async (predicate: () => boolean) => {
    const end = Date.now() + 6000;
    while (!predicate()) { if (Date.now() > end) throw new Error('No llegó la actualización esperada.'); await new Promise((resolve) => setTimeout(resolve,15)); }
  };
  const close = () => { for (const c of connections) c.disconnect(); connections.clear(); };
  try {
    let owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({ issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
    for (const name of ['author','other']) await owner.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator: false });
    const oldAuthor = await connect(options.tokens[1]!);
    await oldAuthor.reducers.joinGroup({ displayName: 'Original author' });
    const oldOther = await connect(options.tokens[2]!);
    await oldOther.reducers.joinGroup({ displayName: 'Original recipient' });
    await subscribe(oldAuthor); await subscribe(oldOther);
    const authorId = oldAuthor.identity!, otherId = oldOther.identity!;
    await oldAuthor.reducers.sendGroupMessage({ text: 'Original group message', replyToId: undefined });
    await oldAuthor.reducers.completeOnboarding({});
    await oldAuthor.reducers.openDirectConversation({ other: otherId });
    const conversationId = [...oldAuthor.db.myDirectConversations.iter()][0]!.id;
    await oldAuthor.reducers.sendDirectMessage({ conversationId, text: 'Original private message', replyToId: undefined });
    const groupId = [...oldAuthor.db.groupMessages.iter()][0]!.id;
    const privateId = [...oldAuthor.db.myDirectMessages.iter()][0]!.id;
    // El corte cambia la audiencia aceptada: las sesiones anteriores dejan de valer al instante.
    close();
    owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({ issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['authenticated'] });
    // El servidor rechaza la conexión de la sesión anterior (on_connect falla).
    await assert.rejects(connect(options.tokens[1]!));
    let author = await connect(options.tokens[4]!);
    let other = await connect(options.tokens[5]!);
    const outsider = await connect(options.tokens[6]!);
    await subscribe(author); await subscribe(other); await subscribe(outsider);
    assert.equal([...author.db.myMember.iter()].length,0);
    await assert.rejects(author.reducers.assertActiveMember({}));
    await owner.reducers.linkAuthIdentity({ sessionIdentity: author.identity!, memberIdentity: authorId });
    await owner.reducers.linkAuthIdentity({ sessionIdentity: other.identity!, memberIdentity: otherId });
    await waitFor(() => [...author.db.myMember.iter()].length === 1 && [...other.db.myMember.iter()].length === 1);
    assert.equal([...author.db.myMember.iter()][0]!.identity.toHexString(),authorId.toHexString());
    assert.equal([...author.db.myAuthIdentity.iter()][0]!.sessionIdentity.toHexString(),author.identity!.toHexString());
    assert.equal([...outsider.db.myAuthIdentity.iter()].length,0);
    assert.equal([...author.db.myOnboarding.iter()].length,1);
    await author.reducers.assertActiveMember({});
    await assert.rejects(author.reducers.linkAuthIdentity({ sessionIdentity: outsider.identity!, memberIdentity: authorId }));
    checks.push('owner vincula identidades nuevas sin duplicar membresías, tutorial ni permisos');
    await author.reducers.editMessage({ scope: 'group', messageId: groupId, text: 'Updated through Supabase' });
    await author.reducers.editMessage({ scope: 'direct', messageId: privateId, text: 'Updated private message' });
    await author.reducers.sendDirectMessage({ conversationId, text: 'New private message', replyToId: undefined });
    await author.reducers.setTyping({ scope: 'direct', conversationId: conversationId.toString(), typing: true });
    await waitFor(() => [...other.db.typingPresence.iter()].some((row) => row.memberId.isEqual(authorId)));
    assert.equal([...outsider.db.typingPresence.iter()].length,0);
    await waitFor(() => [...other.db.myDirectMessages.iter()].length === 2);
    assert.ok([...other.db.myDirectMessages.iter()].every((row) => row.sender.isEqual(authorId)));
    assert.equal([...outsider.db.myDirectMessages.iter()].length,0);
    await assert.rejects(other.reducers.editMessage({ scope: 'group', messageId: groupId, text: 'Not mine' }));
    await assert.rejects(outsider.reducers.sendDirectMessage({ conversationId, text: 'Not allowed', replyToId: undefined }));
    checks.push('autoría, edición e historial de mensajes conservados; privacidad y propiedad intactas');
    close(); await options.restart();
    owner = await connect(options.tokens[0]!); author = await connect(options.tokens[4]!); other = await connect(options.tokens[5]!);
    await subscribe(author); await subscribe(other);
    assert.equal([...author.db.myMember.iter()][0]!.identity.toHexString(),authorId.toHexString());
    assert.equal([...other.db.myDirectMessages.iter()].length,2);
    checks.push('vinculación e historial sobreviven al reinicio real del servidor');
    await owner.reducers.removeMember({ identity: authorId });
    await waitFor(() => [...author.db.myDirectMessages.iter()].length === 0);
    await assert.rejects(author.reducers.assertActiveMember({}));
    await assert.rejects(author.reducers.sendGroupMessage({ text: 'Removed', replyToId: undefined }));
    checks.push('la baja revoca lecturas y acciones del login vinculado inmediatamente');
    return { checks: checks.length, verified: checks };
  } finally { close(); }
}
