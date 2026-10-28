import { ScheduleAt, Timestamp } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { cleanVisualSceneDocument, emptyVisualSceneDocument, validateVisualSceneAssets, visualSceneAssetIds,
  VISUAL_SCENE_LIMITS, type VisualModelAsset, type VisualScene, type VisualSceneDocument } from '../../core/src/visualScenes';
import { readGlbManifest, type GlbManifest } from '../../core/src/glb';
import { memberIdentityFor } from './authIdentity';
import { activeMember, expectVersion, isActive, log, type Ctx, type ViewDb } from './moduleContext';
import { visualProjectReadable } from './visualProjectHandlers';

const UNUSED_TTL = 7n * 24n * 60n * 60n * 1_000_000n;
type AssetRow = NonNullable<ReturnType<Ctx['db']['visualModelAsset']['id']['find']>>;
function failure(error: unknown): never { throw new SenderError(error instanceof Error ? error.message : 'La escena no es válida.'); }
function request(value: string) { if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new SenderError('La solicitud de escena no es válida.'); return value; }
function ownProject(ctx: Ctx, projectId: bigint, editable = true) {
  activeMember(ctx); const project = ctx.db.visualProject.id.find(projectId);
  if (!project || !project.author.isEqual(memberIdentityFor(ctx))) throw new SenderError('Solo el autor modifica la escena de este proyecto.');
  if (editable && project.archived) throw new SenderError('Restaura el proyecto antes de editar la escena.'); return project;
}
function document(value: string): VisualSceneDocument {
  if (new TextEncoder().encode(value).length > VISUAL_SCENE_LIMITS.documentBytes) throw new SenderError('La escena supera 1 MiB.');
  try { return cleanVisualSceneDocument(JSON.parse(value)); } catch (error) { return failure(error); }
}
export function visualSceneReferences(db: ViewDb, projectId: bigint): Set<string> {
  const row = db.visualScene.projectId.find(projectId); return new Set(row ? visualSceneAssetIds(document(row.document)) : []);
}
export function visualModelAssetValue(row: AssetRow): VisualModelAsset {
  return { id: String(row.id), projectId: String(row.projectId), name: row.name,
    state: row.state as VisualModelAsset['state'], version: row.version,
    ...(row.fileId ? { fileId: row.fileId } : {}), ...(row.sha256 ? { sha256: row.sha256 } : {}),
    ...(row.bytes === undefined ? {} : { bytes: Number(row.bytes) }), ...(row.manifest ? { manifest: JSON.parse(row.manifest) as GlbManifest } : {}),
    createdAt: Number(row.createdAt.microsSinceUnixEpoch / 1000n),
    ...(row.unreferencedSince ? { unreferencedSince: Number(row.unreferencedSince.microsSinceUnixEpoch / 1000n) } : {}) };
}
export function visualModelReadable(db: ViewDb, actor: Ctx['sender'], id: bigint): boolean {
  if (!isActive(db, actor)) return false; const asset = db.visualModelAsset.id.find(id);
  if (!asset || asset.state !== 'ready' || !asset.fileId || !visualProjectReadable(db, actor, asset.projectId)) return false;
  if (db.visualProject.id.find(asset.projectId)?.author.isEqual(actor)) return true;
  return visualSceneReferences(db, asset.projectId).has(String(id));
}
export function visualModelFileVisible(db: ViewDb, actor: Ctx['sender'], file: { id: string; targetId: bigint; removedAt?: Timestamp }): boolean {
  return file.removedAt === undefined && visualModelReadable(db, actor, file.targetId) && db.visualModelAsset.id.find(file.targetId)?.fileId === file.id;
}
export function requireVisualModelWriter(ctx: Ctx, id: bigint, actor = memberIdentityFor(ctx)) {
  const asset = ctx.db.visualModelAsset.id.find(id); if (!asset || asset.state === 'purged') throw new SenderError('El modelo no está disponible.');
  const project = ctx.db.visualProject.id.find(asset.projectId);
  if (!project || !isActive(ctx.db, actor) || !project.author.isEqual(actor)) throw new SenderError('Solo el autor modifica los modelos de este proyecto.');
  if (project.archived) throw new SenderError('Restaura el proyecto antes de importar modelos.'); return asset;
}
export function getVisualScene(ctx: Ctx, projectId: bigint): string {
  activeMember(ctx); const actor = memberIdentityFor(ctx);
  if (!visualProjectReadable(ctx.db, actor, projectId)) throw new SenderError('La escena no existe o no tienes acceso.');
  const project = ctx.db.visualProject.id.find(projectId)!; const scene = ctx.db.visualScene.projectId.find(projectId);
  const refs = visualSceneReferences(ctx.db, projectId), owner = project.author.isEqual(actor);
  const assets = [...ctx.db.visualModelAsset.projectId.filter(projectId)].filter(row => row.state !== 'purged' && (owner || refs.has(String(row.id)) && row.state === 'ready')).map(visualModelAssetValue);
  const quota = ctx.db.resourceCapacity.id.find(0);
  const result: VisualScene = { projectId: String(projectId), version: scene?.version ?? 0,
    document: scene ? document(scene.document) : emptyVisualSceneDocument(), assets,
    capacity: { limitBytes: Number(quota?.limitBytes ?? 256n * 1024n * 1024n), reservedBytes: Number(quota?.reservedBytes ?? 0n) },
    updatedAt: Number((scene?.updatedAt ?? project.updatedAt).microsSinceUnixEpoch / 1000n) };
  return JSON.stringify(result);
}
function scheduleUnused(ctx: Ctx, row: AssetRow, at = ctx.timestamp) {
  const next = { ...row, unreferencedSince: at, generation: row.generation + 1 };
  ctx.db.visualModelAsset.id.update(next);
  ctx.db.visualAssetExpiry.insert({ id: 0n, scheduledAt: ScheduleAt.time(at.microsSinceUnixEpoch + UNUSED_TTL), assetId: row.id, generation: next.generation });
}
export function createVisualModelAsset(ctx: Ctx, input: { projectId: bigint; requestId: string; name: string }): string {
  ownProject(ctx, input.projectId); const actor = memberIdentityFor(ctx); const key = `${actor.toHexString()}:${request(input.requestId)}`;
  const name = input.name.trim(); if (!name || name.length > 200 || !/\.glb$/i.test(name)) throw new SenderError('Selecciona un archivo con extensión .glb.');
  const existing = ctx.db.visualModelAsset.requestKey.find(key);
  if (existing) { if (existing.projectId !== input.projectId || existing.name !== name) throw new SenderError('Esta solicitud ya registró otro modelo.'); return JSON.stringify(visualModelAssetValue(existing)); }
  if ([...ctx.db.visualModelAsset.projectId.filter(input.projectId)].filter(row => row.state !== 'purged').length >= 20) throw new SenderError('Libera modelos sin uso antes de registrar más importaciones.');
  const row = ctx.db.visualModelAsset.insert({ id: 0n, projectId: input.projectId, requestKey: key, name,
    state: 'pending', version: 1, fileId: undefined, sha256: undefined, bytes: undefined, manifest: undefined,
    createdAt: ctx.timestamp, unreferencedSince: ctx.timestamp, generation: 1 });
  ctx.db.visualAssetExpiry.insert({ id: 0n, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + UNUSED_TTL), assetId: row.id, generation: 1 });
  return JSON.stringify(visualModelAssetValue(row));
}
export function saveVisualScene(ctx: Ctx, input: { projectId: bigint; expectedVersion: number; requestId: string; payload: string }) {
  ownProject(ctx, input.projectId); const value = document(input.payload), json = JSON.stringify(value);
  const previous = ctx.db.visualScene.projectId.find(input.projectId); const key = `${memberIdentityFor(ctx).toHexString()}:${request(input.requestId)}`;
  if (previous?.requestKey === key) { if (previous.requestPayload !== json) throw new SenderError('Esta solicitud ya guardó otros cambios.'); return; }
  expectVersion(previous?.version ?? 0, input.expectedVersion);
  const assets = [...ctx.db.visualModelAsset.projectId.filter(input.projectId)];
  try { validateVisualSceneAssets(value, assets.map(visualModelAssetValue)); } catch (error) { failure(error); }
  for (const id of visualSceneAssetIds(value)) {
    const asset = assets.find(row => String(row.id) === id)!; const file = asset.fileId && ctx.db.resourceFile.id.find(asset.fileId);
    if (!file || file.removedAt || file.targetKind !== 'visual_model' || file.targetId !== asset.id || !file.storageKey.startsWith('stdb:') || ctx.db.resourceUpload.id.find(file.storageKey.slice(5))?.state !== 'ready') throw new SenderError('Un modelo no ha terminado de subirse. Reintenta sin descartar el borrador.');
  }
  const row = { projectId: input.projectId, schemaVersion: 1, document: json, version: (previous?.version ?? 0) + 1,
    requestKey: key, requestPayload: json, createdAt: previous?.createdAt ?? ctx.timestamp, updatedAt: ctx.timestamp };
  if (previous) ctx.db.visualScene.projectId.update(row); else ctx.db.visualScene.insert(row);
  const used = new Set(visualSceneAssetIds(value));
  for (const asset of assets) {
    if (used.has(String(asset.id))) { if (asset.unreferencedSince) ctx.db.visualModelAsset.id.update({ ...asset, unreferencedSince: undefined, generation: asset.generation + 1 }); }
    else if (asset.state !== 'purged' && asset.unreferencedSince === undefined) scheduleUnused(ctx, asset);
  }
  log(ctx, 'save', 'visual_scene', input.projectId);
}
export function validateVisualModelUpload(ctx: Ctx, assetId: bigint, name: string, mime: string) {
  const asset = requireVisualModelWriter(ctx, assetId);
  if (asset.state !== 'pending' || asset.fileId) throw new SenderError('El archivo de un modelo es inmutable. Registra otra importación.');
  if (asset.name !== name || !/\.glb$/i.test(name) || !['model/gltf-binary', 'application/octet-stream', ''].includes(mime)) throw new SenderError('Usa un archivo GLB autocontenido.');
  if ([...ctx.db.resourceUpload.iter()].some(row => row.targetKind === 'visual_model' && row.targetId === assetId && row.state === 'pending' && row.expiresAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch)) throw new SenderError('Este modelo ya tiene una subida pendiente. Reanúdala o cancélala.');
}
export function finalizeVisualModelUpload(ctx: Ctx, input: { assetId: bigint; fileId: string; bytes: bigint; sha256: string; chunkCount: number }) {
  const asset = requireVisualModelWriter(ctx, input.assetId);
  if (asset.state !== 'pending' || asset.fileId) throw new SenderError('El archivo de un modelo es inmutable.');
  const read = (offset: number, length: number) => {
    const out = new Uint8Array(length); let filled = 0;
    while (filled < length) { const position = offset + filled, index = Math.floor(position / (1024 * 1024)); const chunk = ctx.db.resourceChunk.id.find(`${input.fileId}:${index}`); if (!chunk) throw new SenderError('Faltan bloques del GLB.'); const begin = position % (1024 * 1024), size = Math.min(length - filled, chunk.bytes.length - begin); if (size <= 0) throw new SenderError('El bloque del GLB está incompleto.'); out.set(chunk.bytes.subarray(begin, begin + size), filled); filled += size; }
    return out;
  };
  let manifest: GlbManifest; try { manifest = readGlbManifest(read, Number(input.bytes)); } catch (error) { return failure(error); }
  const next = { ...asset, state: 'ready', fileId: input.fileId, sha256: input.sha256, bytes: input.bytes,
    manifest: JSON.stringify(manifest), version: asset.version + 1 };
  scheduleUnused(ctx, next);
}
function purgeable(ctx: Ctx, asset: AssetRow) {
  if (visualSceneReferences(ctx.db, asset.projectId).has(String(asset.id))) throw new SenderError('El modelo sigue usado por la escena, una vista o un paso.');
  const files = [...ctx.db.resourceFile.targetId.filter(asset.id)].filter(file => file.targetKind === 'visual_model');
  for (const file of files) if ([...ctx.db.resourceFile.iter()].some(other => other.id !== file.id && other.storageKey === file.storageKey)) throw new SenderError('El archivo conserva otras referencias y no se puede liberar.');
}
function purge(ctx: Ctx, asset: AssetRow) {
  if (asset.state === 'purged') return;
  purgeable(ctx, asset);
  let freed = 0n;
  for (const upload of [...ctx.db.resourceUpload.iter()].filter(row => row.targetKind === 'visual_model' && row.targetId === asset.id)) {
    if (upload.state === 'ready' || upload.state === 'pending') freed += upload.bytes;
    for (const chunk of [...ctx.db.resourceChunk.uploadId.filter(upload.id)]) ctx.db.resourceChunk.id.delete(chunk.id);
    for (const event of [...ctx.db.resourceExpiry.iter()]) if (event.uploadId === upload.id) ctx.db.resourceExpiry.id.delete(event.id);
    ctx.db.resourceUpload.id.delete(upload.id);
  }
  for (const file of [...ctx.db.resourceFile.targetId.filter(asset.id)]) if (file.targetKind === 'visual_model') ctx.db.resourceFile.id.delete(file.id);
  if (freed) { const quota = ctx.db.resourceCapacity.id.find(0); if (!quota || quota.reservedBytes < freed) throw new SenderError('La reserva de archivos necesita revisión antes de liberar este modelo.'); ctx.db.resourceCapacity.id.update({ ...quota, reservedBytes: quota.reservedBytes - freed }); }
  ctx.db.visualModelAsset.id.update({ ...asset, state: 'purged', version: asset.version + 1, fileId: undefined, sha256: undefined, bytes: undefined, manifest: undefined, unreferencedSince: undefined, generation: asset.generation + 1 });
  for (const event of [...ctx.db.visualAssetExpiry.iter()]) if (event.assetId === asset.id) ctx.db.visualAssetExpiry.id.delete(event.id);
}
export function discardVisualModelAssets(ctx: Ctx, input: { projectId: bigint; assets: string }) {
  ownProject(ctx, input.projectId);
  let entries: unknown; try { entries = JSON.parse(input.assets); } catch { throw new SenderError('La lista de modelos no es válida.'); }
  if (!Array.isArray(entries) || entries.length > 20 || !entries.length) throw new SenderError('Selecciona los modelos sin uso que deseas liberar.');
  const selected = entries.map(value => { if (!value || typeof value !== 'object') throw new SenderError('El modelo no es válido.'); const entry = value as { id?: unknown; expectedVersion?: unknown }; if (typeof entry.id !== 'string' || !/^[1-9]\d{0,19}$/.test(entry.id)) throw new SenderError('El modelo no es válido.'); const asset = ctx.db.visualModelAsset.id.find(BigInt(entry.id)); if (!asset || asset.projectId !== input.projectId) throw new SenderError('El modelo no pertenece a este proyecto.'); expectVersion(asset.version, Number(entry.expectedVersion)); purgeable(ctx, asset); return asset; });
  if (new Set(selected.map(row => String(row.id))).size !== selected.length) throw new SenderError('No repitas modelos al liberar espacio.');
  selected.forEach(asset => purge(ctx, asset));
  log(ctx, 'discard_assets', 'visual_scene', input.projectId);
}
export function expireVisualModelAsset(ctx: Ctx, event: { assetId: bigint; generation: number }) {
  if (!memberIdentityFor(ctx).isEqual(ctx.identity)) throw new SenderError('Solo el programador interno puede liberar importaciones vencidas.');
  const asset = ctx.db.visualModelAsset.id.find(event.assetId);
  if (!asset || asset.state === 'purged' || asset.generation !== event.generation || !asset.unreferencedSince || asset.unreferencedSince.microsSinceUnixEpoch + UNUSED_TTL > ctx.timestamp.microsSinceUnixEpoch || visualSceneReferences(ctx.db, asset.projectId).has(String(asset.id))) return;
  purge(ctx, asset);
}
