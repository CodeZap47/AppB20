import { memberIdentityFor } from './authIdentity';
import { Identity, Timestamp } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { sha256 } from '@noble/hashes/sha2.js';
import { activeMember, isActive, type Ctx } from './moduleContext';
import { canReadTarget, withdrawn } from './delivery2Handlers';
import { GUIDE_SECTIONS } from '../../core/src/guides';
import {
  AI_CONSENT_VERSION, AI_LIMITS, AI_SOURCE_KINDS, buildAiPreparation, validateAiGenerationConfig,
  aiHash, aiSourceFingerprint, estimateAiQuestionTokens, sanitizeAiText, validateAiPrepareInput, type AiPreparation, type AiPrepareInput, type AiSourceSnapshot,
} from '../../core/src/ai';
import { validateAiQuestionDraft } from '../../core/src/exam';
import { validateAiModuleDraft } from '../../core/src/aiStudyModules';
import { validateAiStudyDraft } from '../../core/src/aiStudyDraft';
import { captureGuide, captureNote } from './delivery2Handlers';

const HOUR = 60n * 60n * 1_000_000n;
const DAY = 24n * HOUR;
function fail(code: string, message: string): never {
  const normalized: Record<string, string> = { invalid_request: 'invalid', request_too_large: 'invalid',
    forbidden: 'unauthorized', ai_disabled: 'disabled', consent_required: 'consent', intent_expired: 'expired',
    invalid_service_identity: 'invalid', source_unavailable: 'unavailable', source_changed: 'conflict',
    key_changed: 'conflict', key_required: 'unavailable' };
  throw new SenderError(`${normalized[code] ?? code}:${message}`);
}
function hex(value: string) { return value.trim().replace(/^0x/i, '').toLowerCase(); }
function hash(value: string) { return Array.from(sha256(new TextEncoder().encode(value)), (byte) => byte.toString(16).padStart(2, '0')).join(''); }
function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail('invalid_request', `${field} debe ser UUID.`);
  return value.toLowerCase();
}
function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_request', 'Se esperaba un objeto.');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid_request', `${field} inválido.`);
  return value.trim();
}
export function parseAiPayload(payload: string): Record<string, unknown> {
  if (new TextEncoder().encode(payload).length > AI_LIMITS.maxBodyBytes) fail('request_too_large', 'La solicitud excede el límite.');
  try { return obj(JSON.parse(payload)); } catch (error) { if (error instanceof SenderError) throw error; return fail('invalid_request', 'JSON inválido.'); }
}
function date(at: Timestamp) { return Number(at.microsSinceUnixEpoch / 1000n); }
function expiry(ctx: Ctx, minutes: number) { return new Timestamp(ctx.timestamp.microsSinceUnixEpoch + BigInt(minutes) * 60n * 1_000_000n); }
function actorIdentity(value: unknown) {
  const valueHex = hex(text(value, 'La identidad', 66));
  if (!/^[0-9a-f]{64}$/.test(valueHex)) fail('invalid_request', 'Identidad inválida.');
  return Identity.fromString(valueHex);
}
export function isAiService(ctx: Ctx): boolean {
  const configured = ctx.db.aiServiceConfig.id.find(0)?.identity;
  return !!configured && configured.isEqual(memberIdentityFor(ctx)) && !ctx.db.appConfig.id.find(0)?.owner.isEqual(memberIdentityFor(ctx))
    && !ctx.db.fileServiceConfig.id.find(0)?.identity.isEqual(memberIdentityFor(ctx))
    && hex(ctx.env.B20_FILE_SERVICE_IDENTITY ?? '') !== hex(memberIdentityFor(ctx).toHexString())
    && !ctx.db.notificationServiceConfig.id.find(0)?.identity.isEqual(memberIdentityFor(ctx)) && !ctx.db.maintenanceService.id.find(0)?.identity.isEqual(memberIdentityFor(ctx))
    && hex(ctx.env.B20_MAINTENANCE_IDENTITY ?? '') !== hex(memberIdentityFor(ctx).toHexString());
}
function service(ctx: Ctx) { if (!isAiService(ctx)) fail('forbidden', 'Solo el servicio de IA puede realizar esta operación.'); }
function enabled(ctx: Ctx) { if (!ctx.db.aiServiceConfig.id.find(0)?.enabled) fail('ai_disabled', 'La IA real todavía no está habilitada para este grupo.'); }
function consent(ctx: Ctx, actor = memberIdentityFor(ctx)) {
  const row = ctx.db.aiConsent.actor.find(actor);
  if (!row?.accepted || row.version !== AI_CONSENT_VERSION) fail('consent_required', 'Confirma el consentimiento vigente antes de enviar material.');
}
export function setAiService(ctx: Ctx, input: { identity: Identity; enabled: boolean; dailyTokenBudget: number }) {
  if (!ctx.db.appConfig.id.find(0)?.owner.isEqual(memberIdentityFor(ctx))) fail('forbidden', 'Solo el propietario configura el servicio de IA.');
  if (input.identity.isEqual(memberIdentityFor(ctx)) || ctx.db.member.identity.find(input.identity) || ctx.db.fileServiceConfig.id.find(0)?.identity.isEqual(input.identity)
    || hex(ctx.env.B20_FILE_SERVICE_IDENTITY ?? '') === hex(input.identity.toHexString())
    || ctx.db.notificationServiceConfig.id.find(0)?.identity.isEqual(input.identity) || ctx.db.maintenanceService.id.find(0)?.identity.isEqual(input.identity)
    || hex(ctx.env.B20_MAINTENANCE_IDENTITY ?? '') === hex(input.identity.toHexString())) fail('invalid_service_identity', 'IA necesita una identidad técnica exclusiva.');
  if (!Number.isInteger(input.dailyTokenBudget) || input.dailyTokenBudget < 1 || input.dailyTokenBudget > 10_000_000) fail('invalid_request', 'Presupuesto diario inválido.');
  const row = { id: 0, ...input };
  if (ctx.db.aiServiceConfig.id.find(0)) ctx.db.aiServiceConfig.id.update(row); else ctx.db.aiServiceConfig.insert(row);
}
export function aiStatus(ctx: Ctx) {
  activeMember(ctx);
  const policy = ctx.db.aiServiceConfig.id.find(0);
  const accepted = ctx.db.aiConsent.actor.find(memberIdentityFor(ctx));
  return { actor: hex(memberIdentityFor(ctx).toHexString()), enabled: policy?.enabled ?? false,
    consentVersion: AI_CONSENT_VERSION, consented: accepted?.accepted === true && accepted.version === AI_CONSENT_VERSION,
    configured: !!ctx.db.aiKey.actor.find(memberIdentityFor(ctx)), model: '', limits: { ...AI_LIMITS, dailyEstimatedTokens: policy?.dailyTokenBudget ?? 100_000 } };
}
export function aiKeyStatus(ctx: Ctx) {
  activeMember(ctx); const key = ctx.db.aiKey.actor.find(memberIdentityFor(ctx));
  return { configured: !!key, provider: 'gemini', ...(key ? { keyId: key.keyId, updatedAt: date(key.updatedAt) } : {}) };
}
function cancelPending(ctx: Ctx, actor: Identity) {
  for (const row of ctx.db.aiKeyIntent.actor.filter(actor)) if (row.status === 'pending') ctx.db.aiKeyIntent.id.update({ ...row, status: 'cancelled' });
  for (const row of ctx.db.aiGeneration.actor.filter(actor)) if (row.status === 'queued') {
    ctx.db.aiGeneration.id.update({ ...row, status: 'failed', errorCode: 'key_changed', errorMessage: 'La clave o el consentimiento cambiaron.' });
    const reservation = ctx.db.aiReservation.id.find(row.id);
    if (reservation) ctx.db.aiReservation.id.update({ ...reservation, status: 'released' });
  }
}
export function aiSetConsent(ctx: Ctx, input: Record<string, unknown>) {
  activeMember(ctx);
  if (input.version !== AI_CONSENT_VERSION || typeof input.accepted !== 'boolean') fail('invalid_request', 'Consentimiento inválido.');
  const row = { actor: memberIdentityFor(ctx), version: AI_CONSENT_VERSION, accepted: input.accepted, updatedAt: ctx.timestamp };
  if (ctx.db.aiConsent.actor.find(memberIdentityFor(ctx))) ctx.db.aiConsent.actor.update(row); else ctx.db.aiConsent.insert(row);
  if (!row.accepted) cancelPending(ctx, memberIdentityFor(ctx));
  return { version: row.version, accepted: row.accepted };
}
export function aiAuthorizeKey(ctx: Ctx, input: Record<string, unknown>) {
  activeMember(ctx); consent(ctx);
  const id = uuid(input.intentId, 'La intención'); const keyId = uuid(input.keyId, 'La clave');
  if (input.provider !== 'gemini') fail('invalid_request', 'Proveedor no admitido.');
  const prior = ctx.db.aiKeyIntent.id.find(id);
  if (prior) {
    if (!prior.actor.isEqual(memberIdentityFor(ctx)) || prior.keyId !== keyId || prior.provider !== input.provider) fail('conflict', 'La intención ya pertenece a otra solicitud.');
    if (prior.status === 'cancelled' || prior.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) fail('intent_expired', 'La intención venció. Crea otra.');
    return { actor: hex(memberIdentityFor(ctx).toHexString()), intentId: id, keyId, expiresAt: date(prior.expiresAt), committed: prior.status === 'committed' };
  }
  // Only the most recently authorized replacement may commit.
  for (const row of ctx.db.aiKeyIntent.actor.filter(memberIdentityFor(ctx))) if (row.status === 'pending') ctx.db.aiKeyIntent.id.update({ ...row, status: 'cancelled' });
  const row = ctx.db.aiKeyIntent.insert({ id, actor: memberIdentityFor(ctx), keyId, provider: 'gemini', status: 'pending', createdAt: ctx.timestamp, expiresAt: expiry(ctx, 5) });
  return { actor: hex(memberIdentityFor(ctx).toHexString()), intentId: id, keyId, expiresAt: date(row.expiresAt), committed: false };
}
export function aiCommitKey(ctx: Ctx, input: Record<string, unknown>) {
  service(ctx); const actor = actorIdentity(input.actor); const intentId = uuid(input.intentId, 'La intención');
  const keyId = uuid(input.keyId, 'La clave'); const intent = ctx.db.aiKeyIntent.id.find(intentId);
  if (!intent || !intent.actor.isEqual(actor) || intent.keyId !== keyId || intent.provider !== input.provider || intent.status === 'cancelled') fail('forbidden', 'No existe una intención válida para esta clave.');
  if (!isActive(ctx.db, actor)) fail('forbidden', 'El propietario de la clave ya no es miembro activo.');
  consent(ctx, actor);
  const ciphertext = text(input.ciphertext, 'El cifrado', 1500); const iv = text(input.iv, 'El IV', 100); const masterVersion = text(input.masterVersion, 'La versión maestra', 80);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext) || !/^[A-Za-z0-9+/]{16}$/.test(iv)) fail('invalid_request', 'Sobre cifrado inválido.');
  const prior = ctx.db.aiKey.actor.find(actor);
  if (intent.status === 'committed') {
    if (prior?.keyId !== keyId || prior.ciphertext !== ciphertext || prior.iv !== iv || prior.masterVersion !== masterVersion) fail('conflict', 'Una clave confirmada no puede sustituirse con esta intención.');
    return { configured: true, keyId };
  }
  if (intent.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) fail('intent_expired', 'La autorización venció.');
  cancelPending(ctx, actor);
  const row = { actor, keyId, provider: 'gemini', ciphertext, iv, masterVersion, updatedAt: ctx.timestamp };
  if (prior) ctx.db.aiKey.actor.update(row); else ctx.db.aiKey.insert(row);
  ctx.db.aiKeyIntent.id.update({ ...intent, status: 'committed' });
  return { configured: true, keyId };
}
export function aiDeleteKey(ctx: Ctx) {
  activeMember(ctx); cancelPending(ctx, memberIdentityFor(ctx)); ctx.db.aiKey.actor.delete(memberIdentityFor(ctx));
  return { configured: false };
}

/** Only the owner's saved explanation is sent. Personal notes, answers, peer identity and reflection are never read. */
function resolveTeachingSource(ctx: Ctx, id: bigint, actor: Identity): AiSourceSnapshot {
  const row = ctx.db.teachingPractice.id.find(id);
  if (!row?.owner.isEqual(actor) || row.status !== 'practicing') fail('source_unavailable', 'Solo el autor puede usar la explicación guardada de una práctica en curso.');
  const revised = [row.revisedConcept, row.revisedExample, row.revisedLimits].every((field) => field.trim());
  const fields = [{ name: 'Concepto guardado', text: revised ? row.revisedConcept : row.concept },
    { name: 'Ejemplo guardado', text: revised ? row.revisedExample : row.example },
    { name: 'Límites guardados', text: revised ? row.revisedLimits : row.limits }];
  if (fields.some((field) => !field.text.trim())) fail('invalid_request', 'Guarda una explicación completa antes de preparar preguntas.');
  const fingerprint = aiHash({ fields, topic: row.topic, subjectId: String(row.subjectId) });
  const key = `${id}:${fingerprint}`;
  let revision = ctx.db.aiTeachingVersion.id.find(key);
  if (!revision) {
    const prior = [...ctx.db.aiTeachingVersion.practiceId.filter(id)];
    revision = ctx.db.aiTeachingVersion.insert({ id: key, practiceId: id,
      version: prior.reduce((max, entry) => Math.max(max, entry.version), 0) + 1, fingerprint, createdAt: ctx.timestamp });
  }
  return { kind: 'teaching', refId: String(id), subjectId: String(row.subjectId), version: revision.version,
    title: row.topic, visibility: 'personal', fields, context: fingerprint,
    omissions: ['Solo se envía la explicación guardada; se excluyen reflexión, temas personales, respuestas, historial y datos del compañero.'] };
}
/** Resolve only academic record fields. No client-supplied text reaches the provider. */
export function resolveAiSource(ctx: Ctx, kind: string, refId: string, actor = memberIdentityFor(ctx)): AiSourceSnapshot {
  if (!/^[1-9][0-9]*$/.test(refId) || BigInt(refId) > 18_446_744_073_709_551_615n) fail('invalid_request', 'Referencia inválida.');
  const id = BigInt(refId);
  if (kind === 'teaching') return resolveTeachingSource(ctx, id, actor);
  if (!canReadTarget(ctx.db, actor, kind, id) || withdrawn(ctx.db, kind, id)) fail('source_unavailable', 'Una fuente no existe o ya no está disponible.');
  let snapshot: AiSourceSnapshot;
  if (kind === 'note') {
    const row = ctx.db.note.id.find(id)!; const detail = ctx.db.noteDetail.noteId.find(id);
    snapshot = { kind, refId, subjectId: String(row.subjectId), termId: detail?.termId?.toString(), version: row.version,
      title: row.title, topic: row.topic, visibility: row.visibility === 'personal' ? 'personal' : 'group',
      fields: [{ name: 'contenido', text: row.body }], context: row.source };
  } else if (kind === 'assignment') {
    const row = ctx.db.assignment.id.find(id)!;
    snapshot = { kind, refId, subjectId: String(row.subjectId), termId: row.termId?.toString(), version: row.version,
      title: row.title, topic: ctx.db.assignmentDetail.assignmentId.find(id)?.topic ?? '', visibility: 'group',
      fields: [{ name: 'instrucciones', text: row.instructions }], context: row.kind };
  } else if (kind === 'activity') {
    const row = ctx.db.activity.id.find(id)!;
    snapshot = { kind, refId, subjectId: String(row.subjectId), termId: row.termId?.toString(), version: row.version,
      title: row.title, topic: row.topic, visibility: 'group', fields: [{ name: 'objetivo', text: row.objective }, { name: 'instrucciones', text: row.instructions }] };
  } else if (kind === 'work') {
    const row = ctx.db.work.id.find(id)!; const parent = resolveAiSource(ctx, 'assignment', row.assignmentId.toString(), actor);
    const detail = ctx.db.workDetail.workId.find(id);
    snapshot = { kind, refId, subjectId: parent.subjectId, termId: parent.termId, version: row.version, title: row.title,
      topic: detail?.topic || parent.topic, visibility: 'group', fields: [{ name: 'solución', text: row.description }],
      context: hash(JSON.stringify({ parent, status: detail?.status ?? 'draft' })),
      omissions: detail?.status !== 'final' ? ['Trabajo sin versión final: revisar su exactitud.'] : [] };
  } else if (kind === 'evidence') {
    const row = ctx.db.evidence.id.find(id)!; const parent = resolveAiSource(ctx, 'activity', row.activityId.toString(), actor);
    snapshot = { kind, refId, subjectId: parent.subjectId, termId: parent.termId, version: ctx.db.evidenceDetail.evidenceId.find(id)?.version ?? 1,
      title: `Evidencia de ${parent.title}`, topic: parent.topic, visibility: 'group', fields: [{ name: 'evidencia', text: row.content }], context: hash(JSON.stringify(parent)),
      omissions: ['Evidencia de compañero: revisar su exactitud.'] };
  } else if (kind === 'guide') {
    const row = ctx.db.studyGuide.id.find(id)!;
    const map: Record<string, AiSourceSnapshot['kind'] | undefined> = { trabajo: 'work', tarea: 'assignment', actividad: 'activity', nota: 'note' };
    const sources = [...ctx.db.guideSource.guideId.filter(id)].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const origins: NonNullable<AiSourceSnapshot['origins']> = [];
    const omissions: string[] = [];
    const provenance = sources.map((source) => {
      const sourceKind = map[source.kind];
      let currentVersion: number | undefined;
      let classification: { subjectId: string; termId?: string; visibility?: string; status?: string } | undefined;
      let parent: { kind: string; id: string; version: number; subjectId: string; termId?: string; available: boolean } | undefined;
      if (sourceKind === 'note') {
        const original = ctx.db.note.id.find(source.refId); currentVersion = original?.version;
        if (original) classification = { subjectId: String(original.subjectId), termId: ctx.db.noteDetail.noteId.find(original.id)?.termId?.toString(), visibility: original.visibility };
      } else if (sourceKind === 'assignment') {
        const original = ctx.db.assignment.id.find(source.refId); currentVersion = original?.version;
        if (original) classification = { subjectId: String(original.subjectId), termId: original.termId?.toString() };
      } else if (sourceKind === 'activity') {
        const original = ctx.db.activity.id.find(source.refId); currentVersion = original?.version;
        if (original) classification = { subjectId: String(original.subjectId), termId: original.termId?.toString() };
      }
      else if (sourceKind === 'work') {
        const work = ctx.db.work.id.find(source.refId); currentVersion = work?.version;
        const assignment = work && ctx.db.assignment.id.find(work.assignmentId);
        if (assignment) classification = { subjectId: String(assignment.subjectId), termId: assignment.termId?.toString(), status: ctx.db.workDetail.workId.find(source.refId)?.status };
        if (assignment) parent = { kind: 'assignment', id: String(assignment.id), version: assignment.version,
          subjectId: String(assignment.subjectId), termId: assignment.termId?.toString(),
          available: canReadTarget(ctx.db, actor, 'assignment', assignment.id) && !withdrawn(ctx.db, 'assignment', assignment.id) };
      }
      const available = !!sourceKind && currentVersion !== undefined && canReadTarget(ctx.db, actor, sourceKind, source.refId)
        && !withdrawn(ctx.db, sourceKind, source.refId) && (sourceKind !== 'work' || parent?.available === true);
      if (sourceKind && available) origins.push({ kind: sourceKind, refId: String(source.refId), version: source.sourceVersion });
      else if (!sourceKind) omissions.push('La guía cita un tipo de fuente no compatible; no se extrajo su contenido.');
      if (source.status !== 'processed') omissions.push(`Original pendiente de la guía${source.reason ? `: ${sanitizeAiText(source.reason)}` : '.'}`);
      if (sourceKind && !available) omissions.push('Un original de la guía no está disponible; revisa la procedencia.');
      if (currentVersion !== undefined && currentVersion !== source.sourceVersion) omissions.push('La guía cita una versión anterior de un original.');
      return { kind: source.kind, refId: String(source.refId), sourceVersion: source.sourceVersion,
        status: source.status, reason: source.reason, currentVersion, classification, available, parent,
        withdrawn: withdrawn(ctx.db, sourceKind ?? source.kind, source.refId) };
    });
    if (!sources.length || !provenance.some((source) => source.available)) omissions.push('Guía sin originales verificables: revisa su contenido antes de generar.');
    snapshot = { kind, refId, subjectId: String(row.subjectId), termId: row.termId?.toString(), version: row.version, title: row.title,
      topic: row.topics.join(', '), visibility: 'group', fields: row.sections.map((section, index) => ({ name: GUIDE_SECTIONS[index]?.title ?? `Sección ${index + 1}`, text: section })),
      origins, omissions, context: aiHash(provenance) };
  } else return fail('invalid_request', 'Este módulo no es una fuente admitida.');
  const files = [...ctx.db.resourceFile.targetId.filter(id)].filter((file) => file.targetKind === kind && file.removedAt === undefined);
  const manifests: unknown[] = [];
  for (const file of files) {
    manifests.push([file.id, file.etag, file.size.toString(), file.storageKey]);
    const sourceId = file.storageKey.startsWith('stdb:') ? file.storageKey.slice(5) : undefined;
    const upload = sourceId ? ctx.db.resourceUpload.id.find(sourceId) : undefined;
    if (!sourceId || upload?.state !== 'ready' || file.size > 262_144n || !(/^(text\/|application\/(json|xml|javascript))/.test(file.contentType) || /\.(txt|md|csv|json|xml|js|ts|py|rs|java|c|cpp|h|css|html|sql)$/i.test(file.name))) {
      snapshot.omissions = [...(snapshot.omissions ?? []), 'Adjunto omitido: formato no compatible, almacenamiento anterior o tamaño superior a 256 KiB. No se envió su contenido.']; continue;
    }
    try {
      const bytes = new Uint8Array(Number(file.size)); let offset = 0;
      for (let index = 0; index < upload.chunkCount; index++) {
        const chunk = ctx.db.resourceChunk.id.find(`${sourceId}:${index}`);
        if (!chunk || offset + chunk.bytes.length > bytes.length) throw new Error();
        bytes.set(chunk.bytes, offset); offset += chunk.bytes.length;
      }
      if (offset !== bytes.length) throw new Error();
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (content.includes('\0')) throw new Error();
      snapshot.fields.push({ name: `Adjunto de texto ${file.id}`, text: content });
    } catch { snapshot.omissions = [...(snapshot.omissions ?? []), 'Adjunto omitido: texto ilegible o archivo incompleto.']; }
  }
  if (kind === 'work' && [...ctx.db.workFile.workId.filter(id)].some((old) => !files.some((file) => file.id === `legacy:${old.id}`))) snapshot.omissions = [...(snapshot.omissions ?? []), 'Adjuntos heredados omitidos: requieren migración antes de extraerse.'];
  snapshot.context = aiHash({ context: snapshot.context, files: manifests });
  const names = [...ctx.db.member.iter()].map((member) => (member.displayName ?? '').trim()).filter((name) => name.length >= 4);
  const redact = (value: string) => names.reduce((clean, name) => clean.split(name).join('[nombre retirado]'), sanitizeAiText(value));
  snapshot.title = redact(snapshot.title); snapshot.fields = snapshot.fields.map((field) => ({ ...field, text: redact(field.text) }));
  if (snapshot.omissions) snapshot.omissions = snapshot.omissions.map(redact);
  return snapshot;
}

export function aiPrepare(ctx: Ctx, raw: Record<string, unknown>) {
  activeMember(ctx);
  const input = validateAiPrepareInput(raw); const id = uuid(raw.id, 'La preparación'); const model = text(raw.model, 'El modelo');
  if (!ctx.db.subject.id.find(BigInt(input.subjectId))) fail('source_unavailable', 'La materia no está disponible.');
  if (input.termId && ctx.db.term.id.find(BigInt(input.termId))?.subjectId !== BigInt(input.subjectId)) fail('invalid_request', 'El parcial no pertenece a esta materia.');
  const snapshots = input.sources.map((source) => resolveAiSource(ctx, source.kind, source.refId));
  const preparation = buildAiPreparation(input, snapshots, { id, model, now: date(ctx.timestamp) });
  const requestJson = JSON.stringify(input);
  if (JSON.stringify(preparation).length > 256_000) fail('quota', 'La vista previa excede el límite. Reduce el alcance.');
  const previous = ctx.db.aiPreparation.id.find(id);
  if (previous) {
    if (!previous.actor.isEqual(memberIdentityFor(ctx)) || previous.fingerprint !== preparation.fingerprint) fail('conflict', 'La preparación ya pertenece a otro contenido.');
    if (previous.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) fail('expired', 'La preparación venció. Crea otra.');
    return JSON.parse(previous.json) as AiPreparation;
  }
  ctx.db.aiPreparation.insert({ id, actor: memberIdentityFor(ctx), fingerprint: preparation.fingerprint, model,
    json: JSON.stringify(preparation), requestJson, createdAt: ctx.timestamp, expiresAt: expiry(ctx, 30) });
  return preparation;
}
function validPreparation(ctx: Ctx, id: string, actor: Identity, checkExpiry: boolean) {
  const row = ctx.db.aiPreparation.id.find(id);
  if (!row || !row.actor.isEqual(actor)) fail('unavailable', 'La preparación no está disponible.');
  if (checkExpiry && row.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) fail('expired', 'La preparación venció. Prepara el material nuevamente.');
  const prep = JSON.parse(row.json) as AiPreparation;
  const input = JSON.parse(row.requestJson) as AiPrepareInput;
  for (const ref of input.sources) {
    const current = resolveAiSource(ctx, ref.kind, ref.refId, actor);
    const recorded = prep.sources.find((source) => source.kind === ref.kind && source.refId === ref.refId);
    if (!recorded || aiSourceFingerprint(current) !== recorded.fingerprint) fail('source_changed', 'Una fuente cambió. Prepara el material nuevamente.');
  }
  return { row, prep };
}
type GenerationRow = NonNullable<ReturnType<Ctx['db']['aiGeneration']['id']['find']>>;
function generationDto(ctx: Ctx, row: GenerationRow) {
  const acceptance = ctx.db.aiStudyAcceptance.generationId.find(row.id);
  return { id: row.id, state: row.status === 'queued' ? 'prepared' : row.status,
    preparationId: row.preparationId, createdAt: date(row.createdAt), updatedAt: date(row.claimedAt ?? row.createdAt),
    preparation: JSON.parse(ctx.db.aiPreparation.id.find(row.preparationId)!.json) as AiPreparation,
    ...(row.resultJson ? { result: JSON.parse(row.resultJson) as unknown } : {}),
    ...(acceptance ? { acceptance: JSON.parse(acceptance.resultJson) as unknown } : {}),
    ...(row.errorCode ? { error: `${row.errorCode}:${row.errorMessage}` } : {}),
    ...(row.inputTokens !== undefined && row.outputTokens !== undefined ? { usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens } } : {}),
    estimatedTokens: ctx.db.aiReservation.id.find(row.id)?.estimatedTokens ?? 0 };
}
function expireGenerations(ctx: Ctx, actor: Identity) {
  for (const row of ctx.db.aiGeneration.actor.filter(actor)) {
    if (row.status === 'running' && row.claimedAt && row.claimedAt.microsSinceUnixEpoch + 90n * 1_000_000n <= ctx.timestamp.microsSinceUnixEpoch) {
      ctx.db.aiGeneration.id.update({ ...row, status: 'unknown', errorCode: 'unknown', errorMessage: 'No se conoce el resultado del envío. No se volverá a enviar automáticamente.' });
    } else if (row.status === 'queued') {
      let invalid = row.createdAt.microsSinceUnixEpoch + 5n * 60n * 1_000_000n <= ctx.timestamp.microsSinceUnixEpoch;
      if (!invalid) {
        try { validPreparation(ctx, row.preparationId, actor, true); }
        catch (error) {
          // A stale queued snapshot has never reached the provider and can safely release its slot.
          if (!(error instanceof SenderError)) throw error;
          invalid = true;
        }
      }
      if (invalid) {
        ctx.db.aiGeneration.id.update({ ...row, status: 'failed', errorCode: 'expired', errorMessage: 'La operación venció o sus fuentes cambiaron antes de enviarse.' });
        const reservation = ctx.db.aiReservation.id.find(row.id);
        if (reservation) ctx.db.aiReservation.id.update({ ...reservation, status: 'released' });
      }
    }
  }
}
export function aiAuthorizeGeneration(ctx: Ctx, raw: Record<string, unknown>) {
  activeMember(ctx);
  const id = uuid(raw.id, 'La generación'); const preparationId = uuid(raw.preparationId, 'La preparación');
  const config = validateAiGenerationConfig(raw.config); const fingerprint = text(raw.fingerprint, 'La huella', 64);
  if (raw.confirmed !== true) fail('consent_required', 'Confirma expresamente el envío de estos fragmentos.');
  const requestHash = aiHash({ preparationId, fingerprint, config });
  const previous = ctx.db.aiGeneration.id.find(id);
  if (previous) {
    if (!previous.actor.isEqual(memberIdentityFor(ctx)) || previous.requestHash !== requestHash) fail('conflict', 'Este UUID ya pertenece a otra solicitud.');
    validPreparation(ctx, preparationId, memberIdentityFor(ctx), false);
    expireGenerations(ctx, memberIdentityFor(ctx));
    return generationDto(ctx, ctx.db.aiGeneration.id.find(id)!);
  }
  if (raw.allowNew === false) fail('ai_disabled', 'La IA real todavía no está habilitada para este grupo.');
  const model = text(raw.model, 'El modelo');
  enabled(ctx); consent(ctx);
  const { row, prep } = validPreparation(ctx, preparationId, memberIdentityFor(ctx), true);
  if (row.fingerprint !== fingerprint || row.model !== model || aiHash(prep.config) !== aiHash(config)) fail('conflict', 'La vista previa o el modelo cambió. Prepara de nuevo.');
  if (!prep.canGenerate) fail('invalid_request', 'Falta resolver fuentes o cobertura antes de generar.');
  const key = ctx.db.aiKey.actor.find(memberIdentityFor(ctx));
  if (!key) fail('key_required', 'Configura tu clave personal antes de generar.');
  expireGenerations(ctx, memberIdentityFor(ctx));
  const rows = [...ctx.db.aiGeneration.actor.filter(memberIdentityFor(ctx))];
  if (rows.some((generation) => generation.status === 'queued' || generation.status === 'running')) fail('quota', 'Ya tienes una generación en curso.');
  if (raw.acknowledgeUnknown !== true && rows.some((generation) => generation.status === 'unknown'
    && generation.createdAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch - DAY)) {
    fail('unknown_confirmation_required', 'Hay un envío de resultado incierto. Confirma el riesgo de consumo adicional antes de solicitar otra generación.');
  }
  const reservations = [...ctx.db.aiReservation.actor.filter(memberIdentityFor(ctx))];
  const sinceHour = ctx.timestamp.microsSinceUnixEpoch - HOUR; const sinceDay = ctx.timestamp.microsSinceUnixEpoch - DAY;
  if (reservations.filter((reservation) => reservation.createdAt.microsSinceUnixEpoch > sinceHour).length >= AI_LIMITS.requestsPerHour
    || reservations.filter((reservation) => reservation.createdAt.microsSinceUnixEpoch > sinceDay).length >= AI_LIMITS.requestsPerDay) fail('quota', 'Alcanzaste el límite de generaciones.');
  const estimatedTokens = estimateAiQuestionTokens(prep, config);
  const spent = reservations.filter((reservation) => reservation.createdAt.microsSinceUnixEpoch > sinceDay && reservation.status !== 'released').reduce((total, reservation) => total + reservation.estimatedTokens, 0);
  if (spent + estimatedTokens > (ctx.db.aiServiceConfig.id.find(0)?.dailyTokenBudget ?? AI_LIMITS.dailyEstimatedTokens)) fail('quota', 'La generación supera el presupuesto diario estimado.');
  ctx.db.aiReservation.insert({ id, actor: memberIdentityFor(ctx), estimatedTokens, status: 'reserved', createdAt: ctx.timestamp });
  const generation = ctx.db.aiGeneration.insert({ id, actor: memberIdentityFor(ctx), preparationId, requestHash, configJson: JSON.stringify(config), keyId: key.keyId,
    model, status: 'queued', createdAt: ctx.timestamp, claimedAt: undefined, inputTokens: undefined, outputTokens: undefined, resultJson: '', errorCode: '', errorMessage: '' });
  return generationDto(ctx, generation);
}
export function aiClaimGeneration(ctx: Ctx, input: Record<string, unknown>) {
  service(ctx); const actor = actorIdentity(input.actor); const id = uuid(input.id, 'La generación');
  expireGenerations(ctx, actor);
  const generation = ctx.db.aiGeneration.id.find(id);
  if (!generation || !generation.actor.isEqual(actor)) fail('unavailable', 'La generación no está disponible.');
  if (!isActive(ctx.db, actor)) fail('forbidden', 'La persona ya no es miembro activo.');
  // Access is checked even on a replay, before disclosing operation state.
  const { prep } = validPreparation(ctx, generation.preparationId, actor, generation.status === 'queued');
  if (generation.status !== 'queued') return { claimed: false, generation: generationDto(ctx, generation) };
  enabled(ctx); consent(ctx, actor);
  const key = ctx.db.aiKey.actor.find(actor);
  if (!key || key.keyId !== generation.keyId) fail('key_changed', 'La clave cambió antes del envío.');
  const claimed = { ...generation, status: 'running', claimedAt: ctx.timestamp };
  ctx.db.aiGeneration.id.update(claimed);
  return { claimed: true, generation: generationDto(ctx, claimed), preparation: prep,
    config: JSON.parse(generation.configJson) as unknown,
    key: { keyId: key.keyId, provider: key.provider, ciphertext: key.ciphertext, iv: key.iv, masterVersion: key.masterVersion } };
}
export function aiFinishGeneration(ctx: Ctx, input: Record<string, unknown>) {
  service(ctx); const actor = actorIdentity(input.actor); const id = uuid(input.id, 'La generación');
  const previous = ctx.db.aiGeneration.id.find(id);
  if (!previous || !previous.actor.isEqual(actor)) fail('unavailable', 'La generación no está disponible.');
  const state = input.state ?? (input.status === 'completed' ? 'succeeded' : input.status);
  if (!['succeeded', 'failed', 'unknown'].includes(String(state))) fail('invalid_request', 'Estado final inválido.');
  const savedPreparation = ctx.db.aiPreparation.id.find(previous.preparationId);
  if (!savedPreparation) fail('unavailable', 'El material preparado ya no está disponible.');
  const preparation = JSON.parse(savedPreparation.json) as AiPreparation;
  const config = validateAiGenerationConfig(JSON.parse(previous.configJson));
  const resultJson = state === 'succeeded' ? JSON.stringify(config.purpose === 'teaching_questions' || config.purpose === 'spaced_cards' ? validateAiModuleDraft(input.result, preparation, config) : config.purpose && config.purpose !== 'questions' ? validateAiStudyDraft(input.result, preparation, config) : validateAiQuestionDraft(input.result, preparation, config)) : '';
  if (resultJson.length > 128_000) fail('request_too_large', 'La respuesta excede el límite.');
  if (previous.status !== 'running') {
    if (previous.status === state && previous.resultJson === resultJson) return generationDto(ctx, previous);
    fail('conflict', 'La operación ya terminó y no puede reenviarse ni cambiarse.');
  }
  // Removing a key invalidates queued work; a provider response already in flight can be recorded.
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  if (input.usage !== undefined) {
    const rawUsage = obj(input.usage);
    if (![rawUsage.inputTokens, rawUsage.outputTokens].every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000_000)) fail('invalid_request', 'El consumo reportado es inválido.');
    usage = { inputTokens: Number(rawUsage.inputTokens), outputTokens: Number(rawUsage.outputTokens) };
  }
  const next = { ...previous, status: String(state), resultJson, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
    errorCode: state === 'succeeded' ? '' : text(input.errorCode ?? state, 'El código', 80),
    errorMessage: state === 'succeeded' ? '' : text(input.errorMessage ?? 'La solicitud no terminó correctamente.', 'El error', 500) };
  ctx.db.aiGeneration.id.update(next);
  const reservation = ctx.db.aiReservation.id.find(id);
  if (reservation) ctx.db.aiReservation.id.update({ ...reservation, status: state === 'unknown' ? 'reserved' : 'consumed',
    estimatedTokens: Math.max(reservation.estimatedTokens, (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)) });
  return generationDto(ctx, next);
}
export function aiGetGeneration(ctx: Ctx, input: Record<string, unknown>) {
  activeMember(ctx); const id = uuid(input.id, 'La generación');
  const generation = ctx.db.aiGeneration.id.find(id);
  if (!generation || !generation.actor.isEqual(memberIdentityFor(ctx))) fail('unavailable', 'La generación no está disponible.');
  validPreparation(ctx, generation.preparationId, memberIdentityFor(ctx), false);
  expireGenerations(ctx, memberIdentityFor(ctx));
  return generationDto(ctx, ctx.db.aiGeneration.id.find(id)!);
}

export function aiListGenerations(ctx: Ctx) {
  activeMember(ctx);
  const rows = [...ctx.db.aiGeneration.actor.filter(memberIdentityFor(ctx))].sort((a, b) => a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1).slice(0, 30);
  return rows.flatMap((row) => {
    try { return [aiGetGeneration(ctx, { id: row.id })]; } catch { return []; }
  });
}
export function aiPublishGeneration(ctx: Ctx, input: Record<string, unknown>) {
  activeMember(ctx); const id = uuid(input.id, 'El borrador');
  const generation = ctx.db.aiGeneration.id.find(id);
  if (!generation?.actor.isEqual(memberIdentityFor(ctx)) || generation.status !== 'succeeded') fail('unavailable', 'El borrador no está disponible.');
  const config = validateAiGenerationConfig(JSON.parse(generation.configJson));
  if (config.purpose === 'teaching_questions' || config.purpose === 'spaced_cards') return acceptStudyDraft(ctx, generation, input);
  const prior = ctx.db.aiPublication.generationId.find(id);
  if (prior) return { targetKind: prior.targetKind, targetId: String(prior.targetId) };
  const { prep } = validPreparation(ctx, generation.preparationId, memberIdentityFor(ctx), false);
  if (prep.sources.some((source) => source.visibility !== 'group')) fail('forbidden', 'Comparte expresamente las fuentes personales antes de publicar un borrador para el grupo.');
  const draft = validateAiStudyDraft(JSON.parse(generation.resultJson), prep, config);
  const usedSources = new Set(draft.sections.flatMap((section) => section.citations.flatMap((citation) => prep.fragments.find((entry) => entry.id === citation)!.origins.map((origin) => `${origin.kind}:${origin.refId}`))));
  const citedSources = prep.sources.filter((source) => usedSources.has(`${source.kind}:${source.refId}`));
  const linkFor = (kind: string, refId: string) => kind === 'work' ? `#/m/tareas/${ctx.db.work.id.find(BigInt(refId))!.assignmentId}?trabajo=${refId}`
    : kind === 'evidence' ? `#/m/actividades/${ctx.db.evidence.id.find(BigInt(refId))!.activityId}`
      : `#/m/${({ note: 'notas', assignment: 'tareas', activity: 'actividades', guide: 'guias' } as Record<string, string>)[kind]}/${refId}`;
  const citations = citedSources.map((source) => `[${source.kind}:${source.refId} v${source.version}](${linkFor(source.kind, source.refId)})`).join('; ');
  const sections = draft.sections.map((section) => `${section.text}\n\nFuentes: ${section.citations.map((citation) => {
    const fragment = prep.fragments.find((entry) => entry.id === citation)!;
    return fragment.origins.map((origin) => `[${origin.kind}:${origin.refId} v${origin.version}](${linkFor(origin.kind, origin.refId)})`).join(', ');
  }).join('; ')}.`);
  if (prep.omissions.length) sections[0] += `\n\nOmisiones pendientes: ${prep.omissions.join(' ')}. No se afirma cobertura completa de los archivos omitidos.`;
  if (citedSources.length < prep.sources.length) sections[0] += '\n\nEl borrador no cita todas las fuentes preparadas; no se afirma cobertura completa del material seleccionado.';
  let targetId: bigint; let targetKind: string;
  if (draft.purpose === 'guide') {
    const guide = ctx.db.studyGuide.insert({ id: 0n, subjectId: BigInt(prep.subjectId), termId: prep.termId ? BigInt(prep.termId) : undefined,
      title: draft.title, topics: prep.topics, sections: sections.map((section, index) => index === 0 ? `Borrador generado con Gemini, revisado y publicado por su solicitante.\n\n${section}` : section),
      version: 1, createdBy: memberIdentityFor(ctx), createdAt: ctx.timestamp, updatedBy: memberIdentityFor(ctx), updatedAt: ctx.timestamp });
    const kinds: Record<string, string> = { note: 'nota', assignment: 'tarea', activity: 'actividad', work: 'trabajo' };
    const references = new Map<string, { kind: string; refId: bigint; sourceVersion: number; topics: string[] }>();
    for (const source of citedSources) {
      const origins = kinds[source.kind] ? [source] : source.kind === 'evidence'
        ? [{ kind: 'activity', refId: String(ctx.db.evidence.id.find(BigInt(source.refId))!.activityId), version: ctx.db.activity.id.find(ctx.db.evidence.id.find(BigInt(source.refId))!.activityId)!.version }]
        : source.origins;
      for (const origin of origins) if (kinds[origin.kind] && canReadTarget(ctx.db, memberIdentityFor(ctx), origin.kind, BigInt(origin.refId)) && !withdrawn(ctx.db, origin.kind, BigInt(origin.refId))
        && (origin.kind !== 'note' || ctx.db.note.id.find(BigInt(origin.refId))?.visibility === 'group')) {
        references.set(`${origin.kind}:${origin.refId}`, { kind: kinds[origin.kind]!, refId: BigInt(origin.refId), sourceVersion: origin.version, topics: source.topics });
      }
    }
    for (const reference of references.values()) ctx.db.guideSource.insert({ id: 0n, guideId: guide.id, ...reference,
      status: 'processed', reason: '', addedBy: memberIdentityFor(ctx), addedAt: ctx.timestamp });
    if (!references.size) ctx.db.studyGuide.id.update({ ...guide, sections: guide.sections.map((section, index) => index === 0 ? `${section}\n\nReferencias utilizadas: ${citations}` : section) });
    captureGuide(ctx, guide.id, memberIdentityFor(ctx)); targetId = guide.id; targetKind = 'guide';
  } else {
    const body = `${sections.map((section, index) => `## ${draft.sections[index]!.heading}\n\n${section}`).join('\n\n')}\n\nOrigen Gemini. Fuentes: ${citations}`;
    if (body.length > 50_000) fail('invalid_result', 'La explicación y sus referencias superan el tamaño de una nota. Prepara menos material.');
    const note = ctx.db.note.insert({ id: 0n, subjectId: BigInt(prep.subjectId), topic: prep.topics.join(', ').slice(0, 120), title: draft.title,
      body, tags: ['gemini'], visibility: 'group', source: 'ai', author: memberIdentityFor(ctx),
      version: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
    ctx.db.noteDetail.insert({ noteId: note.id, termId: prep.termId ? BigInt(prep.termId) : undefined, session: '', assignmentIds: [], activityIds: [], questionIds: [], publishedFromId: undefined, publishedFromVersion: undefined });
    captureNote(ctx, note.id, memberIdentityFor(ctx)); targetId = note.id; targetKind = 'note';
  }
  ctx.db.aiPublication.insert({ generationId: id, actor: memberIdentityFor(ctx), targetKind, targetId, createdAt: ctx.timestamp });
  return { targetKind, targetId: String(targetId) };
}

/** Explicit, atomic acceptance only; never publishes an explanation or changes review scheduling. */
function acceptStudyDraft(ctx: Ctx, generation: GenerationRow, input: Record<string, unknown>) {
  const { prep } = validPreparation(ctx, generation.preparationId, memberIdentityFor(ctx), false);
  const config = validateAiGenerationConfig(JSON.parse(generation.configJson));
  const draft = validateAiModuleDraft(JSON.parse(generation.resultJson), prep, config);
  if (input.reviewed !== true || !Array.isArray(input.selection) || !input.selection.length || input.selection.length > 20) fail('invalid_request', 'Revisa y selecciona expresamente los elementos que quieres incorporar.');
  const entries = input.selection.map((value) => obj(value));
  const items = draft.purpose === 'teaching_questions' ? draft.questions : draft.cards;
  if (entries.some((entry) => !Number.isInteger(entry.index) || Number(entry.index) < 0 || Number(entry.index) >= items.length)
    || new Set(entries.map((entry) => entry.index)).size !== entries.length) fail('invalid_request', 'La selección contiene elementos inválidos o repetidos.');
  // Persist exact reviewed edits in the receipt so an uncertain retry cannot insert a second batch.
  const requestHash = aiHash({ reviewed: true, selection: input.selection, collectionId: input.collectionId,
    expectedCollectionVersion: input.expectedCollectionVersion });
  const prior = ctx.db.aiStudyAcceptance.generationId.find(generation.id);
  if (prior) {
    if (!prior.actor.isEqual(memberIdentityFor(ctx)) || prior.requestHash !== requestHash) fail('conflict', 'Este borrador ya se incorporó con otra selección.');
    return JSON.parse(prior.resultJson) as unknown;
  }
  let result: { targetKind: string; targetId: string; acceptedIds: string[] };
  if (draft.purpose === 'teaching_questions') {
    const source = prep.sources.find((entry) => entry.kind === 'teaching');
    if (!source) fail('invalid_request', 'Falta la explicación guardada.');
    const practiceId = BigInt(source.refId);
    const practice = ctx.db.teachingPractice.id.find(practiceId);
    if (!practice?.owner.isEqual(memberIdentityFor(ctx)) || practice.status !== 'practicing') fail('forbidden', 'La práctica ya no admite preguntas.');
    const reviewed = entries.map((entry) => ({ ...draft.questions[Number(entry.index)]!, text: text(entry.text, 'La pregunta revisada', 3900) }));
    validateAiModuleDraft({ purpose: draft.purpose, questions: reviewed }, prep, config);
    const acceptedIds = reviewed.map((question) => String(ctx.db.teachingQuestion.insert({ id: 0n, practiceId,
      author: memberIdentityFor(ctx), kind: 'guided', text: `Gemini · revisada por su autor: ${question.text}`, answer: '',
      createdAt: ctx.timestamp, answeredAt: undefined }).id));
    ctx.db.teachingPractice.id.update({ ...practice, updatedAt: ctx.timestamp });
    result = { targetKind: 'teaching', targetId: String(practiceId), acceptedIds };
  } else {
    const collectionId = text(input.collectionId, 'La colección', 20);
    if (!/^[1-9][0-9]*$/.test(collectionId) || BigInt(collectionId) > 18_446_744_073_709_551_615n) fail('invalid_request', 'Colección inválida.');
    const collection = ctx.db.spacedCollection.id.find(BigInt(collectionId));
    if (!collection || collection.archived || (collection.visibility !== 'group' && !collection.ownerId.isEqual(memberIdentityFor(ctx)))) fail('forbidden', 'La colección ya no está disponible.');
    if (collection.subjectId !== BigInt(prep.subjectId) || collection.version !== input.expectedCollectionVersion) fail('conflict', 'La colección cambió o pertenece a otra materia.');
    if (collection.visibility === 'group' && prep.sources.some((source) => source.visibility !== 'group')) fail('forbidden', 'Las fuentes personales solo pueden usarse en colecciones personales.');
    if (entries.some((entry) => typeof entry.hint !== 'string')) fail('invalid_request', 'La pista revisada debe ser texto.');
    const reviewed = entries.map((entry) => ({ ...draft.cards[Number(entry.index)]!, question: text(entry.question, 'La pregunta revisada', 1000),
      explanation: text(entry.explanation, 'La explicación revisada', 18_000), hint: typeof entry.hint === 'string' ? entry.hint.trim() : '' }));
    const validated = validateAiModuleDraft({ purpose: draft.purpose, title: draft.title, cards: reviewed }, prep, config);
    if (validated.purpose !== 'spaced_cards') fail('invalid_request', 'Tipo de borrador inválido.');
    // Validate the complete batch before inserting any card: aiResponse returns recoverable errors as data.
    const pendingCards = validated.cards.map((card) => {
      const fragment = prep.fragments.find((entry) => entry.id === card.citations[0])!;
      const origin = fragment.origins[0]!;
      const references = card.citations.map((citation) => prep.fragments.find((entry) => entry.id === citation)!.origins
        .map((entry) => `${entry.kind}:${entry.refId} v${entry.version} · ${entry.field} líneas ${entry.startLine}–${entry.endLine}`).join(', ')).join('; ');
      const explanation = `${card.explanation}\n\nBorrador de Gemini revisado por su solicitante. Referencias: ${references}.`;
      if (explanation.length > 20_000) fail('invalid_request', 'La explicación con referencias excede el tamaño de una tarjeta. Reduce el texto revisado.');
      return { id: 0n, collectionId: collection.id, question: card.question, explanation, hint: card.hint,
        sourceKind: origin.kind, sourceId: BigInt(origin.refId), sourceVersion: origin.version,
        version: 1, archived: false, createdBy: memberIdentityFor(ctx), updatedBy: memberIdentityFor(ctx), createdAt: ctx.timestamp, updatedAt: ctx.timestamp };
    });
    const acceptedIds = pendingCards.map((card) => String(ctx.db.spacedCard.insert(card).id));
    result = { targetKind: 'spaced_collection', targetId: collectionId, acceptedIds };
  }
  ctx.db.aiStudyAcceptance.insert({ generationId: generation.id, actor: memberIdentityFor(ctx), requestHash, resultJson: JSON.stringify(result), createdAt: ctx.timestamp });
  return result;
}

/** Called by retention before deleting an original; no copied private text survives its purge. */
export function purgeAiSource(ctx: Ctx, kind: string, id: bigint): void {
  if (!AI_SOURCE_KINDS.includes(kind as typeof AI_SOURCE_KINDS[number])) return;
  const matches = (source: { kind: string; refId: string }) => source.kind === kind && source.refId === String(id);
  for (const row of ctx.db.aiPreparation.iter()) {
    const preparation = JSON.parse(row.json) as AiPreparation;
    if (!preparation.sources.some((source) => matches(source) || source.origins.some(matches))
      && !preparation.fragments.some((fragment) => fragment.origins.some(matches))) continue;
    for (const generation of ctx.db.aiGeneration.iter()) if (generation.preparationId === row.id) {
      ctx.db.aiGeneration.id.update({ ...generation, status: 'failed', resultJson: '', errorCode: 'source_purged', errorMessage: 'El material original fue eliminado definitivamente.' });
      const reservation = ctx.db.aiReservation.id.find(generation.id);
      if (reservation && generation.status === 'queued') ctx.db.aiReservation.id.update({ ...reservation, status: 'released' });
    }
    ctx.db.aiPreparation.id.delete(row.id);
  }
}

/** Convert shared validation failures to stable, recoverable procedure errors. */
export function aiResponse(ctx: Ctx, payload: string, handler: (ctx: Ctx, input: Record<string, unknown>) => unknown): string {
  try { return JSON.stringify(handler(ctx, parseAiPayload(payload))); }
  catch (error) {
    // Procedures serialize errors instead of throwing: the HTTP runtime treats a
    // thrown SenderError as a fatal module error, losing the recoverable code.
    if (error instanceof SenderError) return JSON.stringify({ ok: false, code: /^([a-z_]{3,40}):/.exec(error.message)?.[1] ?? 'unavailable', message: error.message });
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') return JSON.stringify({ ok: false, code: error.code, message: error.message });
    throw error;
  }
}
