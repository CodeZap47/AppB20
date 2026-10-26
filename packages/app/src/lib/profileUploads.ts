import type { Id, Snapshot } from '../data/types';

export interface ProfileUploadStats {
  bytes: number;
  fileCount: number;
}

/**
 * Usa los totales por integrante del servidor cuando están disponibles. Sin ese
 * agregado, suma solamente resourceFiles y workFiles del snapshot de quien consulta:
 * no incluye stickers ni archivos privados que no puede ver, y no es un total global.
 * La atribución pertenece a uploadedBy, nunca a los coautores de una publicación.
 */
export function buildProfileUploadStats(
  data: Pick<Snapshot, 'resourceFiles' | 'workFiles' | 'memberUploadStats'>,
): Map<Id, ProfileUploadStats> {
  if (data.memberUploadStats !== undefined) {
    return new Map(data.memberUploadStats.map(({ memberId, bytes, fileCount }) => [memberId, { bytes, fileCount }]));
  }

  const stats = new Map<Id, ProfileUploadStats>();
  const add = (memberId: Id, bytes: number) => {
    const previous = stats.get(memberId) ?? { bytes: 0, fileCount: 0 };
    stats.set(memberId, { bytes: previous.bytes + bytes, fileCount: previous.fileCount + 1 });
  };
  const resourceIds = new Set<Id>();
  for (const file of data.resourceFiles) {
    if (resourceIds.has(file.id)) continue;
    resourceIds.add(file.id);
    if (file.removedAt === undefined) add(file.uploadedBy, file.size);
  }

  const workFileIds = new Set<Id>();
  for (const file of data.workFiles) {
    // Los snapshots reflejan los recursos de trabajos también como WorkFile.
    // El recurso es la autoridad, incluso si marca retirado un archivo heredado.
    if (resourceIds.has(file.id) || resourceIds.has(`legacy:${file.id}`) || workFileIds.has(file.id)) continue;
    workFileIds.add(file.id);
    add(file.uploadedBy, file.size);
  }
  return stats;
}
