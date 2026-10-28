import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { emptyVisualSceneDocument, identityVisualTransform } from '@b20/core';
import { createDemoState, DemoDataSource } from './demo';
import { DemoVisualSceneStore } from './visualSceneDemo';
import type { ResourceFile } from './types';

function glb(offset = 0) {
  const bin = new Uint8Array(new Float32Array([offset, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Conjunto', children: [1, 2] }, { name: 'Pieza', mesh: 0 }, { name: 'Pieza', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }] }));
  const length = Math.ceil(json.length / 4) * 4; const bytes = new Uint8Array(12 + 8 + length + 8 + bin.length); const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + length); bytes.set(json, 20);
  view.setUint32(20 + length, bin.length, true); view.setUint32(24 + length, 0x004e4942, true); bytes.set(bin, 28 + length);
  const file = new File([bytes], 'piezas.glb', { type: 'model/gltf-binary' });
  Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: async () => bytes.buffer.slice(0) }); return file;
}
const instance = (assetId: string) => ({ id: 'instancia', assetId, name: 'Placa y piezas', transform: identityVisualTransform(), visible: true, components: [] });
async function setup(persistenceKey?: string) {
  const state = createDemoState(); const source = new DemoDataSource(state, 'demo-1', undefined, undefined, { visualPersistenceKey: persistenceKey });
  const projectId = await source.saveVisualProject({ title: 'Proyecto de prueba 3D', kind: '3d', requestId: crypto.randomUUID() });
  const asset = await source.createVisualModelAsset(projectId, 'importacion', 'piezas.glb');
  const fileId = await source.attachResourceFile('visual_model', asset.id, glb(), asset.version);
  const scene = await source.getVisualScene(projectId);
  const document = emptyVisualSceneDocument(); document.frame.instances.push(instance(asset.id));
  return { source, state, projectId, asset: scene.assets[0]!, fileId, document };
}

describe('escenas 3D de demostración', () => {
  it('conserva escena, vistas, pasos y bytes después de recrear la fuente', async () => {
    const persistenceKey = crypto.randomUUID(); const { source, projectId, document, fileId } = await setup(persistenceKey);
    document.frame.annotations.push({ id: 'etiqueta', text: 'CPU', node: { instanceId: 'instancia', nodeIndex: 1 }, anchor: [0, 0, 0], visible: true });
    document.views.push({ id: 'general', name: 'General', frame: structuredClone(document.frame) });
    document.steps.push({ id: 'paso', title: 'Identifica la CPU', description: 'La pieza resaltada', frame: structuredClone(document.frame) });
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1EAAAAASUVORK5CYII='), character => character.charCodeAt(0));
    const cover = new File([png], 'portada.png', { type: 'image/png' });
    const coverId = await source.attachResourceFile('visual_project', projectId, cover, 1);
    const saved = await source.saveVisualScene({ projectId, expectedVersion: 0, document, requestId: 'guardar' }); source.dispose();
    const reloaded = new DemoDataSource(createDemoState(), 'demo-1', undefined, undefined, { visualPersistenceKey: persistenceKey });
    try {
      expect((await reloaded.getVisualScene(projectId)).document).toEqual(saved.document);
      expect((await reloaded.downloadResourceFile(fileId)).size).toBe(glb().size);
      expect((await reloaded.downloadResourceFile(coverId)).size).toBe(png.byteLength);
      expect(reloaded.getSnapshot().visualProjects.find(row => row.id === projectId)?.coverFileId).toBe(coverId);
      expect(reloaded.getSnapshot().visualProjects.find(row => row.id === projectId)?.hasScene).toBe(true);
      const secondId = await reloaded.saveVisualProject({ title: 'Otra ficha', kind: '3d' }); expect(secondId).not.toBe(projectId);
    } finally { reloaded.dispose(); }
  });
  it('aísla versiones de ficha, importación y escena, y rechaza un editor atrasado', async () => {
    const { source, projectId, document } = await setup();
    try {
      const project = source.getSnapshot().visualProjects.find(row => row.id === projectId)!;
      expect(project.version).toBe(1); expect((await source.getVisualScene(projectId)).version).toBe(0);
      const saved = await source.saveVisualScene({ projectId, expectedVersion: 0, document });
      await source.saveVisualProject({ ...project, title: 'Ficha actualizada', expectedVersion: 1 });
      expect((await source.getVisualScene(projectId)).document).toEqual(saved.document);
      await expect(source.saveVisualScene({ projectId, expectedVersion: 0, document })).rejects.toThrow('cambió');
    } finally { source.dispose(); }
  });
  it('protege modelos privados y pendientes de incorporación incluso frente a otro administrador', async () => {
    const { source, state, projectId, document, fileId } = await setup(); const peer = new DemoDataSource(state, 'demo-4');
    try {
      await expect(peer.getVisualScene(projectId)).rejects.toThrow('disponible');
      await expect(peer.downloadResourceFile(fileId)).rejects.toThrow('disponible');
      await source.setVisualProjectVisibility(projectId, 'group', 1);
      expect((await peer.getVisualScene(projectId)).assets).toEqual([]);
      await expect(peer.downloadResourceFile(fileId)).rejects.toThrow('disponible');
      await source.saveVisualScene({ projectId, expectedVersion: 0, document });
      expect((await peer.downloadResourceFile(fileId)).size).toBe(glb().size);
      await expect(peer.saveVisualScene({ projectId, expectedVersion: 1, document })).rejects.toThrow('autor');
      await source.setVisualProjectVisibility(projectId, 'personal', 2);
      await expect(peer.downloadResourceFile(fileId)).rejects.toThrow('disponible');
    } finally { source.dispose(); peer.dispose(); }
  });
  it('cuenta las referencias de pasos antes de liberar espacio y lo libera una sola vez', async () => {
    const { source, projectId, document, asset, fileId } = await setup();
    try {
      document.steps.push({ id: 'pieza', title: 'Pieza conservada', description: '', frame: structuredClone(document.frame) }); document.frame.instances = [];
      await source.saveVisualScene({ projectId, expectedVersion: 0, document });
      await expect(source.discardVisualModelAssets(projectId, [{ id: asset.id, expectedVersion: asset.version }])).rejects.toThrow('paso');
      document.steps = []; await source.saveVisualScene({ projectId, expectedVersion: 1, document });
      const before = await source.getVisualScene(projectId); await source.discardVisualModelAssets(projectId, [{ id: asset.id, expectedVersion: asset.version }]);
      const after = await source.getVisualScene(projectId); expect(before.capacity.reservedBytes - after.capacity.reservedBytes).toBe(glb().size);
      await expect(source.downloadResourceFile(fileId)).rejects.toThrow('no existe');
      await expect(source.discardVisualModelAssets(projectId, [{ id: asset.id, expectedVersion: asset.version }])).rejects.toThrow('cambió');
      expect((await source.getVisualScene(projectId)).capacity).toEqual(after.capacity);
    } finally { source.dispose(); }
  });
  it('recupera una confirmación de subida y rechaza sustituir sus bytes', async () => {
    const { source, projectId, asset, fileId } = await setup();
    try {
      expect(await source.attachResourceFile('visual_model', asset.id, glb(), 1)).toBe(fileId);
      await expect(source.attachResourceFile('visual_model', asset.id, glb(.5), 1)).rejects.toThrow('inmutable');
      expect((await source.getVisualScene(projectId)).assets.filter(asset => asset.state === 'ready')).toHaveLength(1);
    } finally { source.dispose(); }
  });
  it('rechaza una escritura atrasada desde otra pestaña sin borrar los cambios guardados', async () => {
    const persistenceKey = crypto.randomUUID(); const { source, projectId, document } = await setup(persistenceKey);
    const tab = new DemoDataSource(createDemoState(), 'demo-1', undefined, undefined, { visualPersistenceKey: persistenceKey });
    try {
      const stale = await tab.getVisualScene(projectId); await source.saveVisualScene({ projectId, expectedVersion: 0, document });
      await expect(tab.saveVisualScene({ projectId, expectedVersion: stale.version, document: emptyVisualSceneDocument() })).rejects.toThrow('cambió');
      expect((await tab.getVisualScene(projectId)).document.frame.instances).toHaveLength(1);
    } finally { source.dispose(); tab.dispose(); }
  });
  it('limita los registros pendientes y los retira después de siete días sin uso', async () => {
    let now = new Date('2026-10-26T12:00:00Z'); const source = new DemoDataSource(createDemoState(), 'demo-1', () => now);
    try {
      const projectId = await source.saveVisualProject({ title: 'Pendientes', kind: '3d' });
      await expect(source.createVisualModelAsset(projectId, 'nombre', 'otro.step')).rejects.toThrow('GLB');
      for (let index = 0; index < 20; index++) await source.createVisualModelAsset(projectId, `pendiente-${index}`, 'modelo.glb');
      await expect(source.createVisualModelAsset(projectId, 'exceso', 'modelo.glb')).rejects.toThrow('Libera');
      now = new Date(now.getTime() + 7 * 86400000 + 1);
      await source.createVisualModelAsset(projectId, 'nuevo', 'modelo.glb');
      expect((await source.getVisualScene(projectId)).assets).toHaveLength(1);
    } finally { source.dispose(); }
  });
  it('vuelve a comprobar el espacio si otros adjuntos crecen mientras se lee el GLB', async () => {
    const state = createDemoState(); const at = new Date();
    state.visualProjects.push({ id: 'proyecto', authorId: 'demo-1', title: 'Espacio', kind: '3d', description: '', objective: '', topic: '', tags: [], subjectIds: [], links: [], resources: [], visibility: 'personal', archived: false, version: 1, createdAt: at.getTime(), updatedAt: at.getTime() });
    const existing: ResourceFile[] = [];
    const store = new DemoVisualSceneStore({ state: () => state, active: () => state.members.find(row => row.id === 'demo-1')!, now: () => at, emit() {}, existingFiles: () => existing });
    try {
      const asset = await store.createAsset('proyecto', 'importar', 'modelo.glb'); const file = glb(); const original = file.arrayBuffer.bind(file);
      Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: async () => {
        existing.push(...[50, 50, 50, 50, 50, 6].map((mib, index): ResourceFile => ({ id: `archivo-${index}`, targetKind: 'note', targetId: 'nota', name: 'archivo.bin', size: mib * 1024 * 1024, contentType: 'application/octet-stream', uploadedBy: 'demo-1', createdAt: at })));
        return original();
      } });
      await expect(store.upload(asset.id, file, 1)).rejects.toThrow('espacio disponible cambió');
      expect((await store.get('proyecto')).assets[0]?.state).toBe('pending');
      expect(store.resources()).toEqual([]);
    } finally { store.dispose(); }
  });
});
