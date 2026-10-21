import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import { RETENTION_MICROS } from '../../core/src/retention';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import './index';
import { withdrawContent } from './communityHandlers';
import { canReadTarget } from './delivery2Handlers';
import { readContributionOrigins } from './contributionOrigins';
import { assertRetentionReadable, expireContent, purgeDue, readTrashEntries, setMaintenanceService, scheduleRetention } from './trashHandlers';
import type { Ctx } from './moduleContext';
const identity = (digit: string) => Identity.fromString(digit.repeat(64));
const admin = identity('a'), author = identity('b'), coauthor = identity('c'), other = identity('d'), moduleId = identity('e'), service = identity('f');
const at = new Timestamp(1_700_000_000_000_000n);
type Row = Record<string, unknown>;
const keyOf = (value: unknown): string => value && typeof value === 'object' && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function setup(extra: Record<string, Row[]> = {}) {
  const note = (id: bigint, visibility = 'group') => ({ id, subjectId: 1n, title: `Apunte ${id}`, body: `Contenido privado ${id}`, topic: '', tags: [], visibility, source: 'student', author, version: 1, createdAt: at, updatedAt: at });
  const initial: Record<string, Row[]> = {
    member: [admin, author, coauthor, other].map((person) => ({ identity: person, status: 'active', isCreator: person === admin })),
    appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['test'] }],
    subject: [{ id: 1n }], note: [note(1n), note(2n, 'personal')], ...extra,
  };
  const keys: Record<string, string> = { member: 'identity', contentStatus: 'key', contentRetention: 'key', noteDetail: 'noteId', resourceVersion: 'key', evidenceDetail: 'evidenceId', workDetail: 'workId', contributionTombstone: 'fingerprint', roomSummary: 'roomId', teachingPersonal: 'practiceId', guideAiProvenance: 'key' };
  const tables = new Map<string, Row[]>(); let next = 1000n;
  const rows = (name: string) => { if (!tables.has(name)) tables.set(name, [...(initial[name] ?? [])]); return tables.get(name)!; };
  const db = new Proxy({}, { get(_target, name: string) {
    const table = rows(name); const primary = keys[name] ?? 'id';
    return new Proxy({ iter: () => table.values(), insert: (value: Row) => { const row: Row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) }; table.push(row); return row; } }, { get(target, field: string) {
      if (field in target) return target[field as keyof typeof target];
      return { find: (value: unknown) => table.find((row) => keyOf(row[field]) === keyOf(value)), filter: (value: unknown) => table.filter((row) => keyOf(row[field]) === keyOf(value)),
        update: (row: Row) => { const index = table.findIndex((prior) => keyOf(prior[primary]) === keyOf(row[primary])); table[index] = { ...row }; return row; },
        delete: (value: unknown) => { const index = table.findIndex((row) => keyOf(row[field]) === keyOf(value)); if (index >= 0) table.splice(index, 1); } };
    } });
  } });
  const mutable = { db, sender: author, identity: moduleId, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://auth.spacetimedb.com/oidc', audience: ['test'], fullPayload: { email: 'synthetic@example.test', email_verified: true } } } };
  const ctx = mutable as unknown as Ctx;
  return { ctx, rows, note, as: (sender: Identity) => { mutable.sender = sender; }, time: (micros: bigint) => { mutable.timestamp = new Timestamp(micros); },
    maintenance: () => { mutable.sender = admin; setMaintenanceService(ctx, { identity: service }); mutable.sender = service; } };
}
const withdraw = { kind: 'note', targetId: 1n, withdrawn: true, expectedVersion: 1, reason: '' };

describe('papelera de 30 días con reloj del servidor', () => {
  it('restaura antes del límite, rechaza al llegar y un evento antiguo no elimina un registro restaurado', () => {
    const s = setup(); withdrawContent(s.ctx, withdraw);
    const deadline = at.microsSinceUnixEpoch + RETENTION_MICROS;
    expect(s.rows('contentRetention')[0]?.expiresAt).toEqual(new Timestamp(deadline));
    s.time(deadline - 1n); withdrawContent(s.ctx, { ...withdraw, withdrawn: false, expectedVersion: 2 });
    expect(s.rows('note')[0]?.version).toBe(3);
    s.time(deadline); s.as(moduleId); expireContent(s.ctx, { key: 'note:1', generation: 1 });
    expect(s.rows('note')[0]?.body).toBe('Contenido privado 1');
    const t = setup(); withdrawContent(t.ctx, withdraw); t.time(deadline);
    expect(() => withdrawContent(t.ctx, { ...withdraw, withdrawn: false, expectedVersion: 2 })).toThrow('30 días');
    expect(() => assertRetentionReadable(t.ctx, 'note', 1n)).toThrow('30 días');
    t.as(moduleId); expireContent(t.ctx, { key: 'note:1', generation: 1 });
    expect(t.rows('note').some((row) => row.id === 1n)).toBe(false);
    expect(t.rows('contentRetention')[0]?.state).toBe('purged');
  });
  it('mantiene autoría, coautoría y moderación sin acceso administrativo a apuntes personales', () => {
    const s = setup({ work: [{ id: 9n, assignmentId: 7n, createdBy: author, title: 'Equipo', description: 'Material', version: 1, createdAt: at, updatedAt: at }], workAuthor: [{ id: 1n, workId: 9n, author }, { id: 2n, workId: 9n, author: coauthor }] });
    s.as(coauthor); withdrawContent(s.ctx, { ...withdraw, kind: 'work', targetId: 9n });
    expect(readTrashEntries(s.ctx.db, coauthor)).toMatchObject([{ canRestore: true, targetId: 9n }]);
    s.as(other); expect(readTrashEntries(s.ctx.db, other)).toEqual([]);
    expect(() => withdrawContent(s.ctx, { ...withdraw, kind: 'work', targetId: 9n, withdrawn: false, expectedVersion: 2 })).toThrow();
    s.as(admin); expect(() => withdrawContent(s.ctx, { ...withdraw, targetId: 2n, reason: 'Moderación' })).toThrow('disponible');
    withdrawContent(s.ctx, { ...withdraw, reason: 'Motivo de moderación' });
    expect(readTrashEntries(s.ctx.db, author).find((row) => row.targetId === 1n)?.canRestore).toBe(false);
    s.as(author); expect(() => withdrawContent(s.ctx, { ...withdraw, withdrawn: false, expectedVersion: 2 })).toThrow('administrador');
    s.rows('member').find((row) => row.identity === author)!.status = 'removed';
    expect(readTrashEntries(s.ctx.db, author)).toEqual([]);
    expect(() => withdrawContent(s.ctx, { ...withdraw, withdrawn: false, expectedVersion: 2 })).toThrow('activo');
  });
  it('purga lotes limitados, audita sin texto ni identidad y reintenta sin duplicar trabajo', () => {
    const s = setup(); s.rows('note').splice(0);
    for (let id = 1n; id <= 25n; id++) { s.rows('note').push(s.note(id)); withdrawContent(s.ctx, { ...withdraw, targetId: id }); }
    expect(() => purgeDue(s.ctx, { batchSize: 20 })).toThrow('mantenimiento');
    s.maintenance(); s.time(at.microsSinceUnixEpoch + RETENTION_MICROS);
    expect(purgeDue(s.ctx, { batchSize: 20 })).toEqual({ processed: 20, remaining: 5 });
    expect(purgeDue(s.ctx, { batchSize: 20 })).toEqual({ processed: 5, remaining: 0 });
    expect(purgeDue(s.ctx, { batchSize: 20 })).toEqual({ processed: 0, remaining: 0 });
    expect(s.rows('note')).toEqual([]); expect(s.rows('noteVersion')).toEqual([]); expect(s.rows('contentStatus')).toEqual([]);
    expect(JSON.stringify(s.rows('retentionAudit'), (_key, value) => typeof value === 'bigint' ? String(value) : value)).not.toMatch(/Contenido|Motivo|email|toHexString|authorId/);
    expect(s.rows('retentionAudit').filter((row) => row.action === 'purge')).toHaveLength(25);
  });
  it('conserva bytes publicados por alias y solo libera la reserva después de la última referencia', () => {
    const s = setup({ note: [{ id: 1n, subjectId: 1n, title: 'Privado', body: 'Privado', topic: '', tags: [], visibility: 'personal', source: 'student', author, version: 1, createdAt: at, updatedAt: at },
      { id: 3n, subjectId: 1n, title: 'Publicado', body: '(resource:published-3-private)', topic: '', tags: [], visibility: 'group', source: 'student', author, version: 1, createdAt: at, updatedAt: at }],
      resourceFile: ['private', 'published-3-private'].map((id, index) => ({ id, targetKind: 'note', targetId: index ? 3n : 1n, name: 'private-name.pdf', size: 3n, contentType: 'application/pdf', storageKey: 'stdb:binary', uploadedBy: author, createdAt: at })),
      resourceUpload: [{ id: 'binary', targetKind: 'note', targetId: 1n, actor: author, name: 'private-name.pdf', bytes: 3n, state: 'ready', sha256: 'a'.repeat(64) }], resourceChunk: [{ id: 'binary:0', uploadId: 'binary', bytes: new Uint8Array([1, 2, 3]) }], resourceCapacity: [{ id: 0, limitBytes: 100n, reservedBytes: 3n }],
    });
    withdrawContent(s.ctx, withdraw); s.maintenance(); s.time(at.microsSinceUnixEpoch + RETENTION_MICROS); purgeDue(s.ctx, { batchSize: 20 });
    expect(s.rows('resourceFile').map((row) => row.id)).toEqual(['published-3-private']); expect(s.rows('resourceChunk')).toHaveLength(1);
    expect(s.rows('resourceUpload')[0]).toMatchObject({ actor: moduleId, name: 'Archivo conservado por referencia', targetKind: 'retained' });
    expect(s.rows('resourceCapacity')[0]?.reservedBytes).toBe(3n);
    s.as(author); withdrawContent(s.ctx, { ...withdraw, targetId: 3n });
    s.time(at.microsSinceUnixEpoch + 2n * RETENTION_MICROS); s.as(service); purgeDue(s.ctx, { batchSize: 20 });
    expect(s.rows('resourceFile')).toEqual([]); expect(s.rows('resourceChunk')).toEqual([]); expect(s.rows('resourceUpload')).toEqual([]);
    expect(s.rows('resourceCapacity')[0]?.reservedBytes).toBe(0n);
  });
  it('el hash privado conserva el primer crédito y evita que un clon posterior vuelva a sumar', () => {
    const s = setup(); withdrawContent(s.ctx, withdraw); s.maintenance(); s.time(at.microsSinceUnixEpoch + RETENTION_MICROS); purgeDue(s.ctx, { batchSize: 20 });
    s.rows('note').push({ ...s.note(10n), title: 'Apunte 1', body: 'Contenido privado 1', createdAt: s.ctx.timestamp });
    const origin = readContributionOrigins(s.ctx.db, other).find((row) => row.refId === 10n)!;
    expect(origin.duplicateOf).toBe(1n); expect(origin.creditedAt).toEqual(at);
    expect(s.rows('contributionTombstone')).toHaveLength(1);
    expect(Object.keys(s.rows('contributionTombstone')[0]!)).toEqual(['fingerprint', 'kind', 'canonicalId', 'creditedAt']);
    expect(s.rows('contributionTombstone')[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(canReadTarget(s.ctx.db, author, 'note', 1n)).toBe(false);
  });
  it('exige identidad de mantenimiento separada y preserva la fecha de retiradas anteriores', () => {
    const s = setup();
    expect(() => setMaintenanceService(s.ctx, { identity: service })).toThrow('propietario');
    s.as(admin); expect(() => setMaintenanceService(s.ctx, { identity: author })).toThrow('dedicada');
    for (const name of ['fileServiceConfig', 'aiServiceConfig', 'notificationServiceConfig']) {
      s.rows(name).push({ id: 0, identity: service });
      expect(() => setMaintenanceService(s.ctx, { identity: service })).toThrow('diferente'); s.rows(name).splice(0);
    }
    Object.assign(s.ctx.env, { B20_FILE_SERVICE_IDENTITY: service.toHexString() });
    expect(() => setMaintenanceService(s.ctx, { identity: service })).toThrow('diferente');
    Object.assign(s.ctx.env, { B20_FILE_SERVICE_IDENTITY: undefined });
    s.rows('note').splice(0);
    for (let id = 1n; id <= 25n; id++) { s.rows('note').push(s.note(id)); s.rows('contentStatus').push({ key: `note:${id}`, kind: 'note', targetId: id, withdrawnAt: at, withdrawnBy: author, reason: 'Motivo legado' }); }
    s.maintenance(); s.time(at.microsSinceUnixEpoch + RETENTION_MICROS);
    expect(purgeDue(s.ctx, { batchSize: 20 })).toEqual({ processed: 20, remaining: 5 });
    expect(purgeDue(s.ctx, { batchSize: 20 })).toEqual({ processed: 5, remaining: 0 });
    expect(s.rows('contentRetention').every((row) => (row.expiresAt as Timestamp).microsSinceUnixEpoch === at.microsSinceUnixEpoch + RETENTION_MICROS)).toBe(true);
  });
  it('elimina los seis tipos con sus relaciones y deja las fuentes de repaso sin texto', () => {
    const s = setup({
      question: [{ id: 3n, subjectId: 1n, title: 'Pregunta privada sintética', author, createdAt: at, status: 'open' }],
      answer: [{ id: 4n, questionId: 3n, author, body: 'Respuesta sintética', createdAt: at }],
      studyGuide: [{ id: 5n, subjectId: 1n, title: 'Guía sintética', topics: [], sections: ['Texto de guía'], createdBy: author, createdAt: at, updatedAt: at, version: 1 }],
      work: [{ id: 6n, assignmentId: 9n, title: 'Trabajo sintético', description: 'Contenido trabajo', version: 1, createdAt: at }],
      workAuthor: [{ id: 1n, workId: 6n, author }],
      evidence: [{ id: 7n, activityId: 9n, author, participants: [], content: 'Contenido evidencia', createdAt: at }],
      guideSource: [{ id: 1n, guideId: 5n, kind: 'nota', refId: 1n }],
      spacedCard: [{ id: 1n, sourceKind: 'note', sourceId: 1n, question: 'Texto pregunta', explanation: 'Texto explicación', hint: 'Pista', archived: false, version: 1 }],
      roomMaterial: [{ id: 1n, roomId: 1n, kind: 'note', sourceId: 1n }],
      noteDetail: [{ noteId: 2n, questionIds: [3n] }],
      changeLog: [{ id: 1n, entity: 'guide_source', entityId: '1', actor: author }],
    });
    for (const [kind, id] of [['note', 1n], ['question', 3n], ['answer', 4n], ['guide', 5n], ['work', 6n], ['evidence', 7n]] as const) {
      s.rows('contentStatus').push({ key: `${kind}:${id}`, kind, targetId: id, withdrawnAt: at, withdrawnBy: author, reason: 'Retirada sintética' });
      scheduleRetention(s.ctx, kind, id, 'author');
    }
    s.maintenance(); s.time(at.microsSinceUnixEpoch + RETENTION_MICROS);
    expect(purgeDue(s.ctx, { batchSize: 20 })).toEqual({ processed: 6, remaining: 0 });
    for (const table of ['question', 'answer', 'studyGuide', 'guideSource', 'work', 'workAuthor', 'evidence', 'roomMaterial', 'changeLog', 'contentStatus']) expect(s.rows(table), table).toEqual([]);
    expect(s.rows('note').map((row) => row.id)).toEqual([2n]);
    expect(s.rows('noteDetail')[0]?.questionIds).toEqual([]);
    expect(s.rows('spacedCard')[0]).toMatchObject({ archived: true, question: '', explanation: '', hint: '' });
    expect(s.rows('retentionAudit').filter((row) => row.action === 'purge')).toHaveLength(6);
  });

  it('purga las copias privadas de Guías IA y las citas originales sin borrar la guía independiente', () => {
    const source = (id: string) => ({ kind: 'note', refId: id, title: `Fuente ${id}`, fragmentIds: [`f${id}`] });
    const fragment = (id: string) => ({ id: `f${id}`, text: `Original copiado ${id}`, origins: [{ kind: 'note', refId: id }] });
    const preparation = { sources: [source('1'), source('2')], fragments: [fragment('1'), fragment('2')] };
    const s = setup({
      studyGuide: [{ id: 5n, subjectId: 1n, title: 'Guía publicada independiente', topics: [], sections: ['Explicación revisada'], createdBy: author, createdAt: at, updatedAt: at, version: 1 }],
      guideAiDraft: [{ id: 'private-draft', actor: author, json: JSON.stringify({ preparation, publishedGuideId: '5' }) },
        { id: 'unrelated-draft', actor: other, json: JSON.stringify({ preparation: { sources: [source('2')], fragments: [fragment('2')] } }) }],
      guideAiTranscription: [{ id: 'transcription-1', targetKind: 'note', targetId: 1n, json: 'Original transcrito 1' },
        { id: 'transcription-2', targetKind: 'note', targetId: 2n, json: 'Original transcrito 2' }],
      guideAiProvenance: [{ key: '5:1', guideId: 5n, guideVersion: 1, json: JSON.stringify({ ...preparation, citations: [{ content: 'Explicación revisada', citations: ['f1', 'f2'] }] }) }],
    });
    withdrawContent(s.ctx, withdraw); s.maintenance(); s.time(at.microsSinceUnixEpoch + RETENTION_MICROS);
    expect(purgeDue(s.ctx, { batchSize: 20 })).toEqual({ processed: 1, remaining: 0 });
    expect(s.rows('guideAiDraft').map((row) => row.id)).toEqual(['unrelated-draft']);
    expect(s.rows('guideAiTranscription').map((row) => row.id)).toEqual(['transcription-2']);
    expect(s.rows('studyGuide')[0]?.sections).toEqual(['Explicación revisada']);
    const provenance = JSON.parse(s.rows('guideAiProvenance')[0]!.json as string);
    expect(provenance).toEqual({ sources: [source('2')], fragments: [fragment('2')], citations: [{ content: 'Explicación revisada', citations: ['f2'] }] });
    s.as(author); withdrawContent(s.ctx, { ...withdraw, kind: 'guide', targetId: 5n });
    s.time(at.microsSinceUnixEpoch + 2n * RETENTION_MICROS); s.as(service); purgeDue(s.ctx, { batchSize: 20 });
    expect(s.rows('guideAiProvenance')).toEqual([]);
    expect(s.rows('studyGuide')).toEqual([]);
  });

  it('libera después el archivo de una respuesta activa purgada en cascada cuando pierde su última referencia', () => {
    const s = setup({
      question: [{ id: 3n, subjectId: 1n, title: 'Pregunta sintética', author, createdAt: at, status: 'open' }],
      answer: [{ id: 4n, questionId: 3n, author, body: 'Respuesta sintética', createdAt: at }],
      resourceFile: [{ id: 'answer-file', targetKind: 'answer', targetId: 4n, name: 'private-name.txt', storageKey: 'stdb:answer-bytes', uploadedBy: author, createdAt: at }],
      resourceUpload: [{ id: 'answer-bytes', targetKind: 'answer', targetId: 4n, actor: author, name: 'private-name.txt', bytes: 3n, state: 'ready', sha256: 'a'.repeat(64) }],
      resourceChunk: [{ id: 'answer-bytes:0', uploadId: 'answer-bytes', bytes: new Uint8Array([1, 2, 3]) }],
      resourceCapacity: [{ id: 0, limitBytes: 100n, reservedBytes: 3n }],
    });
    s.rows('note').find((row) => row.id === 1n)!.body = 'Referencia vigente (resource:answer-file)';
    withdrawContent(s.ctx, { ...withdraw, kind: 'question', targetId: 3n });
    s.maintenance(); s.time(at.microsSinceUnixEpoch + RETENTION_MICROS);
    expect(purgeDue(s.ctx, { batchSize: 20 })).toEqual({ processed: 1, remaining: 0 });
    expect(s.rows('answer')).toEqual([]);
    expect(s.rows('contentRetention').find((row) => row.key === 'answer:4')?.state).toBe('purged');
    expect(s.rows('resourceChunk')).toHaveLength(1);
    s.as(author); withdrawContent(s.ctx, withdraw);
    s.time(at.microsSinceUnixEpoch + 2n * RETENTION_MICROS); s.as(service);
    expect(purgeDue(s.ctx, { batchSize: 20 })).toEqual({ processed: 1, remaining: 0 });
    expect(s.rows('resourceFile')).toEqual([]); expect(s.rows('resourceChunk')).toEqual([]);
    expect(s.rows('resourceUpload')).toEqual([]); expect(s.rows('resourceCapacity')[0]?.reservedBytes).toBe(0n);
  });

});
