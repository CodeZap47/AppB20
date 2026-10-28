import { cleanVisualSceneDocument, type VisualModelAsset, type VisualScene, type VisualSceneInput } from '@b20/core';
import type { DbConnection } from '../module_bindings';

/** Only the private, authorized procedure returns scene documents; binary tables are never subscribed. */
export function createVisualSceneActions(connection: () => DbConnection, identity: () => string) {
  function session() {
    const current = connection();
    const actor = identity();
    if (!actor) throw new Error('Inicia sesión para abrir la escena.');
    return { current, assert: () => { if (connection() !== current || identity() !== actor) throw new Error('Tu sesión cambió. Vuelve a abrir el proyecto.'); } };
  }
  function parseScene(raw: string, projectId: string): VisualScene {
    const value = JSON.parse(raw) as VisualScene;
    if (value.projectId !== projectId || !Number.isInteger(value.version) || value.version < 0 || !Array.isArray(value.assets)
      || !value.capacity || !Number.isFinite(value.capacity.limitBytes) || !Number.isFinite(value.capacity.reservedBytes)) {
      throw new Error('No se pudo leer la escena. Actualiza B20 y vuelve a intentarlo.');
    }
    return { ...value, document: cleanVisualSceneDocument(value.document) };
  }
  return {
    async getVisualScene(projectId: string): Promise<VisualScene> {
      const { current, assert } = session();
      const raw = await current.procedures.getVisualScene({ projectId: BigInt(projectId) });
      assert(); return parseScene(raw, projectId);
    },
    async saveVisualScene(input: VisualSceneInput): Promise<VisualScene> {
      const document = cleanVisualSceneDocument(input.document);
      const { current, assert } = session();
      await current.reducers.saveVisualScene({ projectId: BigInt(input.projectId), expectedVersion: input.expectedVersion,
        requestId: input.requestId ?? crypto.randomUUID(), payload: JSON.stringify(document) });
      assert();
      const raw = await current.procedures.getVisualScene({ projectId: BigInt(input.projectId) });
      assert(); return parseScene(raw, input.projectId);
    },
    async createVisualModelAsset(projectId: string, requestId: string, name: string): Promise<VisualModelAsset> {
      const { current, assert } = session();
      const raw = await current.procedures.createVisualModelAsset({ projectId: BigInt(projectId), requestId, name });
      assert(); const value = JSON.parse(raw) as VisualModelAsset;
      if (value.projectId !== projectId || typeof value.id !== 'string' || !Number.isInteger(value.version) || value.version < 1) throw new Error('No se pudo confirmar el modelo. Reintenta la misma importación.');
      return value;
    },
    async discardVisualModelAssets(projectId: string, assets: { id: string; expectedVersion: number }[]): Promise<void> {
      const { current, assert } = session();
      await current.reducers.discardVisualModelAssets({ projectId: BigInt(projectId), assets: JSON.stringify(assets) });
      assert();
    },
  };
}
