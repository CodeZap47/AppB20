import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Identity, setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
import { AI_CONSENT_VERSION } from '../packages/core/src/ai';
import { GUIDE_SECTIONS } from '../packages/core/src/guides';
import type { GuideAiClaim, GuideAiDraft, GuideAiDraftSummary, GuideAiResult, GuideAiPrepareInput, GuideAiProvenance } from '../packages/core/src/guideAi';
import { encryptAiKey } from '../apps/api/src/ai/crypto';

interface Baseline { subjectId: string; noteId: string; guideId: string; noteBody: string; guideTitle: string }
interface Options { address: string; database: string; tokens: string[]; baseline?: Baseline; restart(): Promise<void> }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean, label: string) {
  const deadline = performance.now() + 20_000;
  while (!predicate()) { if (performance.now() > deadline) throw new Error(`Tiempo agotado: ${label}`); await pause(20); }
}
function clients(options: Pick<Options, 'address' | 'database'>) {
  const open = new Set<DbConnection>();
  return {
    connect: (token: string) => new Promise<DbConnection>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Conexión local vencida.')), 20_000);
      const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none')
        .onConnect((ready) => { clearTimeout(timer); resolve(ready); })
        .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
      open.add(connection);
    }),
    close: () => { for (const connection of open) connection.disconnect(); open.clear(); },
  };
}
function subscribe(connection: DbConnection, views = ['subjects', 'terms', 'notes', 'study_guides', 'guide_sources', 'guide_reviews', 'guide_versions', 'resource_files', 'guide_ai_source_availability']) {
  return new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(views.map((name) => `SELECT * FROM ${name}`));
  });
}
async function initialize(connect: (token: string) => Promise<DbConnection>, tokens: string[]) {
  const owner = await connect(tokens[0]!);
  await owner.reducers.setAuthConfig({ issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
  for (const [index, name] of ['owner', 'author', 'reviewer'].entries()) {
    await owner.reducers.inviteMember({ email: `${name}@b20-smoke.invalid`, isCreator: index === 0 });
  }
  await owner.reducers.joinGroup({ displayName: 'Synthetic owner' });
  const author = await connect(tokens[1]!); await author.reducers.joinGroup({ displayName: 'Synthetic author' });
  const reviewer = await connect(tokens[2]!); await reviewer.reducers.joinGroup({ displayName: 'Synthetic reviewer' });
  return { owner, author, reviewer };
}
/** Runs against a previous module before the runner publishes the additive update. */
export async function seedBaseline(options: Pick<Options, 'address' | 'database' | 'tokens'>): Promise<Baseline> {
  setGlobalLogLevel('error'); const pool = clients(options);
  try {
    const { author } = await initialize(pool.connect, options.tokens);
    await subscribe(author, ['subjects', 'notes', 'study_guides']);
    await author.reducers.createSubject({ name: 'Synthetic migration baseline', period: 1 });
    const subjectId = [...author.db.subjects.iter()][0]!.id;
    const noteBody = 'Contenido anterior conservado íntegramente, con su identificador y versión.';
    await author.reducers.saveNote({ noteId: undefined, subjectId, topic: 'Ciclos', title: 'Existing shared note', body: noteBody,
      tags: ['synthetic'], visibility: 'group', source: 'student' });
    const noteId = [...author.db.notes.iter()][0]!.id;
    const guideTitle = 'Existing manual guide';
    await author.reducers.createGuide({ subjectId, termId: undefined, title: guideTitle, topics: ['Ciclos'],
      sections: GUIDE_SECTIONS.map(() => 'Contenido manual existente.'), sources: [{ kind: 'nota', refId: noteId }] });
    const guideId = [...author.db.studyGuides.iter()][0]!.id;
    return { subjectId: String(subjectId), noteId: String(noteId), guideId: String(guideId), noteBody, guideTitle };
  } finally { pool.close(); }
}

export async function runSmoke(options: Options) {
  setGlobalLogLevel('error'); const pool = clients(options); const checks: string[] = [];
  const guide = async <T>(connection: DbConnection, action: string, body: Record<string, unknown> = {}) =>
    JSON.parse(await connection.procedures.guideAi({ payload: JSON.stringify({ action, ...body }) })) as T;
  const current = (connection: DbConnection, id: bigint) => [...connection.db.studyGuides.iter()].find((row) => row.id === id)!;
  try {
    let owner: DbConnection, author: DbConnection, reviewer: DbConnection;
    if (options.baseline) {
      owner = await pool.connect(options.tokens[0]!); author = await pool.connect(options.tokens[1]!); reviewer = await pool.connect(options.tokens[2]!);
    } else ({ owner, author, reviewer } = await initialize(pool.connect, options.tokens));
    await subscribe(owner); await subscribe(author); await subscribe(reviewer);
    const outsider = await pool.connect(options.tokens[3]!);
    await assert.rejects(guide(outsider, 'listDrafts'));
    if (options.baseline) {
      assert.equal([...author.db.notes.iter()].find((row) => String(row.id) === options.baseline!.noteId)?.body, options.baseline.noteBody);
      assert.equal(current(author, BigInt(options.baseline.guideId)).title, options.baseline.guideTitle);
      assert.equal(current(author, BigInt(options.baseline.guideId)).version, 1);
      checks.push('migración aditiva desde el módulo anterior conserva IDs, texto, guía manual y versiones con delete-data=never');
    }
    await author.reducers.createSubject({ name: 'Synthetic guide lifecycle', period: 1 });
    const subjectId = [...author.db.subjects.iter()].find((row) => row.name === 'Synthetic guide lifecycle')!.id;
    await author.reducers.createTerm({ subjectId, name: 'Synthetic term', position: 1 });
    const termId = [...author.db.terms.iter()].find((row) => row.subjectId === subjectId)!.id;
    const noteFields = { subjectId, termId, session: '', topic: 'Ciclos', tags: ['synthetic'], visibility: 'group', source: 'student', assignmentIds: [], activityIds: [], questionIds: [] };
    const addNote = async (title: string, body: string, visibility = 'group') => {
      await author.reducers.saveNoteV2({ ...noteFields, noteId: undefined, expectedVersion: undefined, title, body, visibility });
      return [...author.db.notes.iter()].find((row) => row.title === title)!.id;
    };
    const noteId = await addNote('Synthetic loops', 'Un ciclo repite instrucciones mientras se cumple una condición.');
    const secondId = await addNote('Synthetic conditions', 'Una condición decide qué instrucciones se ejecutan.');
    const privateId = await addNote('Synthetic private input', 'Este contenido no se permite en guías.', 'personal');
    const selection = (ids: bigint[]): GuideAiPrepareInput => ({ purpose: 'study_guide', subjectId: String(subjectId), termId: String(termId),
      title: 'Synthetic generated guide', topics: ['Ciclos'], maxOutputTokens: 1500,
      sources: ids.map((refId) => ({ kind: 'note', refId: String(refId), topics: ['Ciclos'], includeUnplaced: false })) });
    await assert.rejects(guide(author, 'prepare', { id: randomUUID(), input: selection([privateId]), model: 'synthetic-no-network' }));

    const technicalResponse = await fetch(`${options.address}/v1/identity`, { method: 'POST' });
    assert.ok(technicalResponse.ok); const technical = await technicalResponse.json() as { identity: string; token: string };
    await owner.reducers.setAiService({ identity: Identity.fromString(technical.identity), enabled: true, dailyTokenBudget: 100_000 });
    const service = await pool.connect(technical.token);
    const secrets = { AI_MASTER_VERSION: 'v1', AI_MASTER_KEYS_JSON: JSON.stringify({ v1: randomBytes(32).toString('base64') }) };
    const configureKey = async (person: DbConnection) => {
      await person.procedures.aiSetConsent({ payload: JSON.stringify({ version: AI_CONSENT_VERSION, accepted: true }) });
      const keyId = randomUUID(), intentId = randomUUID(), actor = person.identity!.toHexString().replace(/^0x/, '');
      await person.procedures.aiAuthorizeKey({ payload: JSON.stringify({ keyId, intentId, provider: 'gemini' }) });
      const encrypted = await encryptAiKey(secrets, { actor, keyId, provider: 'gemini' }, 'synthetic-local-not-a-real-key');
      await service.procedures.aiCommitKey({ payload: JSON.stringify({ actor, keyId, intentId, provider: 'gemini', ...encrypted }) });
      return actor;
    };
    const actor = await configureKey(author); const reviewerActor = await configureKey(reviewer);
    assert.equal(JSON.parse(await owner.procedures.aiKeyStatus({ payload: '{}' })).configured, false);
    for (const table of ['ai_key', 'guide_ai_draft', 'guide_ai_transcription']) await assert.rejects(subscribe(author, [table]));
    await assert.rejects(guide(author, 'claimStep', { actor, id: randomUUID(), generationId: randomUUID() }));
    checks.push('tres miembros sintéticos, persona no invitada, claves cifradas y tablas privadas sin suscripciones');

    await subscribe(author, ['questions', 'answers']);
    await author.reducers.askQuestion({ subjectId, topic: 'Ciclos', title: 'Synthetic public question', body: '¿Cuándo termina un ciclo?' });
    const questionId = [...author.db.questions.iter()].find((row) => row.title === 'Synthetic public question')!.id;
    await reviewer.reducers.answerQuestion({ questionId, body: 'Termina cuando deja de cumplirse su condición.' });
    const questionInput = { ...selection([]), sources: [{ kind: 'question' as const, refId: String(questionId), topics: ['Ciclos'], includeUnplaced: false }] };
    const unplaced = await guide<GuideAiDraft>(author, 'prepare', { id: randomUUID(), input: questionInput, model: 'synthetic-no-network' });
    assert.equal(unplaced.preparation.canGenerate, false);
    questionInput.sources[0]!.includeUnplaced = true;
    const publicQuestion = await guide<GuideAiDraft>(author, 'prepare', { id: randomUUID(), input: questionInput, model: 'synthetic-no-network' });
    assert.equal(publicQuestion.preparation.canGenerate, true);
    assert.ok(publicQuestion.preparation.fragments.some((fragment) => fragment.text.includes('deja de cumplirse')));
    const ex1Input = { subjectId: String(subjectId), termId: String(termId), topics: ['Ciclos'], model: 'synthetic-no-network' };
    const ordinaryPreparation = JSON.parse(await author.procedures.aiPrepare({ payload: JSON.stringify({ ...ex1Input, id: randomUUID(), sources: selection([noteId]).sources }) }));
    assert.equal(ordinaryPreparation.canGenerate, true);
    const rejectedEx1Question = JSON.parse(await author.procedures.aiPrepare({ payload: JSON.stringify({ ...ex1Input, id: randomUUID(), sources: questionInput.sources }) }));
    assert.equal(rejectedEx1Question.ok, false);
    assert.equal(rejectedEx1Question.code, 'invalid');
    assert.match(rejectedEx1Question.message, /selección de fuentes/);
    checks.push('preguntas con respuestas públicas y selección expresa sin parcial solo amplían Guías, manteniendo el contrato EX-1');

    const bytes = new TextEncoder().encode('Documento compartido: ejemplo de un ciclo.\nRepetir hasta terminar.');
    const fileId = randomUUID();
    await author.reducers.beginResourceUpload({ uploadId: fileId, targetKind: 'note', targetId: noteId, expectedVersion: 1,
      name: 'synthetic-guide.txt', mime: 'text/plain', bytes: BigInt(bytes.length), sha256: hash(bytes) });
    await author.reducers.putResourceChunk({ uploadId: fileId, index: 0, bytes, sha256: hash(bytes) });
    await author.reducers.finalizeResourceUpload({ uploadId: fileId });
    const info = await guide<{ fileHash: string; targetVersion: number }>(author, 'fileInfo', { fileId });
    assert.equal(info.fileHash, hash(bytes)); assert.equal(info.targetVersion, 2);
    const transcriptionId = randomUUID();
    const transcription = { id: transcriptionId, fileId, fileHash: info.fileHash, targetKind: 'note', targetId: String(noteId), targetVersion: info.targetVersion,
      text: new TextDecoder().decode(bytes), reviewed: true,
      segments: [{ id: 'lines-1-2', text: new TextDecoder().decode(bytes), locator: { kind: 'lines', start: 1, end: 2 } }], omissions: [] };
    await assert.rejects(guide(author, 'saveTranscription', { ...transcription, fileHash: '0'.repeat(64) }));
    await guide(author, 'saveTranscription', transcription);
    await guide(author, 'saveTranscription', transcription);
    await assert.rejects(guide(owner, 'getTranscription', { id: transcriptionId }));
    const input = selection([noteId, secondId]); input.sources[0]!.transcriptionIds = [transcriptionId];
    const prepare = (person: DbConnection, selected = input) => guide<GuideAiDraft>(person, 'prepare', { id: randomUUID(), input: selected, model: 'synthetic-no-network' });
    let draft = await prepare(author);
    assert.equal(draft.preparation.estimatedCalls, 1); assert.equal(draft.preparation.canGenerate, true);
    assert.ok(draft.preparation.fragments.some((fragment) => fragment.origins.some((origin) => origin.fileId === fileId && origin.locator?.kind === 'lines')));
    const list = await guide<GuideAiDraftSummary[]>(author, 'listDrafts');
    assert.ok(list.some((row) => row.id === draft.id)); assert.ok(!JSON.stringify(list).includes('fragments'));
    assert.deepEqual(await guide(owner, 'listDrafts'), []);
    await assert.rejects(guide(owner, 'getDraft', { id: draft.id }));
    checks.push('adjunto nativo íntegro, transcripción revisada ligada a huella y versión, borrador privado y listas sin contenido');

    let syntheticCalls = 0;
    const resultFor = (value: GuideAiDraft): GuideAiResult => ({ title: value.title,
      sections: GUIDE_SECTIONS.map((section) => ({ id: section.id, content: `Contenido sintético de ${section.title}.`, citations: value.preparation.fragments.map((fragment) => fragment.id) })) });
    const authorize = async (person: DbConnection, value: GuideAiDraft, generationId = randomUUID()) => {
      const authorized = await guide<{ draft: GuideAiDraft }>(person, 'authorizeStep', { id: value.id, expectedRevision: value.revision,
        generationId, fingerprint: value.preparation.fingerprint, model: value.preparation.model, allowNew: true, confirmed: true });
      return { draft: authorized.draft, generationId };
    };
    const step = async (person: DbConnection, personActor: string, value: GuideAiDraft) => {
      const authorized = await authorize(person, value);
      const claims = await Promise.all([guide<GuideAiClaim>(service, 'claimStep', { id: value.id, actor: personActor, generationId: authorized.generationId }),
        guide<GuideAiClaim>(service, 'claimStep', { id: value.id, actor: personActor, generationId: authorized.generationId })]);
      assert.equal(claims.filter((claim) => claim.claimed).length, 1);
      const claim = claims.find((value) => value.claimed)!; syntheticCalls += 1;
      const result = claim.step!.kind === 'summary' ? { paragraphs: [{ text: 'Resumen sintético del lote.', citations: claim.fragments!.map((fragment) => fragment.id) }] } : resultFor(claim.draft);
      return guide<GuideAiDraft>(service, 'finishStep', { id: value.id, actor: personActor, generationId: authorized.generationId, state: 'succeeded', result, usage: { inputTokens: 100, outputTokens: 100 } });
    };
    draft = await step(author, actor, draft); assert.equal(draft.state, 'ready');
    assert.ok(![...reviewer.db.studyGuides.iter()].some((row) => row.title === draft.title));
    const originalRevision = draft.revision;
    draft = await guide<GuideAiDraft>(author, 'saveDraft', { id: draft.id, expectedRevision: draft.revision,
      result: { ...draft.result!, title: 'Edited private synthetic guide' } });
    await assert.rejects(guide(author, 'saveDraft', { id: draft.id, expectedRevision: originalRevision, result: draft.result }));
    const publication = { id: draft.id, expectedRevision: draft.revision, requestId: randomUUID() };
    const published = await Promise.all([guide<GuideAiDraft>(author, 'publish', publication), guide<GuideAiDraft>(author, 'publish', publication)]);
    assert.equal(published[0]!.publishedGuideId, published[1]!.publishedGuideId);
    const guideId = BigInt(published[0]!.publishedGuideId!);
    await until(() => !!current(reviewer, guideId), 'guía publicada visible');
    assert.equal(current(reviewer, guideId).version, 1);
    assert.equal([...reviewer.db.studyGuides.iter()].filter((row) => row.id === guideId).length, 1);
    const provenance = await guide<GuideAiProvenance>(reviewer, 'getProvenance', { guideId: String(guideId), version: 1 });
    assert.equal(provenance.purpose, 'study_guide'); assert.ok(provenance.fragments.some((fragment) => fragment.origins.some((origin) => origin.fileId === fileId)));
    await until(() => [...reviewer.db.guideAiSourceAvailability.iter()].filter((row) => row.guideId === guideId).length === 2, 'disponibilidad pública de las citas');
    assert.ok([...reviewer.db.guideAiSourceAvailability.iter()].filter((row) => row.guideId === guideId).every((row) => row.available && !row.outdated));
    await assert.rejects(author.reducers.reviewGuideV3({ guideId, expectedVersion: 1, verdict: 'approved', comment: 'No self review' }));
    const reviews = await Promise.allSettled([reviewer.reducers.reviewGuideV3({ guideId, expectedVersion: 1, verdict: 'approved', comment: 'Leí esta versión.' }),
      reviewer.reducers.reviewGuideV3({ guideId, expectedVersion: 1, verdict: 'changes', comment: 'Otra revisión simultánea.' })]);
    assert.equal(reviews.filter((reply) => reply.status === 'fulfilled').length, 1);
    checks.push('una sola reserva y generación concurrente, edición privada con CAS, publicación atómica idempotente y revisión inmutable de tercero');

    const guideFile = randomUUID(); const guideBytes = new TextEncoder().encode('Adjunto histórico de la guía.');
    await author.reducers.beginResourceUpload({ uploadId: guideFile, targetKind: 'guide', targetId: guideId, expectedVersion: 1,
      name: 'historical.txt', mime: 'text/plain', bytes: BigInt(guideBytes.length), sha256: hash(guideBytes) });
    await author.reducers.putResourceChunk({ uploadId: guideFile, index: 0, bytes: guideBytes, sha256: hash(guideBytes) });
    await author.reducers.finalizeResourceUpload({ uploadId: guideFile });
    await until(() => current(author, guideId).version === 2, 'versión con adjunto');
    await assert.rejects(owner.reducers.reviewGuideV3({ guideId, expectedVersion: 1, verdict: 'approved', comment: 'Versión ya cambiada.' }));
    await author.reducers.restoreGuideVersion({ guideId, version: 1, expectedVersion: 2 });
    assert.equal(current(author, guideId).version, 3);
    assert.equal(hash((await reviewer.procedures.readResourceChunk({ fileId: guideFile, index: 0 })).bytes), hash(guideBytes));
    assert.equal((await guide<GuideAiProvenance>(reviewer, 'getProvenance', { guideId: String(guideId), version: 3 })).purpose, 'study_guide');
    await author.reducers.restoreGuideVersion({ guideId, version: 2, expectedVersion: 3 });
    assert.equal(current(author, guideId).version, 4);
    assert.equal([...author.db.resourceFiles.iter()].find((row) => row.id === guideFile)?.removedAt, undefined);
    const guideSources = [...author.db.guideSources.iter()].filter((row) => row.guideId === guideId);
    await author.reducers.updateGuideSourceV3({ sourceId: guideSources[0]!.id, expectedVersion: 4, status: 'processed', reason: '', topics: ['Ciclos'] });
    await assert.rejects(author.reducers.removeGuideSourceV3({ sourceId: guideSources[0]!.id, expectedVersion: 4 }));
    await assert.rejects(owner.reducers.reviewGuideV3({ guideId, expectedVersion: 4, verdict: 'approved', comment: 'Versión anterior.' }));
    assert.equal([...author.db.guideReviews.iter()].filter((row) => row.guideId === guideId && row.guideVersion === 5).length, 0);
    checks.push('historial conserva archivos y procedencia, restauraciones crean versiones y fuentes/revisiones rechazan versiones leídas antiguas');

    const longA = await addNote('Synthetic long A', Array.from({ length: 250 }, (_, index) => `Lote A ${index}: ${'a'.repeat(80)}`).join('\n'));
    const longB = await addNote('Synthetic long B', Array.from({ length: 250 }, (_, index) => `Lote B ${index}: ${'b'.repeat(80)}`).join('\n'));
    let large = await prepare(author, selection([longA, longB]));
    assert.equal(large.totalSteps, 3); large = await step(author, actor, large);
    const largeId = large.id; const largeRevision = large.revision; const draftId = draft.id;
    pool.close(); await options.restart();
    owner = await pool.connect(options.tokens[0]!); author = await pool.connect(options.tokens[1]!); reviewer = await pool.connect(options.tokens[2]!);
    const resumedService = await pool.connect(technical.token);
    await subscribe(author); await subscribe(reviewer);
    large = await guide<GuideAiDraft>(author, 'getDraft', { id: largeId });
    assert.equal(large.completedSteps, 1); assert.equal(large.revision, largeRevision);
    assert.equal((await guide<GuideAiDraft>(author, 'getDraft', { id: draftId })).state, 'published');
    assert.equal(current(author, guideId).version, 5);
    const resumedStep = async (value: GuideAiDraft) => {
      const authorized = await authorize(author, value);
      const claim = await guide<GuideAiClaim>(resumedService, 'claimStep', { id: value.id, actor, generationId: authorized.generationId });
      assert.equal(claim.claimed, true); syntheticCalls += 1;
      if (claim.step!.kind === 'synthesis') assert.equal(claim.summaries!.length, 2);
      const result = claim.step!.kind === 'summary' ? { paragraphs: [{ text: 'Segundo resumen persistido.', citations: claim.fragments!.map((fragment) => fragment.id) }] } : resultFor(claim.draft);
      return guide<GuideAiDraft>(resumedService, 'finishStep', { id: value.id, actor, generationId: authorized.generationId, state: 'succeeded', result });
    };
    large = await resumedStep(large); large = await resumedStep(large); assert.equal(large.state, 'ready');
    checks.push('reinicio real conserva claves, borradores, pasos, guías y archivos; retoma resúmenes antes de la síntesis sin repetir envíos');

    let stale = await prepare(author, selection([secondId])); stale = await resumedStep(stale);
    await author.reducers.saveNoteV2({ ...noteFields, noteId: secondId, expectedVersion: 1, title: 'Synthetic conditions', body: 'La fuente cambió después de preparar el borrador.' });
    await until(() => [...reviewer.db.guideAiSourceAvailability.iter()].some((row) => row.guideId === guideId && row.available && row.outdated), 'cita histórica disponible y desactualizada');
    await assert.rejects(guide(author, 'publish', { id: stale.id, expectedRevision: stale.revision, requestId: randomUUID() }));
    assert.equal((await guide<GuideAiDraft>(author, 'getDraft', { id: stale.id })).state, 'ready');
    let blocked = await prepare(author, selection([noteId]));
    const authorizedBlocked = await authorize(author, blocked);
    await assert.rejects(guide(resumedService, 'claimStep', { id: blocked.id, actor, generationId: authorizedBlocked.generationId }), /quota|límite/);
    blocked = await guide<GuideAiDraft>(author, 'getDraft', { id: blocked.id });
    assert.equal(blocked.completedSteps, 0); assert.equal(blocked.steps[0]!.state, 'pending');
    const cancelled = await guide<GuideAiDraft>(author, 'cancelDraft', { id: blocked.id, expectedRevision: blocked.revision });
    assert.equal(cancelled.state, 'cancelled');
    await assert.rejects(guide(resumedService, 'claimStep', { id: blocked.id, actor, generationId: authorizedBlocked.generationId }));
    checks.push('fuente cambiada bloquea publicar conservando el borrador; cuota compartida conserva avance y cancelar impide pasos pendientes');

    let malformed = await prepare(reviewer, selection([noteId]));
    const malformedAuthorization = await authorize(reviewer, malformed);
    const malformedClaim = await guide<GuideAiClaim>(resumedService, 'claimStep', { id: malformed.id, actor: reviewerActor, generationId: malformedAuthorization.generationId });
    assert.equal(malformedClaim.claimed, true); syntheticCalls += 1;
    malformed = await guide<GuideAiDraft>(resumedService, 'finishStep', { id: malformed.id, actor: reviewerActor, generationId: malformedAuthorization.generationId,
      state: 'succeeded', result: { title: 'Invalid citations', sections: GUIDE_SECTIONS.map((section) => ({ id: section.id, content: 'Texto', citations: ['does-not-exist'] })) } });
    assert.equal(malformed.state, 'failed'); assert.equal(malformed.result, undefined);

    await subscribe(author, ['activities', 'evidences']); await subscribe(reviewer, ['activities', 'evidences']);
    await author.reducers.createActivity({ subjectId, termId, topic: 'Ciclos', date: '2026-10-21', title: 'Synthetic evidence activity', objective: 'Comprender ciclos.', instructions: 'Comparte una evidencia.' });
    const activityId = [...author.db.activities.iter()].find((row) => row.title === 'Synthetic evidence activity')!.id;
    await reviewer.reducers.addEvidence({ activityId, content: 'Sentinela de evidencia compartida que luego se retira.', participants: [] });
    const evidenceId = [...reviewer.db.evidences.iter()].find((row) => row.activityId === activityId)!.id;
    const evidenceInput = { ...selection([]), sources: [{ kind: 'activity' as const, refId: String(activityId), topics: ['Ciclos'], includeUnplaced: false, evidenceIds: [String(evidenceId)] }] };
    let evidenceDraft = await prepare(reviewer, evidenceInput);
    const evidenceAuthorization = await authorize(reviewer, evidenceDraft);
    const evidenceClaim = await guide<GuideAiClaim>(resumedService, 'claimStep', { id: evidenceDraft.id, actor: reviewerActor, generationId: evidenceAuthorization.generationId });
    assert.equal(evidenceClaim.claimed, true); syntheticCalls += 1;
    const evidenceCitations = evidenceClaim.fragments!.filter((fragment) => fragment.origins.some((origin) => origin.kind === 'evidence')).map((fragment) => fragment.id);
    assert.ok(evidenceCitations.length);
    evidenceDraft = await guide<GuideAiDraft>(resumedService, 'finishStep', { id: evidenceDraft.id, actor: reviewerActor, generationId: evidenceAuthorization.generationId,
      state: 'succeeded', result: { ...resultFor(evidenceClaim.draft), sections: resultFor(evidenceClaim.draft).sections.map((section) => ({ ...section, citations: evidenceCitations })) } });
    evidenceDraft = await guide<GuideAiDraft>(reviewer, 'publish', { id: evidenceDraft.id, expectedRevision: evidenceDraft.revision, requestId: randomUUID() });
    const evidenceGuideId = BigInt(evidenceDraft.publishedGuideId!);
    await until(() => [...author.db.guideAiSourceAvailability.iter()].some((row) => row.guideId === evidenceGuideId && row.available), 'evidencia citada disponible');
    await reviewer.reducers.withdrawContent({ kind: 'evidence', targetId: evidenceId, expectedVersion: 1, withdrawn: true, reason: 'Retiro sintético de la única evidencia citada.' });
    await until(() => [...author.db.guideAiSourceAvailability.iter()].some((row) => row.guideId === evidenceGuideId && !row.available), 'evidencia retirada pierde cobertura aunque siga visible la actividad');
    const redactedEvidence = await guide<GuideAiProvenance>(author, 'getProvenance', { guideId: String(evidenceGuideId), version: 1 });
    assert.ok(redactedEvidence.fragments.every((fragment) => fragment.text === '[Fuente no disponible]' && fragment.origins.length === 0));
    assert.ok(current(author, evidenceGuideId)); assert.ok([...author.db.activities.iter()].some((row) => row.id === activityId));
    checks.push('vista pública distingue cita histórica disponible de origen retirado; evidencia retirada pierde cobertura y texto de procedencia sin ocultar la guía ni su actividad');

    await author.reducers.withdrawContent({ kind: 'note', targetId: noteId, expectedVersion: 2, withdrawn: true, reason: 'Synthetic withdrawal' });
    await assert.rejects(guide(author, 'getDraft', { id: draftId }));
    await assert.rejects(guide(author, 'getTranscription', { id: transcriptionId }));
    const redacted = await guide<GuideAiProvenance>(author, 'getProvenance', { guideId: String(guideId), version: 1 });
    assert.ok(redacted.fragments.filter((fragment) => fragment.origins.every((origin) => origin.refId !== String(noteId))).length);
    assert.ok(!JSON.stringify(redacted.fragments).includes('Documento compartido: ejemplo de un ciclo.'));
    await owner.reducers.removeMember({ identity: reviewer.identity! });
    await assert.rejects(guide(reviewer, 'listDrafts'));
    checks.push('citas inexistentes rechazan el resultado, retirada revalida acceso a texto derivado y baja impide consultar borradores');
    return { checks, migrationRehearsed: !!options.baseline, syntheticProviderCalls: syntheticCalls, realGeminiCalls: 0 };
  } finally { pool.close(); }
}
