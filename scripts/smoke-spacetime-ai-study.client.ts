import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { Identity, setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
import { AI_CONSENT_VERSION, type AiPreparation, type AiGeneration } from '../packages/core/src/ai';
import { ResourceTransport } from '../packages/app/src/data/resourceTransport';
import { createAiDatabase, type AiWorkerEnv } from '../apps/api/src/ai/database';
import { aiWorkerRoutes, aiPublicError, type AiRouteContext } from '../apps/api/src/ai/routes';
import { checkActiveMembership } from '../apps/api/src/lib/membership';

export async function runSmoke(options: { address: string; database: string; tokens: string[]; restart(): Promise<void> }) {
  setGlobalLogLevel('error');
  const connections = new Set<DbConnection>();
  const checks: string[] = [];
  const connect = (token: string) => new Promise<DbConnection>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Conexión local vencida.')), 20000);
    const connection = DbConnection.builder().withUri(options.address).withDatabaseName(options.database).withToken(token).withCompression('none')
      .onConnect((ready) => { clearTimeout(timeout); resolve(ready); })
      .onConnectError((_ctx, error) => { clearTimeout(timeout); reject(error); }).build();
    connections.add(connection);
  });
  const subscribe = (connection: DbConnection, views: string[]) => new Promise<void>((resolve, reject) => {
    connection.subscriptionBuilder().onApplied(() => resolve()).onError((_ctx, error) => reject(error)).subscribe(views.map((name) => `SELECT * FROM ${name}`));
  });
  const waitFor = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (condition()) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
    assert.ok(condition(), 'La suscripción no recibió el cambio confirmado.');
  };
  const close = () => { for (const connection of connections) connection.disconnect(); connections.clear(); };
  try {
    let owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({ issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['b20-local-smoke'] });
    await owner.reducers.inviteMember({ email: 'owner@b20-smoke.invalid', isCreator: true });
    await owner.reducers.inviteMember({ email: 'author@b20-smoke.invalid', isCreator: false });
    await owner.reducers.joinGroup({ displayName: 'Synthetic owner' });
    let author = await connect(options.tokens[1]!);
    await author.reducers.joinGroup({ displayName: 'Synthetic author' });
    await subscribe(author, ['subjects', 'notes']);
    await author.reducers.createSubject({ name: 'Synthetic BYOK', period: 1 });
    const subjectId = [...author.db.subjects.iter()][0]!.id;
    await author.reducers.saveNoteV2({ noteId: undefined, expectedVersion: undefined, subjectId, termId: undefined,
      session: '', topic: 'Ciclos', title: 'Synthetic private note', body: 'Un ciclo repite instrucciones. Contacto: privacy@example.invalid',
      tags: ['ciclos'], visibility: 'personal', source: 'student', assignmentIds: [], activityIds: [], questionIds: [] });
    const noteId = [...author.db.notes.iter()][0]!.id;
    const transfer = new ResourceTransport({ getConnection: () => author, getIdentity: () => author.identity!.toHexString() });
    await transfer.upload('note', noteId.toString(), new File(['const vueltas = 3; // UTF8 real'], 'ejemplo.ts', { type: 'text/plain' }), 1);
    const serviceResponse = await fetch(`${options.address}/v1/identity`, { method: 'POST' });
    assert.equal(serviceResponse.status, 200);
    const service = await serviceResponse.json() as { identity: string; token: string };
    await owner.reducers.setAiService({ identity: Identity.fromString(service.identity), enabled: true, dailyTokenBudget: 100000 });
    const env = { SPACETIMEDB_URI: options.address, SPACETIMEDB_MODULE: options.database,
      AI_SERVICE_TOKEN: service.token, AI_MASTER_KEYS_JSON: JSON.stringify({ v1: randomBytes(32).toString('base64') }),
      AI_MASTER_VERSION: 'v1', AI_ENABLED: 'true', GEMINI_MODEL: 'synthetic-no-network' } as AiWorkerEnv;
    let providerCalls = 0;
    const app = new Hono<AiRouteContext>();
    // Membership is checked by the real DB with the signed synthetic token, not a mocked identity.
    app.use('*', async (c, next) => {
      const token = c.req.header('Authorization')?.replace(/^Bearer /, '') ?? '';
      if (!token || !await checkActiveMembership(token, { uri: options.address, module: options.database })) return c.json({ error: 'Forbidden' }, 403);
      c.set('sessionToken', token); c.set('ai', createAiDatabase(env)); c.header('Cache-Control', 'private, no-store'); await next();
    });
    app.route('/ai', aiWorkerRoutes({ provider: { async generate(input) {
      providerCalls++;
      assert.equal(input.apiKey, 'synthetic-local-key-never-a-real-key');
      assert.ok(!JSON.stringify(input.preparation.fragments).includes('privacy@example.invalid'));
      assert.ok(!JSON.stringify(input.preparation).includes('SECRET_REFLECTION'));
      assert.ok(!JSON.stringify(input.preparation).includes('SECRET_PERSONAL_TOPICS'));
      const citations = [input.preparation.fragments[0]!.id];
      const result = input.config.purpose === 'teaching_questions'
        ? { purpose: input.config.purpose, questions: [{ text: '¿Qué haría que el ciclo no terminara?', citations }] }
        : { purpose: input.config.purpose, title: 'Ciclos', cards: [{ question: '¿Qué repite un ciclo?', explanation: 'Repite instrucciones.', hint: 'Repetición.', citations }] };
      return { text: JSON.stringify(result), usage: { inputTokens: 100, outputTokens: 100 } };
    } } }));
    app.onError((error, c) => { const safe = aiPublicError(error); return c.json({ error: safe?.message ?? 'Local failure', code: safe?.code }, safe?.status ?? 503); });
    const request = (token: string, path: string, method = 'GET', body?: unknown) => app.request(`http://local.test/ai/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
    const successful = async <T>(response: Response): Promise<T> => {
      const body = await response.json(); assert.ok(response.ok, JSON.stringify(body)); return body as T;
    };
    const userToken = options.tokens[1]!;
    const saveTeaching = async (input: { practiceId: bigint; concept: string; example: string; limits: string; revisedConcept: string; revisedExample: string; revisedLimits: string; reflection: string; topicsToReview: string }) => {
      const head = [...author.db.myTeachingVersions.iter()].find((entry) => entry.practiceId === input.practiceId);
      const response = JSON.parse(await author.procedures.teachingSaveV2({ payload: JSON.stringify({ practiceId: String(input.practiceId), expectedVersion: head?.version ?? 1, requestId: randomUUID(),
        initial: { concept: input.concept, example: input.example, limits: input.limits }, revised: { concept: input.revisedConcept, example: input.revisedExample, limits: input.revisedLimits }, reflection: input.reflection, topicsToReview: input.topicsToReview }) }));
      assert.ok(response.ok, response.message);
    };
    await successful(await request(userToken, 'consent', 'PUT', { version: AI_CONSENT_VERSION, accepted: true }));
    await successful(await request(userToken, 'key', 'PUT', { apiKey: 'synthetic-local-key-never-a-real-key' }));
    await subscribe(author, ['my_teaching_versions', 'teaching_practices', 'teaching_questions', 'my_teaching_personal', 'spaced_collections', 'spaced_cards', 'my_spaced_progress', 'my_spaced_reviews']);
    await author.reducers.createTeachingPractice({ subjectId, topic: 'Ciclos', concept: 'Un ciclo repite instrucciones.', example: 'Un contador aumenta en cada vuelta.', limits: 'Termina si su condición deja de cumplirse.', sourceKind: undefined, sourceId: undefined });
    const practiceId = [...author.db.teachingPractices.iter()][0]!.id;
    await author.reducers.startTeachingPractice({ practiceId });
    await author.reducers.setTeachingReviewer({ practiceId, reviewer: owner.identity! });
    const initial = [...author.db.teachingPractices.iter()][0]!;
    await saveTeaching({ practiceId, concept: initial.concept, example: initial.example, limits: initial.limits,
      revisedConcept: '', revisedExample: '', revisedLimits: '', reflection: 'SECRET_REFLECTION', topicsToReview: 'SECRET_PERSONAL_TOPICS' });
    const prepareInput = (purpose: 'teaching_questions' | 'spaced_cards', kind: string, refId: bigint) => ({ subjectId: subjectId.toString(), topics: ['Ciclos'],
      config: { purpose, questionCount: 1, types: ['single'], difficulty: 'basic' }, sources: [{ kind, refId: refId.toString(), topics: ['Ciclos'], includeUnplaced: true }] });
    const teachingInput = prepareInput('teaching_questions', 'teaching', practiceId);
    assert.ok(!(await request(options.tokens[0]!, 'preparations', 'POST', teachingInput)).ok, 'Reviewer cannot send the owner explanation');
    const teachingPrep = await successful<AiPreparation>(await request(userToken, 'preparations', 'POST', teachingInput));
    assert.equal(teachingPrep.sources[0]!.version, 1); assert.ok(teachingPrep.fragments.some((fragment) => fragment.text.includes(initial.concept)));
    assert.ok(!JSON.stringify(teachingPrep).includes('SECRET_'));
    const generate = async (preparation: AiPreparation) => {
      const body = { id: randomUUID(), preparationId: preparation.id, fingerprint: preparation.fingerprint, config: preparation.config, confirmed: true };
      const result = await successful<AiGeneration>(await request(userToken, 'generations', 'POST', body));
      assert.equal(result.state, 'succeeded'); await successful(await request(userToken, 'generations', 'POST', body));
      return result;
    };
    const beforeQuestions = [...author.db.teachingQuestions.iter()].length;
    const teachingDraft = await generate(teachingPrep); assert.equal(providerCalls, 1);
    assert.equal([...author.db.teachingQuestions.iter()].length, beforeQuestions, 'Generation does not insert questions');
    assert.ok(!(await request(options.tokens[0]!, `generations/${teachingDraft.id}`)).ok, 'Reviewer cannot read private AI drafts');
    const teachingAcceptance = { reviewed: true, selection: [{ index: 0, text: '¿Qué condición haría infinito el ciclo?' }] };
    const firstQuestions = await successful(await request(userToken, `generations/${teachingDraft.id}/publish`, 'POST', teachingAcceptance));
    assert.deepEqual(await successful(await request(userToken, `generations/${teachingDraft.id}/publish`, 'POST', teachingAcceptance)), firstQuestions);
    await waitFor(() => [...author.db.teachingQuestions.iter()].length === beforeQuestions + 1);
    assert.equal([...author.db.teachingQuestions.iter()].length, beforeQuestions + 1);
    assert.equal([...author.db.notes.iter()].length, 1, 'Accepting questions never publishes a note');
    checks.push('owner-only saved explanation with version; excludes reflection, personal topics, reviewer and history; private questions require explicit acceptance');
    await author.reducers.saveSpacedCollection({ collectionId: undefined, subjectId, termId: undefined, title: 'Synthetic private cards', visibility: 'personal', expectedVersion: undefined });
    await author.reducers.saveSpacedCollection({ collectionId: undefined, subjectId, termId: undefined, title: 'Synthetic group cards', visibility: 'group', expectedVersion: undefined });
    const privateCollection = [...author.db.spacedCollections.iter()].find((row) => row.visibility === 'personal')!;
    const groupCollection = [...author.db.spacedCollections.iter()].find((row) => row.visibility === 'group')!;
    const cardPrep = await successful<AiPreparation>(await request(userToken, 'preparations', 'POST', prepareInput('spaced_cards', 'note', noteId)));
    const cardDraft = await generate(cardPrep); assert.equal(providerCalls, 2);
    assert.equal([...author.db.spacedCards.iter()].length, 0);
    const cardSelection = [{ index: 0, question: '¿Qué hace un ciclo?', explanation: 'Repite instrucciones mientras una condición lo permita.', hint: 'Repetición.' }];
    assert.ok(!(await request(userToken, `generations/${cardDraft.id}/publish`, 'POST', { reviewed: true, collectionId: String(groupCollection.id), expectedCollectionVersion: groupCollection.version, selection: cardSelection })).ok);
    const acceptCards = { reviewed: true, collectionId: String(privateCollection.id), expectedCollectionVersion: privateCollection.version, selection: cardSelection };
    const cardReceipt = await successful(await request(userToken, `generations/${cardDraft.id}/publish`, 'POST', acceptCards));
    assert.deepEqual(await successful(await request(userToken, `generations/${cardDraft.id}/publish`, 'POST', acceptCards)), cardReceipt);
    await waitFor(() => [...author.db.spacedCards.iter()].length === 1);
    const acceptedCards = [...author.db.spacedCards.iter()]; assert.equal(acceptedCards.length, 1); assert.equal(acceptedCards[0]!.sourceVersion, 2);
    assert.equal(acceptedCards[0]!.sourceId, noteId); assert.ok(acceptedCards[0]!.explanation.includes(`note:${noteId} v2`));
    assert.equal([...author.db.mySpacedProgress.iter()].length, 0); assert.equal([...author.db.mySpacedReviews.iter()].length, 0);
    await subscribe(owner, ['spaced_cards']); assert.equal([...owner.db.spacedCards.iter()].length, 0);
    checks.push('private card drafts, reviewed edits and exact source version; group rejects personal sources; acceptance is atomic/idempotent and leaves progress untouched');
    await author.reducers.saveNoteV2({ noteId: undefined, expectedVersion: undefined, subjectId, termId: undefined,
      session: '', topic: 'Ciclos', title: 'Synthetic group note', body: 'Los ciclos for y while repiten instrucciones.',
      tags: ['ciclos'], visibility: 'group', source: 'student', assignmentIds: [], activityIds: [], questionIds: [] });
    const groupNoteId = [...author.db.notes.iter()].find((note) => note.visibility === 'group')!.id;
    const groupPrep = await successful<AiPreparation>(await request(userToken, 'preparations', 'POST', prepareInput('spaced_cards', 'note', groupNoteId)));
    const groupDraft = await generate(groupPrep); assert.equal(providerCalls, 3);
    await successful(await request(userToken, `generations/${groupDraft.id}/publish`, 'POST', { reviewed: true, collectionId: String(groupCollection.id), expectedCollectionVersion: groupCollection.version, selection: cardSelection }));
    await waitFor(() => [...owner.db.spacedCards.iter()].length === 1);
    assert.equal([...owner.db.spacedCards.iter()][0]!.collectionId, groupCollection.id);
    checks.push('explicit acceptance can add a reviewed card to a group collection only from group material');
    close(); await options.restart();
    author = await connect(userToken);
    assert.equal((await successful<AiGeneration>(await request(userToken, `generations/${teachingDraft.id}`))).state, 'succeeded');
    assert.deepEqual(await successful(await request(userToken, `generations/${cardDraft.id}/publish`, 'POST', acceptCards)), cardReceipt);
    assert.equal(providerCalls, 3);
    await subscribe(author, ['spaced_cards', 'teaching_practices', 'my_teaching_versions']);
    assert.equal([...author.db.spacedCards.iter()].length, 2);
    checks.push('restart recovers private drafts and acceptance receipts without another provider request');
    const current = [...author.db.teachingPractices.iter()].find((row) => row.id === practiceId)!;
    await saveTeaching({ practiceId, concept: current.concept, example: current.example, limits: current.limits,
      revisedConcept: 'Una revisión distinta del concepto.', revisedExample: 'Un nuevo ejemplo de ciclos.', revisedLimits: 'Un límite nuevo.', reflection: 'SECRET_REFLECTION', topicsToReview: 'SECRET_PERSONAL_TOPICS' });
    assert.ok(!(await request(userToken, `generations/${teachingDraft.id}`)).ok, 'Changed explanation invalidates old AI drafts');
    const newTeachingPrep = await successful<AiPreparation>(await request(userToken, 'preparations', 'POST', teachingInput));
    assert.equal(newTeachingPrep.sources[0]!.version, 2);
    await author.reducers.withdrawContent({ kind: 'note', targetId: noteId, withdrawn: true, expectedVersion: 2, reason: 'Synthetic withdrawal' });
    assert.ok(!(await request(userToken, `generations/${cardDraft.id}`)).ok);
    assert.ok(!(await request(userToken, `generations/${cardDraft.id}/publish`, 'POST', acceptCards)).ok);
    await successful(await request(userToken, 'key', 'DELETE'));
    assert.equal((await successful<{ configured: boolean }>(await request(userToken, 'key'))).configured, false);
    checks.push('saved explanation changes and source withdrawal revoke private drafts and acceptance replay; key can be deleted immediately');
    return { checks, providerCalls, realGeminiCalls: 0 };
  } finally { close(); }
}
