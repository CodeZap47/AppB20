import { Identity, Timestamp } from 'spacetimedb';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it, vi } from 'vitest';
import { emptyVisualSceneDocument, identityVisualTransform, type VisualModelAsset, type VisualScene, type VisualSceneDocument } from '../../core/src/visualScenes';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) };
});
import { get_visual_scene, create_visual_model_asset, save_visual_scene, discard_visual_model_assets, expire_visual_model_asset,
  save_visual_project, set_visual_project_visibility, archive_visual_project, visual_projects, resource_files,
  begin_resource_upload, put_resource_chunk, finalize_resource_upload, cancel_resource_upload, get_resource_manifest,
  read_resource_chunk, remove_resource_file, set_resource_capacity, change_history, type Ctx } from './index';

type Row = Record<string, any>;
const author = Identity.fromString('a'.repeat(64)), peer = Identity.fromString('b'.repeat(64)), admin = Identity.fromString('c'.repeat(64));
const outsider = Identity.fromString('d'.repeat(64));
const key = (value: unknown) => value instanceof Identity ? value.toHexString() : String(value);
function store(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map(row => [key(row[primary]), row])); let next = 1n;
  return new Proxy({ rows, iter: () => rows.values(), insert(input: Row) {
    while (rows.has(String(next))) next++; const row: Row = { ...input, ...(input.id === 0n ? { id: next++ } : {}) }; rows.set(key(row[primary]), row); return row;
  } }, { get(target, field: string) { if (field in target) return target[field as keyof typeof target]; return {
    find: (value: unknown) => [...rows.values()].find(row => key(row[field]) === key(value)),
    filter: (value: unknown) => [...rows.values()].filter(row => key(row[field]) === key(value)),
    update: (row: Row) => { rows.set(key(row[primary]), { ...row }); return row; }, delete: (value: unknown) => rows.delete(key(value)),
  }; } });
}
function setup() {
  const initial: Record<string, Row[]> = {
    appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }],
    member: [author, peer, admin].map(identity => ({ identity, status: 'active', isCreator: identity === admin })), subject: [{ id: 1n }],
  };
  const primary: Record<string, string> = { member: 'identity', authIdentityLink: 'sessionIdentity', contentStatus: 'key', contentRetention: 'key', visualScene: 'projectId' };
  const stores = new Map<string, ReturnType<typeof store>>(); const db = new Proxy({}, { get: (_, name: string) => { if (!stores.has(name)) stores.set(name, store(primary[name] ?? 'id', initial[name])); return stores.get(name); } });
  const mutable = { db, sender: author, identity: admin, timestamp: new Timestamp(1_800_000_000_000_000n), env: {},
    senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'student@example.test', email_verified: true } } },
    withTx: (fn: (ctx: unknown) => unknown) => fn(mutable) };
  const ctx = mutable as unknown as Ctx & Parameters<typeof get_visual_scene>[0] & Parameters<typeof visual_projects>[0];
  save_visual_project(ctx, { requestId: 'project', payload: JSON.stringify({ title: 'Equipo', kind: '3d', subjectIds: ['1'] }) });
  const scene = () => JSON.parse(get_visual_scene(ctx, { projectId: 1n })) as VisualScene;
  const register = (requestId = 'asset', name = 'equipo.glb') => JSON.parse(create_visual_model_asset(ctx, { projectId: 1n, requestId, name })) as VisualModelAsset;
  let request = 0;
  const save = (document: VisualSceneDocument, expectedVersion = scene().version, requestId = `save-${++request}`) => save_visual_scene(ctx, { projectId: 1n, expectedVersion, requestId, payload: JSON.stringify(document) });
  const publish = (visibility = 'group') => set_visual_project_visibility(ctx, { projectId: 1n, expectedVersion: visual_projects(ctx)[0]!.json ? JSON.parse(visual_projects(ctx)[0]!.json).version : 1, visibility });
  return { ctx, mutable, scene, register, save, publish, as(identity: Identity) { mutable.sender = identity; }, rows: (name: string) => [...(db as Record<string, ReturnType<typeof store>>)[name]!.rows.values()] };
}
function modelBytes() {
  const value = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'Equipo', children: [1, 2] }, { name: 'Pieza', mesh: 0 }, { name: 'Pieza', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], buffers: [{ byteLength: 44 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }] };
  const json = new TextEncoder().encode(JSON.stringify(value)), size = Math.ceil(json.length / 4) * 4, bytes = new Uint8Array(28 + size + 44), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true); view.setUint32(12, size, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + size); bytes.set(json, 20); view.setUint32(20 + size, 44, true); view.setUint32(24 + size, 0x004e4942, true); return bytes;
}
const hash = (bytes: Uint8Array) => Array.from(sha256(bytes), b => b.toString(16).padStart(2, '0')).join('');
function upload(s: ReturnType<typeof setup>, asset: VisualModelAsset, uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', bytes = modelBytes()) {
  begin_resource_upload(s.ctx, { uploadId, targetKind: 'visual_model', targetId: BigInt(asset.id), expectedVersion: asset.version, name: asset.name,
    mime: 'model/gltf-binary', bytes: BigInt(bytes.length), sha256: hash(bytes) });
  for (let offset = 0, index = 0; offset < bytes.length; offset += 1024 * 1024, index++) { const chunk = bytes.slice(offset, offset + 1024 * 1024); put_resource_chunk(s.ctx, { uploadId, index, bytes: chunk, sha256: hash(chunk) }); }
  finalize_resource_upload(s.ctx, { uploadId }); return uploadId;
}
function document(assetId = '1') {
  const value = emptyVisualSceneDocument(); value.frame.instances.push({ id: 'instance', assetId, name: 'Equipo', transform: identityVisualTransform(), visible: true, components: [] });
  value.frame.annotations.push({ id: 'label', text: 'CPU', node: { instanceId: 'instance', nodeIndex: 1 }, anchor: [0, 1, 0], visible: true }); return value;
}
describe('visual scenes: native binary storage and permissions', () => {
  it('registers/uploads idempotently without modifying catalog or scene versions; stages stay private', () => {
    const s = setup(); const asset = s.register(); expect(s.register()).toEqual(asset); expect(() => s.register('asset', 'other.glb')).toThrow(/otro modelo/);
    const file = upload(s, asset); finalize_resource_upload(s.ctx, { uploadId: file });
    expect(s.scene()).toMatchObject({ version: 0, assets: [{ id: '1', version: 2, state: 'ready', fileId: file }] });
    expect(JSON.parse(visual_projects(s.ctx)[0]!.json).version).toBe(1); expect(s.rows('resourceCapacity')[0]!.reservedBytes).toBe(BigInt(modelBytes().length));
    s.publish();
    for (const actor of [peer, admin]) { s.as(actor); expect(s.scene().assets).toEqual([]); expect(resource_files(s.ctx)).toEqual([]); expect(() => get_resource_manifest(s.ctx, { fileId: file })).toThrow(/modelo/); }
    s.as(author); expect(resource_files(s.ctx).map(row => row.id)).toEqual([file]);
  });
  it('exposes only saved model assets, revokes bytes when made private and refuses report bypass', () => {
    const s = setup(); const file = upload(s, s.register()); s.save(document()); s.publish(); s.as(peer);
    expect(s.scene().document.frame.annotations[0]!.text).toBe('CPU'); expect(JSON.parse(get_resource_manifest(s.ctx, { fileId: file })).storageKind).toBe('spacetime'); expect(read_resource_chunk(s.ctx, { fileId: file, index: 0 }).bytes).toEqual(modelBytes());
    s.as(author); s.publish('personal');
    s.ctx.db.messageReport.insert({ id: 1n, scope: 'group', messageId: 1n, reason: 'Prueba de permisos', evidenceText: '',
      attachmentIds: [file], reporter: peer, status: 'open', resolvedBy: undefined, resolvedAt: undefined, createdAt: s.ctx.timestamp });
    for (const actor of [peer, admin, outsider]) { s.as(actor); expect(() => s.scene()).toThrow(); expect(resource_files(s.ctx)).toEqual([]); expect(() => get_resource_manifest(s.ctx, { fileId: file })).toThrow(); expect(change_history(s.ctx).some(row => row.entity === 'visual_scene')).toBe(false); }
  });
  it('keeps independent snapshots across metadata updates and rejects stale scene writes', () => {
    const s = setup(); upload(s, s.register()); const value = document(); value.views.push({ id: 'view', name: 'General', frame: structuredClone(value.frame) }); value.steps.push({ id: 'step', title: 'CPU', description: 'Observa la pieza', frame: structuredClone(value.frame) });
    s.save(value, 0, 'same-save'); s.save(value, 0, 'same-save'); expect(s.scene().version).toBe(1);
    expect(() => s.save({ ...value, steps: [] }, 0, 'same-save')).toThrow(/otros cambios/);
    expect(() => s.save(value, 0, 'other-save')).toThrow(/cambió/);
    const before = s.scene().document; save_visual_project(s.ctx, { projectId: 1n, expectedVersion: 1, requestId: 'metadata', payload: JSON.stringify({ title: 'Nuevo título', kind: '3d' }) });
    expect(s.scene().document).toEqual(before); expect(s.scene().version).toBe(1); expect(JSON.parse(visual_projects(s.ctx)[0]!.json)).toMatchObject({ hasScene: true, sceneVersion: 1, version: 2 });
  });
  it('retains models used only by steps and releases their capacity exactly once after removing every reference', () => {
    const s = setup(); const file = upload(s, s.register()); const value = document(); value.steps.push({ id: 'step', title: 'CPU', description: '', frame: structuredClone(value.frame) }); value.frame.instances = []; value.frame.annotations = []; s.save(value);
    expect(() => discard_visual_model_assets(s.ctx, { projectId: 1n, assets: JSON.stringify([{ id: '1', expectedVersion: 2 }]) })).toThrow(/sigue usado/);
    expect(() => remove_resource_file(s.ctx, { fileId: file, expectedVersion: 2 })).toThrow(/sin uso/);
    s.save(emptyVisualSceneDocument()); discard_visual_model_assets(s.ctx, { projectId: 1n, assets: JSON.stringify([{ id: '1', expectedVersion: 2 }]) });
    expect(s.rows('resourceCapacity')[0]!.reservedBytes).toBe(0n); expect(s.rows('resourceChunk')).toEqual([]); expect(s.rows('resourceFile')).toEqual([]); expect(s.rows('visualModelAsset')[0]!.state).toBe('purged');
    expect(() => discard_visual_model_assets(s.ctx, { projectId: 1n, assets: JSON.stringify([{ id: '1', expectedVersion: 2 }]) })).toThrow(/cambió/);
    discard_visual_model_assets(s.ctx, { projectId: 1n, assets: JSON.stringify([{ id: '1', expectedVersion: 3 }]) }); expect(s.rows('resourceCapacity')[0]!.reservedBytes).toBe(0n);
  });
  it('checks exact saved piece IDs and prevents foreign-project/unfinished asset references', () => {
    const s = setup(); const asset = s.register(); expect(() => s.save(document())).toThrow(/modelo no está disponible/); upload(s, asset);
    const invalid = document(); invalid.frame.annotations[0]!.node.nodeIndex = 99; expect(() => s.save(invalid)).toThrow(/pieza referenciada/);
    s.as(peer); expect(() => s.register('theft')).toThrow(/autor/); expect(() => s.save(document(), 0)).toThrow(/autor/);
    s.as(author); save_visual_project(s.ctx, { requestId: 'second', payload: JSON.stringify({ title: 'Otro', kind: '3d' }) });
    expect(() => save_visual_scene(s.ctx, { projectId: 2n, expectedVersion: 0, requestId: 'steal-file', payload: JSON.stringify(document()) })).toThrow(/modelo no está disponible/);
  });
  it('rejects damaged GLB before creating a file and allows cancellation to recover its reservation', () => {
    const s = setup(); const asset = s.register(); const bytes = modelBytes(); bytes[0] = 0;
    expect(() => upload(s, asset, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', bytes)).toThrow(/cabecera/);
    expect(s.rows('resourceFile')).toEqual([]); expect(s.scene().assets[0]!.state).toBe('pending'); cancel_resource_upload(s.ctx, { uploadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }); expect(s.rows('resourceCapacity')[0]!.reservedBytes).toBe(0n);
  });
  it('honors live global capacity without changing the configured limit', () => {
    const s = setup(); s.as(admin); set_resource_capacity(s.ctx, { bytes: 10n }); s.as(author);
    expect(() => upload(s, s.register())).toThrow(/espacio/); expect(s.rows('resourceCapacity')[0]).toMatchObject({ limitBytes: 10n, reservedBytes: 0n }); expect(s.rows('resourceUpload')).toEqual([]);
  });
  it('guards seven-day purge generations and preserves referenced models of archived projects', () => {
    const s = setup(); const file = upload(s, s.register()); const event = s.rows('visualAssetExpiry').at(-1)!;
    s.save(document()); s.publish(); archive_visual_project(s.ctx, { projectId: 1n, expectedVersion: 2, archived: true });
    s.mutable.timestamp = new Timestamp(s.mutable.timestamp.microsSinceUnixEpoch + 8n * 24n * 3600n * 1_000_000n); s.as(admin);
    expire_visual_model_asset(s.ctx, { event } as unknown as Parameters<typeof expire_visual_model_asset>[1]);
    expect(s.rows('resourceFile').some(row => row.id === file)).toBe(true);
    s.as(author); expect(s.scene().document.frame.instances).toHaveLength(1); expect(() => s.save(document())).toThrow(/Restaura/);
    s.as(peer); expect(() => s.scene()).toThrow();
    s.as(author); archive_visual_project(s.ctx, { projectId: 1n, expectedVersion: 3, archived: false }); s.save(emptyVisualSceneDocument());
    const fresh = s.rows('visualAssetExpiry').at(-1)!; s.mutable.timestamp = new Timestamp(s.mutable.timestamp.microsSinceUnixEpoch + 8n * 24n * 3600n * 1_000_000n); s.as(admin);
    expire_visual_model_asset(s.ctx, { event: fresh } as unknown as Parameters<typeof expire_visual_model_asset>[1]);
    expect(s.rows('resourceFile')).toEqual([]); expect(s.rows('resourceCapacity')[0]!.reservedBytes).toBe(0n);
  });
});
