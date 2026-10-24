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
      ['subjects', 'notes', 'note_details', 'note_versions', 'resource_files', 'my_trash_entries', 'contribution_origins'].map((name) => `SELECT * FROM ${name}`));
  }), 'suscribir');
  const upload = async (connection: DbConnection, id: bigint, bytes: Uint8Array) => {
    const uploadId = randomUUID();
    await connection.reducers.beginResourceUpload({ uploadId, targetKind: 'note', targetId: id, expectedVersion: 1,
      name: 'synthetic-retention.txt', mime: 'text/plain', bytes: BigInt(bytes.length), sha256: hash(bytes) });
    await connection.reducers.putResourceChunk({ uploadId, index: 0, bytes, sha256: hash(bytes) });
    await connection.reducers.finalizeResourceUpload({ uploadId }); return uploadId;
  };
  try {
    const owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({ issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
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
    return { database: options.database, checks, acceleratedSeconds: 4, productionRetentionDays: 30 };
  } finally { for (const connection of connections) connection.disconnect(); }
}
