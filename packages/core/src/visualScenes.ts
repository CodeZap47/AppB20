import type { GlbManifest } from './glb';

export type VisualVec3 = [number, number, number];
export type VisualQuaternion = [number, number, number, number];
export interface VisualTransform { position: VisualVec3; quaternion: VisualQuaternion; scale: VisualVec3 }
export interface VisualNodeRef { instanceId: string; nodeIndex: number }
export interface VisualComponentOverride { nodeIndex: number; transform?: VisualTransform; visible?: boolean; alias?: string }
export interface VisualModelInstance {
  id: string; assetId: string; name: string; transform: VisualTransform; visible: boolean; components: VisualComponentOverride[];
}
export interface VisualAnnotation { id: string; text: string; node: VisualNodeRef; anchor: VisualVec3; visible: boolean }
export interface VisualCamera { position: VisualVec3; target: VisualVec3; up: VisualVec3; fov: number }
export interface VisualFrame { camera: VisualCamera; instances: VisualModelInstance[]; annotations: VisualAnnotation[]; selection?: VisualNodeRef }
export interface VisualView { id: string; name: string; frame: VisualFrame }
export interface VisualStep { id: string; title: string; description: string; frame: VisualFrame }
export interface VisualSceneDocument { schemaVersion: 1; frame: VisualFrame; views: VisualView[]; steps: VisualStep[] }
export interface VisualModelAsset {
  id: string; projectId: string; name: string; state: 'pending' | 'ready' | 'purged'; version: number;
  fileId?: string; sha256?: string; bytes?: number; manifest?: GlbManifest; createdAt: number; unreferencedSince?: number;
}
export interface VisualScene {
  projectId: string; version: number; document: VisualSceneDocument; assets: VisualModelAsset[];
  capacity: { limitBytes: number; reservedBytes: number }; updatedAt: number;
}
export interface VisualSceneInput { projectId: string; expectedVersion: number; document: VisualSceneDocument; requestId?: string }
export const VISUAL_SCENE_LIMITS = {
  modelBytes: 50 * 1024 * 1024, sceneBytes: 150 * 1024 * 1024, documentBytes: 1024 * 1024,
  assets: 10, instances: 20, views: 50, steps: 100, annotations: 100, nodes: 10_000,
  primitives: 2_000, triangles: 2_000_000, geometryBytes: 256 * 1024 * 1024,
  textureEdge: 4096, texturePixels: 32 * 1024 * 1024, jsonBytes: 4 * 1024 * 1024,
  unusedDays: 7, history: 50,
} as const;
export function identityVisualTransform(): VisualTransform { return { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] }; }
export function emptyVisualFrame(): VisualFrame { return { camera: { position: [4, 3, 6], target: [0, 0, 0], up: [0, 1, 0], fov: 45 }, instances: [], annotations: [] }; }
export function emptyVisualSceneDocument(): VisualSceneDocument { return { schemaVersion: 1, frame: emptyVisualFrame(), views: [], steps: [] }; }
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} no es válido.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max: number, required = true): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) throw new Error(`${name} no es válido.`);
  return value.trim();
}
function id(value: unknown): string {
  const result = text(value, 'El identificador', 100);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new Error('El identificador no es válido.');
  return result;
}
function number(value: unknown, name: string, min = -1e9, max = 1e9): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} no es válido.`);
  return Object.is(value, -0) ? 0 : value;
}
function integer(value: unknown, name: string, max = VISUAL_SCENE_LIMITS.nodes - 1): number {
  const result = number(value, name, 0, max); if (!Number.isInteger(result)) throw new Error(`${name} no es válido.`); return result;
}
function vector(value: unknown, name: string): VisualVec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${name} no es válido.`);
  return value.map(entry => number(entry, name)) as VisualVec3;
}
function bool(value: unknown, name: string, fallback = true): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${name} no es válido.`); return value;
}
function list(value: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${name} admite hasta ${max} elementos.`); return value;
}
function unique<T>(items: T[], key: (item: T) => string | number, name: string): T[] {
  if (new Set(items.map(key)).size !== items.length) throw new Error(`${name} contiene identificadores duplicados.`); return items;
}
export function cleanVisualTransform(value: unknown): VisualTransform {
  const row = object(value, 'La transformación');
  if (!Array.isArray(row.quaternion) || row.quaternion.length !== 4) throw new Error('La rotación no es válida.');
  const quaternion = row.quaternion.map(v => number(v, 'La rotación', -1, 1)) as VisualQuaternion;
  const length = Math.hypot(...quaternion);
  if (length < 1e-8) throw new Error('La rotación no es válida.');
  const scale = vector(row.scale, 'La escala');
  if (scale.some(v => Math.abs(v) < 1e-6 || Math.abs(v) > 1e6)) throw new Error('La escala no puede ser cero ni exceder el límite.');
  return { position: vector(row.position, 'La posición'), quaternion: quaternion.map(v => v / length) as VisualQuaternion, scale };
}
function node(value: unknown): VisualNodeRef {
  const row = object(value, 'La pieza'); return { instanceId: id(row.instanceId), nodeIndex: integer(row.nodeIndex, 'La pieza') };
}
export function cleanVisualFrame(value: unknown): VisualFrame {
  const row = object(value, 'La captura'); const camera = object(row.camera, 'La cámara');
  const position = vector(camera.position, 'La cámara'), target = vector(camera.target, 'El objetivo'), up = vector(camera.up, 'El eje de cámara');
  if (Math.hypot(...up) < 1e-8 || Math.hypot(...position.map((v, i) => v - target[i]!)) < 1e-8) throw new Error('El encuadre de la cámara no es válido.');
  const instances = unique(list(row.instances, 'Los modelos', VISUAL_SCENE_LIMITS.instances).map(value => {
    const entry = object(value, 'El modelo');
    const components = unique(list(entry.components ?? [], 'Las piezas', VISUAL_SCENE_LIMITS.nodes).map(value => {
      const part = object(value, 'La pieza');
      return { nodeIndex: integer(part.nodeIndex, 'La pieza'), ...(part.transform === undefined ? {} : { transform: cleanVisualTransform(part.transform) }),
        ...(part.visible === undefined ? {} : { visible: bool(part.visible, 'La visibilidad') }),
        ...(part.alias === undefined ? {} : { alias: text(part.alias, 'El nombre de la pieza', 180, false) }) };
    }), entry => entry.nodeIndex, 'Las piezas');
    return { id: id(entry.id), assetId: id(entry.assetId), name: text(entry.name, 'El nombre del modelo', 200),
      transform: cleanVisualTransform(entry.transform), visible: bool(entry.visible, 'La visibilidad'), components };
  }), entry => entry.id, 'Los modelos');
  const annotations = unique(list(row.annotations, 'Las etiquetas', VISUAL_SCENE_LIMITS.annotations).map(value => {
    const entry = object(value, 'La etiqueta'); return { id: id(entry.id), text: text(entry.text, 'El texto de etiqueta', 500),
      node: node(entry.node), anchor: vector(entry.anchor, 'El anclaje'), visible: bool(entry.visible, 'La visibilidad') };
  }), entry => entry.id, 'Las etiquetas');
  const checkNode = (ref: VisualNodeRef) => { if (!instances.some(instance => instance.id === ref.instanceId)) throw new Error('La pieza pertenece a un modelo que ya no está en esta captura.'); };
  annotations.forEach(annotation => checkNode(annotation.node));
  const selection = row.selection === undefined ? undefined : node(row.selection); if (selection) checkNode(selection);
  return { camera: { position, target, up, fov: number(camera.fov, 'El campo de visión', 10, 120) }, instances, annotations, ...(selection ? { selection } : {}) };
}
export function cleanVisualSceneDocument(value: unknown): VisualSceneDocument {
  const row = object(value, 'La escena');
  if (row.schemaVersion !== 1) throw new Error('Esta versión de escena no es compatible.');
  const result: VisualSceneDocument = { schemaVersion: 1, frame: cleanVisualFrame(row.frame),
    views: unique(list(row.views, 'Las vistas', VISUAL_SCENE_LIMITS.views).map(value => { const entry = object(value, 'La vista'); return { id: id(entry.id), name: text(entry.name, 'El nombre de la vista', 180), frame: cleanVisualFrame(entry.frame) }; }), entry => entry.id, 'Las vistas'),
    steps: unique(list(row.steps, 'Los pasos', VISUAL_SCENE_LIMITS.steps).map(value => { const entry = object(value, 'El paso'); return { id: id(entry.id), title: text(entry.title, 'El título del paso', 180), description: text(entry.description, 'La explicación', 6000, false), frame: cleanVisualFrame(entry.frame) }; }), entry => entry.id, 'Los pasos') };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > VISUAL_SCENE_LIMITS.documentBytes) throw new Error('La escena supera 1 MiB. Reduce las capturas o etiquetas antes de guardar.');
  return result;
}
export function visualSceneFrames(document: VisualSceneDocument): VisualFrame[] { return [document.frame, ...document.views.map(view => view.frame), ...document.steps.map(step => step.frame)]; }
export function visualSceneAssetIds(document: VisualSceneDocument): string[] { return [...new Set(visualSceneFrames(document).flatMap(frame => frame.instances.map(instance => instance.assetId)))]; }
/** Authoritative asset metadata is derived by the server, never supplied by a scene editor. */
export function validateVisualSceneAssets(document: VisualSceneDocument, assets: readonly VisualModelAsset[]): void {
  const ids = visualSceneAssetIds(document);
  if (ids.length > VISUAL_SCENE_LIMITS.assets) throw new Error('Una escena admite hasta diez archivos de modelos.');
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  let bytes = 0;
  for (const id of ids) { const asset = byId.get(id); if (!asset || asset.state !== 'ready' || !asset.fileId || !asset.manifest) throw new Error('Un modelo no está disponible. Vuelve a importarlo sin descartar el borrador.'); bytes += asset.bytes ?? 0; }
  if (bytes > VISUAL_SCENE_LIMITS.sceneBytes) throw new Error('Los archivos de la escena superan 150 MiB.');
  for (const frame of visualSceneFrames(document)) {
    let nodes = 0, primitives = 0, triangles = 0, geometryBytes = 0, texturePixels = 0;
    const check = (ref: VisualNodeRef) => { const instance = frame.instances.find(value => value.id === ref.instanceId); const asset = instance && byId.get(instance.assetId); if (!asset?.manifest?.nodes.some(node => node.index === ref.nodeIndex)) throw new Error('La pieza referenciada no existe en el archivo original.'); };
    const seen = new Set<string>();
    for (const instance of frame.instances) {
      const manifest = byId.get(instance.assetId)!.manifest!;
      instance.components.forEach(component => check({ instanceId: instance.id, nodeIndex: component.nodeIndex }));
      if (!instance.visible) continue;
      nodes += manifest.nodeCount; primitives += manifest.primitiveCount; triangles += manifest.triangleCount;
      if (!seen.has(instance.assetId)) { geometryBytes += manifest.geometryBytes; texturePixels += manifest.texturePixels; seen.add(instance.assetId); }
    }
    frame.annotations.forEach(annotation => check(annotation.node)); if (frame.selection) check(frame.selection);
    if (nodes > VISUAL_SCENE_LIMITS.nodes || primitives > VISUAL_SCENE_LIMITS.primitives || triangles > VISUAL_SCENE_LIMITS.triangles || geometryBytes > VISUAL_SCENE_LIMITS.geometryBytes || texturePixels > VISUAL_SCENE_LIMITS.texturePixels) throw new Error('La captura excede el presupuesto de complejidad 3D. Reduce los modelos visibles.');
  }
}
