import { SenderError } from 'spacetimedb/server';
import { cleanVisualProjectInput, cleanVisualProjectRemovedLinks, mergeVisualProjectLinks,
  type VisualProject, type VisualProjectLink, type VisualProjectMetadata,
  type VisualProjectVisibility } from '../../core/src/visualProjects';
import { memberIdentityFor } from './authIdentity';
import { canReadTarget, withdrawnIncludingParent } from './delivery2Handlers';
import { activeMember, expectVersion, isActive, log, type Ctx, type ViewDb } from './moduleContext';

type ProjectRow = NonNullable<ReturnType<Ctx['db']['visualProject']['id']['find']>>;
const numericId = (id: string) => {
  if (!/^[1-9]\d{0,19}$/.test(id) || BigInt(id) > 18_446_744_073_709_551_615n) throw new SenderError('La referencia académica no es válida.');
  return BigInt(id);
};
function metadata(value: string): VisualProjectMetadata {
  if (value.length > 160_000) throw new SenderError('El proyecto excede el tamaño permitido.');
  try { return cleanVisualProjectInput(JSON.parse(value)); }
  catch (error) { throw new SenderError(error instanceof SyntaxError ? 'Los datos del proyecto no son válidos.' : error instanceof Error ? error.message : 'El proyecto no es válido.'); }
}
function removedLinks(value: string): VisualProjectLink[] {
  try { return cleanVisualProjectRemovedLinks(JSON.parse(value)); }
  catch (error) { throw new SenderError(error instanceof Error ? error.message : 'Las relaciones retiradas no son válidas.'); }
}
function readableLink(db: ViewDb, actor: Ctx['sender'], link: VisualProjectLink): boolean {
  const id = numericId(link.id);
  return canReadTarget(db, actor, link.kind, id) && !withdrawnIncludingParent(db, link.kind, id);
}
function validateSources(ctx: Ctx, value: VisualProjectMetadata, group: boolean) {
  const actor = memberIdentityFor(ctx);
  for (const id of value.subjectIds) if (!ctx.db.subject.id.find(numericId(id))) throw new SenderError('Una de las materias ya no está disponible.');
  if (value.termId && !ctx.db.term.id.find(numericId(value.termId))) throw new SenderError('El parcial no está disponible.');
  for (const link of value.links) {
    if (!readableLink(ctx.db, actor, link)) throw new SenderError('Uno de los recursos relacionados ya no está disponible. Revisa las relaciones.');
    if (group && link.kind === 'note' && ctx.db.note.id.find(numericId(link.id))?.visibility !== 'group') {
      throw new SenderError('Para publicar, las notas relacionadas deben estar compartidas con el grupo. Quita la relación o comparte la nota primero.');
    }
  }
}
function owned(ctx: Ctx, id: bigint): ProjectRow {
  activeMember(ctx);
  const row = ctx.db.visualProject.id.find(id);
  if (!row || !row.author.isEqual(memberIdentityFor(ctx))) throw new SenderError('Solo el autor modifica este proyecto.');
  return row;
}
function requireEditable(row: ProjectRow) {
  if (row.archived) throw new SenderError('Restaura el proyecto antes de editarlo.');
}
export function visualProjectReadable(db: ViewDb, actor: Ctx['sender'], id: bigint): boolean {
  if (!isActive(db, actor)) return false;
  const row = db.visualProject.id.find(id);
  return !!row && (row.author.isEqual(actor) || row.visibility === 'group' && !row.archived);
}
export function latestVisualProjectCover(db: ViewDb, id: bigint) {
  return [...db.resourceFile.targetId.filter(id)].filter(file => file.targetKind === 'visual_project' && file.removedAt === undefined)
    .sort((a, b) => a.createdAt.microsSinceUnixEpoch > b.createdAt.microsSinceUnixEpoch ? -1
      : a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : b.id.localeCompare(a.id))[0];
}
/** Previous covers never remain shared after their replacement. */
export function visualProjectCoverVisible(db: ViewDb, actor: Ctx['sender'], file: { id: string; targetId: bigint }): boolean {
  if (!visualProjectReadable(db, actor, file.targetId)) return false;
  const project = db.visualProject.id.find(file.targetId)!;
  return project.author.isEqual(actor) || latestVisualProjectCover(db, file.targetId)?.id === file.id;
}
export function saveVisualProject(ctx: Ctx, input: { projectId?: bigint; expectedVersion?: number; requestId: string; payload: string }) {
  activeMember(ctx);
  const actor = memberIdentityFor(ctx);
  const clean = metadata(input.payload);
  const removed = removedLinks(input.payload);
  if (input.projectId !== undefined) {
    const row = owned(ctx, input.projectId); requireEditable(row);
    if (input.expectedVersion === undefined) throw new SenderError('Falta la versión del proyecto. Vuelve a abrirlo.');
    expectVersion(row.version, input.expectedVersion);
    const prior = metadata(row.metadata);
    const priorKeys = new Set(prior.links.map(link => `${link.kind}:${link.id}`));
    try {
      clean.links = mergeVisualProjectLinks(prior.links, clean.links, removed, link =>
        !readableLink(ctx.db, actor, link) || row.visibility === 'group' && link.kind === 'note'
          && ctx.db.note.id.find(numericId(link.id))?.visibility !== 'group');
    } catch (error) { throw new SenderError(error instanceof Error ? error.message : 'Las relaciones no son válidas.'); }
    // Existing sources may change independently; only new references need approval on an edit.
    // An explicit publication below still checks every reference in the complete stored set.
    validateSources(ctx, { ...clean, links: clean.links.filter(link => !priorKeys.has(`${link.kind}:${link.id}`)) }, row.visibility === 'group');
    ctx.db.visualProject.id.update({ ...row, metadata: JSON.stringify(clean), version: row.version + 1, updatedAt: ctx.timestamp });
    log(ctx, 'update', 'visual_project', row.id);
    return row.id;
  }
  if (removed.length) throw new SenderError('Un proyecto nuevo no tiene relaciones que quitar.');
  const json = JSON.stringify(clean);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.requestId)) throw new SenderError('La solicitud de creación no es válida.');
  const requestKey = `${actor.toHexString()}:${input.requestId}`;
  const previous = ctx.db.visualProject.requestKey.find(requestKey);
  if (previous) {
    if (previous.creationMetadata !== json) throw new SenderError('Esta solicitud ya creó otro proyecto.');
    return previous.id;
  }
  validateSources(ctx, clean, false);
  const row = ctx.db.visualProject.insert({ id: 0n, author: actor, requestKey, requestId: input.requestId,
    creationMetadata: json, metadata: json, visibility: 'personal', archived: false, version: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
  log(ctx, 'create', 'visual_project', row.id);
  return row.id;
}
export function setVisualProjectVisibility(ctx: Ctx, input: { projectId: bigint; visibility: string; expectedVersion: number }) {
  const row = owned(ctx, input.projectId); requireEditable(row);
  expectVersion(row.version, input.expectedVersion);
  if (!['personal', 'group'].includes(input.visibility)) throw new SenderError('La visibilidad no es válida.');
  if (input.visibility === 'group') validateSources(ctx, metadata(row.metadata), true);
  if (row.visibility === input.visibility) return;
  ctx.db.visualProject.id.update({ ...row, visibility: input.visibility, version: row.version + 1, updatedAt: ctx.timestamp });
  log(ctx, input.visibility === 'group' ? 'publish' : 'unpublish', 'visual_project', row.id);
}
export function archiveVisualProject(ctx: Ctx, input: { projectId: bigint; archived: boolean; expectedVersion: number }) {
  const row = owned(ctx, input.projectId);
  expectVersion(row.version, input.expectedVersion);
  if (row.archived === input.archived) return;
  // Existing shared projects redact unavailable links at read time, including after restoration.
  ctx.db.visualProject.id.update({ ...row, archived: input.archived, version: row.version + 1, updatedAt: ctx.timestamp });
  log(ctx, input.archived ? 'archive' : 'restore', 'visual_project', row.id);
}
export function visualProjects(db: ViewDb, actor: Ctx['sender']) {
  if (!isActive(db, actor)) return [];
  return [...db.visualProject.iter()].filter(row => visualProjectReadable(db, actor, row.id)).map(row => {
    const value = metadata(row.metadata);
    const scene = db.visualScene.projectId.find(row.id);
    const sceneDocument = scene ? JSON.parse(scene.document) as { frame?: { instances?: unknown[] }; views?: { frame?: { instances?: unknown[] } }[]; steps?: { frame?: { instances?: unknown[] } }[] } : undefined;
    const hasScene = !!sceneDocument && [sceneDocument.frame, ...(sceneDocument.views ?? []).map(view => view.frame), ...(sceneDocument.steps ?? []).map(step => step.frame)].some(frame => !!frame?.instances?.length);
    const project: VisualProject = { ...value, id: String(row.id), authorId: row.author.toHexString(),
      links: value.links.filter(link => readableLink(db, actor, link)),
      ...(row.author.isEqual(actor) ? { unavailableLinks: value.links.filter(link => !readableLink(db, actor, link)) } : {}),
      visibility: row.visibility as VisualProjectVisibility, archived: row.archived, version: row.version,
      createdAt: Number(row.createdAt.microsSinceUnixEpoch / 1000n), updatedAt: Number((scene && scene.updatedAt.microsSinceUnixEpoch > row.updatedAt.microsSinceUnixEpoch ? scene.updatedAt : row.updatedAt).microsSinceUnixEpoch / 1000n),
      sceneVersion: scene?.version ?? 0, hasScene,
      coverFileId: latestVisualProjectCover(db, row.id)?.id };
    return { id: row.id, json: JSON.stringify(project), requestId: row.author.isEqual(actor) ? row.requestId : '' };
  });
}
