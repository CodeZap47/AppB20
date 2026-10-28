import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
import type { VisualProject, VisualProjectInput } from '../packages/core/src/visualProjects';
import { emptyVisualSceneDocument, identityVisualTransform, type VisualScene } from '../packages/core/src/visualScenes';

function modelBytes() {
  const bin = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Conjunto', children: [1, 2] }, { name: 'Pieza', mesh: 0 }, { name: 'Pieza', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteLength: bin.length }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }] }));
  const size = Math.ceil(json.length / 4) * 4, bytes = new Uint8Array(28 + size + bin.length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, size, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + size); bytes.set(json, 20);
  view.setUint32(20 + size, bin.length, true); view.setUint32(24 + size, 0x004e4942, true); bytes.set(bin, 28 + size); return bytes;
}

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function until(ready: () => boolean, label: string) {
  const deadline = performance.now() + 30_000;
  while (!ready()) {
    if (performance.now() > deadline) throw new Error(`Tiempo agotado: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/** Exercises the actual SDK, subscriptions, binary storage and database restart. */
export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>();
  const checks: string[] = [];
  const connect = (token: string) => new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tiempo agotado al conectar')), 30_000);
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database)
      .withToken(token).withCompression('none')
      .onConnect(ready => { clearTimeout(timer); resolve(ready); })
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
    connections.add(connection);
  });
  const observe = (connection: DbConnection) => new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error))
      .subscribe(['visual_projects', 'subjects', 'assignments', 'notes', 'resource_files'].map(view => `SELECT * FROM ${view}`));
  });
  const projects = (connection: DbConnection) => [...connection.db.visualProjects.iter()].map(row => JSON.parse(row.json) as VisualProject);
  const close = () => { for (const connection of connections) connection.disconnect(); connections.clear(); };
  try {
    let owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({ issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
    for (const [name, isCreator] of [['owner', true], ['author', false], ['reviewer', false]] as const) {
      await owner.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator });
    }
    await owner.reducers.joinGroup({ displayName: 'Visual test admin' });
    let author = await connect(options.tokens[1]!);
    await author.reducers.joinGroup({ displayName: 'Visual test author' });
    let reviewer = await connect(options.tokens[2]!);
    await reviewer.reducers.joinGroup({ displayName: 'Visual test peer' });
    let outsider = await connect(options.tokens[3]!);
    await Promise.all([owner, author, reviewer, outsider].map(observe));
    await author.reducers.createSubject({ name: 'Hardware · prueba local', period: 1 });
    const subjectId = [...author.db.subjects.iter()][0]!.id;
    await author.reducers.createAssignmentV2({ subjectId, termId: undefined, kind: 'tarea', title: 'Explicar una computadora',
      instructions: 'Solo datos sintéticos', dueDate: '', topic: 'Hardware' });
    const assignmentId = [...author.db.assignments.iter()][0]!.id;
    const noteInput = { noteId: undefined, subjectId, topic: 'Memoria', title: 'Fuente privada local', body: 'Solo datos sintéticos',
      tags: [], visibility: 'personal', source: 'student' };
    await author.reducers.saveNote(noteInput);
    const noteId = [...author.db.notes.iter()][0]!.id;
    const metadata: VisualProjectInput = { title: 'Computadora por capas', kind: '3d', description: 'Ficha sintética persistida',
      subjectIds: [String(subjectId)], links: [{ kind: 'assignment', id: String(assignmentId) }, { kind: 'note', id: String(noteId) }],
      resources: [{ label: 'Adafruit CAD', url: 'https://github.com/adafruit/Adafruit_CAD_Parts', provider: 'Adafruit', format: 'STEP' }] };
    const requestId = randomUUID();
    await author.reducers.saveVisualProject({ projectId: undefined, expectedVersion: undefined, requestId, payload: JSON.stringify(metadata) });
    await author.reducers.saveVisualProject({ projectId: undefined, expectedVersion: undefined, requestId, payload: JSON.stringify(metadata) });
    assert.equal(projects(author).length, 1);
    const projectId = BigInt(projects(author)[0]!.id);
    const current = () => projects(author).find(project => project.id === String(projectId))!;
    assert.equal(current().visibility, 'personal');
    assert.equal(projects(owner).length, 0); assert.equal(projects(reviewer).length, 0); assert.equal(projects(outsider).length, 0);
    await assert.rejects(owner.reducers.archiveVisualProject({ projectId, archived: true, expectedVersion: 1 }));
    await assert.rejects(author.reducers.setVisualProjectVisibility({ projectId, visibility: 'group', expectedVersion: 1 }));
    checks.push('creación idempotente, privacidad incluso ante administrador y publicación bloqueada por fuente personal');

    const cover = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1EAAAAASUVORK5CYII=', 'base64'));
    const fileId = randomUUID();
    const upload = { uploadId: fileId, targetKind: 'visual_project', targetId: projectId, expectedVersion: 1,
      name: 'portada.png', mime: 'image/png', bytes: BigInt(cover.length), sha256: hash(cover) };
    await assert.rejects(owner.reducers.beginResourceUpload({ ...upload, uploadId: randomUUID() }));
    await assert.rejects(author.reducers.beginResourceUpload({ ...upload, uploadId: randomUUID(), mime: 'image/svg+xml' }));
    await author.reducers.beginResourceUpload(upload);
    await author.reducers.putResourceChunk({ uploadId: fileId, index: 0, bytes: cover, sha256: hash(cover) });
    await author.reducers.finalizeResourceUpload({ uploadId: fileId });
    assert.equal(current().coverFileId, fileId); assert.equal(current().version, 2);
    await assert.rejects(owner.procedures.getResourceManifest({ fileId }));
    await assert.rejects(reviewer.procedures.readResourceChunk({ fileId, index: 0 }));
    const blob = await author.procedures.readResourceChunk({ fileId, index: 0 });
    assert.equal(hash(blob.bytes), hash(cover));
    checks.push('portada nativa PNG íntegra y privada, tipos inválidos y escritura ajena rechazados');

    await assert.rejects(author.reducers.saveVisualProject({ projectId, expectedVersion: 1, requestId: randomUUID(), payload: JSON.stringify(metadata) }));
    await author.reducers.publishNoteVersion({ noteId, expectedVersion: 1 });
    const publishedNoteId = [...author.db.notes.iter()].find(note => note.visibility === 'group')!.id;
    const publicMetadata = { ...metadata, links: [{ kind: 'assignment', id: String(assignmentId) }, { kind: 'note', id: String(publishedNoteId) }] };
    await author.reducers.saveVisualProject({ projectId, expectedVersion: 2, requestId: randomUUID(), payload: JSON.stringify(publicMetadata) });
    await author.reducers.setVisualProjectVisibility({ projectId, visibility: 'group', expectedVersion: 3 });
    await until(() => projects(reviewer).length === 1, 'proyecto compartido');
    assert.equal(projects(reviewer)[0]!.links.length, 2);
    assert.equal(hash((await reviewer.procedures.readResourceChunk({ fileId, index: 0 })).bytes), hash(cover));
    await author.reducers.withdrawContent({ kind: 'note', targetId: publishedNoteId, withdrawn: true,
      expectedVersion: 1, reason: 'Retirada sintética local', acknowledgeImpact: undefined });
    await until(() => projects(reviewer)[0]?.links.length === 1, 'ocultar referencia retirada');
    await until(() => projects(owner)[0]?.links.length === 1, 'vista del administrador sin referencia retirada');
    assert.equal(projects(reviewer)[0]!.links[0]!.kind, 'assignment');
    checks.push('publicación con fuentes compartidas, conflicto de versiones y ocultación inmediata de fuente retirada');

    const unavailable = { kind: 'note' as const, id: String(publishedNoteId) };
    await until(() => current().unavailableLinks?.length === 1, 'marcador privado del autor');
    assert.deepEqual(current().unavailableLinks, [unavailable]);
    assert.equal(projects(reviewer)[0]!.unavailableLinks, undefined);
    assert.equal(projects(owner)[0]!.unavailableLinks, undefined);
    const revisedTitle = 'Computadora por capas · revisión';
    await author.reducers.saveVisualProject({ projectId, expectedVersion: current().version, requestId: randomUUID(),
      payload: JSON.stringify({ ...publicMetadata, title: revisedTitle, links: [{ kind: 'assignment', id: String(assignmentId) }] }) });
    assert.deepEqual(current().unavailableLinks, [unavailable]);
    await author.reducers.withdrawContent({ kind: 'note', targetId: publishedNoteId, withdrawn: false,
      expectedVersion: 2, reason: '', acknowledgeImpact: undefined });
    await until(() => current().links.length === 2, 'referencia conservada resuelve al restaurar fuente');
    assert.equal(current().unavailableLinks?.length ?? 0, 0);
    await author.reducers.withdrawContent({ kind: 'note', targetId: publishedNoteId, withdrawn: true,
      expectedVersion: 3, reason: 'Retirada durante edición sintética', acknowledgeImpact: undefined });
    // A form loaded before the withdrawal still sends the old visible relation.
    await author.reducers.saveVisualProject({ projectId, expectedVersion: current().version, requestId: randomUUID(),
      payload: JSON.stringify({ ...publicMetadata, title: revisedTitle }) });
    assert.deepEqual(current().unavailableLinks, [unavailable]);
    await assert.rejects(author.reducers.saveVisualProject({ projectId, expectedVersion: current().version, requestId: randomUUID(),
      payload: JSON.stringify({ ...publicMetadata, title: revisedTitle, links: [{ kind: 'assignment', id: String(assignmentId) },
        { kind: 'note', id: String(noteId) }], removedLinks: [unavailable] }) }));
    assert.deepEqual(current().unavailableLinks, [unavailable]);
    checks.push('referencias retiradas conservadas en guardados antiguos y en carreras de edición, con marcadores exclusivos del autor');

    await author.reducers.archiveVisualProject({ projectId, archived: true, expectedVersion: current().version });
    await until(() => projects(reviewer).length === 0, 'archivo deja de ser visible al grupo');
    await assert.rejects(reviewer.procedures.getResourceManifest({ fileId }));
    assert.equal(current().archived, true);
    await author.reducers.archiveVisualProject({ projectId, archived: false, expectedVersion: current().version });
    await until(() => projects(reviewer).length === 1, 'proyecto restaurado');
    await author.reducers.setVisualProjectVisibility({ projectId, visibility: 'personal', expectedVersion: current().version });
    await until(() => projects(reviewer).length === 0, 'proyecto vuelve a privado');
    await assert.rejects(reviewer.procedures.getResourceManifest({ fileId }));
    await assert.rejects(author.reducers.setVisualProjectVisibility({ projectId, visibility: 'group', expectedVersion: current().version }));
    checks.push('archivar, restaurar y volver a privado revocan metadatos y descarga de portada');

    close(); await options.restart();
    author = await connect(options.tokens[1]!); owner = await connect(options.tokens[0]!);
    reviewer = await connect(options.tokens[2]!); outsider = await connect(options.tokens[3]!);
    await Promise.all([owner, author, reviewer, outsider].map(observe));
    assert.equal(projects(author)[0]!.title, revisedTitle);
    assert.equal(projects(author)[0]!.coverFileId, fileId);
    assert.deepEqual(projects(author)[0]!.unavailableLinks, [unavailable]);
    assert.equal(hash((await author.procedures.readResourceChunk({ fileId, index: 0 })).bytes), hash(cover));
    assert.equal(projects(reviewer).length, 0); assert.equal(projects(owner).length, 0); assert.equal(projects(outsider).length, 0);
    checks.push('ficha y portada persistentes después de reiniciar SpacetimeDB con permisos conservados');
    await author.reducers.createAssignmentV2({ subjectId, termId: undefined, kind: 'tarea', title: 'Fuente de reemplazo',
      instructions: 'Solo datos sintéticos', dueDate: '', topic: 'Hardware' });
    const replacementId = [...author.db.assignments.iter()].find(assignment => assignment.title === 'Fuente de reemplazo')!.id;
    await author.reducers.saveVisualProject({ projectId, expectedVersion: current().version, requestId: randomUUID(),
      payload: JSON.stringify({ ...publicMetadata, title: revisedTitle, links: [{ kind: 'assignment', id: String(assignmentId) },
        { kind: 'assignment', id: String(replacementId) }], removedLinks: [unavailable] }) });
    assert.equal(current().unavailableLinks?.length ?? 0, 0);
    await author.reducers.withdrawContent({ kind: 'note', targetId: publishedNoteId, withdrawn: false,
      expectedVersion: 4, reason: '', acknowledgeImpact: undefined });
    assert.deepEqual(current().links, [{ kind: 'assignment', id: String(assignmentId) }, { kind: 'assignment', id: String(replacementId) }]);
    await author.reducers.setVisualProjectVisibility({ projectId, visibility: 'group', expectedVersion: current().version });
    await until(() => projects(reviewer)[0]?.links.length === 2, 'reemplazo autorizado compartido');
    assert.equal(projects(reviewer)[0]!.unavailableLinks, undefined);
    checks.push('reemplazo explícito y atómico de la relación tras reiniciar, seguido de publicación estricta');

    const scene = async (connection = author) => JSON.parse(await connection.procedures.getVisualScene({ projectId })) as VisualScene;
    const model = JSON.parse(await author.procedures.createVisualModelAsset({ projectId, requestId: 'modelo-native', name: 'piezas.glb' })) as { id: string; version: number };
    const repeated = JSON.parse(await author.procedures.createVisualModelAsset({ projectId, requestId: 'modelo-native', name: 'piezas.glb' })) as { id: string };
    assert.equal(repeated.id, model.id);
    const modelId = randomUUID(), bytes = modelBytes(), metadataVersion = current().version;
    await author.reducers.beginResourceUpload({ uploadId: modelId, targetKind: 'visual_model', targetId: BigInt(model.id),
      expectedVersion: model.version, name: 'piezas.glb', mime: 'model/gltf-binary', bytes: BigInt(bytes.length), sha256: hash(bytes) });
    await author.reducers.putResourceChunk({ uploadId: modelId, index: 0, bytes, sha256: hash(bytes) });
    await author.reducers.finalizeResourceUpload({ uploadId: modelId });
    assert.equal(current().coverFileId, fileId); assert.equal(current().version, metadataVersion); assert.equal((await scene()).version, 0);
    await assert.rejects(reviewer.procedures.getResourceManifest({ fileId: modelId }));
    await assert.rejects(owner.procedures.getResourceManifest({ fileId: modelId }));
    assert.equal((await scene(reviewer)).assets.length, 0);
    checks.push('GLB nativo validado, importación idempotente y modelo preparado privado sin alterar portada ni versión de ficha');

    const document = emptyVisualSceneDocument();
    document.frame.instances.push({ id: 'placa', assetId: model.id, name: 'Placa', transform: identityVisualTransform(), visible: true, components: [] });
    document.frame.annotations.push({ id: 'etiqueta', text: 'CPU', node: { instanceId: 'placa', nodeIndex: 1 }, anchor: [0, 0, 0], visible: true });
    document.views.push({ id: 'general', name: 'Vista general', frame: structuredClone(document.frame) });
    document.steps.push({ id: 'primer-paso', title: 'Identificar CPU', description: 'Explicación de prueba', frame: structuredClone(document.frame) });
    const sceneRequest = randomUUID();
    await author.reducers.saveVisualScene({ projectId, expectedVersion: 0, requestId: sceneRequest, payload: JSON.stringify(document) });
    await author.reducers.saveVisualScene({ projectId, expectedVersion: 0, requestId: sceneRequest, payload: JSON.stringify(document) });
    assert.equal((await scene()).version, 1);
    assert.deepEqual((await scene(reviewer)).document, document);
    assert.equal(hash((await reviewer.procedures.readResourceChunk({ fileId: modelId, index: 0 })).bytes), hash(bytes));
    await assert.rejects(reviewer.reducers.saveVisualScene({ projectId, expectedVersion: 1, requestId: randomUUID(), payload: JSON.stringify(document) }));
    await assert.rejects(author.reducers.saveVisualScene({ projectId, expectedVersion: 0, requestId: randomUUID(), payload: JSON.stringify(document) }));
    await author.reducers.saveVisualProject({ projectId, expectedVersion: current().version, requestId: randomUUID(), payload: JSON.stringify({ ...current(), title: revisedTitle }) });
    assert.deepEqual((await scene()).document, document);
    const readyAsset = (await scene()).assets.find(asset => asset.id === model.id)!;
    await assert.rejects(author.reducers.discardVisualModelAssets({ projectId, assets: JSON.stringify([{ id: model.id, expectedVersion: readyAsset.version }]) }));
    document.frame = emptyVisualSceneDocument().frame;
    await author.reducers.saveVisualScene({ projectId, expectedVersion: 1, requestId: randomUUID(), payload: JSON.stringify(document) });
    await assert.rejects(author.reducers.discardVisualModelAssets({ projectId, assets: JSON.stringify([{ id: model.id, expectedVersion: readyAsset.version }]) }));
    checks.push('escena, etiquetas y capturas independientes; guardados idempotentes, conflictos y referencias de vistas/pasos protegen los bytes');

    await author.reducers.setVisualProjectVisibility({ projectId, visibility: 'personal', expectedVersion: current().version });
    await assert.rejects(reviewer.procedures.getVisualScene({ projectId }));
    await assert.rejects(reviewer.procedures.readResourceChunk({ fileId: modelId, index: 0 }));
    close(); await options.restart();
    author = await connect(options.tokens[1]!); reviewer = await connect(options.tokens[2]!); await Promise.all([author, reviewer].map(observe));
    assert.deepEqual((await scene()).document, document);
    assert.equal(hash((await author.procedures.readResourceChunk({ fileId: modelId, index: 0 })).bytes), hash(bytes));
    await assert.rejects(reviewer.procedures.getVisualScene({ projectId }));
    const beforeQuota = (await scene()).capacity.reservedBytes;
    const empty = emptyVisualSceneDocument();
    await author.reducers.saveVisualScene({ projectId, expectedVersion: 2, requestId: randomUUID(), payload: JSON.stringify(empty) });
    await author.reducers.discardVisualModelAssets({ projectId, assets: JSON.stringify([{ id: model.id, expectedVersion: readyAsset.version }]) });
    const afterQuota = (await scene()).capacity.reservedBytes;
    assert.equal(beforeQuota - afterQuota, bytes.length);
    await assert.rejects(author.procedures.getResourceManifest({ fileId: modelId }));
    await assert.rejects(author.reducers.discardVisualModelAssets({ projectId, assets: JSON.stringify([{ id: model.id, expectedVersion: readyAsset.version }]) }));
    assert.equal((await scene()).capacity.reservedBytes, afterQuota);
    assert.equal(hash((await author.procedures.readResourceChunk({ fileId, index: 0 })).bytes), hash(cover));
    checks.push('escena y GLB persistentes tras reinicio, revocación privada y liberación exacta de modelos sin tocar portada');
    return { checks };
  } finally { close(); }
}
