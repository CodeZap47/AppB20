import { cleanVisualProjectInput, cleanVisualProjectLinks, type VisualProject, type VisualProjectLink } from '@b20/core';
import type { DbConnection } from '../module_bindings';
import type { Snapshot } from './types';

/** Reject mismatched wire versions; never retain another account's cached private records. */
export function readVisualProjectsSnapshot(connection: Pick<DbConnection, 'db'>, snapshot: Snapshot, identity: string): VisualProject[] {
  if (snapshot.me?.id !== identity || snapshot.me.status !== 'active') return [];
  const rows = connection.db.visualProjects?.iter() ?? [];
  const result: VisualProject[] = [];
  for (const row of rows) {
    try {
      const value = JSON.parse(row.json) as VisualProject;
      if (!value || typeof value !== 'object' || value.id !== row.id.toString() || typeof value.authorId !== 'string'
        || !['personal', 'group'].includes(value.visibility) || typeof value.archived !== 'boolean') throw new Error();
      if (value.authorId !== identity && (value.visibility !== 'group' || value.archived)) continue;
      if (!Number.isInteger(value.version) || value.version < 1 || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)
        || value.coverFileId !== undefined && typeof value.coverFileId !== 'string') throw new Error();
      const metadata = cleanVisualProjectInput(value);
      const owner = value.authorId === identity;
      // A server marker wins over a stale academic snapshot. It becomes a live
      // reference again when the server projection confirms restored access.
      const unavailableLinks = owner ? cleanVisualProjectLinks(value.unavailableLinks, 'Las relaciones no disponibles') : [];
      const unavailable = new Set(unavailableLinks.map(link => `${link.kind}:${link.id}`));
      const links = metadata.links.filter((link) => {
        if (unavailable.has(`${link.kind}:${link.id}`)) return false;
        const sources = link.kind === 'assignment' ? snapshot.assignments : link.kind === 'activity' ? snapshot.activities
          : link.kind === 'note' ? snapshot.notes : snapshot.guides;
        const readable = sources.some((source) => source.id === link.id && !('withdrawnAt' in source && source.withdrawnAt)
          && (!('visibility' in source) || source.visibility !== 'personal' || 'authorId' in source && source.authorId === identity));
        if (!readable && owner) {
          unavailableLinks.push({ kind: link.kind, id: link.id });
          unavailable.add(`${link.kind}:${link.id}`);
        }
        return readable;
      });
      const project: VisualProject = { ...metadata, id: value.id, authorId: value.authorId, visibility: value.visibility, archived: value.archived,
        version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt, links, coverFileId: value.coverFileId };
      if (typeof value.hasScene === 'boolean') project.hasScene = value.hasScene;
      if (Number.isInteger(value.sceneVersion) && value.sceneVersion! >= 0) project.sceneVersion = value.sceneVersion;
      if (owner && unavailableLinks.length) project.unavailableLinks = unavailableLinks.map((link): VisualProjectLink => ({ kind: link.kind, id: link.id }));
      result.push(project);
    } catch { throw new Error('Los proyectos visuales requieren una actualización de B20. Vuelve a conectar con el grupo.'); }
  }
  return result;
}
