import {
  Box3, BufferGeometry, InterleavedBufferAttribute, LoadingManager, Material, Object3D, Texture, Vector3,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { parseGlbManifest, VISUAL_SCENE_LIMITS, type VisualFrame, type VisualModelAsset, type VisualTransform } from '@b20/core';
import { DRACOLoader } from './StaticDRACOLoader.js';
import { KTX2Loader } from './StaticKTX2Loader.js';
import { StaticMeshoptDecoder } from './StaticMeshoptDecoder';

export const NODE_INDEX_KEY = '__b20VisualNodeIndex';
export interface LoadedModel {
  source: Object3D;
  geometryBytes: number;
  textureBytes: number;
  triangles: number;
  primitives: number;
  nodes: number;
  dispose(): void;
}
interface Renderable extends Object3D { geometry?: BufferGeometry; material?: Material | Material[]; isMesh?: boolean; isInstancedMesh?: boolean; count?: number }

export function lowMemoryProfile(): boolean {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined) return memory <= 4;
  return matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600;
}
export function frameBudgetError(frame: VisualFrame, assets: readonly VisualModelAsset[]): string | undefined {
  const limits = VISUAL_SCENE_LIMITS;
  let triangles = 0, nodes = 0, primitives = 0;
  for (const instance of frame.instances) {
    const asset = assets.find(value => value.id === instance.assetId);
    if (!asset || asset.state !== 'ready' || !asset.fileId || !asset.manifest) return 'Uno de los modelos ya no está disponible. Vuelve a importarlo para continuar.';
    triangles += asset.manifest.triangleCount;
    nodes += asset.manifest.nodeCount;
    primitives += asset.manifest.primitiveCount;
  }
  if (triangles > limits.triangles || nodes > limits.nodes || primitives > limits.primitives) return 'La escena supera el límite de complejidad. Puedes revisar sus modelos por separado.';
  return undefined;
}
export function applyTransform(object: Object3D, transform: VisualTransform) {
  object.position.fromArray(transform.position); object.quaternion.fromArray(transform.quaternion); object.scale.fromArray(transform.scale);
  object.updateMatrix(); object.updateMatrixWorld(true);
}
export function readTransform(object: Object3D): VisualTransform {
  return { position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray() };
}
export function visibleInHierarchy(object: Object3D): boolean {
  for (let value: Object3D | null = object; value; value = value.parent) if (!value.visible) return false;
  return true;
}
export function visibleBounds(root: Object3D): Box3 {
  root.updateWorldMatrix(true, true);
  const box = new Box3();
  root.traverse(value => { const object = value as Renderable; if (!object.geometry || !visibleInHierarchy(object)) return;
    object.geometry.computeBoundingBox(); if (object.geometry.boundingBox) box.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld)); });
  return box;
}
function texturesOf(material: Material): Texture[] {
  return Object.values(material).filter((value): value is Texture => value instanceof Texture);
}
export function disposeModel(root: Object3D) {
  const geometries = new Set<BufferGeometry>(); const materials = new Set<Material>(); const textures = new Set<Texture>();
  root.traverse(value => { const object = value as Renderable; if (object.geometry) geometries.add(object.geometry);
    for (const material of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) materials.add(material); });
  for (const material of materials) for (const texture of texturesOf(material)) textures.add(texture);
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) { const image = texture.source?.data as { close?: () => void } | undefined; image?.close?.(); texture.dispose(); }
}
export function measureVisualModel(root: Object3D) {
  const buffers = new Set<ArrayBufferLike>(); const textures = new Set<Texture>(); let triangles = 0, primitives = 0, nodes = 0;
  root.traverse(value => {
    nodes++; const object = value as Renderable;
    if (object.geometry) {
      primitives++;
      const position = object.geometry.getAttribute('position');
      if (position && position.count > VISUAL_SCENE_LIMITS.triangles * 3) throw new Error('El modelo excede el límite de vértices.');
      if (position) for (let index = 0; index < position.count; index++) {
        if (!Number.isFinite(position.getX(index)) || !Number.isFinite(position.getY(index)) || !Number.isFinite(position.getZ(index))) throw new Error('El modelo contiene coordenadas no válidas.');
      }
      if (position && object.geometry.index) for (let index = 0; index < object.geometry.index.count; index++) {
        if (object.geometry.index.getX(index) >= position.count) throw new Error('El modelo contiene un índice fuera de su geometría.');
      }
      for (const attribute of Object.values(object.geometry.attributes)) buffers.add(attribute instanceof InterleavedBufferAttribute ? attribute.data.array.buffer : attribute.array.buffer);
      if (object.geometry.index) buffers.add(object.geometry.index.array.buffer);
      for (const attributes of Object.values(object.geometry.morphAttributes)) for (const attribute of attributes ?? []) buffers.add(attribute instanceof InterleavedBufferAttribute ? attribute.data.array.buffer : attribute.array.buffer);
      triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0) / 3 * (object.isInstancedMesh ? object.count ?? 1 : 1);
    }
    for (const material of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) for (const texture of texturesOf(material)) textures.add(texture);
  });
  let texturePixels = 0;
  for (const texture of textures) {
    const image = texture.image as { width?: number; height?: number; depth?: number } | undefined;
    const width = image?.width ?? 0, height = image?.height ?? 0;
    if (width > VISUAL_SCENE_LIMITS.textureEdge || height > VISUAL_SCENE_LIMITS.textureEdge) throw new Error('Una textura supera 4096 píxeles por lado. Reduce su tamaño antes de importar.');
    texturePixels += width * height * Math.max(1, image?.depth ?? 1);
  }
  const geometryBytes = [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
  if (triangles > VISUAL_SCENE_LIMITS.triangles || nodes > VISUAL_SCENE_LIMITS.nodes || primitives > VISUAL_SCENE_LIMITS.primitives || geometryBytes > VISUAL_SCENE_LIMITS.geometryBytes || texturePixels > VISUAL_SCENE_LIMITS.texturePixels) {
    throw new Error('El modelo decodificado supera el límite de complejidad o texturas. Prueba una versión optimizada.');
  }
  return { geometryBytes, textureBytes: Math.ceil(texturePixels * 4 * 4 / 3), triangles, primitives, nodes };
}

export class VisualModelLoader {
  private draco: DRACOLoader;
  private ktx: KTX2Loader;
  private meshopt = new StaticMeshoptDecoder();
  private loader: GLTFLoader;
  private disposed = false;
  private objectUrls = new Set<string>();
  private embeddedResourceError = false;

  constructor(renderer: WebGLRenderer) {
    const manager = new LoadingManager();
    manager.onError = () => { this.embeddedResourceError = true; };
    // Uploaded JSON is validated before loading. Only its embedded bytes may generate these URLs.
    manager.setURLModifier(url => {
      if (url.startsWith('blob:')) { this.objectUrls.add(url); return url; }
      if (/^data:(?:image\/(?:png|jpeg|ktx2)|application\/(?:octet-stream|gltf-buffer));base64,/i.test(url)) return url;
      throw new Error('El modelo contiene un recurso externo. Importa un GLB autocontenido.');
    });
    this.draco = new DRACOLoader(manager).setWorkerLimit(1);
    this.ktx = new KTX2Loader(manager).detectSupport(renderer).setWorkerLimit(1);
    this.loader = new GLTFLoader(manager).setDRACOLoader(this.draco).setKTX2Loader(this.ktx)
      .setMeshoptDecoder(this.meshopt as unknown as Parameters<GLTFLoader['setMeshoptDecoder']>[0]);
  }
  async load(blob: Blob, signal?: AbortSignal): Promise<LoadedModel> {
    if (signal?.aborted || this.disposed) throw new DOMException('La carga se canceló.', 'AbortError');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    parseGlbManifest(bytes);
    this.embeddedResourceError = false;
    let timer: ReturnType<typeof setTimeout> | undefined; let abort: (() => void) | undefined;
    let gltf: GLTF | undefined;
    const parsed = this.loader.parseAsync(bytes.buffer, '').then(value => {
      if (signal?.aborted || this.disposed) { for (const scene of value.scenes) disposeModel(scene); throw new DOMException('La carga se canceló.', 'AbortError'); }
      return value;
    });
    try {
      gltf = await Promise.race([parsed, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('El modelo tardó demasiado en abrirse. Prueba una versión más ligera.')), 60000);
        abort = () => reject(new DOMException('La carga se canceló.', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
      })]);
      for (const [object, association] of gltf.parser.associations) {
        if (object instanceof Object3D && association.nodes !== undefined) object.userData[NODE_INDEX_KEY] = association.nodes;
      }
      if (this.embeddedResourceError) throw new Error('No se pudo abrir una textura integrada del modelo. Revisa el GLB y vuelve a importarlo.');
      const stats = measureVisualModel(gltf.scene);
      const scenes = gltf.scenes;
      return { source: gltf.scene, ...stats, dispose: () => { for (const scene of scenes) disposeModel(scene); } };
    } catch (error) { if (gltf) for (const scene of gltf.scenes) disposeModel(scene); throw error; }
    finally { if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); this.releaseUrls(); }
  }
  private releaseUrls() { for (const url of this.objectUrls) URL.revokeObjectURL(url); this.objectUrls.clear(); }
  dispose() { this.disposed = true; this.releaseUrls(); this.draco.dispose(); this.ktx.dispose(); this.meshopt.dispose(); }
}
export function cloneModel(model: LoadedModel): { root: Object3D; nodes: Map<number, Object3D>; originals: Map<number, VisualTransform> } {
  const root = clone(model.source); const nodes = new Map<number, Object3D>(); const originals = new Map<number, VisualTransform>();
  root.traverse(object => { const index = object.userData[NODE_INDEX_KEY] as unknown; if (typeof index === 'number') { nodes.set(index, object); originals.set(index, readTransform(object)); } });
  return { root, nodes, originals };
}
export function projectedLabel(node: Object3D, anchor: readonly number[], camera: import('three').Camera, width: number, height: number) {
  const point = new Vector3().fromArray(anchor).applyMatrix4(node.matrixWorld).project(camera);
  return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2, visible: point.z >= -1 && point.z <= 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && visibleInHierarchy(node) };
}
