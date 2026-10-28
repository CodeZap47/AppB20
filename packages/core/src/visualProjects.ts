/** The catalog is usable without a renderer or an AI account. */
export const VISUAL_PROJECT_KINDS = ['3d', 'graphic', 'simulation', 'mixed'] as const;
export type VisualProjectKind = typeof VISUAL_PROJECT_KINDS[number];
export type VisualProjectVisibility = 'personal' | 'group';
export const VISUAL_PROJECT_KIND_LABELS: Record<VisualProjectKind, string> = {
  '3d': '3D', graphic: 'Diseño gráfico', simulation: 'Simulación', mixed: 'Mixto',
};
export const VISUAL_PROJECT_LINK_KINDS = ['assignment', 'activity', 'note', 'guide'] as const;
export interface VisualProjectLink { kind: typeof VISUAL_PROJECT_LINK_KINDS[number]; id: string }
export interface VisualProjectResource {
  label: string; url: string; provider?: string; author?: string; format?: string; license?: string;
}
export interface VisualProjectInput {
  id?: string; expectedVersion?: number; requestId?: string;
  title: string; kind: VisualProjectKind; description?: string; objective?: string; topic?: string;
  tags?: string[]; subjectIds?: string[]; termId?: string;
  links?: VisualProjectLink[]; resources?: VisualProjectResource[];
  /** Explicit removals distinguish a deliberate edit from omitted, inaccessible sources. */
  removedLinks?: VisualProjectLink[];
}
export interface VisualProject {
  id: string; authorId: string; title: string; kind: VisualProjectKind;
  description: string; objective: string; topic: string; tags: string[];
  subjectIds: string[]; termId?: string; links: VisualProjectLink[]; resources: VisualProjectResource[];
  visibility: VisualProjectVisibility; archived: boolean; version: number;
  createdAt: number; updatedAt: number; coverFileId?: string;
  /** Derived scene summary; independent from the catalog metadata and version. */
  hasScene?: boolean; sceneVersion?: number;
  /** Author-only projection. These markers never contain source titles, content or URLs. */
  unavailableLinks?: VisualProjectLink[];
}
export type VisualProjectMetadata = Pick<VisualProject,
  'title' | 'kind' | 'description' | 'objective' | 'topic' | 'tags' | 'subjectIds' | 'termId' | 'links' | 'resources'>;
export const VISUAL_PROJECT_LIMITS = {
  title: 180, description: 6000, objective: 2000, topic: 160,
  tags: 20, tag: 60, subjects: 45, links: 100, resources: 40, url: 2000,
  coverBytes: 5 * 1024 * 1024,
} as const;

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} no es válido.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw new Error(`${field} no es válido.`);
  const clean = value.trim();
  if (required && !clean) throw new Error(`${field} es obligatorio.`);
  if (clean.length > max) throw new Error(`${field} excede ${max} caracteres.`);
  return clean;
}
function list(value: unknown, field: string, max: number): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`${field} admite hasta ${max} elementos.`);
  return value;
}
function identifier(value: unknown, field: string): string {
  const clean = text(value, field, 80, true);
  if (!/^[A-Za-z0-9_-]+$/.test(clean)) throw new Error(`${field} no es válido.`);
  return clean;
}
export function cleanVisualProjectLinks(value: unknown, field = 'Las relaciones'): VisualProjectLink[] {
  const seen = new Set<string>();
  const links: VisualProjectLink[] = [];
  for (const entry of list(value, field, VISUAL_PROJECT_LIMITS.links)) {
    const link = object(entry, 'La relación');
    const kind = link.kind as VisualProjectLink['kind'];
    if (!VISUAL_PROJECT_LINK_KINDS.includes(kind)) throw new Error('El tipo de relación no es válido.');
    const id = identifier(link.id, 'El recurso relacionado');
    const key = `${kind}:${id}`;
    if (!seen.has(key)) links.push({ kind, id });
    seen.add(key);
  }
  return links;
}
export function cleanVisualProjectRemovedLinks(value: unknown): VisualProjectLink[] {
  return cleanVisualProjectLinks(object(value, 'El proyecto').removedLinks, 'Las relaciones retiradas');
}
/** Preserve hidden prior references even when an older client cannot send them back. */
export function mergeVisualProjectLinks(
  previous: readonly VisualProjectLink[], submitted: readonly VisualProjectLink[], removed: readonly VisualProjectLink[],
  preserve: (link: VisualProjectLink) => boolean,
): VisualProjectLink[] {
  const key = (link: VisualProjectLink) => `${link.kind}:${link.id}`;
  const previousKeys = new Set(previous.map(key));
  const submittedKeys = new Set(submitted.map(key));
  const removedKeys = new Set(removed.map(key));
  for (const link of removed) {
    if (!previousKeys.has(key(link))) throw new Error('La relación que intentas quitar no pertenece a este proyecto.');
    if (submittedKeys.has(key(link))) throw new Error('No puedes conservar y quitar la misma relación.');
  }
  const next = new Map(submitted.map(link => [key(link), { ...link }]));
  for (const link of previous) {
    if (!removedKeys.has(key(link)) && !next.has(key(link)) && preserve(link)) next.set(key(link), { ...link });
  }
  if (next.size > VISUAL_PROJECT_LIMITS.links) throw new Error(`Las relaciones admiten hasta ${VISUAL_PROJECT_LIMITS.links} elementos.`);
  return [...next.values()];
}
/** SpacetimeDB does not expose URL; validate the same strict HTTPS subset in every runtime. */
export function cleanVisualProjectUrl(value: unknown): string {
  const url = text(value, 'El enlace', VISUAL_PROJECT_LIMITS.url, true);
  if (!/^https:\/\//i.test(url) || /[\s\\\u0000-\u001f\u007f]/.test(url)) throw new Error('Usa un enlace HTTPS válido, sin credenciales.');
  const authority = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(url)?.[1];
  if (!authority || authority.includes('@') || !/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[A-Fa-f0-9:]+\])(?::\d{1,5})?$/.test(authority)) {
    throw new Error('Usa un enlace HTTPS válido, sin credenciales.');
  }
  const port = /:(\d+)$/.exec(authority)?.[1];
  if (port && Number(port) > 65535) throw new Error('El puerto del enlace no es válido.');
  return url.replace(/^https:\/\//i, 'https://');
}
export function cleanVisualProjectInput(value: unknown): VisualProjectMetadata {
  const row = object(value, 'El proyecto');
  const kind = row.kind as VisualProjectKind;
  if (!VISUAL_PROJECT_KINDS.includes(kind)) throw new Error('Selecciona un tipo de contenido válido.');
  const tags = [...new Set(list(row.tags, 'Las etiquetas', VISUAL_PROJECT_LIMITS.tags)
    .map(value => text(value, 'La etiqueta', VISUAL_PROJECT_LIMITS.tag, true)))];
  const subjectIds = [...new Set(list(row.subjectIds, 'Las materias', VISUAL_PROJECT_LIMITS.subjects)
    .map(value => identifier(value, 'La materia')))];
  const links = cleanVisualProjectLinks(row.links);
  const resources = list(row.resources, 'Los enlaces externos', VISUAL_PROJECT_LIMITS.resources).map(value => {
    const resource = object(value, 'El recurso externo');
    const optional = (key: string) => text(resource[key], `El campo ${key}`, 300) || undefined;
    return { label: text(resource.label, 'El nombre del recurso', 180, true), url: cleanVisualProjectUrl(resource.url),
      provider: optional('provider'), author: optional('author'), format: optional('format'), license: optional('license') };
  });
  return {
    title: text(row.title, 'El título', VISUAL_PROJECT_LIMITS.title, true), kind,
    description: text(row.description, 'La descripción', VISUAL_PROJECT_LIMITS.description),
    objective: text(row.objective, 'El objetivo', VISUAL_PROJECT_LIMITS.objective),
    topic: text(row.topic, 'El tema', VISUAL_PROJECT_LIMITS.topic), tags, subjectIds,
    termId: row.termId === undefined || row.termId === '' ? undefined : identifier(row.termId, 'El parcial'), links, resources,
  };
}
export function visualProjectCoverError(name: string, type: string, bytes: number): string | undefined {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(type) || !Number.isFinite(bytes) || bytes <= 0 || bytes > VISUAL_PROJECT_LIMITS.coverBytes) {
    return `«${name}» debe ser una imagen PNG, JPEG o WebP de hasta 5 MiB.`;
  }
  return undefined;
}
