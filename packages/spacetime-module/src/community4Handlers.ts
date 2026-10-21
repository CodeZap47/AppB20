import { SenderError } from 'spacetimedb/server';
import { cleanMuseum, cleanOpportunity, opportunityExpired, type MuseumFields, type OpportunityFields } from '../../core/src/community4';
import { activeMember, expectVersion, isActive, log, requireSubject, requireText, type Ctx, type ViewDb } from './moduleContext';
import { canReadTarget, withdrawn } from './delivery2Handlers';
type Person = Ctx['sender'];
const check = <T>(fn: () => T): T => { try { return fn(); } catch (error) { throw new SenderError(error instanceof Error ? error.message : 'Datos no válidos.'); } };
const numericId = (value: string) => { if (!/^[0-9]+$/.test(value) || BigInt(value) > 18446744073709551615n) throw new SenderError('Una referencia no es válida.'); return BigInt(value); };
const token = (value: string) => requireText(value, 'La solicitud', 128);
function sameIntent(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new SenderError('Este envío ya se utilizó para otro contenido.'); }
function parse<T>(value: string): T { if (value.length > 40000) throw new SenderError('La ficha es demasiado grande.'); return check(() => JSON.parse(value) as T); }
function museumReferences(ctx: Ctx, fields: MuseumFields) {
  for (const id of fields.noteIds) {
    const note = ctx.db.note.id.find(numericId(id));
    if (!note || note.visibility !== 'group' || !canReadTarget(ctx.db, ctx.sender, 'note', numericId(id)) || withdrawn(ctx.db, 'note', numericId(id))) throw new SenderError('Solo enlaza notas compartidas disponibles para el grupo.');
  }
  for (const id of fields.questionIds) if (!canReadTarget(ctx.db, ctx.sender, 'question', numericId(id)) || withdrawn(ctx.db, 'question', numericId(id))) throw new SenderError('Una pregunta enlazada no está disponible.');
}
export function museumReadable(db: ViewDb, sender: Person, questionId: bigint) {
  return isActive(db, sender) && canReadTarget(db, sender, 'question', questionId) && !withdrawn(db, 'question', questionId);
}
export function saveMuseum(ctx: Ctx, input: { questionId: bigint; expectedVersion: number; fields: string; requestId: string }) {
  activeMember(ctx); const question = ctx.db.question.id.find(input.questionId);
  if (!question || !museumReadable(ctx.db, ctx.sender, question.id)) throw new SenderError('La pregunta no está disponible.');
  if (!question.author.isEqual(ctx.sender)) throw new SenderError('Solo el autor puede editar la ficha; propone correcciones en Preguntas.');
  const current = ctx.db.museumEntry.questionId.find(question.id); const requestId = token(input.requestId);
  const fields = check(() => cleanMuseum(parse<MuseumFields>(input.fields)));
  if (current?.requestId === requestId) { sameIntent({ fields: JSON.parse(current.fields), version: current.version }, { fields, version: input.expectedVersion + 1 }); return; }
  expectVersion(current?.version ?? 0, input.expectedVersion);
  museumReferences(ctx, fields);
  const row = { questionId: question.id, author: question.author, requestId, creationRequestId: current?.creationRequestId ?? requestId, fields: JSON.stringify(fields), version: (current?.version ?? 0) + 1,
    updatedBy: ctx.sender, createdAt: current?.createdAt ?? ctx.timestamp, updatedAt: ctx.timestamp };
  if (current) ctx.db.museumEntry.questionId.update(row); else ctx.db.museumEntry.insert(row);
  ctx.db.museumRevision.insert({ id: 0n, questionId: question.id, fields: row.fields, version: row.version, updatedBy: ctx.sender, createdAt: ctx.timestamp });
  log(ctx, 'update', 'museum', question.id);
}
export function createMuseum(ctx: Ctx, input: { subjectId: bigint; title: string; fields: string; requestId: string }) {
  activeMember(ctx); const requestId = token(input.requestId);
  const fields = check(() => cleanMuseum(parse<MuseumFields>(input.fields))); const title = requireText(input.title, 'El título', 200);
  const prior = [...ctx.db.museumEntry.author.filter(ctx.sender)].find(row => row.creationRequestId === requestId);
  if (prior) {
    const question = ctx.db.question.id.find(prior.questionId); const first = [...ctx.db.museumRevision.questionId.filter(prior.questionId)].find(row => row.version === 1);
    sameIntent({ subjectId: question?.subjectId.toString(), title: question?.title, fields: JSON.parse(first?.fields ?? prior.fields) }, { subjectId: input.subjectId.toString(), title, fields }); return;
  }
  requireSubject(ctx, input.subjectId); museumReferences(ctx, fields);
  const row = ctx.db.question.insert({ id: 0n, subjectId: input.subjectId, topic: fields.topic, title,
    body: `Intención: ${fields.intention}\n\nSíntoma: ${fields.symptom}\n\nCausa o hipótesis: ${fields.cause}\n\nCorrección: ${fields.correction}\n\nAprendizaje: ${fields.learning}\n\nCódigo mínimo:\n${fields.minimalCode}\n\nEvidencia: ${fields.evidence}`,
    author: ctx.sender, status: 'open', acceptedAnswerId: undefined, resolvedAt: undefined, createdAt: ctx.timestamp });
  saveMuseum(ctx, { questionId: row.id, fields: JSON.stringify(fields), expectedVersion: 0, requestId });
}
export function purgeMuseum(db: Ctx['db'], kind: string, id: bigint) {
  if (kind !== 'question') return;
  db.museumEntry?.questionId.delete(id);
  for (const row of db.museumRevision?.questionId.filter(id) ?? []) db.museumRevision.id.delete(row.id);
}
function readOpportunity(ctx: Ctx, id: bigint) { activeMember(ctx); const row = ctx.db.opportunity.id.find(id); if (!row) throw new SenderError('La oportunidad no existe.'); return row; }
export function opportunityReadable(db: ViewDb, sender: Person, id: bigint) {
  if (!isActive(db, sender)) return false; const row = db.opportunity.id.find(id);
  return !!row && (!row.withdrawn || row.author.isEqual(sender) || !!db.member.identity.find(sender)?.isCreator);
}
function opportunityFields(ctx: Ctx, input: string) {
  const fields = check(() => cleanOpportunity(parse<OpportunityFields>(input)));
  if (fields.roomId) {
    const room = ctx.db.studyRoom.id.find(numericId(fields.roomId));
    if (!room || room.visibility !== 'group' || !['scheduled', 'active'].includes(room.status)) throw new SenderError('Enlaza una sala abierta vigente; su inscripción sigue siendo voluntaria.');
  }
  return fields;
}
function revision(ctx: Ctx, row: NonNullable<ReturnType<Ctx['db']['opportunity']['id']['find']>>) {
  ctx.db.opportunityRevision.insert({ id: 0n, opportunityId: row.id, fields: row.fields, withdrawn: row.withdrawn,
    version: row.version, updatedBy: ctx.sender, createdAt: ctx.timestamp });
}
export function createOpportunity(ctx: Ctx, input: { fields: string; requestId: string }) {
  activeMember(ctx); const requestId = token(input.requestId);
  const prior = [...ctx.db.opportunity.author.filter(ctx.sender)].find(row => row.requestId === requestId);
  if (prior) { const first = [...ctx.db.opportunityRevision.opportunityId.filter(prior.id)].find(row => row.version === 1); sameIntent(JSON.parse(first?.fields ?? prior.fields), check(() => cleanOpportunity(parse<OpportunityFields>(input.fields)))); return; }
  const fields = opportunityFields(ctx, input.fields);
  const row = ctx.db.opportunity.insert({ id: 0n, author: ctx.sender, requestId, fields: JSON.stringify(fields), withdrawn: false,
    withdrawalReason: '', version: 1, updatedBy: ctx.sender, createdAt: ctx.timestamp, updatedAt: ctx.timestamp }); revision(ctx, row); log(ctx, 'create', 'opportunity', row.id);
}
export function updateOpportunity(ctx: Ctx, input: { opportunityId: bigint; expectedVersion: number; fields: string }) {
  const row = readOpportunity(ctx, input.opportunityId); if (!row.author.isEqual(ctx.sender)) throw new SenderError('Solo el autor puede editar; envía una corrección.');
  if (row.withdrawn) throw new SenderError('Restaura la oportunidad antes de editar.'); expectVersion(row.version, input.expectedVersion);
  const next = { ...row, fields: JSON.stringify(opportunityFields(ctx, input.fields)), version: row.version + 1, updatedBy: ctx.sender, updatedAt: ctx.timestamp };
  ctx.db.opportunity.id.update(next); revision(ctx, next); log(ctx, 'update', 'opportunity', row.id);
}
export function withdrawOpportunity(ctx: Ctx, input: { opportunityId: bigint; expectedVersion: number; withdrawn: boolean; reason: string }) {
  const row = readOpportunity(ctx, input.opportunityId); const own = row.author.isEqual(ctx.sender); const admin = activeMember(ctx).isCreator;
  if (!own && !admin) throw new SenderError('Solo el autor o un administrador puede retirar esta ficha.'); expectVersion(row.version, input.expectedVersion);
  if (row.withdrawn === input.withdrawn) return;
  if (!input.withdrawn && row.updatedBy.isEqual(row.author) && !own) throw new SenderError('Solo el autor puede restaurar su retirada voluntaria.');
  if (!input.withdrawn && !row.updatedBy.isEqual(row.author) && !admin) throw new SenderError('Un administrador debe restaurar esta retirada.');
  const reason = input.withdrawn ? (own ? input.reason.trim() : requireText(input.reason, 'El motivo', 1000)) : '';
  if (reason.length > 1000) throw new SenderError('El motivo excede 1000 caracteres.');
  const next = { ...row, withdrawn: input.withdrawn, withdrawalReason: reason, version: row.version + 1, updatedBy: ctx.sender, updatedAt: ctx.timestamp };
  ctx.db.opportunity.id.update(next); revision(ctx, next); log(ctx, input.withdrawn ? 'withdraw' : 'restore', 'opportunity', row.id);
}
export function setOpportunityInterest(ctx: Ctx, input: { opportunityId: bigint; interested: boolean; seekingTeam: boolean; shareContact: boolean; expectedVersion: number }) {
  const row = readOpportunity(ctx, input.opportunityId); const key = `${row.id}:${ctx.sender.toHexString()}`; const old = ctx.db.opportunityInterest.key.find(key);
  const interested = input.interested; const seekingTeam = interested && input.seekingTeam; const shareContact = seekingTeam && input.shareContact;
  if (old && old.interested === interested && old.seekingTeam === seekingTeam && old.shareContact === shareContact) return;
  expectVersion(old?.version ?? 0, input.expectedVersion);
  if (interested && (row.withdrawn || opportunityExpired(parse<OpportunityFields>(row.fields), ctx.timestamp.toDate()))) throw new SenderError('La oportunidad está retirada o vencida. Puedes cancelar tu interés.');
  const next = { key, opportunityId: row.id, memberId: ctx.sender, interested, seekingTeam, shareContact, version: (old?.version ?? 0) + 1, updatedAt: ctx.timestamp };
  if (old) ctx.db.opportunityInterest.key.update(next); else ctx.db.opportunityInterest.insert(next);
}
export function interestReadable(db: ViewDb, sender: Person, row: { opportunityId: bigint; memberId: Person; interested: boolean; seekingTeam: boolean; shareContact: boolean }) {
  if (!isActive(db, sender) || !isActive(db, row.memberId)) return false;
  if (row.memberId.isEqual(sender)) return true;
  const opportunity = db.opportunity.id.find(row.opportunityId);
  return !!opportunity && !opportunity.withdrawn && row.interested && row.seekingTeam && row.shareContact;
}
export function sendOpportunityFeedback(ctx: Ctx, input: { opportunityId: bigint; kind: string; text: string; requestId: string }) {
  const row = readOpportunity(ctx, input.opportunityId); if (row.withdrawn) throw new SenderError('La oportunidad está retirada.');
  const requestId = token(input.requestId);
  const prior = [...ctx.db.opportunityFeedback.opportunityId.filter(row.id)].find(r => r.author.isEqual(ctx.sender) && r.requestId === requestId);
  const text = requireText(input.text, 'La corrección o reporte', 4000);
  if (prior) { sameIntent({ kind: prior.kind, text: prior.text }, { kind: input.kind, text }); return; }
  if (!['correction', 'broken_link', 'outdated'].includes(input.kind)) throw new SenderError('El tipo de aviso no es válido.');
  ctx.db.opportunityFeedback.insert({ id: 0n, opportunityId: row.id, author: ctx.sender, requestId, kind: input.kind,
    text, status: 'open', resolution: '', resolvedBy: undefined, version: 1, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
}
export function resolveOpportunityFeedback(ctx: Ctx, input: { feedbackId: bigint; expectedVersion: number; resolution: string }) {
  const member = activeMember(ctx); const row = ctx.db.opportunityFeedback.id.find(input.feedbackId); if (!row) throw new SenderError('El aviso no existe.');
  const opportunity = readOpportunity(ctx, row.opportunityId);
  if (!opportunity.author.isEqual(ctx.sender) && !member.isCreator) throw new SenderError('Solo el autor o un administrador puede resolver el aviso.');
  expectVersion(row.version, input.expectedVersion);
  ctx.db.opportunityFeedback.id.update({ ...row, resolution: requireText(input.resolution, 'La resolución', 4000), status: 'resolved', resolvedBy: ctx.sender, version: row.version + 1, updatedAt: ctx.timestamp });
}
