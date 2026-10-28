import type { VisualProjectInput, VisualProjectVisibility } from '@b20/core';
import type { DbConnection } from '../module_bindings';

/** A receipt identifies an own creation even when peers create identical titles concurrently. */
export function createVisualProjectsActions(connection: () => DbConnection, identity: () => string) {
  return {
    async saveVisualProject(input: VisualProjectInput): Promise<string> {
      const actor = identity();
      const current = connection();
      const requestId = input.requestId?.trim() ?? crypto.randomUUID();
      const { id, expectedVersion, requestId: _request, ...metadata } = input;
      await current.reducers.saveVisualProject({ projectId: id === undefined ? undefined : BigInt(id), expectedVersion,
        requestId, payload: JSON.stringify(metadata) });
      if (identity() !== actor || connection() !== current) throw new Error('La sesión cambió. Vuelve a abrir Laboratorio visual.');
      if (id !== undefined) return id;
      const receipt = [...current.db.visualProjects.iter()].find((row) => {
        if (row.requestId !== requestId) return false;
        try { return (JSON.parse(row.json) as { authorId?: string }).authorId === actor; } catch { return false; }
      });
      if (!receipt) throw new Error('El proyecto se envió, pero falta confirmar su página. Reintenta el mismo envío para comprobarlo.');
      return receipt.id.toString();
    },
    async setVisualProjectVisibility(id: string, visibility: VisualProjectVisibility, expectedVersion: number): Promise<void> {
      const actor = identity(); const current = connection();
      await current.reducers.setVisualProjectVisibility({ projectId: BigInt(id), visibility, expectedVersion });
      if (identity() !== actor || connection() !== current) throw new Error('La sesión cambió. Vuelve a abrir Laboratorio visual.');
    },
    async archiveVisualProject(id: string, archived: boolean, expectedVersion: number): Promise<void> {
      const actor = identity(); const current = connection();
      await current.reducers.archiveVisualProject({ projectId: BigInt(id), archived, expectedVersion });
      if (identity() !== actor || connection() !== current) throw new Error('La sesión cambió. Vuelve a abrir Laboratorio visual.');
    },
  };
}
