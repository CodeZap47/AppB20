import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean, label: string) { const end = performance.now() + 20_000; while (!predicate()) { if (performance.now() > end) throw new Error(`Tiempo agotado: ${label}`); await delay(20); } }
export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  setGlobalLogLevel('error'); const connections = new Set<DbConnection>(); const checks: string[] = [];
  const connect = (token: string) => new Promise<DbConnection>((resolve, reject) => { const c = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none').onConnect(resolve).onConnectError((_ctx, error) => reject(error)).build(); connections.add(c); });
  const subscribe = (c: DbConnection) => new Promise<void>((resolve, reject) => c.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(['subjects', 'questions', 'answers', 'question_comments', 'museum_entries', 'museum_revisions', 'opportunities', 'opportunity_revisions', 'opportunity_interests', 'opportunity_feedback'].map((name) => `SELECT * FROM ${name}`)));
  const close = () => { for (const c of connections) c.disconnect(); connections.clear(); };
  const fields = { intention: 'Hacer un ciclo', symptom: 'No termina', cause: 'Hipótesis: no avanza índice', correction: '', learning: 'Revisar incremento', minimalCode: 'while (i < 10) {}', evidence: 'Reproducción sintética', language: 'JS', topic: 'Ciclos', bugType: 'Lógico', noteIds: [], questionIds: [] };
  const opportunityFields = { kind: 'event', title: 'Synthetic manual event', topic: 'Rust', modality: 'online', sourceUrl: 'https://example.com/event', organizer: 'Synthetic university', requirements: 'Register manually', costKnown: false, cost: '' };
  try {
    let owner = await connect(options.tokens[0]!); await owner.reducers.setAuthConfig({ issuer: 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
    for (const name of ['owner', 'author', 'outsider']) await owner.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator: name === 'owner' });
    await owner.reducers.joinGroup({ displayName: 'Synthetic owner' }); let author = await connect(options.tokens[1]!); await author.reducers.joinGroup({ displayName: 'Synthetic author' }); let peer = await connect(options.tokens[2]!); await peer.reducers.joinGroup({ displayName: 'Synthetic peer' });
    await Promise.all([subscribe(owner), subscribe(author), subscribe(peer)]); await author.reducers.createSubject({ name: 'Community smoke', period: 1 }); const subjectId = [...author.db.subjects.iter()][0]!.id;
    const create = { subjectId, title: 'Synthetic infinite loop', fields: JSON.stringify(fields), requestId: randomUUID() }; await author.reducers.createMuseum(create); await author.reducers.createMuseum(create);
    await until(() => [...peer.db.museumEntries.iter()].length === 1, 'museo visible'); const museum = [...author.db.museumEntries.iter()][0]!; const questionId = museum.questionId;
    assert.equal([...author.db.questions.iter()].filter((r) => r.id === questionId).length, 1);
    await peer.reducers.commentQuestion({ questionId, text: 'Synthetic correction in existing question discussion', answerId: undefined });
    await until(() => [...author.db.questionComments.iter()].some((r) => r.questionId === questionId), 'comentario reutilizado');
    await assert.rejects(peer.reducers.saveMuseum({ questionId, expectedVersion: 1, fields: JSON.stringify(fields), requestId: randomUUID() }));
    await author.reducers.saveMuseum({ questionId, expectedVersion: 1, fields: JSON.stringify({ ...fields, correction: 'Incrementar i' }), requestId: randomUUID() }); await author.reducers.createMuseum(create); assert.equal([...author.db.museumEntries.iter()].length, 1); assert.equal([...author.db.museumRevisions.iter()].length, 2);
    await author.reducers.withdrawContent({ kind: 'question', targetId: questionId, expectedVersion: 1, withdrawn: true, reason: '' }); await until(() => [...peer.db.museumEntries.iter()].length === 0, 'ocultación con origen'); assert.equal([...peer.db.museumRevisions.iter()].length, 0);
    await author.reducers.withdrawContent({ kind: 'question', targetId: questionId, expectedVersion: 2, withdrawn: false, reason: '' }); await until(() => [...peer.db.museumEntries.iter()].length === 1, 'restauración de metadata');
    checks.push('Museo reutiliza preguntas/comentarios; autoría, creación idempotente tras editar, historial, retirada y restauración con mismo origen');
    const createOpportunity = { fields: JSON.stringify(opportunityFields), requestId: randomUUID() }; await author.reducers.createOpportunity(createOpportunity); await author.reducers.createOpportunity(createOpportunity); await until(() => [...peer.db.opportunities.iter()].length === 1, 'oportunidad'); const opportunityId = [...author.db.opportunities.iter()][0]!.id;
    await peer.reducers.setOpportunityInterest({ opportunityId, interested: true, seekingTeam: false, shareContact: false, expectedVersion: 0 }); assert.equal([...author.db.opportunityInterests.iter()].length, 0); assert.equal([...owner.db.opportunityInterests.iter()].length, 0);
    await peer.reducers.setOpportunityInterest({ opportunityId, interested: true, seekingTeam: true, shareContact: true, expectedVersion: 1 }); await until(() => [...author.db.opportunityInterests.iter()].length === 1, 'permiso expreso de contacto');
    await peer.reducers.setOpportunityInterest({ opportunityId, interested: false, seekingTeam: true, shareContact: true, expectedVersion: 2 }); await until(() => [...author.db.opportunityInterests.iter()].length === 0, 'cancelación de contacto');
    const feedback = { opportunityId, kind: 'broken_link', text: 'Synthetic broken link report', requestId: randomUUID() }; await peer.reducers.sendOpportunityFeedback(feedback); await peer.reducers.sendOpportunityFeedback(feedback); await until(() => [...author.db.opportunityFeedback.iter()].length === 1, 'reporte'); const feedbackId = [...author.db.opportunityFeedback.iter()][0]!.id;
    await assert.rejects(peer.reducers.resolveOpportunityFeedback({ feedbackId, expectedVersion: 1, resolution: 'Not allowed' })); await owner.reducers.resolveOpportunityFeedback({ feedbackId, expectedVersion: 1, resolution: 'Synthetic source checked manually' });
    await assert.rejects(peer.reducers.updateOpportunity({ opportunityId, expectedVersion: 1, fields: JSON.stringify(opportunityFields) })); await author.reducers.updateOpportunity({ opportunityId, expectedVersion: 1, fields: JSON.stringify({ ...opportunityFields, title: 'Synthetic corrected title' }) });
    await assert.rejects(author.reducers.updateOpportunity({ opportunityId, expectedVersion: 1, fields: JSON.stringify(opportunityFields) }));
    await author.reducers.withdrawOpportunity({ opportunityId, expectedVersion: 2, withdrawn: true, reason: '' }); await until(() => [...peer.db.opportunities.iter()].length === 0, 'retirada radar'); await author.reducers.withdrawOpportunity({ opportunityId, expectedVersion: 3, withdrawn: false, reason: '' }); await until(() => [...peer.db.opportunities.iter()].length === 1, 'restauración radar');
    checks.push('Radar manual con historial, versiones, interés privado incluso ante admin, contacto expreso revocable, reportes idempotentes y resolución autorizada');
    close(); await options.restart(); author = await connect(options.tokens[1]!); peer = await connect(options.tokens[2]!); await Promise.all([subscribe(author), subscribe(peer)]); assert.equal([...author.db.opportunityFeedback.iter()][0]?.status, 'resolved'); assert.equal([...author.db.museumEntries.iter()][0]?.version, 2);
    await author.reducers.withdrawContent({ kind: 'question', targetId: questionId, expectedVersion: 3, withdrawn: true, reason: '' }); await until(() => ![...author.db.questions.iter()].some((r) => r.id === questionId), 'purga programada pregunta');
    await assert.rejects(author.reducers.withdrawContent({ kind: 'question', targetId: questionId, expectedVersion: 4, withdrawn: false, reason: '' }));
    checks.push('Persistencia tras reinicio; purga programada real elimina origen sin restauración posterior (retención acelerada sólo en copia temporal)');
    return { database: options.database, checks, acceleratedSeconds: 4, productionRetentionDays: 30 };
  } finally { close(); }
}
