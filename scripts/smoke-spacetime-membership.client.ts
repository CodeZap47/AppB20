import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';

export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  setGlobalLogLevel('error'); const connections = new Set<DbConnection>(); const checks: string[] = [];
  const connect = (token: string) => new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Conexión sintética vencida.')), 15_000);
    const c = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none')
      .onConnect(ready => { clearTimeout(timer); resolve(ready); }).onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
    connections.add(c);
  });
  const subscribe = (connection: DbConnection) => new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error))
      .subscribe(['my_member', 'my_auth_identity', 'members', 'feed_posts', 'group_messages'].map(name => `SELECT * FROM ${name}`));
  });
  const until = async (test: () => boolean) => {
    const end = Date.now() + 6000;
    while (!test()) { if (Date.now() > end) throw new Error('No llegó el cambio de acceso esperado.'); await new Promise(resolve => setTimeout(resolve, 20)); }
  };
  const payload = (input: unknown) => ({ payload: JSON.stringify(input) });
  const create = async (c: DbConnection, extra: Record<string, unknown> = {}) => {
    const token = randomBytes(32).toString('base64url'), id = randomUUID();
    const input = { id, name: 'Synthetic invitation', tokenHash: createHash('sha256').update(token).digest('hex'), ciphertext: 'synthetic-ciphertext', iv: 'synthetic-iv', keyVersion: 'v1', ...extra };
    const result = JSON.parse(await c.procedures.invitationLinkCreate(payload(input)));
    return { token, id, input, result };
  };
  const close = () => { for (const c of connections) c.disconnect(); connections.clear(); };
  try {
    let owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({ issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['b20-local-smoke'] });
    await owner.reducers.setSupabaseAuth({ issuer: 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1', audiences: ['authenticated'], enabled: true });
    const first = await create(owner);
    assert.equal(first.result.maxUses, null); assert.equal(first.result.expiresAt - first.result.createdAt, 7 * 86_400_000);
    const retry = JSON.parse(await owner.procedures.invitationLinkCreate(payload({ ...first.input, ciphertext: 'different-retry-ciphertext' })));
    assert.equal(retry.ciphertext, first.result.ciphertext);
    let author = await connect(options.tokens[1]!);
    await author.procedures.joinWithInvitationLink({ token: first.token, displayName: 'Synthetic link author' });
    const authorId = author.identity!;
    await subscribe(author);
    await author.reducers.createFeedPost({ text: 'Synthetic contribution survives link deactivation and member removal', requestId: randomUUID(), subjectId: undefined });
    await author.reducers.sendGroupMessage({ text: 'Synthetic group message', replyToId: undefined });
    await owner.procedures.invitationLinkRevoke(payload({ id: first.id }));
    await assert.rejects(owner.procedures.invitationLinkCopy(payload({ id: first.id })));
    await author.reducers.assertActiveMember({});
    assert.equal(JSON.parse(await author.procedures.joinWithInvitationLink({ token: first.token, displayName: 'Idempotent member' })).alreadyMember, true);
    await owner.reducers.inviteMember({ email: 'other@b20-smoke.invalid', isCreator: false });
    let peer = await connect(options.tokens[2]!); await peer.reducers.joinGroup({ displayName: 'Synthetic peer' }); await subscribe(peer);
    assert.equal([...peer.db.feedPosts.iter()].length, 1);
    checks.push('7 días sin cupo por defecto, secreto recuperable idempotente y revocación conserva accesos y aportes');

    const replacement = await create(owner); // Enlace independiente para verificar que una baja no lo puede aprovechar.
    const removeId = randomUUID();
    const remove = { operationId: removeId, identity: authorId.toHexString(), generation: 1, action: 'remove', reason: '', bulk: true, invitationLinkId: first.id };
    assert.equal(JSON.parse(await owner.procedures.adminMemberAccess(payload(remove))).status, 'applied');
    await until(() => [...author.db.groupMessages.iter()].length === 0 && [...author.db.feedPosts.iter()].length === 0);
    await assert.rejects(author.reducers.assertActiveMember({}));
    await assert.rejects(author.procedures.joinWithInvitationLink({ token: replacement.token, displayName: 'Removed' }));
    assert.equal([...peer.db.feedPosts.iter()].length, 1);
    assert.equal(JSON.parse(await owner.procedures.adminMemberAccess(payload(remove))).status, 'applied');
    await owner.reducers.inviteMember({ email: 'author@b20-smoke.invalid', isCreator: false });
    assert.equal(JSON.parse(await author.procedures.myMembershipAccess({})).canRejoin, true);
    await author.reducers.joinGroup({ displayName: 'Ignored new display name' });
    const stale = JSON.parse(await owner.procedures.adminMemberAccess(payload({ ...remove, operationId: randomUUID() })));
    assert.equal(stale.status, 'skipped'); await author.reducers.assertActiveMember({});
    checks.push('sesiones abiertas pierden lecturas, baja exige reinvitación y una selección antigua conserva la nueva generación');

    let linked = await connect(options.tokens[4]!); const linkedId = linked.identity!;
    await owner.reducers.linkAuthIdentity({ sessionIdentity: linkedId, memberIdentity: authorId });
    linked.disconnect(); connections.delete(linked); linked = await connect(options.tokens[4]!); await subscribe(linked);
    await linked.reducers.assertActiveMember({});
    await owner.procedures.blockEmail(payload({ operationId: randomUUID(), email: 'author@b20-smoke.invalid', reason: 'Synthetic block' }));
    await until(() => [...linked.db.groupMessages.iter()].length === 0);
    assert.equal(JSON.parse(await linked.procedures.myMembershipAccess({})).blocked, true);
    linked.disconnect(); connections.delete(linked); linked = await connect(options.tokens[4]!);
    assert.equal(JSON.parse(await linked.procedures.myMembershipAccess({})).blocked, true);
    await assert.rejects(owner.reducers.inviteMember({ email: 'supabase-author@b20-smoke.invalid', isCreator: false }));
    await owner.procedures.unblockEmail(payload({ operationId: randomUUID(), email: 'author@b20-smoke.invalid' }));
    assert.deepEqual(JSON.parse(await linked.procedures.myMembershipAccess({})), { blocked: false, canRejoin: false });
    await owner.reducers.inviteMember({ email: 'author@b20-smoke.invalid', isCreator: false });
    await author.reducers.joinGroup({ displayName: 'Same stable author' });
    let snapshot = JSON.parse(await owner.procedures.adminMembershipSnapshot({}));
    const member = snapshot.members.find((row: { identity: string }) => row.identity === authorId.toHexString());
    assert.equal(member.generation, 3); assert.equal(member.emails.length, 2);
    assert.equal(snapshot.blockedEmails.length, 0);
    assert.ok(!JSON.stringify(snapshot).includes('synthetic-ciphertext'));
    checks.push('ambos proveedores comparten membresía estable, bloqueo afecta aliases y desbloqueo conserva la baja');

    const limited = await create(owner, { maxUses: 1, expiresAt: null });
    const outsider = await connect(options.tokens[3]!), alternate = await connect(options.tokens[6]!);
    const joins = await Promise.allSettled([outsider, alternate].map(c => c.procedures.joinWithInvitationLink({ token: limited.token, displayName: 'Synthetic final slot' })));
    assert.equal(joins.filter(result => result.status === 'fulfilled').length, 1);
    snapshot = JSON.parse(await owner.procedures.adminMembershipSnapshot({}));
    assert.equal(snapshot.links.find((row: { id: string }) => row.id === limited.id).usedCount, 1);
    await assert.rejects(owner.procedures.invitationLinkCopy(payload({ id: limited.id })));
    checks.push('dos canjes concurrentes del último cupo producen exactamente una incorporación');

    close(); await options.restart(); owner = await connect(options.tokens[0]!); author = await connect(options.tokens[1]!); peer = await connect(options.tokens[2]!);
    await subscribe(author); await subscribe(peer);
    snapshot = JSON.parse(await owner.procedures.adminMembershipSnapshot({}));
    assert.equal(snapshot.members.find((row: { identity: string }) => row.identity === authorId.toHexString()).generation, 3);
    assert.equal([...peer.db.feedPosts.iter()].length, 1);
    assert.equal(JSON.parse(await owner.procedures.invitationLinkCopy(payload({ id: replacement.id }))).ciphertext, 'synthetic-ciphertext');
    checks.push('historial, generaciones, envelope y aportes conservados sobreviven un reinicio real');
    return { checks: checks.length, verified: checks };
  } finally { close(); }
}
