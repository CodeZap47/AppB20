import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { Identity, setGlobalLogLevel } from 'spacetimedb';
import { DbConnection } from '../packages/app/src/module_bindings';
import { AI_CONSENT_VERSION, type AiPreparation, type AiGeneration } from '../packages/core/src/ai';
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
    await owner.reducers.setAuthConfig({ issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['b20-local-smoke'] });
    await owner.reducers.inviteMember({ email: 'owner@b20-smoke.invalid', isCreator: true });
    await owner.reducers.inviteMember({ email: 'author@b20-smoke.invalid', isCreator: false });
    await owner.reducers.joinGroup({ displayName: 'Synthetic owner' });
    let author = await connect(options.tokens[1]!);
    await author.reducers.joinGroup({ displayName: 'Synthetic author' });
    await subscribe(author, ['subjects', 'notes']);
    await author.reducers.createSubject({ name: 'Synthetic EX-1', period: 1 });
    const subjectId = [...author.db.subjects.iter()][0]!.id;
    await author.reducers.saveNoteV2({ noteId: undefined, expectedVersion: undefined, subjectId, termId: undefined,
      session: '', topic: 'Ciclos', title: 'Synthetic private note', body: 'Un ciclo repite instrucciones. Contacto: privacy@example.invalid',
      tags: ['ciclos'], visibility: 'personal', source: 'student', assignmentIds: [], activityIds: [], questionIds: [] });
    const noteId = [...author.db.notes.iter()][0]!.id;
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
      return { text: JSON.stringify({ questions: [{ id: 'q1', type: 'single', text: '¿Qué hace un ciclo?',
        options: [{ id: 'a', text: 'Repite' }, { id: 'b', text: 'Borra' }, { id: 'c', text: 'Cierra' }, { id: 'd', text: 'Envía' }],
        correctOptionId: 'a', explanation: 'Repite instrucciones.', topic: 'Ciclos', citations: [input.preparation.fragments[0]!.id] }] }),
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
    const config = { questionCount: 1, types: ['single'], difficulty: 'basic' };
    const selection = { subjectId: subjectId.toString(), topics: ['Ciclos'], config,
      sources: [{ kind: 'note', refId: noteId.toString(), topics: ['Ciclos'], includeUnplaced: true }] };
    assert.ok(!(await request(options.tokens[0]!, 'preparations', 'POST', selection)).ok);
    const preparation = await successful<AiPreparation>(await request(options.tokens[1]!, 'preparations', 'POST', selection));
    assert.equal(preparation.canGenerate, true);
    assert.ok(!JSON.stringify(preparation).includes('privacy@example.invalid'));
    await assert.rejects(subscribe(author, ['ai_key']));
    await assert.rejects(author.procedures.aiClaimGeneration({ payload: JSON.stringify({ id: randomUUID(), actor: author.identity!.toHexString() }) }));
    checks.push('tres identidades, clave cifrada, fuente personal y operaciones técnicas aisladas');
    const generationBody = { id: randomUUID(), preparationId: preparation.id, fingerprint: preparation.fingerprint, config, confirmed: true };
    const replies = await Promise.all([request(options.tokens[1]!, 'generations', 'POST', generationBody), request(options.tokens[1]!, 'generations', 'POST', generationBody)]);
    for (const reply of replies) await successful(reply);
    const generation = await successful<AiGeneration>(await request(options.tokens[1]!, `generations/${generationBody.id}`));
    assert.equal(generation.state, 'succeeded'); assert.equal(providerCalls, 1);
    assert.ok(!(await request(options.tokens[0]!, `generations/${generationBody.id}`)).ok);
    checks.push('preparación autorizada y redacción; generación simulada y UUID concurrente sin doble envío');
    close(); await options.restart();
    assert.equal((await successful<{ configured: boolean }>(await request(options.tokens[1]!, 'key'))).configured, true);
    assert.equal((await successful<AiGeneration>(await request(options.tokens[1]!, `generations/${generationBody.id}`))).state, 'succeeded');
    await successful(await request(options.tokens[1]!, 'generations', 'POST', generationBody)); assert.equal(providerCalls, 1);
    checks.push('reinicio conserva clave, preparación y generación sin volver a llamar al proveedor');
    owner = await connect(options.tokens[0]!); author = await connect(options.tokens[1]!);
    await author.reducers.withdrawContent({ kind: 'note', targetId: noteId, withdrawn: true, expectedVersion: 1, reason: 'Synthetic withdrawal' });
    assert.ok(!(await request(options.tokens[1]!, `generations/${generationBody.id}`)).ok);
    await successful(await request(options.tokens[1]!, 'key', 'DELETE'));
    assert.equal((await successful<{ configured: boolean }>(await request(options.tokens[1]!, 'key'))).configured, false);
    await owner.reducers.setAiService({ identity: Identity.fromString(service.identity), enabled: false, dailyTokenBudget: 100000 });
    assert.equal((await successful<{ enabled: boolean }>(await request(options.tokens[1]!, 'status'))).enabled, false);
    checks.push('retiro oculta resultados derivados, eliminación inmediata y política desactivada');
    return { checks, providerCalls, realGeminiCalls: 0 };
  } finally { close(); }
}
