import type { Identity } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { memberIdentityFor } from './authIdentity';
import { emitNotificationEvent } from './notificationHandlers';
import type { Ctx } from './moduleContext';

export const MOODLE_MAX_ITEMS = 200;
const MOODLE_ID = /^cesun:assign:\d{1,18}$/;
const MOODLE_URL = /^https:\/\/cursos\.cesun\.edu\.mx\/[^\s]{0,500}$/;

/** Helpers de páginas que viven en `index.ts`; se inyectan para no duplicar el versionado. */
export interface MoodleDeps {
  saveRevision(ctx: Ctx, assignmentId: bigint, version: number,
    content: { title: string; summary: string; body: string; dueDate: string }, actor: Identity): void;
  savePageSnapshot(ctx: Ctx, assignmentId: bigint): void;
  setAssignmentTopic(ctx: Ctx, assignmentId: bigint, topic: string): void;
}
export interface MoodleItem { moodleId: string; course: string; title: string; description: string; url: string; dueDate: string }
export interface MoodleResult { ok: true; created: number; updated: number; unchanged: number; skipped: { moodleId: string; reason: 'subject' | 'deleted' }[] }

function fail(code: string, message: string): never { throw new SenderError(`${code}:${message}`); }
const hex = (value: string) => value.trim().replace(/^0x/i, '').toLowerCase();

/** Igual que `normalize` de la extensión: sin acentos, minúsculas y solo letras/números. */
export function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function serviceIdentities(ctx: Ctx): string[] {
  return [ctx.db.aiServiceConfig.id.find(0)?.identity, ctx.db.fileServiceConfig.id.find(0)?.identity,
    ctx.db.notificationServiceConfig.id.find(0)?.identity, ctx.db.maintenanceService.id.find(0)?.identity]
    .filter((identity): identity is Identity => !!identity).map((identity) => hex(identity.toHexString()))
    .concat([ctx.env.B20_FILE_SERVICE_IDENTITY, ctx.env.B20_MAINTENANCE_IDENTITY].filter((v): v is string => !!v).map(hex));
}

export function setMoodleSync(ctx: Ctx, input: { identity: Identity; actor: Identity; enabled: boolean }) {
  if (!ctx.db.appConfig.id.find(0)?.owner.isEqual(memberIdentityFor(ctx))) throw new SenderError('Solo el propietario configura la sincronización con Moodle.');
  if (ctx.db.member.identity.find(input.identity) || serviceIdentities(ctx).includes(hex(input.identity.toHexString()))) {
    throw new SenderError('Moodle necesita una identidad técnica exclusiva.');
  }
  if (ctx.db.member.identity.find(input.actor)?.status !== 'active') throw new SenderError('Las tareas deben atribuirse a un miembro activo.');
  const row = { id: 0, ...input };
  if (ctx.db.moodleSyncConfig.id.find(0)) ctx.db.moodleSyncConfig.id.update(row); else ctx.db.moodleSyncConfig.insert(row);
}

function str(value: unknown, field: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('invalid', `${field} inválido.`);
  return value.trim();
}
export function parseMoodleItems(input: Record<string, unknown>): MoodleItem[] {
  const items = input.items;
  if (!Array.isArray(items) || items.length > MOODLE_MAX_ITEMS) fail('invalid', `Envía hasta ${MOODLE_MAX_ITEMS} tareas.`);
  const seen = new Set<string>();
  return items.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid', 'Tarea inválida.');
    const item = raw as Record<string, unknown>;
    const moodleId = str(item.moodleId, 'El identificador de Moodle', 40);
    if (!MOODLE_ID.test(moodleId) || seen.has(moodleId)) fail('invalid', 'Identificador de Moodle inválido o repetido.');
    seen.add(moodleId);
    const url = str(item.url, 'El enlace', 520);
    if (!MOODLE_URL.test(url)) fail('invalid', 'El enlace debe apuntar a cursos.cesun.edu.mx.');
    const dueDate = str(item.dueDate, 'La fecha', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) fail('invalid', 'Fecha de entrega inválida.');
    return { moodleId, url, dueDate, course: str(item.course, 'El curso', 300), title: str(item.title, 'El título', 200),
      description: str(item.description ?? '', 'La descripción', 20_000, false) };
  });
}

/** La materia cuyo nombre aparece en el curso de Moodle; ante varias, la más específica. */
function matchSubject(ctx: Ctx, course: string): bigint | undefined {
  const haystack = normalizeName(course);
  let best: { id: bigint; length: number } | undefined;
  for (const subject of ctx.db.subject.iter()) {
    const needle = normalizeName(subject.name);
    if (needle && haystack.includes(needle) && needle.length > (best?.length ?? 0)) best = { id: subject.id, length: needle.length };
  }
  return best?.id;
}

const instructionsFor = (item: MoodleItem) => [item.description, `Importada de Moodle: ${item.url}`].filter(Boolean).join('\n\n');

/** Crea o actualiza tareas del calendario compartido. Solo la identidad técnica configurada puede llamarlo. */
export function moodleIngest(ctx: Ctx, input: Record<string, unknown>, deps: MoodleDeps): MoodleResult {
  const config = ctx.db.moodleSyncConfig.id.find(0);
  if (!config || !config.identity.isEqual(memberIdentityFor(ctx))) fail('unauthorized', 'Solo el servicio de Moodle puede importar tareas.');
  if (!config.enabled) fail('disabled', 'La sincronización con Moodle está desactivada.');
  if (ctx.db.member.identity.find(config.actor)?.status !== 'active') fail('unauthorized', 'El miembro de la sincronización ya no está activo.');
  const items = parseMoodleItems(input);
  const actor = config.actor;
  const result: MoodleResult = { ok: true, created: 0, updated: 0, unchanged: 0, skipped: [] };
  const changeLog = (action: string, id: bigint) =>
    ctx.db.changeLog.insert({ id: 0n, actor, action, entity: 'assignment', entityId: id.toString(), at: ctx.timestamp });

  for (const item of items) {
    const link = ctx.db.moodleAssignmentLink.moodleId.find(item.moodleId);
    if (link) {
      const row = ctx.db.assignment.id.find(link.assignmentId);
      if (!row) { result.skipped.push({ moodleId: item.moodleId, reason: 'deleted' }); continue; }
      if (link.lastTitle === item.title && link.lastDueDate === item.dueDate) { result.unchanged += 1; continue; }
      // Solo se aplica lo que cambió en Moodle; las ediciones del grupo en otros campos se conservan.
      deps.savePageSnapshot(ctx, row.id);
      const next = { ...row, title: link.lastTitle !== item.title ? item.title : row.title,
        dueDate: link.lastDueDate !== item.dueDate ? item.dueDate : row.dueDate,
        version: row.version + 1, updatedBy: actor, updatedAt: ctx.timestamp };
      ctx.db.assignment.id.update(next);
      deps.saveRevision(ctx, row.id, next.version, { title: next.title, summary: '', body: next.instructions, dueDate: next.dueDate }, actor);
      ctx.db.moodleAssignmentLink.moodleId.update({ ...link, lastTitle: item.title, lastDueDate: item.dueDate, updatedAt: ctx.timestamp });
      changeLog('update', row.id);
      if (row.dueDate !== next.dueDate) emitNotificationEvent(ctx, { eventKey: `due:assignment:${row.id}:${next.version}`, kind: 'due_change',
        sourceKind: 'assignment', sourceId: row.id, actor, route: `/m/tareas/${row.id}` });
      result.updated += 1;
      continue;
    }
    const subjectId = matchSubject(ctx, item.course);
    if (subjectId === undefined) { result.skipped.push({ moodleId: item.moodleId, reason: 'subject' }); continue; }
    const row = ctx.db.assignment.insert({ id: 0n, subjectId, termId: undefined, kind: 'tarea', title: item.title,
      instructions: instructionsFor(item), dueDate: item.dueDate, version: 1,
      createdBy: actor, createdAt: ctx.timestamp, updatedBy: actor, updatedAt: ctx.timestamp });
    deps.setAssignmentTopic(ctx, row.id, '');
    deps.saveRevision(ctx, row.id, 1, { title: row.title, summary: '', body: row.instructions, dueDate: row.dueDate }, actor);
    ctx.db.moodleAssignmentLink.insert({ moodleId: item.moodleId, assignmentId: row.id, lastTitle: item.title,
      lastDueDate: item.dueDate, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
    changeLog('create', row.id);
    result.created += 1;
  }
  return result;
}

/** Igual que `aiResponse`: los procedures devuelven el error como dato para conservar su código. */
export function moodleResponse(ctx: Ctx, payload: string, deps: MoodleDeps): string {
  try {
    if (new TextEncoder().encode(payload).length > 512 * 1024) fail('invalid', 'La solicitud excede el límite.');
    let input: unknown;
    try { input = JSON.parse(payload); } catch { fail('invalid', 'JSON inválido.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid', 'Se esperaba un objeto.');
    return JSON.stringify(moodleIngest(ctx, input as Record<string, unknown>, deps));
  } catch (error) {
    if (error instanceof SenderError) return JSON.stringify({ ok: false, code: /^([a-z_]{3,40}):/.exec(error.message)?.[1] ?? 'unavailable', message: error.message });
    throw error;
  }
}
