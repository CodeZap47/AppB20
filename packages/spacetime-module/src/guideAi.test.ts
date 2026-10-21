import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import { AI_CONSENT_VERSION } from '../../core/src/ai';
import { GUIDE_SECTIONS } from '../../core/src/guides';
import type { GuideAiDraft, GuideAiPrepareInput } from '../../core/src/guideAi';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import { guide_ai, update_guide_v2, type Ctx } from './index';
import { guideAiSourceAvailability } from './guideAiHandlers';
import { addGuideSourcesV3, refreshGuideSourceV3, restoreGuideVersion, reviewGuideV3, updateGuideSourceV3 } from './knowledgeHandlers';

const person = (digit: string) => Identity.fromString(digit.repeat(64));
const alice = person('a'); const bob = person('b'); const removed = person('c'); const service = person('d'); const owner = person('e');
const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = Record<string, unknown>;
const keyOf = (value: unknown) => typeof value === 'object' && value !== null && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function tableStore(key: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[key]), row])); let next = initial.reduce((max, row) => typeof row.id === 'bigint' && row.id >= max ? row.id + 1n : max, 1n);
  return new Proxy({ rows, iter: () => rows.values(), insert: (value: Row) => {
    const row: Row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) }; if (rows.has(keyOf(row[key]))) throw new Error('Duplicate key'); rows.set(keyOf(row[key]), row); return row;
  } }, { get(target, name) {
    if (name in target) return target[name as keyof typeof target];
    return { find: (value: unknown) => rows.get(keyOf(value)), update: (row: Row) => { rows.set(keyOf(row[key]), { ...row }); return row; },
      delete: (value: unknown) => rows.delete(keyOf(value)), filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[String(name)]) === keyOf(value)) };
  } });
}
function setup() {
  const at = new Timestamp(1_790_000_000_000_000n); const fileHash = 'a'.repeat(64);
  const initial: Record<string, Row[]> = {
    appConfig: [{ id: 0, owner }], authConfig: [{ id: 0, issuer: 'https://issuer.test', audiences: ['test'] }],
    member: [alice, bob, removed].map((identity) => ({ identity, status: identity.isEqual(removed) ? 'removed' : 'active', isCreator: false })),
    subject: [{ id: 1n }], term: [{ id: 11n, subjectId: 1n }, { id: 12n, subjectId: 1n }],
    aiServiceConfig: [{ id: 0, identity: service, enabled: true, dailyTokenBudget: 100_000 }],
    aiConsent: [alice, bob].map((actor) => ({ actor, version: AI_CONSENT_VERSION, accepted: true, updatedAt: at })),
    aiKey: [alice, bob].map((actor) => ({ actor, keyId: uid(actor.isEqual(alice) ? 901 : 902), provider: 'gemini', ciphertext: 'private-ciphertext', iv: 'AAAAAAAAAAAAAAAA', masterVersion: 'v1', updatedAt: at })),
    note: [{ id: 1n, subjectId: 1n, title: 'Nota compartida', topic: 'Tema', body: 'Un ciclo repite instrucciones.', visibility: 'group', version: 1, author: alice },
      { id: 2n, subjectId: 1n, title: 'Nota privada', topic: 'Tema', body: 'Contenido privado', visibility: 'personal', version: 1, author: alice }],
    noteDetail: [{ noteId: 1n, termId: 11n }, { noteId: 2n, termId: 11n }],
    assignment: [{ id: 10n, subjectId: 1n, termId: 11n, version: 1, title: 'Consigna', instructions: 'Explica ciclos', kind: 'tarea' }],
    activity: [{ id: 20n, subjectId: 1n, termId: 11n, version: 1, title: 'Actividad', topic: 'Tema', objective: 'Comprender ciclos', instructions: 'Implementa un ciclo' }],
    evidence: [{ id: 21n, activityId: 20n, author: bob, content: 'Evidencia seleccionada de ciclo terminado' }, { id: 22n, activityId: 20n, author: bob, content: 'Evidencia no seleccionada' }],
    question: [{ id: 30n, subjectId: 1n, title: '¿Cómo funciona?', body: '¿Cómo termina un ciclo?', topic: 'Tema', author: alice, status: 'open' }],
    answer: [{ id: 31n, questionId: 30n, body: 'Finaliza cuando su condición es falsa.', author: bob }],
    resourceFile: [{ id: 'file-1', targetKind: 'note', targetId: 1n, name: 'ejemplo.txt', size: 120n, contentType: 'text/plain', storageKey: 'stdb:file-1', etag: fileHash, createdAt: at, uploadedBy: alice }],
    resourceUpload: [{ id: 'file-1', state: 'ready', sha256: fileHash }],
    studyGuide: [{ id: 80n, subjectId: 1n, termId: 11n, title: 'Manual', topics: ['Tema'], sections: Array(8).fill('Texto manual'), version: 1, createdBy: alice, updatedBy: alice, createdAt: at, updatedAt: at }],
  };
  const keys: Record<string, string> = { member: 'identity', aiConsent: 'actor', aiKey: 'actor', noteDetail: 'noteId', evidenceDetail: 'evidenceId', assignmentDetail: 'assignmentId', contentStatus: 'key', resourceVersion: 'key', guideAiProvenance: 'key' };
  const tables = new Map<string, ReturnType<typeof tableStore>>();
  const db = new Proxy({}, { get: (_target, name: string) => { if (!tables.has(name)) tables.set(name, tableStore(keys[name] ?? 'id', initial[name])); return tables.get(name); } });
  const state = { db, sender: alice, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://issuer.test', audience: ['test'], fullPayload: { email: 'member@example.com', email_verified: true } } } };
  const ctx = state as unknown as Ctx;
  const proc = { withTx: (fn: (tx: Ctx) => unknown) => fn(ctx) } as unknown as Parameters<typeof guide_ai>[0];
  const rows = (name: string) => [...(db as Record<string, ReturnType<typeof tableStore>>)[name].rows.values()];
  const call = <T = GuideAiDraft>(action: string, input: Record<string, unknown> = {}) => JSON.parse(guide_ai(proc, { payload: JSON.stringify({ action, ...input }) })) as T;
  const as = (identity: Identity) => { state.sender = identity; };
  const tick = (seconds: number) => { state.timestamp = new Timestamp(state.timestamp.microsSinceUnixEpoch + BigInt(seconds) * 1_000_000n); };
  const input: GuideAiPrepareInput = { purpose: 'study_guide', subjectId: '1', termId: '11', title: 'Guía de ciclos', topics: ['Tema'], maxOutputTokens: 1500,
    sources: [{ kind: 'note', refId: '1', topics: ['Tema'], includeUnplaced: false }] };
  const prepare = (n = 1, change: Partial<GuideAiPrepareInput> = {}) => call('prepare', { id: uid(n), model: 'gemini-3.8-flash', input: { ...input, ...change } });
  const authorize = (draft: GuideAiDraft, n = 100, extra: Record<string, unknown> = {}) => call<{ draft: GuideAiDraft }>('authorizeStep', { id: draft.id, expectedRevision: draft.revision,
    generationId: uid(n), confirmed: true, allowNew: true, model: draft.preparation.model, fingerprint: draft.preparation.fingerprint, ...extra }).draft;
  const claim = (draft: GuideAiDraft, n = 100) => { as(service); const result = call<{ claimed: boolean; draft: GuideAiDraft; key?: unknown }>('claimStep', { actor: alice.toHexString(), id: draft.id, generationId: uid(n) }); as(alice); return result; };
  const result = (draft: GuideAiDraft, citation = draft.preparation.fragments[0]!.id) => ({ title: 'Guía generada', sections: GUIDE_SECTIONS.map((section) => ({ id: section.id, content: `Texto para ${section.title}`, citations: [citation] })) });
  const finish = (draft: GuideAiDraft, n = 100, extra: Record<string, unknown> = {}) => { as(service); const next = call('finishStep', { actor: alice.toHexString(), id: draft.id, generationId: uid(n), state: 'succeeded', result: result(draft), ...extra }); as(alice); return next; };
  const ready = (n = 1, generation = 100) => { const prep = prepare(n); const authorized = authorize(prep, generation); claim(authorized, generation); return finish(authorized, generation); };
  return { ctx, call, rows, as, tick, input, prepare, authorize, claim, result, finish, ready, fileHash };
}

describe('Guías IA: servidor privado, cuotas compartidas y publicación atómica', () => {
  it('aísla borradores y transcripciones; lista solo resúmenes y bloquea bajas', () => {
    const s = setup(); const draft = s.prepare(); const listed = s.call<Record<string, unknown>[]>('listDrafts');
    expect(listed[0]).toMatchObject({ id: draft.id, completedSteps: 0, totalSteps: 1 }); expect(JSON.stringify(listed)).not.toContain('repite instrucciones');
    s.as(bob); expect(s.call('listDrafts')).toEqual([]); expect(() => s.call('getDraft', { id: draft.id })).toThrow('disponible');
    s.as(removed); expect(() => s.call('listDrafts')).toThrow('activo'); s.as(service); expect(() => s.call('listDrafts')).toThrow('activo');
  });
  it('solo usa notas del grupo, evidencias seleccionadas y respuestas públicas; fija clasificación y versiones', () => {
    const s = setup(); expect(() => s.prepare(2, { sources: [{ kind: 'note', refId: '2', topics: ['Tema'], includeUnplaced: false }] })).toThrow('compartido');
    const draft = s.prepare(3, { sources: [{ kind: 'activity', refId: '20', topics: ['Tema'], includeUnplaced: false, evidenceIds: ['21'] }, { kind: 'question', refId: '30', topics: ['Tema'], includeUnplaced: true }] });
    const text = JSON.stringify(draft.preparation.fragments); expect(text).toContain('Evidencia seleccionada'); expect(text).not.toContain('Evidencia no seleccionada'); expect(text).toContain('condición es falsa');
    expect(() => s.prepare(4, { termId: '12' })).toThrow('clasificación');
    s.rows('answer')[0]!.body = 'Respuesta corregida'; expect(() => s.authorize(draft)).toThrow('cambió');
  });
  it('ata la transcripción a archivo, hash y versión; conserva localizadores y reintentos', () => {
    const s = setup(); const transcript = { id: uid(50), fileId: 'file-1', fileHash: s.fileHash, targetKind: 'note', targetId: '1', targetVersion: 1, text: 'for (;;) {}',
      segments: [{ id: 'line-1', text: 'for (;;) {}', locator: { kind: 'lines', start: 1, end: 1 } }], omissions: [], reviewed: true };
    expect(s.call<Record<string, unknown>>('fileInfo', { fileId: 'file-1' })).toMatchObject({ fileHash: s.fileHash, targetVersion: 1 });
    s.call('saveTranscription', transcript); s.tick(2); s.call('saveTranscription', transcript); expect(s.rows('guideAiTranscription')).toHaveLength(1);
    expect(() => s.call('saveTranscription', { ...transcript, id: uid(51), fileHash: 'b'.repeat(64) })).toThrow('huella');
    expect(() => s.call('saveTranscription', { ...transcript, id: uid(52), targetVersion: 2 })).toThrow('cambió');
    const draft = s.prepare(2, { sources: [{ ...s.input.sources[0]!, transcriptionIds: [uid(50)] }] });
    expect(draft.preparation.fragments.some((fragment) => fragment.origins.some((origin) => origin.fileId === 'file-1' && origin.locator?.start === 1))).toBe(true);
    s.rows('note')[0]!.version = 2; expect(s.call('getDraft', { id: draft.id }).id).toBe(draft.id); expect(() => s.authorize(draft)).toThrow('cambió');
    s.as(bob); expect(() => s.call('getTranscription', { id: uid(50) })).toThrow('disponible');
  });
  it('un solo claim alcanza al proveedor y contabiliza en las cuotas de EX-1', () => {
    const s = setup(); const draft = s.prepare(); const authorized = s.authorize(draft); expect(s.rows('aiReservation')).toHaveLength(0);
    expect(s.claim(authorized).claimed).toBe(true); expect(s.claim(authorized).claimed).toBe(false); expect(s.rows('aiReservation')).toHaveLength(1);
    const other = s.prepare(2); const next = s.authorize(other, 101); expect(() => s.claim(next, 101)).toThrow('en curso');
    s.as(alice); expect(() => s.call('finishStep', { id: draft.id, actor: alice.toHexString(), generationId: uid(100), state: 'failed' })).toThrow('servicio');
  });
  it('exige volver a confirmar si cambió la clave y no acepta replay con otra huella', () => {
    const s = setup(); const draft = s.authorize(s.prepare()); s.rows('aiKey')[0]!.keyId = uid(999);
    expect(() => s.claim(draft)).toThrow('clave cambió'); s.as(alice);
    expect(() => s.authorize(draft, 100, { fingerprint: 'x'.repeat(64) })).toThrow('vista previa');
  });
  it('resultado incierto persiste tras recargar y solo autoriza otra llamada con advertencia expresa', () => {
    const s = setup(); const draft = s.authorize(s.prepare()); s.claim(draft); s.tick(91);
    const unknown = s.call('getDraft', { id: draft.id }); expect(unknown.state).toBe('unknown'); expect(s.rows('aiReservation')[0]!.status).toBe('reserved');
    expect(() => s.authorize(unknown, 101)).toThrow('consumo adicional');
    const another = s.prepare(2); expect(() => s.authorize(another, 102)).toThrow('consumo adicional');
    const accepted = s.authorize(unknown, 101, { acknowledgeUnknown: true }); expect(s.claim(accepted, 101).claimed).toBe(true);
  });
  it('rechaza citas falsas como fallo persistente sin reenviar y conserva pasos anteriores', () => {
    const s = setup(); const draft = s.authorize(s.prepare()); s.claim(draft); const failed = s.finish(draft, 100, { result: s.result(draft, 'inventada') });
    expect(failed.state).toBe('failed'); expect(failed.steps[0]!.state).toBe('failed'); expect(s.rows('aiReservation')[0]!.status).toBe('consumed');
    expect(s.claim(failed).claimed).toBe(false); expect(s.rows('aiGeneration')).toHaveLength(1);
  });
  it('publica una vez, conserva ID en nueva versión, detecta conflicto y asigna revisión al texto leído', () => {
    const s = setup(); const ready = s.ready();
    const publication = { id: ready.id, expectedRevision: ready.revision, requestId: uid(200), guideId: '80', expectedVersion: 1 };
    const published = s.call('publish', publication); s.call('publish', publication);
    expect(published.publishedGuideId).toBe('80'); expect(s.rows('studyGuide')).toHaveLength(1); expect(s.ctx.db.studyGuide.id.find(80n)!.version).toBe(2);
    expect(s.rows('guideVersion')).toHaveLength(2); expect(s.rows('guideAiProvenance')).toHaveLength(1); expect(s.rows('changeLog').filter((row) => row.entity === 'study_guide')).toHaveLength(1);
    s.as(bob); reviewGuideV3(s.ctx, { guideId: 80n, expectedVersion: 2, verdict: 'approved', comment: 'Verifiqué las ocho secciones y sus fuentes.' });
    expect(() => reviewGuideV3(s.ctx, { guideId: 80n, expectedVersion: 1, verdict: 'approved', comment: 'Versión antigua' })).toThrow('cambió');
    expect(() => reviewGuideV3(s.ctx, { guideId: 80n, expectedVersion: 2, verdict: 'changes', comment: 'Otra revisión' })).toThrow('no se sobrescribe');
    restoreGuideVersion(s.ctx, { guideId: 80n, version: 2, expectedVersion: 2 });
    expect(s.ctx.db.studyGuide.id.find(80n)!.version).toBe(3); expect(s.ctx.db.guideAiProvenance.key.find('80:3')).toBeDefined(); expect(s.rows('guideReview')[0]!.guideVersion).toBe(2);
  });
  it('mantiene borrador si cambia una fuente; cancelar bloquea pasos pendientes y publicar exige versión esperada', () => {
    const s = setup(); const ready = s.ready(); s.rows('note')[0]!.body = 'Nueva explicación';
    expect(() => s.call('publish', { id: ready.id, expectedRevision: ready.revision, requestId: uid(200) })).toThrow('Conservamos el borrador'); expect(s.rows('studyGuide')).toHaveLength(1);
    expect(s.call('getDraft', { id: ready.id }).result).toBeDefined();
    const next = s.prepare(2); const authorized = s.authorize(next, 101); const cancelled = s.call('cancelDraft', { id: next.id, expectedRevision: authorized.revision });
    expect(cancelled.state).toBe('cancelled'); expect(() => s.claim(cancelled, 101)).toThrow('cancelado');
  });
  it('cierra cambios de fuentes sin versión y refrescar exige reprocesamiento', () => {
    const s = setup(); addGuideSourcesV3(s.ctx, { guideId: 80n, expectedVersion: 1, sources: [{ kind: 'nota', refId: 1n }] });
    const sourceId = s.rows('guideSource')[0]!.id as bigint;
    expect(() => updateGuideSourceV3(s.ctx, { sourceId, expectedVersion: 1, status: 'processed', reason: '', topics: ['Tema'] })).toThrow('cambió');
    updateGuideSourceV3(s.ctx, { sourceId, expectedVersion: 2, status: 'processed', reason: '', topics: ['Tema'] });
    s.rows('note')[0]!.version = 2; refreshGuideSourceV3(s.ctx, { sourceId, expectedVersion: 3 });
    expect(s.rows('guideSource')[0]).toMatchObject({ sourceVersion: 2, status: 'pending' });
  });
  it('persiste lotes y continúa después de agotar cuota sin repetir resúmenes enviados', () => {
    const s = setup(); s.rows('note')[0]!.body = Array.from({ length: 23 }, (_, index) => `Bloque ${index}: ${String(index).repeat(3700).slice(0, 3700)}`).join('\n');
    let draft = s.prepare(); expect(draft.steps.filter((step) => step.kind === 'summary').length).toBeGreaterThan(1);
    for (let index = 0; index < 2; index++) {
      draft = s.authorize(draft, 100 + index); s.claim(draft, 100 + index);
      const step = draft.steps.find((entry) => entry.state !== 'succeeded')!; const batch = draft.preparation.batches.find((entry) => entry.id === step.batchId)!;
      draft = s.finish(draft, 100 + index, { result: { paragraphs: [{ text: `Resumen ${index}`, citations: [batch.fragmentIds[0]] }] } });
    }
    expect(draft.completedSteps).toBe(2);
    for (let index = 0; index < 3; index++) s.ctx.db.aiReservation.insert({ id: uid(800 + index), actor: alice, estimatedTokens: 1, status: 'consumed', createdAt: s.ctx.timestamp });
    draft = s.authorize(draft, 102); expect(() => s.claim(draft, 102)).toThrow('límite compartido'); s.as(alice);
    expect(s.call('getDraft', { id: draft.id }).completedSteps).toBe(2); s.tick(3601);
    const alreadySent = s.rows('aiGeneration').map((entry) => entry.id);
    while (draft.state !== 'ready') {
      const index = 100 + draft.completedSteps; if (draft.steps.find((entry) => entry.state !== 'succeeded')?.generationId !== uid(index)) draft = s.authorize(draft, index);
      const claim = s.claim(draft, index); expect(claim.claimed).toBe(true);
      const step = draft.steps.find((entry) => entry.state !== 'succeeded')!;
      if (step.kind === 'summary') {
        const batch = draft.preparation.batches.find((entry) => entry.id === step.batchId)!;
        draft = s.finish(draft, index, { result: { paragraphs: [{ text: 'Resumen posterior', citations: [batch.fragmentIds[0]] }] } });
      } else {
        const summaryStep = draft.steps.find((entry) => entry.kind === 'summary')!;
        const citation = (summaryStep.result as { paragraphs: { citations: string[] }[] }).paragraphs[0]!.citations[0]!;
        draft = s.finish(draft, index, { result: s.result(draft, citation) });
      }
    }
    expect(draft.completedSteps).toBe(draft.totalSteps); expect(s.rows('aiGeneration').filter((entry) => alreadySent.includes(entry.id))).toHaveLength(2);
  });
  it('fuentes retiradas dejan de autorizar consulta de contenido aunque la lista conserve el borrador', () => {
    const s = setup(); const draft = s.prepare(); s.ctx.db.contentStatus.insert({ key: 'note:1', kind: 'note', targetId: 1n, withdrawnAt: s.ctx.timestamp, withdrawnBy: alice, reason: 'Retirada' });
    expect(() => s.call('getDraft', { id: draft.id })).toThrow('disponible'); expect(s.call<unknown[]>('listDrafts')).toHaveLength(1);
    s.as(bob); expect(() => s.call('getDraft', { id: draft.id })).toThrow('disponible');
  });
  it('un rechazo explícito consume una solicitud; la cancelación de una llamada en curso guarda su resultado sin iniciar otras', () => {
    const s = setup(); let draft = s.authorize(s.prepare()); s.claim(draft);
    draft = s.finish(draft, 100, { state: 'failed', result: undefined, errorCode: 'provider_rejected', errorMessage: 'El proveedor rechazó la solicitud.' });
    expect(draft.state).toBe('failed'); expect(s.rows('aiReservation')[0]!.status).toBe('consumed');
    draft = s.authorize(draft, 101); const claim = s.claim(draft, 101); draft = s.call('cancelDraft', { id: draft.id, expectedRevision: claim.draft.revision });
    draft = s.finish(draft, 101); expect(draft.state).toBe('cancelled'); expect(draft.steps[0]!.state).toBe('succeeded'); expect(s.rows('aiGeneration')).toHaveLength(2);
    expect(() => s.authorize(draft, 102)).toThrow('pasos pendientes');
  });
  it('publicación distingue preparada y citada; evidencia retirada elimina cobertura sin retirar su actividad', () => {
    const s = setup(); let draft = s.prepare(1, { sources: [{ kind: 'activity', refId: '20', topics: ['Tema'], includeUnplaced: false }, { kind: 'evidence', refId: '21', topics: ['Tema'], includeUnplaced: false }] });
    draft = s.authorize(draft); s.claim(draft);
    const fragment = draft.preparation.fragments.find((entry) => entry.origins.some((origin) => origin.kind === 'evidence'))!;
    draft = s.finish(draft, 100, { result: s.result(draft, fragment.id) });
    s.call('publish', { id: draft.id, expectedRevision: draft.revision, requestId: uid(200), guideId: '80', expectedVersion: 1 });
    expect(s.rows('guideSource')).toHaveLength(1); expect(s.rows('guideSource')[0]!.status).toBe('processed');
    expect(guideAiSourceAvailability(s.ctx.db, alice)[0]).toMatchObject({ available: true, outdated: false });
    s.ctx.db.evidenceDetail.insert({ evidenceId: 21n, version: 2, updatedBy: alice, updatedAt: s.ctx.timestamp });
    expect(guideAiSourceAvailability(s.ctx.db, alice)[0]).toMatchObject({ available: true, outdated: true });
    s.ctx.db.contentStatus.insert({ key: 'evidence:21', kind: 'evidence', targetId: 21n, withdrawnAt: s.ctx.timestamp, withdrawnBy: bob, reason: 'Retirada' });
    expect(guideAiSourceAvailability(s.ctx.db, alice)[0]).toMatchObject({ available: false });
    const provenance = s.call<{ fragments: { text: string }[]; unavailableFragmentIds: string[] }>('getProvenance', { guideId: '80', version: 2 });
    expect(provenance.fragments[0]!.text).toBe('[Fuente no disponible]'); expect(provenance.unavailableFragmentIds).toContain(fragment.id);
  });
  it('filtra texto de procedencia que dejó de compartirse y conserva el aviso tras editar una guía publicada', () => {
    const s = setup(); const draft = s.ready(); s.call('publish', { id: draft.id, expectedRevision: draft.revision, requestId: uid(200), guideId: '80', expectedVersion: 1 });
    update_guide_v2(s.ctx, { guideId: 80n, expectedVersion: 2, subjectId: 1n, termId: 11n, title: 'Editada', topics: ['Tema'], sections: Array(8).fill('Nuevo texto editado') });
    const edited = s.call<{ editedAfterGeneration: boolean; citations: { content: string }[] }>('getProvenance', { guideId: '80', version: 3 });
    expect(edited.editedAfterGeneration).toBe(true); expect(edited.citations[0]!.content).toBe('Nuevo texto editado');
    s.rows('note')[0]!.visibility = 'personal';
    const provenance = s.call<{ sources: { available: boolean; title: string }[]; fragments: { text: string }[] }>('getProvenance', { guideId: '80', version: 3 });
    expect(provenance.sources[0]).toMatchObject({ available: false, title: 'Fuente no disponible' }); expect(JSON.stringify(provenance)).not.toContain('repite instrucciones');
    expect(guideAiSourceAvailability(s.ctx.db, alice)[0]!.available).toBe(false); s.as(removed); expect(guideAiSourceAvailability(s.ctx.db, removed)).toEqual([]);
  });
  it('una respuesta pública citada se desactualiza y su retirada quita cobertura aunque la pregunta siga publicada', () => {
    const s = setup(); let draft = s.prepare(1, { sources: [{ kind: 'question', refId: '30', topics: ['Tema'], includeUnplaced: true }] });
    draft = s.authorize(draft); s.claim(draft);
    const fragment = draft.preparation.fragments.find((entry) => entry.origins.some((origin) => origin.field.startsWith('respuesta:31:')))!;
    draft = s.finish(draft, 100, { result: s.result(draft, fragment.id) });
    s.call('publish', { id: draft.id, expectedRevision: draft.revision, requestId: uid(200), guideId: '80', expectedVersion: 1 });
    expect(guideAiSourceAvailability(s.ctx.db, alice)[0]).toMatchObject({ available: true, outdated: false });
    s.ctx.db.resourceVersion.insert({ key: 'answer:31', targetKind: 'answer', targetId: 31n, version: 2 });
    expect(guideAiSourceAvailability(s.ctx.db, alice)[0]).toMatchObject({ available: true, outdated: true });
    s.ctx.db.contentStatus.insert({ key: 'answer:31', kind: 'answer', targetId: 31n, withdrawnAt: s.ctx.timestamp, withdrawnBy: bob, reason: 'Retirada' });
    expect(guideAiSourceAvailability(s.ctx.db, alice)[0]!.available).toBe(false);
    const provenance = s.call<{ fragments: { text: string }[] }>('getProvenance', { guideId: '80', version: 2 }); expect(provenance.fragments[0]!.text).toBe('[Fuente no disponible]');
  });
  it('el adjunto retirado de la versión actual conserva su cita histórica y la marca de desactualización', () => {
    const s = setup(); const transcript = { id: uid(50), fileId: 'file-1', fileHash: s.fileHash, targetKind: 'note', targetId: '1', targetVersion: 1, text: 'Texto del archivo histórico',
      segments: [{ id: 'line-1', text: 'Texto del archivo histórico', locator: { kind: 'lines', start: 1, end: 1 } }], omissions: [], reviewed: true };
    s.call('saveTranscription', transcript); let draft = s.prepare(1, { sources: [{ ...s.input.sources[0]!, transcriptionIds: [uid(50)] }] });
    draft = s.authorize(draft); s.claim(draft); const fragment = draft.preparation.fragments.find((entry) => entry.origins.some((origin) => origin.fileId))!;
    draft = s.finish(draft, 100, { result: s.result(draft, fragment.id) }); s.call('publish', { id: draft.id, expectedRevision: draft.revision, requestId: uid(200), guideId: '80', expectedVersion: 1 });
    s.ctx.db.noteVersion.insert({ id: 0n, noteId: 1n, version: 1, subjectId: 1n, termId: 11n, session: '', topic: 'Tema', title: 'Nota compartida', body: 'Un ciclo repite instrucciones.', tags: [], visibility: 'group', source: 'student', author: alice,
      assignmentIds: [], activityIds: [], questionIds: [], attachmentIds: ['file-1'], editedBy: alice, editedAt: s.ctx.timestamp, restoredFromVersion: undefined });
    s.rows('resourceFile')[0]!.removedAt = s.ctx.timestamp; s.rows('note')[0]!.version = 2;
    expect(guideAiSourceAvailability(s.ctx.db, alice)[0]).toMatchObject({ available: true, outdated: true });
    const provenance = s.call<{ fragments: { text: string }[] }>('getProvenance', { guideId: '80', version: 2 }); expect(provenance.fragments[0]!.text).toBe(transcript.text);
  });
  it('asignar un parcial compatible mantiene cobertura histórica; reclasificar fuera del alcance la retira', () => {
    const s = setup(); s.ctx.db.noteDetail.noteId.delete(1n);
    let draft = s.prepare(1, { sources: [{ kind: 'note', refId: '1', topics: ['Tema'], includeUnplaced: true }] });
    draft = s.authorize(draft); s.claim(draft); draft = s.finish(draft);
    s.call('publish', { id: draft.id, expectedRevision: draft.revision, requestId: uid(200), guideId: '80', expectedVersion: 1 });
    s.ctx.db.noteDetail.insert({ noteId: 1n, termId: 11n, session: '', assignmentIds: [], activityIds: [], questionIds: [], publishedFromId: undefined, publishedFromVersion: undefined });
    expect(guideAiSourceAvailability(s.ctx.db, alice)[0]).toMatchObject({ available: true, outdated: true });
    expect(s.call<{ fragments: { text: string }[] }>('getProvenance', { guideId: '80', version: 2 }).fragments[0]!.text).toContain('repite instrucciones');
    s.ctx.db.noteDetail.noteId.update({ ...s.ctx.db.noteDetail.noteId.find(1n)!, termId: 12n });
    expect(guideAiSourceAvailability(s.ctx.db, alice)[0]!.available).toBe(false);
    expect(s.call<{ fragments: { text: string }[] }>('getProvenance', { guideId: '80', version: 2 }).fragments[0]!.text).toBe('[Fuente no disponible]');
  });
  it('cuenta la sobrecarga de citas y fragmentos al reservar presupuesto sin enviar texto ni perder el borrador', () => {
    const s = setup(); const segments = Array.from({ length: 1000 }, (_, index) => ({ id: `line-${index + 1}`, text: `L${String(index).padStart(4, '0')}`, locator: { kind: 'lines', start: index + 1, end: index + 1 } }));
    s.call('saveTranscription', { id: uid(50), fileId: 'file-1', fileHash: s.fileHash, targetKind: 'note', targetId: '1', targetVersion: 1,
      text: segments.map((segment) => segment.text).join('\n'), segments, omissions: [], reviewed: true });
    const draft = s.authorize(s.prepare(1, { sources: [{ ...s.input.sources[0]!, transcriptionIds: [uid(50)] }] }));
    s.ctx.db.aiServiceConfig.id.update({ ...s.ctx.db.aiServiceConfig.id.find(0)!, dailyTokenBudget: 8000 });
    expect(() => s.claim(draft)).toThrow('presupuesto diario'); s.as(alice);
    expect(s.rows('aiReservation')).toHaveLength(0); expect(s.call('getDraft', { id: draft.id }).completedSteps).toBe(0);
  });
  it('actualiza fuentes sin otra llamada, conserva las ocho secciones editadas y exige revisar las citas antes de publicar', () => {
    const s = setup(); let draft = s.ready();
    const edited = { ...draft.result!, title: 'Título editado', sections: draft.result!.sections.map((section, index) => ({ ...section, content: `Edición personal ${index}` })) };
    draft = s.call('saveDraft', { id: draft.id, expectedRevision: draft.revision, result: edited }); s.tick(5);
    s.rows('note')[0]!.body = 'La explicación de las condiciones se corrigió.'; s.rows('note')[0]!.version = 2;
    const request = { id: draft.id, expectedRevision: draft.revision, requestId: uid(500), input: s.input, model: 'gemini-new-config' };
    const refreshed = s.call('reprepareDraft', request);
    expect(refreshed.id).toBe(draft.id); expect(refreshed.result!.sections.map((section) => section.content)).toEqual(edited.sections.map((section) => section.content));
    expect(refreshed.result!.sections.every((section) => section.citations.length === 0)).toBe(true); expect(refreshed.needsCitationReview).toBe(true);
    expect(refreshed.generationModel).toBe('gemini-3.8-flash'); expect(refreshed.preparation.model).toBe('gemini-new-config');
    expect(s.rows('aiReservation')).toHaveLength(1); expect(s.rows('aiGeneration')).toHaveLength(1);
    expect(s.call('reprepareDraft', request).revision).toBe(refreshed.revision);
    expect(() => s.call('reprepareDraft', { ...request, input: { ...s.input, title: 'Otra solicitud' } })).toThrow('otra selección');
    expect(() => s.call('publish', { id: draft.id, expectedRevision: refreshed.revision, requestId: uid(200) })).toThrow('Revisa las citas');
    expect(() => s.call('saveDraft', { id: draft.id, expectedRevision: refreshed.revision, result: refreshed.result })).toThrow('citas');
    const repaired = { ...refreshed.result!, sections: refreshed.result!.sections.map((section) => ({ ...section, citations: [refreshed.preparation.fragments[0]!.id] })) };
    draft = s.call('saveDraft', { id: draft.id, expectedRevision: refreshed.revision, result: repaired }); expect(draft.needsCitationReview).toBe(false);
    s.tick(10); const published = s.call('publish', { id: draft.id, expectedRevision: draft.revision, requestId: uid(200) });
    const provenance = s.call<{ model: string; editedAfterGeneration: boolean; generatedAt: number }>('getProvenance', { guideId: published.publishedGuideId, version: published.publishedGuideVersion });
    expect(provenance.model).toBe('gemini-3.8-flash'); expect(provenance.editedAfterGeneration).toBe(true); expect(provenance.generatedAt).toBeLessThan(Number(s.ctx.timestamp.microsSinceUnixEpoch / 1000n));
  });
  it('renovar la misma preparación conserva los pasos y su resultado, sin permitir reemplazar un envío en curso', () => {
    const s = setup(); const draft = s.ready(); s.tick(1801);
    const refreshed = s.call('reprepareDraft', { id: draft.id, expectedRevision: draft.revision, requestId: uid(500), input: s.input, model: draft.preparation.model });
    expect(refreshed.preparation.expiresAt).toBeGreaterThan(draft.preparation.expiresAt); expect(refreshed.steps).toEqual(draft.steps); expect(refreshed.result).toEqual(draft.result); expect(refreshed.needsCitationReview).toBeUndefined();
    const running = s.authorize(s.prepare(2), 101); const claimed = s.claim(running, 101);
    expect(() => s.call('reprepareDraft', { id: running.id, expectedRevision: claimed.draft.revision, requestId: uid(501), input: s.input, model: running.preparation.model })).toThrow('envío en curso');
    s.as(bob); expect(() => s.call('reprepareDraft', { id: draft.id, expectedRevision: refreshed.revision, requestId: uid(502), input: s.input, model: draft.preparation.model })).toThrow('disponible');
  });
  it('cambiar preparación incompleta conserva el consumo, pero no reutiliza resúmenes de otra versión', () => {
    const s = setup(); s.rows('note')[0]!.body = Array.from({ length: 15 }, (_, index) => `Bloque ${index}: ${String(index).repeat(3700).slice(0, 3700)}`).join('\n');
    let draft = s.authorize(s.prepare()); s.claim(draft);
    const first = draft.preparation.batches[0]!;
    draft = s.finish(draft, 100, { result: { paragraphs: [{ text: 'Resumen previo', citations: [first.fragmentIds[0]] }] } }); expect(draft.completedSteps).toBe(1);
    s.rows('note')[0]!.body = 'Contenido nuevo y breve'; s.rows('note')[0]!.version = 2;
    const refreshed = s.call('reprepareDraft', { id: draft.id, expectedRevision: draft.revision, requestId: uid(500), input: s.input, model: draft.preparation.model });
    expect(refreshed.state).toBe('prepared'); expect(refreshed.completedSteps).toBe(0); expect(refreshed.steps).toEqual([{ id: 'direct', kind: 'direct', state: 'pending' }]);
    expect(s.rows('aiReservation')).toHaveLength(1); expect(s.rows('aiGeneration')[0]!.status).toBe('succeeded');
  });
  it('no recupera contenido retirado o personal cambiando la selección de un borrador antiguo', () => {
    const s = setup(); const draft = s.ready();
    const input = { ...s.input, sources: [{ kind: 'assignment', refId: '10', topics: ['Tema'], includeUnplaced: false }] };
    const request = { id: draft.id, expectedRevision: draft.revision, requestId: uid(500), input, model: draft.preparation.model };
    s.rows('note')[0]!.visibility = 'personal'; expect(() => s.call('reprepareDraft', request)).toThrow('compartido');
    s.rows('note')[0]!.visibility = 'group'; s.ctx.db.contentStatus.insert({ key: 'note:1', kind: 'note', targetId: 1n, withdrawnAt: s.ctx.timestamp, withdrawnBy: alice, reason: 'Retirada' });
    expect(() => s.call('reprepareDraft', request)).toThrow('disponible');
    expect(s.rows('guideAiDraft')[0]!.revision).toBe(draft.revision); expect(s.rows('aiReservation')).toHaveLength(1);
  });
  it('cancelar tras perder acceso detiene lo pendiente y devuelve una respuesta sin contenido de las fuentes', () => {
    const s = setup(); const draft = s.authorize(s.prepare());
    s.ctx.db.contentStatus.insert({ key: 'note:1', kind: 'note', targetId: 1n, withdrawnAt: s.ctx.timestamp, withdrawnBy: alice, reason: 'Retirada' });
    const cancelled = s.call('cancelDraft', { id: draft.id, expectedRevision: draft.revision });
    expect(cancelled.state).toBe('cancelled'); expect(cancelled.steps[0]!.state).toBe('cancelled'); expect(cancelled.preparation.fragments).toEqual([]); expect(cancelled.preparation.omissions).toEqual([]);
    expect(cancelled.preparation.input.sources).toEqual([]); expect(cancelled.result).toBeUndefined(); expect(JSON.stringify(cancelled)).not.toContain('repite instrucciones');
    expect(String(s.rows('guideAiDraft')[0]!.json)).toContain('repite instrucciones');
    expect(() => s.claim(cancelled)).toThrow('disponible'); expect(s.rows('aiGeneration')).toHaveLength(0);
  });
});
