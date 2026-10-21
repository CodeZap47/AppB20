import { cleanMuseum, cleanOpportunity, opportunityExpired, type MuseumFields } from '@b20/core';
import type { AskQuestionInput, Member, Snapshot } from './types';
import { emptyCommunity4, type Community4Actions, type Community4Snapshot, type MuseumEntry, type Opportunity } from './community4Types';
interface Context { state(): object; active(): Member; current(): Snapshot; id(): string; now(): Date; emit(): void; createQuestion(input: AskQuestionInput): string; }
interface Store extends Community4Snapshot { museumCreationRequests: Map<string, string>; feedbackRequests: Map<string, string>; }
const stores = new WeakMap<object, Store>();
const token = (value: string) => { if (!value.trim() || value.trim().length > 128) throw new Error('La solicitud no es válida.'); return value.trim(); };
const version = (actual: number, expected: number) => { if (actual !== expected) throw new Error('El contenido cambió. Actualiza antes de guardar.'); };
function sameIntent(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Este envío ya se utilizó para otro contenido.'); }
export class DemoCommunity4Store implements Community4Actions {
  constructor(private ctx: Context) {}
  private get shared() { let result = stores.get(this.ctx.state()); if (!result) { result = { ...emptyCommunity4(), museumCreationRequests: new Map(), feedbackRequests: new Map() }; stores.set(this.ctx.state(), result); } return result; }
  snapshot(base: Snapshot): Community4Snapshot {
    if (base.me?.status !== 'active') return emptyCommunity4();
    const questionIds = new Set(base.questions.filter((r) => !r.withdrawnAt).map((r) => r.id));
    const museumEntries = this.shared.museumEntries.filter((r) => questionIds.has(r.questionId));
    const opportunities = this.shared.opportunities.filter((r) => !r.withdrawn || r.authorId === base.me!.id || base.me!.isCreator);
    const opportunityIds = new Set(opportunities.map((r) => r.id));
    return structuredClone({ museumEntries, museumRevisions: this.shared.museumRevisions.filter((r) => questionIds.has(r.questionId)), opportunities,
      opportunityRevisions: this.shared.opportunityRevisions.filter((r) => opportunityIds.has(r.opportunityId)),
      opportunityInterests: this.shared.opportunityInterests.filter((r) => base.members.some((m) => m.id === r.memberId && m.status === 'active') && (r.memberId === base.me!.id || (opportunities.some((o) => o.id === r.opportunityId && !o.withdrawn) && r.interested && r.seekingTeam && r.shareContact))),
      opportunityFeedback: this.shared.opportunityFeedback.filter((r) => opportunityIds.has(r.opportunityId)) });
  }
  /** Called with the actual purged origin, never with a viewer-filtered snapshot. */
  purgeMuseum(kind: string, id: string) { if (kind !== 'question') return; this.shared.museumEntries = this.shared.museumEntries.filter((r) => r.questionId !== id); this.shared.museumRevisions = this.shared.museumRevisions.filter((r) => r.questionId !== id); }
  private references(fields: MuseumFields) { const base = this.ctx.current();
    if (fields.noteIds.some((id) => !base.notes.some((n) => n.id === id && n.visibility === 'group' && !n.withdrawnAt))) throw new Error('Solo enlaza notas compartidas disponibles para el grupo.');
    if (fields.questionIds.some((id) => !base.questions.some((q) => q.id === id && !q.withdrawnAt))) throw new Error('Una pregunta enlazada no está disponible.');
  }
  createMuseum(input: Parameters<Community4Actions['createMuseum']>[0]) {
    const me = this.ctx.active(); const requestId = token(input.requestId); const key = `${me.id}:${requestId}`;
    const fields = cleanMuseum(input.fields); const priorId = this.shared.museumCreationRequests.get(key);
    if (priorId) {
      const question = this.ctx.current().questions.find(row => row.id === priorId); const first = this.shared.museumRevisions.find(row => row.questionId === priorId && row.version === 1);
      sameIntent({ subjectId: question?.subjectId, title: question?.title, fields: first?.fields }, { subjectId: input.subjectId, title: input.title.trim(), fields }); return;
    }
    this.references(fields);
    if (!this.ctx.current().subjects.some((s) => s.id === input.subjectId)) throw new Error('La materia no existe.');
    if (!input.title.trim() || input.title.trim().length > 200) throw new Error('El título es obligatorio (máximo 200).');
    const questionId = this.ctx.createQuestion({ subjectId: input.subjectId, topic: fields.topic, title: input.title.trim(), body: `Intención: ${fields.intention}\n\nSíntoma: ${fields.symptom}\n\nCausa o hipótesis: ${fields.cause}\n\nCorrección: ${fields.correction}\n\nAprendizaje: ${fields.learning}\n\nCódigo mínimo:\n${fields.minimalCode}\n\nEvidencia: ${fields.evidence}` });
    this.shared.museumCreationRequests.set(key, questionId);
    this.saveMuseum({ questionId, expectedVersion: 0, fields, requestId });
  }
  saveMuseum(input: Parameters<Community4Actions['saveMuseum']>[0]) {
    const me = this.ctx.active(); const question = this.ctx.current().questions.find((q) => q.id === input.questionId && !q.withdrawnAt);
    if (!question) throw new Error('La pregunta no está disponible.');
    if (question.authorId !== me.id) throw new Error('Solo el autor puede editar la ficha; propone correcciones en Preguntas.');
    const old = this.shared.museumEntries.find((r) => r.questionId === question.id); const requestId = token(input.requestId); const fields = cleanMuseum(input.fields);
    if (old?.requestId === requestId) { const saved = this.shared.museumRevisions.find(row => row.questionId === question.id && row.version === old.version); sameIntent({ fields: saved?.fields, version: old.version }, { fields, version: input.expectedVersion + 1 }); return; }
    version(old?.version ?? 0, input.expectedVersion); this.references(fields);
    const row: MuseumEntry = { ...fields, questionId: question.id, authorId: me.id, requestId, version: (old?.version ?? 0) + 1, updatedBy: me.id, createdAt: old?.createdAt ?? this.ctx.now(), updatedAt: this.ctx.now() };
    this.shared.museumEntries = [...this.shared.museumEntries.filter((r) => r.questionId !== question.id), row];
    this.shared.museumRevisions.push({ id: this.ctx.id(), questionId: question.id, fields, version: row.version, updatedBy: me.id, createdAt: this.ctx.now() }); this.ctx.emit();
  }
  private fields(input: Parameters<Community4Actions['createOpportunity']>[0]['fields']) { const fields = cleanOpportunity(input);
    if (fields.roomId && !this.ctx.current().studyRooms.some((r) => r.id === fields.roomId && r.visibility === 'group' && ['scheduled', 'active'].includes(r.status))) throw new Error('Enlaza una sala abierta vigente; su inscripción sigue siendo voluntaria.'); return fields;
  }
  private read(id: string) { this.ctx.active(); const row = this.shared.opportunities.find((r) => r.id === id); if (!row) throw new Error('La oportunidad no existe.'); return row; }
  private revision(row: Opportunity) { const { id: opportunityId, authorId: _a, requestId: _r, withdrawalReason: _w, updatedAt: _u, ...rest } = row;
    const { updatedBy, version: v, withdrawn, createdAt: _c, ...fields } = rest;
    this.shared.opportunityRevisions.push({ id: this.ctx.id(), opportunityId, fields, withdrawn, version: v, updatedBy, createdAt: this.ctx.now() });
  }
  createOpportunity(input: Parameters<Community4Actions['createOpportunity']>[0]) {
    const me = this.ctx.active(); const requestId = token(input.requestId); const prior = this.shared.opportunities.find(r => r.authorId === me.id && r.requestId === requestId);
    if (prior) { sameIntent(this.shared.opportunityRevisions.find(row => row.opportunityId === prior.id && row.version === 1)?.fields, cleanOpportunity(input.fields)); return; }
    const row: Opportunity = { ...this.fields(input.fields), id: this.ctx.id(), authorId: me.id, requestId, withdrawn: false, withdrawalReason: '', version: 1, updatedBy: me.id, createdAt: this.ctx.now(), updatedAt: this.ctx.now() };
    this.shared.opportunities.push(row); this.revision(row); this.ctx.emit();
  }
  updateOpportunity(input: Parameters<Community4Actions['updateOpportunity']>[0]) { const row = this.read(input.opportunityId); const me = this.ctx.active();
    if (row.authorId !== me.id) throw new Error('Solo el autor puede editar; envía una corrección.'); if (row.withdrawn) throw new Error('Restaura la oportunidad antes de editar.'); version(row.version, input.expectedVersion);
    Object.assign(row, this.fields(input.fields), { version: row.version + 1, updatedBy: me.id, updatedAt: this.ctx.now() }); this.revision(row); this.ctx.emit();
  }
  withdrawOpportunity(input: Parameters<Community4Actions['withdrawOpportunity']>[0]) { const row = this.read(input.opportunityId); const me = this.ctx.active(); const own = row.authorId === me.id;
    if (!own && !me.isCreator) throw new Error('Solo el autor o un administrador puede retirar esta ficha.'); version(row.version, input.expectedVersion); if (row.withdrawn === input.withdrawn) return;
    if (!input.withdrawn && row.updatedBy === row.authorId && !own) throw new Error('Solo el autor puede restaurar su retirada voluntaria.');
    if (!input.withdrawn && row.updatedBy !== row.authorId && !me.isCreator) throw new Error('Un administrador debe restaurar esta retirada.');
    if (input.reason.trim().length > 1000 || (!own && input.withdrawn && !input.reason.trim())) throw new Error('Indica un motivo de hasta 1000 caracteres.');
    Object.assign(row, { withdrawn: input.withdrawn, withdrawalReason: input.withdrawn ? input.reason.trim() : '', version: row.version + 1, updatedBy: me.id, updatedAt: this.ctx.now() }); this.revision(row); this.ctx.emit();
  }
  setOpportunityInterest(input: Parameters<Community4Actions['setOpportunityInterest']>[0]) { const row = this.read(input.opportunityId); const me = this.ctx.active(); const old = this.shared.opportunityInterests.find((r) => r.opportunityId === row.id && r.memberId === me.id);
    const interested = input.interested, seekingTeam = interested && input.seekingTeam, shareContact = seekingTeam && input.shareContact;
    if (old && old.interested === interested && old.seekingTeam === seekingTeam && old.shareContact === shareContact) return;
    version(old?.version ?? 0, input.expectedVersion); if (interested && (row.withdrawn || opportunityExpired(row, this.ctx.now()))) throw new Error('La oportunidad está retirada o vencida. Puedes cancelar tu interés.');
    this.shared.opportunityInterests = this.shared.opportunityInterests.filter((r) => r !== old); this.shared.opportunityInterests.push({ opportunityId: row.id, memberId: me.id, interested, seekingTeam, shareContact, version: (old?.version ?? 0) + 1, updatedAt: this.ctx.now() }); this.ctx.emit();
  }
  sendOpportunityFeedback(input: Parameters<Community4Actions['sendOpportunityFeedback']>[0]) { const row = this.read(input.opportunityId); const me = this.ctx.active(); if (row.withdrawn) throw new Error('La oportunidad está retirada.');
    const requestId = token(input.requestId), key = `${row.id}:${me.id}:${requestId}`; const priorId = this.shared.feedbackRequests.get(key);
    if (priorId) { const prior = this.shared.opportunityFeedback.find(row => row.id === priorId); sameIntent({ kind: prior?.kind, text: prior?.text }, { kind: input.kind, text: input.text.trim() }); return; }
    if (!['correction', 'broken_link', 'outdated'].includes(input.kind) || !input.text.trim() || input.text.trim().length > 4000) throw new Error('Indica una corrección o reporte de hasta 4000 caracteres.');
    const id = this.ctx.id(); this.shared.feedbackRequests.set(key, id); this.shared.opportunityFeedback.push({ id, opportunityId: row.id, authorId: me.id, kind: input.kind, text: input.text.trim(), status: 'open', resolution: '', version: 1, createdAt: this.ctx.now(), updatedAt: this.ctx.now() }); this.ctx.emit();
  }
  resolveOpportunityFeedback(input: Parameters<Community4Actions['resolveOpportunityFeedback']>[0]) { const me = this.ctx.active(); const row = this.shared.opportunityFeedback.find((r) => r.id === input.feedbackId); if (!row) throw new Error('El aviso no existe.'); const opportunity = this.read(row.opportunityId);
    if (opportunity.authorId !== me.id && !me.isCreator) throw new Error('Solo el autor o un administrador puede resolver el aviso.'); version(row.version, input.expectedVersion);
    if (!input.resolution.trim() || input.resolution.trim().length > 4000) throw new Error('Indica una resolución de hasta 4000 caracteres.'); Object.assign(row, { status: 'resolved', resolution: input.resolution.trim(), resolvedBy: me.id, version: row.version + 1, updatedAt: this.ctx.now() }); this.ctx.emit();
  }
}
