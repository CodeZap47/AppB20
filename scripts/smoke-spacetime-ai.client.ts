import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { Identity, setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
import { AI_CONSENT_VERSION, type AiPreparation, type AiGeneration } from '../packages/core/src/ai';
import { GUIDE_SECTIONS } from '../packages/core/src/guides';
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
  const close = () => { for (const connection of connections) connection.disconnect(); connections.clear(); };
  try {
    let owner = await connect(options.tokens[0]!);
    await owner.reducers.setAuthConfig({ issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['b20-local-smoke'] });
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
      assert.equal(input.preparation.config.purpose, input.config.purpose);
      const headings = input.config.purpose === 'guide' ? GUIDE_SECTIONS.map((section) => section.title) : ['Explicación'];
      return { text: JSON.stringify({ purpose: input.config.purpose, title: 'Ciclos revisables',
        sections: headings.map((heading) => ({ heading, text: 'Un ciclo repite instrucciones. Ejemplo: tres vueltas.', citations: [input.preparation.fragments[0]!.id] })) }),
        usage: { inputTokens: 100, outputTokens: 100 } };
    } } }));
    app.onError((error, c) => { const safe = aiPublicError(error); return c.json({ error: safe?.message ?? 'Local failure', code: safe?.code }, safe?.status ?? 503); });
    const request = (token: string, path: string, method = 'GET', body?: unknown) => app.request(`http://local.test/ai/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
    const successful = async <T>(response: Response): Promise<T> => {
      const body = await response.json(); assert.ok(response.ok, JSON.stringify(body)); return body as T;
    };
    assert.equal((await request(options.tokens[2]!, 'status')).status, 403);
    await successful(await request(options.tokens[1]!, 'consent', 'PUT', { version: AI_CONSENT_VERSION, accepted: true }));
    const key = await request(options.tokens[1]!, 'key', 'PUT', { apiKey: 'synthetic-local-key-never-a-real-key' });
    assert.equal(key.status, 200); assert.ok(!(await key.text()).includes('synthetic-local-key'));
    assert.equal((await successful<{ configured: boolean }>(await request(options.tokens[0]!, 'key'))).configured, false);
    const config = { purpose: 'explanation', questionCount: 1, types: ['single'], difficulty: 'basic' };
    const selection = { subjectId: subjectId.toString(), topics: ['Ciclos'], config,
      sources: [{ kind: 'note', refId: noteId.toString(), topics: ['Ciclos'], includeUnplaced: true }] };
    assert.ok(!(await request(options.tokens[0]!, 'preparations', 'POST', selection)).ok);
    const preparation = await successful<AiPreparation>(await request(options.tokens[1]!, 'preparations', 'POST', selection));
    assert.equal(preparation.canGenerate, true);
    assert.ok(!JSON.stringify(preparation).includes('privacy@example.invalid'));
    assert.ok(JSON.stringify(preparation.fragments).includes('const vueltas = 3;'));
    assert.equal(preparation.sources[0]!.version, 2);
    await assert.rejects(subscribe(author, ['ai_key']));
    assert.equal(JSON.parse(await author.procedures.aiClaimGeneration({ payload: JSON.stringify({ id: randomUUID(), actor: author.identity!.toHexString() }) })).code, 'unauthorized');
    checks.push('tres identidades, clave cifrada, fuente personal y operaciones técnicas aisladas');
    const generationBody = { id: randomUUID(), preparationId: preparation.id, fingerprint: preparation.fingerprint, config, confirmed: true };
    const replies = await Promise.all([request(options.tokens[1]!, 'generations', 'POST', generationBody), request(options.tokens[1]!, 'generations', 'POST', generationBody)]);
    for (const reply of replies) await successful(reply);
    const generation = await successful<AiGeneration>(await request(options.tokens[1]!, `generations/${generationBody.id}`));
    assert.equal(generation.state, 'succeeded'); assert.equal(providerCalls, 1);
    assert.ok(!(await request(options.tokens[0]!, `generations/${generationBody.id}`)).ok);
    assert.equal((await request(options.tokens[1]!, `generations/${generationBody.id}/publish`, 'POST', {})).status, 403);
    checks.push('adjunto UTF8 real, fuentes/versiones, redacción; explicación privada y UUID concurrente sin doble envío');
    await author.reducers.saveNoteV2({ noteId: undefined, expectedVersion: undefined, subjectId, termId: undefined,
      session: '', topic: 'Ciclos', title: 'Synthetic group note', body: 'Los ciclos for y while repiten instrucciones.',
      tags: ['ciclos'], visibility: 'group', source: 'student', assignmentIds: [], activityIds: [], questionIds: [] });
    const groupNoteId = [...author.db.notes.iter()].find((note) => note.visibility === 'group')!.id;
    const guideConfig = { ...config, purpose: 'guide' };
    const guidePreparation = await successful<AiPreparation>(await request(options.tokens[1]!, 'preparations', 'POST', { ...selection,
      config: guideConfig, sources: [{ kind: 'note', refId: groupNoteId.toString(), topics: ['Ciclos'], includeUnplaced: true }] }));
    const guideBody = { id: randomUUID(), preparationId: guidePreparation.id, fingerprint: guidePreparation.fingerprint, config: guideConfig, confirmed: true };
    const guideDraft = await successful<AiGeneration>(await request(options.tokens[1]!, 'generations', 'POST', guideBody));
    assert.equal(guideDraft.state, 'succeeded'); assert.equal(providerCalls, 2);
    const drafts = await successful<AiGeneration[]>(await request(options.tokens[1]!, 'generations'));
    assert.equal(drafts.length, 2); assert.equal(drafts[0]!.preparation!.sources[0]!.version, 1);
    const publication = await successful<{ targetKind: string; targetId: string }>(await request(options.tokens[1]!, `generations/${guideBody.id}/publish`, 'POST', {}));
    assert.equal(publication.targetKind, 'guide');
    assert.deepEqual(await successful(await request(options.tokens[1]!, `generations/${guideBody.id}/publish`, 'POST', {})), publication);
    await subscribe(owner, ['study_guides', 'guide_sources']);
    const guide = [...owner.db.studyGuides.iter()].find((row) => row.id.toString() === publication.targetId)!;
    assert.equal(guide.sections.length, 8); assert.ok(guide.sections[0]!.includes('Gemini'));
    assert.ok(guide.sections[0]!.includes(`note:${groupNoteId} v1`));
    assert.ok([...owner.db.guideSources.iter()].some((row) => row.guideId === guide.id && row.refId === groupNoteId && row.sourceVersion === 1));
    checks.push('borradores privados recuperables y guía con ocho secciones publicada explícitamente una sola vez con referencias');
    close(); await options.restart();
    assert.equal((await successful<{ configured: boolean }>(await request(options.tokens[1]!, 'key'))).configured, true);
    assert.equal((await successful<AiGeneration>(await request(options.tokens[1]!, `generations/${generationBody.id}`))).state, 'succeeded');
    await successful(await request(options.tokens[1]!, 'generations', 'POST', generationBody)); assert.equal(providerCalls, 2);
    assert.equal((await successful<AiGeneration[]>(await request(options.tokens[1]!, 'generations'))).length, 2);
    checks.push('reinicio conserva clave, preparación y generación sin volver a llamar al proveedor');
    owner = await connect(options.tokens[0]!); author = await connect(options.tokens[1]!);
    await author.reducers.withdrawContent({ kind: 'note', targetId: noteId, withdrawn: true, expectedVersion: 2, reason: 'Synthetic withdrawal' });
    assert.ok(!(await request(options.tokens[1]!, `generations/${generationBody.id}`)).ok);
    await successful(await request(options.tokens[1]!, 'key', 'DELETE'));
    assert.equal((await successful<{ configured: boolean }>(await request(options.tokens[1]!, 'key'))).configured, false);
    await owner.reducers.setAiService({ identity: Identity.fromString(service.identity), enabled: false, dailyTokenBudget: 100000 });
    assert.equal((await successful<{ enabled: boolean }>(await request(options.tokens[1]!, 'status'))).enabled, false);
    checks.push('retiro oculta resultados derivados, eliminación inmediata y política desactivada');
    return { checks, providerCalls, realGeminiCalls: 0 };
  } finally { close(); }
}
