import { cleanVisualProjectInput, cleanVisualProjectRemovedLinks, mergeVisualProjectLinks,
  type VisualProject, type VisualProjectInput, type VisualProjectLink, type VisualProjectVisibility } from '@b20/core';
import type { Member, ResourceFile } from './types';

export interface VisualProjectsDemoState {
  visualProjects: VisualProject[];
  visualProjectRequests: { actor: string; requestId: string; metadata: string; id: string }[];
}

interface Context {
  state(): VisualProjectsDemoState;
  active(): Member;
  id(): string;
  now(): Date;
  emit(): void;
  subjects(): readonly { id: string }[];
  terms(): readonly { id: string }[];
  source(link: VisualProjectLink): { public: boolean } | undefined;
  files(): readonly ResourceFile[];
}

/** Metadata lives with the demo state, never in a cache belonging to a different account. */
export class DemoVisualProjectsStore {
  constructor(private ctx: Context) {}

  private own(id: string, expectedVersion: number | undefined, allowArchived = false) {
    const actor = this.ctx.active();
    const row = this.ctx.state().visualProjects.find((project) => project.id === id);
    if (!row || row.authorId !== actor.id) throw new Error('Solo el autor puede modificar este proyecto visual.');
    if (expectedVersion !== row.version) throw new Error('El proyecto cambió. Revisa la versión actual antes de guardar.');
    if (row.archived && !allowArchived) throw new Error('Restaura el proyecto antes de modificarlo.');
    return row;
  }

  private sources(links: VisualProjectLink[], shared: boolean) {
    for (const link of links) {
      const source = this.ctx.source(link);
      if (!source) throw new Error('Un recurso relacionado ya no está disponible. Revisa los vínculos del proyecto.');
      if (shared && !source.public) throw new Error('Para publicar, todos los recursos relacionados deben estar disponibles para el grupo.');
    }
  }

  private replace(row: VisualProject) {
    this.ctx.state().visualProjects = this.ctx.state().visualProjects.map((project) => project.id === row.id ? row : project);
    this.ctx.emit();
  }

  async save(input: VisualProjectInput): Promise<string> {
    const actor = this.ctx.active();
    const metadata = cleanVisualProjectInput(input);
    const removed = cleanVisualProjectRemovedLinks(input);
    if (metadata.subjectIds.some((id) => !this.ctx.subjects().some((subject) => subject.id === id))) throw new Error('Una materia seleccionada no existe.');
    if (metadata.termId && !this.ctx.terms().some((term) => term.id === metadata.termId)) throw new Error('El parcial seleccionado no existe.');
    if (input.id !== undefined) {
      const row = this.own(input.id, input.expectedVersion);
      const prior = new Set(row.links.map(link => `${link.kind}:${link.id}`));
      const shared = row.visibility === 'group';
      metadata.links = mergeVisualProjectLinks(row.links, metadata.links, removed, link => {
        const source = this.ctx.source(link);
        return !source || shared && !source.public;
      });
      // Existing references can become unavailable after the editor opens. Only new
      // references require fresh access here; publishing always rechecks the whole set.
      this.sources(metadata.links.filter(link => !prior.has(`${link.kind}:${link.id}`)), shared);
      this.replace({ ...row, ...metadata, version: row.version + 1, updatedAt: this.ctx.now().getTime() });
      return row.id;
    }
    if (removed.length) throw new Error('No se pueden quitar relaciones de un proyecto que todavía no existe.');
    const requestId = input.requestId?.trim() ?? crypto.randomUUID();
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) throw new Error('El identificador del envío no es válido.');
    const payload = JSON.stringify(metadata);
    const previous = this.ctx.state().visualProjectRequests.find((entry) => entry.actor === actor.id && entry.requestId === requestId);
    if (previous) {
      if (previous.metadata !== payload) throw new Error('El identificador del envío ya corresponde a otro proyecto.');
      return previous.id;
    }
    this.sources(metadata.links, false);
    const at = this.ctx.now().getTime();
    const project: VisualProject = { ...metadata, id: this.ctx.id(), authorId: actor.id, visibility: 'personal', archived: false,
      version: 1, createdAt: at, updatedAt: at };
    this.ctx.state().visualProjects.push(project);
    this.ctx.state().visualProjectRequests.push({ actor: actor.id, requestId, metadata: payload, id: project.id });
    this.ctx.emit();
    return project.id;
  }

  async visibility(id: string, visibility: VisualProjectVisibility, expectedVersion: number): Promise<void> {
    const row = this.own(id, expectedVersion);
    if (visibility !== 'personal' && visibility !== 'group') throw new Error('La visibilidad del proyecto no es válida.');
    if (visibility === 'group') this.sources(row.links, true);
    if (row.visibility !== visibility) this.replace({ ...row, visibility, version: row.version + 1, updatedAt: this.ctx.now().getTime() });
  }

  async archive(id: string, archived: boolean, expectedVersion: number): Promise<void> {
    const row = this.own(id, expectedVersion, true);
    if (typeof archived !== 'boolean') throw new Error('El estado del proyecto no es válido.');
    if (row.archived !== archived) this.replace({ ...row, archived, version: row.version + 1, updatedAt: this.ctx.now().getTime() });
  }

  snapshot(): VisualProject[] {
    const actor = this.ctx.active();
    return this.ctx.state().visualProjects
      .filter((project) => project.authorId === actor.id || project.visibility === 'group' && !project.archived)
      .map((project) => {
        const latest = this.ctx.files().filter((file) => file.targetKind === 'visual_project' && file.targetId === project.id && !file.removedAt).at(-1);
        const links: VisualProjectLink[] = [];
        const unavailableLinks: VisualProjectLink[] = [];
        for (const link of project.links) {
          if (this.ctx.source(link)) links.push({ ...link });
          else if (project.authorId === actor.id) unavailableLinks.push({ ...link });
        }
        const result: VisualProject = { ...project, tags: [...project.tags], subjectIds: [...project.subjectIds],
          links, resources: project.resources.map((resource) => ({ ...resource })), coverFileId: latest?.id };
        // State contains the original relationships; derived markers belong only to
        // the current owner's projection, never to a peer or administrator.
        delete result.unavailableLinks;
        if (project.authorId === actor.id && unavailableLinks.length) result.unavailableLinks = unavailableLinks;
        return result;
      });
  }
}
