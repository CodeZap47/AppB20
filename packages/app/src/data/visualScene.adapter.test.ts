import { describe, expect, it, vi } from 'vitest';
import { emptyVisualSceneDocument, type VisualScene } from '@b20/core';
import type { DbConnection } from '../module_bindings';
import { createVisualSceneActions } from './visualSceneActions';
import { PUBLIC_VIEWS } from './spacetimeSnapshot';

const projectId = '18446744073709551614';
const scene = (): VisualScene => ({ projectId, version: 0, document: emptyVisualSceneDocument(), assets: [], capacity: { limitBytes: 268435456, reservedBytes: 0 }, updatedAt: 1 });
function setup() {
  let actor = 'author'; let value = scene();
  const getVisualScene = vi.fn(async () => JSON.stringify(value));
  const saveVisualScene = vi.fn(async () => { value = { ...value, version: value.version + 1 }; });
  const createVisualModelAsset = vi.fn(async () => JSON.stringify({ id: '18446744073709551613', projectId, name: 'cpu.glb', state: 'pending', version: 1, createdAt: 1 }));
  const discardVisualModelAssets = vi.fn(async () => undefined);
  const connection = { procedures: { getVisualScene, createVisualModelAsset }, reducers: { saveVisualScene, discardVisualModelAssets } } as unknown as DbConnection;
  return { actions: createVisualSceneActions(() => connection, () => actor), getVisualScene, saveVisualScene, createVisualModelAsset, discardVisualModelAssets,
    changeActor: () => { actor = 'other'; } };
}
describe('adaptador de escenas privadas', () => {
  it('consulta a demanda con identificadores u64 sin añadir tablas privadas a las suscripciones', async () => {
    const { actions, getVisualScene } = setup(); expect(await actions.getVisualScene(projectId)).toEqual(scene());
    expect(getVisualScene).toHaveBeenCalledWith({ projectId: BigInt(projectId) });
    for (const name of ['visual_scene', 'visual_model_asset', 'visual_asset_expiry']) expect(PUBLIC_VIEWS).not.toContain(name);
  });
  it('guarda el documento validado con su versión y recibo, y consulta la versión confirmada', async () => {
    const { actions, saveVisualScene } = setup(); const document = emptyVisualSceneDocument();
    expect((await actions.saveVisualScene({ projectId, expectedVersion: 0, requestId: 'guardar-una-vez', document })).version).toBe(1);
    expect(saveVisualScene).toHaveBeenCalledWith({ projectId: BigInt(projectId), expectedVersion: 0, requestId: 'guardar-una-vez', payload: JSON.stringify(document) });
  });
  it('no devuelve documentos privados de una sesión que cambió durante la consulta', async () => {
    const { actions, getVisualScene, changeActor } = setup();
    getVisualScene.mockImplementation(async () => { changeActor(); return JSON.stringify(scene()); });
    await expect(actions.getVisualScene(projectId)).rejects.toThrow('sesión cambió');
  });
  it('conserva solicitudes y versiones de activos al registrar y liberar archivos', async () => {
    const { actions, createVisualModelAsset, discardVisualModelAssets } = setup();
    const asset = await actions.createVisualModelAsset(projectId, 'reintento', 'cpu.glb');
    expect(createVisualModelAsset).toHaveBeenCalledWith({ projectId: BigInt(projectId), requestId: 'reintento', name: 'cpu.glb' });
    await actions.discardVisualModelAssets(projectId, [{ id: asset.id, expectedVersion: 2 }]);
    expect(discardVisualModelAssets).toHaveBeenCalledWith({ projectId: BigInt(projectId), assets: JSON.stringify([{ id: asset.id, expectedVersion: 2 }]) });
  });
  it('rechaza un documento de otro proyecto antes de entregarlo al visor', async () => {
    const { actions, getVisualScene } = setup(); getVisualScene.mockResolvedValue(JSON.stringify({ ...scene(), projectId: 'otro' }));
    await expect(actions.getVisualScene(projectId)).rejects.toThrow('leer la escena');
  });
});
