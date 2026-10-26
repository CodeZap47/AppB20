import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';

const CHUNK_BYTES = 1024 * 1024;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bounded = <T>(pending: Promise<T>, label: string): Promise<T> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Tiempo agotado: ${label}`)), 30_000);
  pending.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});
const waitForSubscription = async (ready: () => boolean, label: string): Promise<void> => {
  const deadline = performance.now() + 30_000;
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error(`Tiempo agotado esperando la suscripción: ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
};

export async function runSmoke(options: {
  address: string; database: string; tokens: string[]; restart(): Promise<void>;
}) {
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>();
  const checks: string[] = [];
  const connect = (token: string) => bounded(new Promise<DbConnection>((resolve, reject) => {
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database)
      .withToken(token).withCompression('none').onConnect((ready) => resolve(ready))
      .onConnectError((_ctx, error) => reject(error)).build();
    connections.add(connection);
  }), 'conexión');
  const subscribe = (connection: DbConnection, queries: string[]) => bounded(new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(queries);
  }), 'suscripción');
  const close = () => { for (const connection of connections) connection.disconnect(); connections.clear(); };
  const groupViews = ['subjects', 'assignments', 'works', 'resource_files', 'work_revisions', 'work_details',
    'activities', 'evidences', 'evidence_details', 'member_upload_stats'];
  const observe = (connection: DbConnection) => subscribe(connection, groupViews.map((name) => `SELECT * FROM ${name}`));
  const uploadStats = (connection: DbConnection, memberId: string) => [...connection.db.memberUploadStats.iter()]
    .find((row) => row.memberId.toHexString() === memberId);
  try {
    let owner = await connect(options.tokens[0]);
    await owner.reducers.setAuthConfig({ issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
    await owner.reducers.inviteMember({ email: 'owner@b20-smoke.invalid', isCreator: true });
    await owner.reducers.inviteMember({ email: 'author@b20-smoke.invalid', isCreator: false });
    await owner.reducers.joinGroup({ displayName: 'Local owner' });
    let author = await connect(options.tokens[1]);
    await author.reducers.joinGroup({ displayName: 'Local author' });
    let outsider = await connect(options.tokens[2]);
    await assert.rejects(outsider.reducers.joinGroup({ displayName: 'Local outsider' }), /autorizada/);
    await observe(owner); await observe(author); await observe(outsider);
    assert.equal([...outsider.db.subjects.iter()].length, 0);
    assert.equal([...outsider.db.memberUploadStats.iter()].length, 0);
    const authorId = author.identity!.toHexString();
    assert.deepEqual(uploadStats(owner, authorId), { memberId: author.identity, bytes: 0n, fileCount: 0n });
    await author.reducers.createSubject({ name: 'Local smoke', period: 1 });
    const subjectId = [...author.db.subjects.iter()][0].id;
    await author.reducers.createAssignmentV2({ subjectId, termId: undefined, kind: 'tarea', title: 'Local assignment',
      instructions: 'Synthetic smoke data only', dueDate: '', topic: 'Files' });
    const assignmentId = [...author.db.assignments.iter()][0].id;
    await author.reducers.publishWorkV2({ assignmentId, title: 'Local work', description: 'Synthetic content',
      coauthors: [], topic: 'Files', status: 'draft' });
    const workId = [...author.db.works.iter()][0].id;
    checks.push('tres identidades sintéticas, invitación y datos sincronizados');

    const bytes = Uint8Array.from({ length: CHUNK_BYTES + 31 }, (_, index) => index % 251);
    const uploadId = randomUUID();
    const input = { uploadId, targetKind: 'work', targetId: workId, expectedVersion: 1,
      name: 'synthetic.bin', mime: 'application/octet-stream', bytes: BigInt(bytes.length), sha256: hash(bytes) };
    await assert.rejects(author.reducers.beginResourceUpload({ ...input, uploadId: randomUUID(), bytes: 0n }), /1 byte/);
    await assert.rejects(author.reducers.beginResourceUpload({ ...input, uploadId: randomUUID(), bytes: 50n * BigInt(CHUNK_BYTES) + 1n }), /50/);
    await author.reducers.beginResourceUpload(input);
    await author.reducers.beginResourceUpload(input);
    await assert.rejects(author.reducers.finalizeResourceUpload({ uploadId }), /Faltan bloques/);
    await assert.rejects(author.reducers.putResourceChunk({ uploadId, index: 0, bytes: bytes.slice(0, CHUNK_BYTES),
      sha256: '0'.repeat(64) }), /integridad/);
    const first = { uploadId, index: 0, bytes: bytes.slice(0, CHUNK_BYTES), sha256: hash(bytes.slice(0, CHUNK_BYTES)) };
    await author.reducers.putResourceChunk(first);
    await author.reducers.putResourceChunk(first);
    assert.equal(uploadStats(owner, authorId)?.bytes, 0n);
    assert.deepEqual(JSON.parse(await author.procedures.getResourceUploadStatus({ uploadId })).receivedIndexes, [0]);
    const mutated = first.bytes.slice(); mutated[0] ^= 1;
    await assert.rejects(author.reducers.putResourceChunk({ ...first, bytes: mutated, sha256: hash(mutated) }), /sustituirse/);
    checks.push('validación de límite, integridad, bloques inmutables y reintentos idempotentes');

    await assert.rejects(owner.procedures.getResourceUploadStatus({ uploadId }), /pertenece/);
    await assert.rejects(subscribe(author, ['SELECT * FROM resource_chunk']));
    await assert.rejects(subscribe(author, ['SELECT * FROM resource_upload']));
    checks.push('tablas binarias privadas y estado de subida aislado');

    close(); await options.restart();
    owner = await connect(options.tokens[0]); author = await connect(options.tokens[1]); outsider = await connect(options.tokens[2]);
    await observe(owner); await observe(author); await observe(outsider);
    assert.deepEqual(JSON.parse(await author.procedures.getResourceUploadStatus({ uploadId })).receivedIndexes, [0]);
    const last = bytes.slice(CHUNK_BYTES);
    await author.reducers.putResourceChunk({ uploadId, index: 1, bytes: last, sha256: hash(last) });
    await author.reducers.finalizeResourceUpload({ uploadId });
    await author.reducers.finalizeResourceUpload({ uploadId });
    assert.equal([...author.db.works.iter()][0].version, 2);
    // El acuse de autor no es una barrera para las suscripciones de otras sesiones.
    await waitForSubscription(() => [...owner.db.resourceFiles.iter()].some((row) => row.id === uploadId), 'archivo visible para el propietario');
    assert.equal([...owner.db.resourceFiles.iter()].filter((row) => row.id === uploadId).length, 1);
    await waitForSubscription(() => uploadStats(owner, authorId)?.bytes === BigInt(bytes.length), 'totales al confirmar adjunto');
    assert.equal(uploadStats(owner, authorId)?.fileCount, 1n);
    assert.deepEqual(Object.keys(uploadStats(owner, authorId)!).sort(), ['bytes', 'fileCount', 'memberId']);
    checks.push('totales de perfiles actualizados en otra sesión sin exponer metadatos ni contar cargas incompletas');
    checks.push('subida reanudada después de reiniciar el servidor y confirmada una sola vez');

    const manifest = JSON.parse(await owner.procedures.getResourceManifest({ fileId: uploadId }));
    assert.equal(manifest.storageKind, 'spacetime'); assert.equal(manifest.chunkCount, 2);
    const result = new Uint8Array(bytes.length);
    for (let index = 0; index < manifest.chunkCount; index++) {
      const chunk = await owner.procedures.readResourceChunk({ fileId: uploadId, index });
      assert.equal(hash(chunk.bytes), chunk.sha256); result.set(chunk.bytes, index * CHUNK_BYTES);
    }
    assert.equal(hash(result), hash(bytes));
    await assert.rejects(outsider.procedures.getResourceManifest({ fileId: uploadId }), /activo/);
    await assert.rejects(outsider.procedures.readResourceChunk({ fileId: uploadId, index: 0 }), /activo/);
    // Una nueva suscripción aplicada comprueba el estado actual, sin depender del retraso de eventos.
    await observe(outsider);
    assert.equal([...outsider.db.resourceFiles.iter()].length, 0);
    checks.push('descarga binaria íntegra y rechazo de una cuenta ajena al grupo');

    await author.reducers.removeResourceFile({ fileId: uploadId, expectedVersion: 2 });
    await waitForSubscription(() => uploadStats(owner, authorId)?.fileCount === 0n, 'totales al quitar adjunto');
    assert.equal(uploadStats(owner, authorId)?.bytes, 0n);
    assert.equal(JSON.parse(await author.procedures.getResourceManifest({ fileId: uploadId })).sha256, hash(bytes));
    await author.reducers.restoreWorkVersion({ workId, version: 2, expectedVersion: 3 });
    await waitForSubscription(() => uploadStats(owner, authorId)?.fileCount === 1n, 'totales al restaurar adjunto');
    assert.equal([...author.db.works.iter()][0].version, 4);
    const cancelledId = randomUUID();
    await author.reducers.beginResourceUpload({ ...input, uploadId: cancelledId, expectedVersion: 4 });
    await author.reducers.putResourceChunk({ ...first, uploadId: cancelledId });
    await author.reducers.cancelResourceUpload({ uploadId: cancelledId });
    assert.deepEqual(JSON.parse(await author.procedures.getResourceUploadStatus({ uploadId: cancelledId })).receivedIndexes, []);
    await owner.reducers.setResourceCapacity({ bytes: BigInt(bytes.length) });
    await assert.rejects(author.reducers.beginResourceUpload({ ...input, uploadId: randomUUID(), expectedVersion: 4 }), /espacio/);
    await owner.reducers.setResourceCapacity({ bytes: 256n * BigInt(CHUNK_BYTES) });
    checks.push('historial recuperable, cancelación y reserva de capacidad');

    await author.reducers.createActivity({ subjectId, termId: undefined, topic: 'Files', date: '2026-10-21',
      title: 'Local evidence activity', objective: 'Recover evidence attachments', instructions: 'Synthetic data only' });
    const activityId = [...author.db.activities.iter()][0].id;
    await author.reducers.addEvidence({ activityId, content: 'Synthetic evidence', participants: [] });
    const evidenceId = [...author.db.evidences.iter()][0].id;
    const evidenceBytes = new TextEncoder().encode('Persistent evidence attachment');
    const evidenceFileId = randomUUID();
    await author.reducers.beginResourceUpload({ ...input, uploadId: evidenceFileId, targetKind: 'evidence',
      targetId: evidenceId, expectedVersion: 1, name: 'evidence.txt', mime: 'text/plain',
      bytes: BigInt(evidenceBytes.length), sha256: hash(evidenceBytes) });
    await author.reducers.putResourceChunk({ uploadId: evidenceFileId, index: 0, bytes: evidenceBytes, sha256: hash(evidenceBytes) });
    await author.reducers.finalizeResourceUpload({ uploadId: evidenceFileId });
    await author.reducers.removeResourceFile({ fileId: evidenceFileId, expectedVersion: 2 });
    assert.notEqual([...author.db.resourceFiles.iter()].find((row) => row.id === evidenceFileId)?.removedAt, undefined);
    assert.equal((await owner.procedures.readResourceChunk({ fileId: evidenceFileId, index: 0 })).sha256, hash(evidenceBytes));
    await assert.rejects(owner.reducers.restoreResourceFile({ fileId: evidenceFileId, expectedVersion: 3 }), /Solo el autor/);
    await assert.rejects(outsider.reducers.restoreResourceFile({ fileId: evidenceFileId, expectedVersion: 3 }), /activo/);
    await assert.rejects(author.reducers.restoreResourceFile({ fileId: evidenceFileId, expectedVersion: 2 }), /cambió/);
    await author.reducers.restoreResourceFile({ fileId: evidenceFileId, expectedVersion: 3 });
    await author.reducers.restoreResourceFile({ fileId: evidenceFileId, expectedVersion: 3 });
    assert.equal([...author.db.resourceFiles.iter()].find((row) => row.id === evidenceFileId)?.removedAt, undefined);
    assert.equal([...author.db.evidenceDetails.iter()].find((row) => row.evidenceId === evidenceId)?.version, 4);
    assert.equal(hash((await owner.procedures.readResourceChunk({ fileId: evidenceFileId, index: 0 })).bytes), hash(evidenceBytes));
    checks.push('adjuntos de evidencia retirados, legibles y recuperables solo por su autor sin duplicar versiones');

    // Prueba el mayor archivo permitido a través del protocolo binario real y del SHA-256 del servidor.
    const maximum = new Uint8Array(50 * CHUNK_BYTES); maximum.fill(97);
    const maximumId = randomUUID();
    const maximumStart = performance.now();
    await author.reducers.beginResourceUpload({ ...input, uploadId: maximumId, expectedVersion: 4,
      name: 'maximum-50MiB.bin', bytes: BigInt(maximum.length), sha256: hash(maximum) });
    const maximumChunk = maximum.slice(0, CHUNK_BYTES);
    const maximumChunkHash = hash(maximumChunk);
    for (let index = 0; index < 50; index++) await bounded(author.reducers.putResourceChunk({
      uploadId: maximumId, index, bytes: maximumChunk, sha256: maximumChunkHash }), `bloque máximo ${index}`);
    await bounded(author.reducers.finalizeResourceUpload({ uploadId: maximumId }), 'confirmación de 50 MiB');
    assert.equal(JSON.parse(await owner.procedures.getResourceManifest({ fileId: maximumId })).bytes, String(maximum.length));
    const maximumSeconds = Math.round((performance.now() - maximumStart) / 100) / 10;
    checks.push('archivo de 50 MiB completo, con verificación SHA-256 en el servidor');

    close(); await options.restart();
    owner = await connect(options.tokens[0]); author = await connect(options.tokens[1]);
    await observe(owner); await observe(author);
    assert.equal(JSON.parse(await author.procedures.getResourceManifest({ fileId: maximumId })).chunkCount, 50);
    const recovered = await author.procedures.readResourceChunk({ fileId: uploadId, index: 0 });
    assert.equal(hash(recovered.bytes), first.sha256);
    assert.equal(hash((await author.procedures.readResourceChunk({ fileId: evidenceFileId, index: 0 })).bytes), hash(evidenceBytes));
    await owner.reducers.removeMember({ identity: author.identity! });
    await waitForSubscription(() => uploadStats(owner, authorId) === undefined && [...author.db.memberUploadStats.iter()].length === 0,
      'totales revocados al dar de baja al miembro');
    await assert.rejects(author.procedures.readResourceChunk({ fileId: uploadId, index: 0 }), /activo/);
    checks.push('archivos confirmados persistentes tras reinicio y acceso revocado inmediatamente');
    return { checks, maximumFileBytes: maximum.length, maximumUploadSeconds: maximumSeconds };
  } finally { close(); }
}
