import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import { AI_CONSENT_VERSION } from '../../core/src/ai';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import * as agent from './agentHandlers';
import { agent_ai, remove_member } from './index';
import type { Ctx } from './index';

const identity = (digit: string) => Identity.fromString(digit.repeat(64));
const admin = identity('a'); const owner = identity('b'); const peer = identity('c'); const service = identity('e');
const at = new Timestamp(1_700_000_000_000_000n);
const uid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = Record<string, unknown>;
const keyOf = (value: unknown): string => value && typeof value === 'object' && 'toHexString' in value ? (value as Identity).toHexString() : String(value);

function store(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[primary]), row]));
  let next = 100n;
  return new Proxy({ rows, iter: () => rows.values(), insert: (value: Row) => {
    const row: Row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) };
    if (rows.has(keyOf(row[primary]))) throw new Error('Duplicate key');
    rows.set(keyOf(row[primary]), row); return row;
  } }, { get(target, name: string) {
    if (name in target) return target[name as keyof typeof target];
    return { find: (value: unknown) => [...rows.values()].find((row) => keyOf(row[name]) === keyOf(value)),
      filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[name]) === keyOf(value)),
      update: (row: Row) => { rows.set(keyOf(row[primary]), { ...row }); return row; },
      delete: (value: unknown) => rows.delete(keyOf(value)) };
  } });
}

const essay = 'Un ciclo while repite instrucciones mientras su condición sea verdadera. Si el índice nunca cambia, el ciclo no termina y el programa se queda congelado. Por eso conviene revisar el incremento antes de ejecutar el programa completo.';

function setup() {
  const member = [admin, owner, peer].map((person) => ({ identity: person, displayName: person === peer ? 'Ana Pérez' : person === owner ? 'Luis Flores' : 'Admin', isCreator: person === admin, status: 'active', joinedAt: at }));
  const initial: Record<string, Row[]> = {
    member, appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }],
    aiServiceConfig: [{ id: 0, identity: service, enabled: true, dailyTokenBudget: 100_000 }],
    aiConsent: [owner, peer].map((actor) => ({ actor, version: AI_CONSENT_VERSION, accepted: true, updatedAt: at })),
    aiKey: [owner, peer].map((actor) => ({ actor, keyId: actor === owner ? uid(901) : uid(902), provider: 'gemini', ciphertext: 'cifrado', iv: 'AAAAAAAAAAAAAAAA', masterVersion: 'v1', updatedAt: at })),
    assignment: [{ id: 1n, subjectId: 1n, kind: 'tarea', title: 'Ciclos', instructions: 'Explica qué ocurre cuando un ciclo no termina.', version: 1, createdBy: admin, createdAt: at, updatedBy: admin, updatedAt: at }],
    work: [{ id: 10n, assignmentId: 1n, title: '', description: 'Primero leí la consigna con calma. Después probé el ciclo y anoté cada resultado en una tabla.', version: 1, createdBy: owner, createdAt: at, updatedAt: at },
      { id: 11n, assignmentId: 1n, title: '', description: essay, version: 1, createdBy: peer, createdAt: at, updatedAt: at }],
    workAuthor: [{ id: 1n, workId: 10n, author: owner }, { id: 2n, workId: 11n, author: peer }],
  };
  const keys: Record<string, string> = { member: 'identity', contentStatus: 'key', agentProfile: 'owner', agentStyleSource: 'key', aiConsent: 'actor', aiKey: 'actor' };
  const tables = new Map<string, ReturnType<typeof store>>();
  const db = new Proxy({}, { get(_target, property: string) {
    if (!tables.has(property)) tables.set(property, store(keys[property] ?? 'id', initial[property]));
    return tables.get(property);
  } });
  const state = { db, sender: owner, identity: admin, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'alumno@example.com', email_verified: true } } } };
  const ctx = state as unknown as Ctx;
  const proc = { withTx: (fn: (tx: Ctx) => unknown) => fn(ctx) } as unknown as Parameters<typeof agent_ai>[0];
  const rows = (table: string) => [...(db as Record<string, ReturnType<typeof store>>)[table].rows.values()];
  const as = (sender: Identity) => { state.sender = sender; };
  const tick = (seconds: number) => { state.timestamp = new Timestamp(state.timestamp.microsSinceUnixEpoch + BigInt(seconds) * 1_000_000n); };
  const call = <T = Record<string, unknown>>(action: string, input: Record<string, unknown> = {}) => JSON.parse(agent_ai(proc, { payload: JSON.stringify({ action, ...input }) })) as T;
  agent.enableAgent(ctx, { premisesVersion: 1 });
  agent.trainAgent(ctx, { sources: JSON.stringify([{ kind: 'work', refId: '10' }]), expectedStyleVersion: 0 });
  agent.startAgentSession(ctx, { assignmentId: 1n, requestId: 'sesion-1' });
  const sessionId = String(rows('agentSession')[0]!.id);
  const authorize = (step: string, n: number, extra: Record<string, unknown> = {}) => call('authorize', { step, sessionId, generationId: uid(n), confirmed: true, allowNew: true, model: 'gemini-test', ...extra });
  const claim = (n: number) => { as(service); const result = call<{ claimed: boolean; key?: unknown; payload?: { owner: string; bot: string; draft?: string }; systemInstruction?: string; ok?: boolean; code?: string }>('claim', { actor: owner.toHexString(), generationId: uid(n) }); as(owner); return result; };
  const finish = (n: number, result: unknown, extra: Record<string, unknown> = {}) => { as(service); const value = call('finish', { actor: owner.toHexString(), generationId: uid(n), state: 'succeeded', result, usage: { inputTokens: 100, outputTokens: 50 }, ...extra }); as(owner); return value; };
  const write = (draft: string) => { const session = rows('agentSession')[0]!; agent.saveAgentDraft(ctx, { sessionId: session.id as bigint, expectedDraftVersion: session.draftVersion as number, stage: 'review', draft }); };
  return { ctx, rows, as, tick, call, authorize, claim, finish, write, sessionId };
}

describe('agente con Gemini: vista previa y autorización', () => {
  it('arma el payload en el servidor con el nombre del agente y no guarda nada en la vista previa', () => {
    const s = setup(); s.write('Mi borrador sobre ciclos.');
    const preview = s.call<{ payload: { bot: string; owner: string; draft: string; style: unknown }; systemInstruction: string; estimatedTokens: number }>('preview', { step: 'review', sessionId: s.sessionId });
    expect(preview.payload).toMatchObject({ bot: 'Luis_BOT', owner: 'Luis', draft: 'Mi borrador sobre ciclos.' });
    expect(preview.systemInstruction).toContain('No me hago pasar por Luis');
    expect(preview.estimatedTokens).toBeGreaterThan(0);
    expect(s.rows('agentAiRun')).toHaveLength(0);
  });
  it('exige confirmación, paso habilitado, consentimiento y clave; es idempotente por envío', () => {
    const s = setup(); s.write('Mi borrador.');
    expect(s.authorize('review', 1, { confirmed: false })).toMatchObject({ ok: false, code: 'consent' });
    expect(s.authorize('review', 1, { allowNew: false })).toMatchObject({ ok: false, code: 'disabled' });
    expect(s.authorize('publicar', 1)).toMatchObject({ ok: false, code: 'invalid' });
    const first = s.authorize('review', 1); expect(first).toMatchObject({ run: { state: 'pending', step: 'review' } });
    expect(s.authorize('review', 1)).toEqual(first);
    expect(s.authorize('plan', 2)).toMatchObject({ ok: false, code: 'quota' });
    s.as(peer); expect(s.call('get', { generationId: uid(1) })).toMatchObject({ ok: false, code: 'unavailable' });
  });
  it('no permite el paso de originalidad sin una comparación del borrador actual', () => {
    const s = setup(); s.write(essay);
    expect(s.authorize('originality', 1)).toMatchObject({ ok: false, code: 'conflict' });
    agent.checkAgentOriginality(s.ctx, { sessionId: BigInt(s.sessionId), draftVersion: 1 });
    expect(s.authorize('originality', 1)).toMatchObject({ run: { state: 'pending' } });
    expect(s.rows('agentAiRun')[0]!.refs).toEqual(['work:10', 'work:11']);
  });
});

describe('agente con Gemini: reclamar, terminar y aplicar', () => {
  it('solo el servicio reclama, reserva presupuesto una vez y vuelve a comprobar el borrador', () => {
    const s = setup(); s.write('El ciclo ciclo termina.');
    s.authorize('review', 1);
    expect(s.call('claim', { actor: owner.toHexString(), generationId: uid(1) })).toMatchObject({ ok: false, code: 'forbidden' });
    s.write('Cambié el borrador.');
    expect(s.claim(1)).toMatchObject({ ok: false, code: 'source_changed' });
    s.authorize('review', 2); // el primero sigue pendiente: un envío a la vez
    expect(s.rows('agentAiRun')).toHaveLength(1);
  });
  it('guarda sugerencias marcadas como generadas y rechaza las que salen del borrador', () => {
    const s = setup(); s.write('El ciclo ciclo termina.'); s.authorize('review', 1);
    const claimed = s.claim(1);
    expect(claimed).toMatchObject({ claimed: true, payload: { bot: 'Luis_BOT', draft: 'El ciclo ciclo termina.' }, key: { keyId: uid(901) } });
    expect(claimed.systemInstruction).toContain('Soy Luis_BOT');
    expect(s.claim(1)).toMatchObject({ claimed: false });
    expect(s.rows('aiReservation')).toHaveLength(1);
    const done = s.finish(1, { suggestions: [{ reason: 'Se repite', original: 'ciclo ciclo', replacement: 'ciclo' }] });
    expect(done).toMatchObject({ state: 'succeeded', applied: true });
    expect(s.rows('agentSuggestion').map((r) => r.reason)).toEqual(['Se repite (generado con Luis_BOT)']);
    expect(s.rows('aiReservation')[0]).toMatchObject({ status: 'consumed' });
    expect(s.finish(1, { suggestions: [] })).toMatchObject({ ok: false, code: 'conflict' });

    s.authorize('review', 2); s.claim(2);
    expect(s.finish(2, { suggestions: [{ reason: 'x', original: 'no aparece', replacement: 'y' }] })).toMatchObject({ state: 'failed', applied: false });
    expect(s.rows('agentSuggestion')).toHaveLength(1);
  });
  it('añade el resumen de estilo al perfil vigente y guarda el plan sin tocar el borrador', () => {
    const s = setup();
    s.authorize('style', 1); s.claim(1);
    expect(s.finish(1, { summary: 'Explica en pasos y registra resultados.', traits: ['Ordena con «primero» y «después»'] })).toMatchObject({ applied: true });
    expect(JSON.parse(s.rows('agentStyleSnapshot')[0]!.features as string).ai).toMatchObject({ summary: 'Explica en pasos y registra resultados.', runId: uid(1) });
    s.authorize('plan', 2); s.claim(2);
    expect(s.finish(2, { explanation: 'Pide describir un ciclo infinito.', approach: ['Define'], outline: ['Causa'], questions: ['¿Qué ejemplo propio tienes?'] }))
      .toMatchObject({ state: 'succeeded', applied: false, result: { outline: ['Causa'] } });
    expect(s.rows('agentSession')[0]!.draft).toBe('');
  });
  it('un envío sin respuesta queda incierto y el siguiente exige confirmar el posible consumo', () => {
    const s = setup(); s.authorize('style', 1); s.claim(1); s.tick(120);
    expect(s.call('get', { generationId: uid(1) })).toMatchObject({ state: 'unknown' });
    expect(s.authorize('style', 2)).toMatchObject({ ok: false, code: 'unknown_confirmation_required' });
    expect(s.authorize('style', 2, { acknowledgeUnknown: true })).toMatchObject({ run: { state: 'pending' } });
  });
});

describe('agente con Gemini: retención', () => {
  it('purga envíos de fuentes eliminadas y conserva el historial privado de un miembro dado de baja', () => {
    const s = setup(); s.write(essay); agent.checkAgentOriginality(s.ctx, { sessionId: BigInt(s.sessionId), draftVersion: 1 });
    s.authorize('originality', 1); s.claim(1); s.finish(1, { notes: [{ refKey: 'work:11', why: 'Ambos siguen el mismo libro.', question: '¿Qué te pasó a ti al probarlo?' }] });
    agent.purgeAgentSource(s.ctx.db, 'work', 11n); expect(s.rows('agentAiRun')).toHaveLength(0);
    s.authorize('style', 2); s.claim(2); s.finish(2, { summary: 'Escribe en pasos.', traits: [] });
    s.as(admin); remove_member(s.ctx, { identity: owner }); expect(s.rows('agentAiRun')).toHaveLength(1);
    s.as(owner); expect(s.authorize('style', 3)).toMatchObject({ ok: false });
  });
});
