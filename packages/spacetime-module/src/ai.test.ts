import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import { AI_CONSENT_VERSION, type AiPreparation } from '../../core/src/ai';
import { GUIDE_SECTIONS } from '../../core/src/guides';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import { ai_status, ai_key_status, ai_set_consent, ai_authorize_key, ai_commit_key, ai_delete_key, ai_prepare,
  ai_authorize_generation, ai_claim_generation, ai_finish_generation, ai_get_generation, ai_publish_generation, ai_list_generations, on_connect, set_ai_service, set_file_service } from './index';
import { purgeAiSource } from './aiHandlers';
const person = (digit: string) => Identity.fromString(digit.repeat(64));
const owner = person('a'); const alice = person('b'); const bob = person('c'); const removed = person('d'); const aiService = person('e'); const fileService = person('f');
const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = Record<string, unknown>;
const keyOf = (v: unknown) => typeof v === 'object' && v !== null && 'toHexString' in v ? (v as Identity).toHexString() : String(v);
function store(key: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[key]), row]));
  let next = 1000n;
  return new Proxy({ rows, iter: () => rows.values(), insert: (value: Row) => { const row: Row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) }; rows.set(keyOf(row[key]), row); return row; } }, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      return { find: (v: unknown) => rows.get(keyOf(v)), update: (row: Row) => { rows.set(keyOf(row[key]), row); return row; },
        delete: (v: unknown) => rows.delete(keyOf(v)), filter: (v: unknown) => [...rows.values()].filter((row) => keyOf(row[String(property)]) === keyOf(v)) };
    },
  });
}
function setup() {
  const timestamp = new Timestamp(1_790_000_000_000_000n);
  const keys: Record<string, string> = { member: 'identity', aiKey: 'actor', aiConsent: 'actor', noteDetail: 'noteId',
    assignmentDetail: 'assignmentId', workDetail: 'workId', evidenceDetail: 'evidenceId', contentStatus: 'key', aiPublication: 'generationId' };
  const initial: Record<string, Row[]> = {
    appConfig: [{ id: 0, owner }], authConfig: [{ id: 0, issuer: 'https://issuer.test', audiences: ['test'] }],
    member: [owner, alice, bob, removed].map((identity) => ({ identity, status: identity === removed ? 'removed' : 'active', isCreator: identity === owner })),
    fileServiceConfig: [{ id: 0, identity: fileService }], subject: [{ id: 1n }, { id: 2n }], term: [{ id: 11n, subjectId: 1n }, { id: 22n, subjectId: 2n }],
    note: [{ id: 1n, subjectId: 1n, title: 'Lógica', topic: 'Ciclos', body: 'Un ciclo repite instrucciones.\nContacto alumno@example.com; api_key=secret_test_value', version: 1, author: alice, visibility: 'group', source: 'teacher' },
      { id: 2n, subjectId: 1n, title: 'Personal', topic: 'Ciclos', body: 'Mi explicación privada', version: 1, author: alice, visibility: 'personal', source: 'student' },
      { id: 3n, subjectId: 1n, title: 'Sin parcial', topic: 'Ciclos', body: 'Texto', version: 1, author: alice, visibility: 'group', source: 'student' }],
    noteDetail: [{ noteId: 1n, termId: 11n }, { noteId: 2n, termId: 11n }],
    assignment: [{ id: 10n, subjectId: 1n, termId: 11n, version: 2, title: 'Consigna', instructions: 'Resolver ciclos', kind: 'tarea' }],
    activity: [{ id: 20n, subjectId: 1n, termId: 11n, version: 1, title: 'Clase', objective: 'Aprender ciclos', instructions: 'Construye un ciclo', topic: 'Ciclos' }],
    work: [{ id: 30n, assignmentId: 10n, version: 1, title: 'Solución', description: 'for (let i=0;i<10;i++) {}', createdBy: alice }],
    workDetail: [{ workId: 30n, topic: 'Ciclos', status: 'final' }],
    evidence: [{ id: 40n, activityId: 20n, author: alice, content: 'El ciclo termina cuando i llega a 10' }],
    studyGuide: [{ id: 50n, subjectId: 1n, termId: 11n, version: 1, title: 'Guía', topics: ['Ciclos'], sections: ['Repetir instrucciones'] }],
    guideSource: [{ id: 51n, guideId: 50n, kind: 'nota', refId: 1n, sourceVersion: 1, status: 'processed', reason: '' }],
  };
  const tables = new Map<string, ReturnType<typeof store>>();
  const db = new Proxy({}, { get: (_target, name: string) => {
    if (!tables.has(name)) tables.set(name, store(keys[name] ?? 'id', initial[name]));
    return tables.get(name);
  } });
  const state = { db, timestamp, sender: alice, env: {}, senderAuth: { jwt: { issuer: 'https://issuer.test', audience: ['test'], fullPayload: { email: 'x@example.com', email_verified: true } } } };
  const ctx = state as unknown as Parameters<typeof set_ai_service>[0];
  const proc = { withTx: (fn: (tx: typeof ctx) => unknown) => fn(ctx) } as unknown as Parameters<typeof ai_status>[0];
  const as = (identity: Identity) => { state.sender = identity; };
  const tick = (seconds: number) => { state.timestamp = new Timestamp(state.timestamp.microsSinceUnixEpoch + BigInt(seconds) * 1_000_000n); };
  const rows = (name: string) => [...(db as Record<string, ReturnType<typeof store>>)[name].rows.values()];
  const call = <T = Record<string, unknown>>(fn: typeof ai_status, input: unknown = {}) => {
    const result = JSON.parse(fn(proc, { payload: JSON.stringify(input) }));
    if (result?.ok === false) throw new Error(`${result.code}:${result.message ?? ''}`);
    return result as T;
  };
  const configure = (enabled = true, budget = 100_000) => { as(owner); set_ai_service(ctx, { identity: aiService, enabled, dailyTokenBudget: budget }); as(alice); };
  const configureKey = (n = 1) => {
    call(ai_set_consent, { version: AI_CONSENT_VERSION, accepted: true });
    call(ai_authorize_key, { intentId: uid(n), keyId: uid(n + 100), provider: 'gemini' });
    as(aiService); call(ai_commit_key, { actor: alice.toHexString(), intentId: uid(n), keyId: uid(n + 100), provider: 'gemini', ciphertext: 'Y2lwaGVydGV4dA==', iv: 'AAAAAAAAAAAAAAAA', masterVersion: 'v1' }); as(alice);
  };
  const prep = (n = 500, sources: Record<string, unknown>[] = [{ kind: 'note', refId: '1', topics: ['Ciclos'], includeUnplaced: false }]) =>
    call<AiPreparation>(ai_prepare, { id: uid(n), model: 'gemini-test', config: { questionCount: 1, types: ['single'], difficulty: 'basic' }, subjectId: '1', termId: '11', topics: ['Ciclos'], sources });
  const generation = (preparation: AiPreparation, n = 600) => ({ id: uid(n), preparationId: preparation.id, fingerprint: preparation.fingerprint,
    model: preparation.model, confirmed: true, config: { questionCount: 1, types: ['single'], difficulty: 'basic' } });
  const ready = () => { configure(); configureKey(); call(ai_set_consent, { version: AI_CONSENT_VERSION, accepted: true }); const preparation = prep(); return { preparation, request: generation(preparation) }; };
  const insert = (name: string, row: Row) => (db as Record<string, ReturnType<typeof store>>)[name].insert(row);
  return { ctx, call, as, rows, insert, tick, configure, configureKey, prep, generation, ready };
}

describe('EX1 IA: procedimientos reales y tablas privadas', () => {
  it('extrae adjuntos UTF8 autorizados, registra omisiones y detecta su sustitución antes del envío', () => {
    const s = setup(); const bytes = new TextEncoder().encode('const ejemplo = 123;');
    s.insert('resourceFile', { id: 'text-file', targetKind: 'note', targetId: 1n, name: 'codigo.ts', size: BigInt(bytes.length), contentType: 'text/plain', storageKey: 'stdb:text-file', etag: 'a' });
    s.insert('resourceFile', { id: 'pdf-file', targetKind: 'note', targetId: 1n, name: 'escaneo.pdf', size: 30n, contentType: 'application/pdf', storageKey: 'stdb:pdf-file', etag: 'b' });
    s.insert('resourceUpload', { id: 'text-file', state: 'ready', chunkCount: 1 }); s.insert('resourceChunk', { id: 'text-file:0', bytes });
    const prep = s.prep(); expect(prep.fragments.some((fragment) => fragment.text.includes('const ejemplo = 123;'))).toBe(true);
    expect(prep.omissions.some((omission) => omission.includes('formato no compatible'))).toBe(true);
    s.configure(); s.configureKey(); const request = s.generation(prep);
    s.call(ai_authorize_generation, request); s.rows('resourceFile')[0].etag = 'changed'; s.as(aiService);
    expect(() => s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() })).toThrow('cambió');
  });
  it('genera y publica una guía citada una sola vez; los borradores personales no pueden publicarse', () => {
    const s = setup(); s.configure(); s.configureKey();
    const config = { purpose: 'guide', questionCount: 1, types: ['single'], difficulty: 'basic' };
    const prep = s.call<AiPreparation>(ai_prepare, { id: uid(701), subjectId: '1', termId: '11', topics: ['Ciclos'], config, model: 'fake',
      sources: [{ kind: 'note', refId: '1', topics: ['Ciclos'], includeUnplaced: true }] });
    const request = { id: uid(702), preparationId: prep.id, fingerprint: prep.fingerprint, config, model: 'fake', confirmed: true };
    s.call(ai_authorize_generation, request); s.as(aiService); s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() });
    s.call(ai_finish_generation, { id: request.id, actor: alice.toHexString(), state: 'succeeded', result: { purpose: 'guide', title: 'Guía IA',
      sections: GUIDE_SECTIONS.map((section) => ({ heading: section.title, text: 'Desarrollo razonado.', citations: [prep.fragments[0]!.id] })) } });
    s.as(bob); expect(() => s.call(ai_publish_generation, { id: request.id })).toThrow('disponible');
    s.as(alice); expect(s.call<unknown[]>(ai_list_generations)).toHaveLength(1);
    const publication = s.call(ai_publish_generation, { id: request.id }); expect(s.call(ai_publish_generation, { id: request.id })).toEqual(publication);
    expect(s.rows('aiPublication')).toHaveLength(1); expect(s.rows('studyGuide').at(-1)?.title).toBe('Guía IA');
    expect(s.rows('guideSource').at(-1)).toMatchObject({ kind: 'nota', refId: 1n, sourceVersion: 1, status: 'processed' });
    const personal = s.call<AiPreparation>(ai_prepare, { id: uid(704), subjectId: '1', termId: '11', topics: ['Ciclos'], config, model: 'fake', sources: [{ kind: 'note', refId: '2', topics: ['Ciclos'], includeUnplaced: true }] });
    s.insert('aiGeneration', { ...s.rows('aiGeneration')[0], id: uid(703), preparationId: personal.id });
    expect(() => s.call(ai_publish_generation, { id: uid(703) })).toThrow('personales');
    purgeAiSource(s.ctx, 'note', 1n);
    expect(s.rows('aiPreparation').some((row) => row.id === prep.id)).toBe(false);
    expect(s.rows('aiGeneration').find((row) => row.id === request.id)).toMatchObject({ status: 'failed', resultJson: '' });
    expect(() => s.call(ai_get_generation, { id: request.id })).toThrow('disponible');
    expect(s.rows('studyGuide').some((row) => String(row.id) === publication.targetId)).toBe(true);
  });
  it('no habilita por defecto y devuelve solo metadatos de clave y actor DB', () => {
    const s = setup(); expect(s.call(ai_status)).toMatchObject({ actor: alice.toHexString(), enabled: false, configured: false, consented: false });
    s.configure(); s.configureKey(); expect(s.call(ai_key_status)).toMatchObject({ configured: true, provider: 'gemini', keyId: uid(101) });
    expect(JSON.stringify(s.call(ai_key_status))).not.toMatch(/ciphertext|AAAAAAAA/);
    s.as(removed); expect(() => s.call(ai_status)).toThrow('activo');
  });
  it('el propietario configura identidad exclusiva; servicio no adquiere membresía', () => {
    const s = setup(); expect(() => set_ai_service(s.ctx, { identity: aiService, enabled: true, dailyTokenBudget: 100_000 })).toThrow('propietario');
    s.as(owner); for (const identity of [owner, alice, fileService]) expect(() => set_ai_service(s.ctx, { identity, enabled: true, dailyTokenBudget: 100_000 })).toThrow('exclusiva');
    s.configure(); s.as(owner); expect(() => set_file_service(s.ctx, { identity: aiService })).toThrow('distintas');
    s.as(aiService); expect(() => on_connect(s.ctx, {})).not.toThrow(); expect(() => s.call(ai_status)).toThrow('activo');
  });
  it('no puede compartir identidad de IA con notificaciones ni mantenimiento', () => {
    const s = setup(); s.as(owner);
    const notifications = person('1'); const maintenance = person('2');
    s.insert('notificationServiceConfig', { id: 0, identity: notifications, enabled: true });
    s.insert('maintenanceService', { id: 0, identity: maintenance });
    for (const identity of [notifications, maintenance]) expect(() => set_ai_service(s.ctx, { identity, enabled: true, dailyTokenBudget: 100_000 })).toThrow('exclusiva');
  });
  it('la preparación de guía no revela referencias a originales personales inaccesibles', () => {
    const s = setup(); s.rows('note')[0].visibility = 'personal'; s.as(bob);
    const prep = s.prep(505, [{ kind: 'guide', refId: '50', topics: ['Ciclos'], includeUnplaced: false }]);
    expect(prep.sources[0].origins).toEqual([]);
    expect(prep.omissions.some((omission) => omission.includes('no está disponible'))).toBe(true);
  });
  it('impide confirmar intenciones ajenas, sustituciones antiguas y borrado revoca pendientes', () => {
    const s = setup(); s.configure(); s.call(ai_set_consent, { version: AI_CONSENT_VERSION, accepted: true }); s.call(ai_authorize_key, { intentId: uid(1), keyId: uid(101), provider: 'gemini' });
    const commit = { actor: alice.toHexString(), intentId: uid(1), keyId: uid(101), provider: 'gemini', ciphertext: 'Y2lwaGVydGV4dA==', iv: 'AAAAAAAAAAAAAAAA', masterVersion: 'v1' };
    expect(() => s.call(ai_commit_key, commit)).toThrow('servicio'); s.as(aiService);
    expect(() => s.call(ai_commit_key, { ...commit, actor: bob.toHexString() })).toThrow('intención');
    s.call(ai_commit_key, commit); s.call(ai_commit_key, commit); expect(s.rows('aiKey')).toHaveLength(1);
    expect(() => s.call(ai_commit_key, { ...commit, ciphertext: 'YWx0ZXJlZA==' })).toThrow('confirmada');
    s.as(alice); s.call(ai_authorize_key, { intentId: uid(2), keyId: uid(102), provider: 'gemini' }); s.call(ai_delete_key);
    s.as(aiService); expect(() => s.call(ai_commit_key, { ...commit, intentId: uid(2), keyId: uid(102) })).toThrow('intención');
    s.as(alice); expect(s.call(ai_key_status)).toMatchObject({ configured: false });
  });
  it('revocar consentimiento impide confirmar una intención y reemplazar clave cancela trabajo pendiente', () => {
    const s = setup(); const { request } = s.ready(); s.call(ai_authorize_generation, request);
    s.call(ai_authorize_key, { intentId: uid(2), keyId: uid(102), provider: 'gemini' });
    s.call(ai_set_consent, { version: AI_CONSENT_VERSION, accepted: false });
    s.as(aiService); expect(() => s.call(ai_commit_key, { actor: alice.toHexString(), intentId: uid(2), keyId: uid(102), provider: 'gemini', ciphertext: 'Y2lwaGVydGV4dA==', iv: 'AAAAAAAAAAAAAAAA', masterVersion: 'v1' })).toThrow('intención');
    s.as(alice); s.configureKey(3);
    expect(s.call(ai_key_status).keyId).toBe(uid(103));
    expect(s.rows('aiGeneration')[0].status).toBe('failed');
    expect(s.rows('aiReservation')[0].status).toBe('released');
  });
  it('rechaza intención vencida, consentimiento desactualizado y JSON excesivo', () => {
    const s = setup(); s.configure(); s.call(ai_set_consent, { version: AI_CONSENT_VERSION, accepted: true }); s.call(ai_authorize_key, { intentId: uid(1), keyId: uid(101), provider: 'gemini' }); s.tick(301); s.as(aiService);
    expect(() => s.call(ai_commit_key, { actor: alice.toHexString(), intentId: uid(1), keyId: uid(101), provider: 'gemini', ciphertext: 'Y2lwaGVydGV4dA==', iv: 'AAAAAAAAAAAAAAAA', masterVersion: 'v1' })).toThrow('venció');
    s.as(alice); expect(() => s.call(ai_set_consent, { version: 'old', accepted: true })).toThrow('inválido');
    expect(() => s.call(ai_prepare, { text: 'a'.repeat(140_000) })).toThrow('límite');
  });
  it('extrae las seis fuentes académicas; redacta y conserva procedencia sin adjuntos', () => {
    const s = setup(); const ids = [['note', 1], ['assignment', 10], ['activity', 20], ['work', 30], ['evidence', 40], ['guide', 50]];
    const prep = s.prep(500, ids.map(([kind, id]) => ({ kind, refId: String(id), topics: ['Ciclos'], includeUnplaced: false })));
    expect(prep.canGenerate).toBe(true); expect(prep.sources).toHaveLength(6);
    expect(prep.fragments.some((f) => f.text.includes('[correo retirado]'))).toBe(true);
    expect(JSON.stringify(prep)).not.toContain('secret_test_value'); expect(JSON.stringify(prep)).not.toContain('alumno@example.com');
    expect(prep.sources.find((source) => source.kind === 'guide')?.origins).toEqual([{ kind: 'note', refId: '1', version: 1 }]);
    expect(s.rows('aiPreparation')[0].json).toContain('[credencial retirada]');
  });
  it('guías relacionan originales sin leerlos y revalidan procedencia y estado', () => {
    const s = setup(); s.ready();
    s.rows('guideSource')[0].status = 'pending'; s.rows('guideSource')[0].reason = 'Falta comprobar';
    const preparation = s.prep(502, [{ kind: 'guide', refId: '50', topics: ['Ciclos'], includeUnplaced: false }]);
    expect(preparation.omissions.some((omission) => omission.includes('pendiente'))).toBe(true);
    expect(preparation.fragments.map((fragment) => fragment.text).join('')).not.toContain('Un ciclo repite');
    const request = s.generation(preparation); s.call(ai_authorize_generation, request);
    s.rows('guideSource')[0].status = 'processed'; s.as(aiService);
    expect(() => s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() })).toThrow('cambió');
    s.rows('guideSource')[0].status = 'pending'; s.rows('note')[0].version = 2;
    expect(() => s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() })).toThrow('cambió');
  });
  it('bloquea notas personales de tercero y exige incluir expresamente fuentes sin parcial', () => {
    const s = setup(); s.as(bob); expect(() => s.prep(500, [{ kind: 'note', refId: '2', topics: ['Ciclos'], includeUnplaced: true }])).toThrow('disponible');
    s.as(alice); const p = s.prep(501, [{ kind: 'note', refId: '3', topics: ['Ciclos'], includeUnplaced: false }]);
    expect(p.canGenerate).toBe(false); expect(p.sources[0].status).toBe('pending');
    expect(s.prep(502, [{ kind: 'note', refId: '3', topics: ['Ciclos'], includeUnplaced: true }]).canGenerate).toBe(true);
  });
  it('revalida fuentes y padres en claim y consulta; no devuelve resultados ajenos', () => {
    const s = setup(); const { request } = s.ready(); s.call(ai_authorize_generation, request);
    s.as(bob); expect(() => s.call(ai_get_generation, { id: request.id })).toThrow('disponible');
    s.as(alice); const note = s.rows('note')[0]; note.body = 'Cambio silencioso sin subir versión';
    s.as(aiService); expect(() => s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() })).toThrow('cambió');
    s.as(alice); expect(() => s.call(ai_get_generation, { id: request.id })).toThrow('cambió');
  });
  it('rechaza trabajos si su tarea padre cambia de materia', () => {
    const s = setup(); const p = s.prep(500, [{ kind: 'work', refId: '30', topics: ['Ciclos'], includeUnplaced: false }]);
    s.configure(); s.configureKey(); s.call(ai_set_consent, { version: AI_CONSENT_VERSION, accepted: true }); const req = s.generation(p); s.call(ai_authorize_generation, req);
    s.rows('assignment')[0].subjectId = 2n; s.as(aiService); expect(() => s.call(ai_claim_generation, { id: req.id, actor: alice.toHexString() })).toThrow('cambió');
  });
  it('rechaza fuentes retiradas y contenido padre retirado aunque su autor conserve lectura', () => {
    const s = setup();
    s.ctx.db.contentStatus.insert({ key: 'assignment:10', kind: 'assignment', targetId: 10n, withdrawnAt: s.ctx.timestamp, withdrawnBy: alice, reason: 'Retirada' });
    expect(() => s.prep(500, [{ kind: 'work', refId: '30', topics: ['Ciclos'], includeUnplaced: false }])).toThrow('disponible');
    s.ctx.db.contentStatus.insert({ key: 'note:1', kind: 'note', targetId: 1n, withdrawnAt: s.ctx.timestamp, withdrawnBy: alice, reason: 'Retirada' });
    expect(() => s.prep()).toThrow('disponible');
  });
  it('cambiar configuración requiere preparar de nuevo y retirar consentimiento cancela pendientes', () => {
    const s = setup(); const { request } = s.ready();
    expect(() => s.call(ai_authorize_generation, { ...request, config: { ...request.config, difficulty: 'advanced' } })).toThrow('cambió');
    s.call(ai_authorize_generation, request); s.call(ai_set_consent, { version: AI_CONSENT_VERSION, accepted: false });
    expect(s.rows('aiGeneration')[0].status).toBe('failed'); expect(s.rows('aiReservation')[0].status).toBe('released');
    expect(() => s.call(ai_authorize_key, { intentId: uid(2), keyId: uid(102), provider: 'gemini' })).toThrow('consentimiento');
  });
  it('detecta modificaciones de evidencia y cambios silenciosos de su actividad padre', () => {
    const s = setup(); s.ready();
    const p = s.prep(502, [{ kind: 'evidence', refId: '40', topics: ['Ciclos'], includeUnplaced: false }]);
    const request = s.generation(p, 605); s.call(ai_authorize_generation, request);
    const prior = s.rows('evidence')[0].content; s.rows('evidence')[0].content = 'Contenido distinto'; s.as(aiService);
    expect(() => s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() })).toThrow('cambió');
    s.rows('evidence')[0].content = prior; s.rows('activity')[0].instructions = 'Nueva consigna';
    expect(() => s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() })).toThrow('cambió');
  });
  it('generar exige política, consentimiento y preparación vigente sin consumos ocultos', () => {
    const s = setup(); const p = s.prep(); const req = s.generation(p); expect(() => s.call(ai_authorize_generation, req)).toThrow('habilitada');
    s.configure(); expect(() => s.call(ai_authorize_generation, req)).toThrow('consentimiento');
    s.configureKey(); s.call(ai_set_consent, { version: AI_CONSENT_VERSION, accepted: true }); s.tick(1801);
    expect(() => s.call(ai_authorize_generation, req)).toThrow('venció'); expect(s.rows('aiReservation')).toHaveLength(0);
  });
  it('reserva atómicamente, conserva UUID y solo reclama una vez', () => {
    const s = setup(); const { request } = s.ready();
    expect(s.call(ai_authorize_generation, request)).toMatchObject({ state: 'prepared' }); s.call(ai_authorize_generation, request);
    expect(s.rows('aiReservation')).toHaveLength(1); expect(() => s.call(ai_authorize_generation, { ...request, config: { ...request.config, questionCount: 2 } })).toThrow('UUID');
    expect(() => s.call(ai_authorize_generation, { ...request, id: uid(601) })).toThrow('curso');
    s.as(aiService); const claimed = s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() });
    expect(claimed).toMatchObject({ claimed: true, generation: { state: 'running' }, key: { keyId: uid(101) } });
    const replay = s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() }); expect(replay).toMatchObject({ claimed: false }); expect(replay.key).toBeUndefined();
  });
  it('estado incierto no se reenvía, conserva reserva y permite consultar tras reinicio', () => {
    const s = setup(); const { request } = s.ready(); s.call(ai_authorize_generation, request); s.as(aiService); s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() });
    s.tick(91); const replay = s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() }); expect(replay).toMatchObject({ claimed: false, generation: { state: 'unknown' } });
    expect(s.rows('aiReservation')[0].status).toBe('reserved'); s.as(alice); expect(s.call(ai_authorize_generation, request)).toMatchObject({ state: 'unknown' });
    expect(() => s.call(ai_authorize_generation, { ...request, id: uid(601) })).toThrow('consumo adicional');
    expect(s.call(ai_authorize_generation, { ...request, id: uid(601), acknowledgeUnknown: true })).toMatchObject({ state: 'prepared' });
    expect(s.rows('aiReservation')).toHaveLength(2);
  });
  it('valida referencias, respuestas y tamaño antes de persistir éxito; finaliza idempotente', () => {
    const s = setup(); const { request, preparation } = s.ready(); s.call(ai_authorize_generation, request); s.as(aiService); s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() });
    const result = { questions: [{ id: 'q1', type: 'single', text: '¿Qué hace un ciclo?', options: ['Repite', 'Borra', 'Duerme', 'Nada'].map((text, i) => ({ id: String(i), text })), correctOptionId: '0', explanation: 'Repite instrucciones.', topic: 'Ciclos', citations: [preparation.fragments[0].id] }] };
    expect(() => s.call(ai_finish_generation, { id: request.id, actor: alice.toHexString(), state: 'succeeded', result: { questions: [{ ...result.questions[0], citations: ['inventada'] }] } })).toThrow('inválidas');
    const finish = { id: request.id, actor: alice.toHexString(), state: 'succeeded', result, usage: { inputTokens: 20_000, outputTokens: 4_000 } }; s.call(ai_finish_generation, finish); s.call(ai_finish_generation, finish);
    expect(s.rows('aiGeneration')[0].status).toBe('succeeded'); expect(s.rows('aiReservation')[0].status).toBe('consumed');
    expect(s.rows('aiReservation')[0].estimatedTokens).toBe(24_000);
    s.as(alice); expect(s.call(ai_get_generation, { id: request.id })).toMatchObject({ state: 'succeeded', result, usage: finish.usage });
  });
  it('borrar clave invalida la generación pendiente y una baja bloquea el servicio', () => {
    const s = setup(); const { request } = s.ready(); s.call(ai_authorize_generation, request); s.call(ai_delete_key);
    expect(s.rows('aiGeneration')[0].status).toBe('failed'); expect(s.rows('aiReservation')[0].status).toBe('released');
    s.rows('member').find((row) => (row.identity as Identity).isEqual(alice))!.status = 'removed'; s.as(aiService);
    expect(() => s.call(ai_claim_generation, { id: request.id, actor: alice.toHexString() })).toThrow('activo');
  });
  it('limita cinco solicitudes por hora aun cuando fallen y respeta presupuesto estimado', () => {
    const s = setup(); const { request } = s.ready();
    for (let i = 0; i < 5; i++) { const id = uid(600 + i); s.as(alice); s.call(ai_authorize_generation, { ...request, id }); s.as(aiService); s.call(ai_claim_generation, { id, actor: alice.toHexString() }); s.call(ai_finish_generation, { id, actor: alice.toHexString(), state: 'failed', errorCode: 'provider', errorMessage: 'Rechazo simulado' }); }
    expect(s.rows('aiReservation').every((row) => row.status === 'consumed')).toBe(true);
    s.as(alice); expect(() => s.call(ai_authorize_generation, { ...request, id: uid(606) })).toThrow('límite');
    s.tick(3601); s.configure(true, 100); expect(() => s.call(ai_authorize_generation, { ...request, id: uid(607) })).toThrow('venció');
    const fresh = s.prep(501); expect(() => s.call(ai_authorize_generation, s.generation(fresh, 607))).toThrow('presupuesto');
  });
});
