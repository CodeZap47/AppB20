import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import { RETENTION_MICROS } from '../../core/src/retention';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder }); const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import './index';
import { channel_messages, group_messages, edit_message, toggle_reaction, get_file_download_access } from './index';
import { withdrawContent } from './communityHandlers';
import { canReadTarget } from './delivery2Handlers';
import { readContributionOrigins } from './contributionOrigins';
import { assertRetentionReadable, expireContent, purgeDue, readTrashEntries, setMaintenanceService, scheduleRetention } from './trashHandlers';
import type { Ctx } from './moduleContext';
import { moderateContentItem } from './adminContentHandlers';
import { readAdminContentEntries } from './contentInventory';
import { commentReadable, postReadable, toggleFeedReaction } from './feedHandlers';
import { visibleStickerIds } from './nativeStickersHandlers';
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
  const keys: Record<string, string> = { member: 'identity', memberEmail: 'email', memberAccess: 'memberIdentity', adminContentResult: 'key', contentStatus: 'key', contentRetention: 'key', noteDetail: 'noteId', resourceVersion: 'key', evidenceDetail: 'evidenceId', workDetail: 'workId', contributionTombstone: 'fingerprint', roomSummary: 'roomId', teachingPersonal: 'practiceId', guideAiProvenance: 'key' };
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
  const as = (sender: Identity) => { mutable.sender = sender; mutable.senderAuth.jwt.fullPayload.email = `${sender.toHexString()}@example.test`; };
  return { ctx, rows, note, as, time: (micros: bigint) => { mutable.timestamp = new Timestamp(micros); },
    maintenance: () => { as(admin); setMaintenanceService(ctx, { identity: service }); as(service); } };
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

describe('moderación de aportes y mensajes grupales', () => {
  const message = (id: bigint, sender = author) => ({ id, sender, text: 'Texto grupal confidencial', sentAt: at });
  const post = (id: bigint) => ({ id, author, text: 'Texto del feed', requestId: String(id), createdAt: at });
  const comment = (id: bigint, postId = 10n, person = other) => ({ id, postId, author: person, text: 'Comentario ajeno', requestId: String(id), createdAt: at });
  const action = { operationId: 'review-1', kind: 'feed_post', targetId: 10n, expectedVersion: 1, withdrawn: true, reason: 'Retirada revisada', acknowledgeImpact: false };

  it('conserva el feed y comentarios de integrantes dados de baja', () => {
    const s = setup({ feedPost: [post(10n)], feedComment: [comment(11n)] });
    s.rows('member').find((row) => row.identity === author)!.status = 'removed';
    s.rows('member').find((row) => row.identity === other)!.status = 'removed';
    expect(postReadable(s.ctx.db, admin, 10n)).toBe(true);
    expect(commentReadable(s.ctx.db, admin, s.rows('feedComment')[0] as never)).toBe(true);
    expect(postReadable(s.ctx.db, author, 10n)).toBe(false);
  });

  it('excluye datos privados y exige revisar coautores, dependencias y referencias antes de retirar', () => {
    const s = setup({ feedPost: [post(10n)], feedComment: [comment(11n)],
      work: [{ id: 12n, title: 'Trabajo conjunto', createdBy: author, version: 1 }], workAuthor: [{ id: 1n, workId: 12n, author }, { id: 2n, workId: 12n, author: coauthor }],
      directMessage: [message(13n)], agentDraft: [{ id: 'private', text: 'Privado' }],
      resourceFile: [{ id: 'shared', targetKind: 'feed_post', targetId: 10n }], messageReport: [{ id: 1n, attachmentIds: ['shared'] }],
    });
    expect(readAdminContentEntries(s.ctx.db, author)).toEqual([]);
    s.as(admin); const entries = readAdminContentEntries(s.ctx.db, admin);
    expect(entries.some((row) => row.kind === 'direct_message' || row.targetId === 2n)).toBe(false);
    expect(entries.find((row) => row.kind === 'feed_post')).toMatchObject({ foreignDependencies: 1, reportReferences: 1, safeForBulk: false });
    expect(entries.find((row) => row.kind === 'work')).toMatchObject({ collaborative: true, safeForBulk: false });
    moderateContentItem(s.ctx, action);
    expect(s.rows('adminContentResult')[0]).toMatchObject({ status: 'failed', version: 1 });
    expect(s.rows('contentStatus')).toEqual([]);
    moderateContentItem(s.ctx, { ...action, operationId: 'review-2', acknowledgeImpact: true, expectedImpact: '0:1:0:1' });
    expect(s.rows('adminContentResult')[1]).toMatchObject({ status: 'completed', version: 2 });
    moderateContentItem(s.ctx, { ...action, operationId: 'review-2', acknowledgeImpact: true, expectedImpact: '0:1:0:1' });
    expect(s.rows('contentRetention')).toHaveLength(1);
    expect(s.rows('adminContentResult')).toHaveLength(2);
    expect(() => moderateContentItem(s.ctx, { ...action, operationId: 'review-2', acknowledgeImpact: true, expectedImpact: '0:1:0:1', reason: 'Otra decisión' })).toThrow('otra decisión');
  });

  it('restaura una publicación sin restaurar comentarios retirados independientemente ni borrados', () => {
    const s = setup({ feedPost: [post(10n)], feedComment: [comment(11n), comment(12n), { ...comment(13n), text: '', deletedAt: at }] });
    s.as(admin);
    withdrawContent(s.ctx, { ...withdraw, kind: 'feed_comment', targetId: 11n, reason: 'Comentario moderado' });
    moderateContentItem(s.ctx, { ...action, acknowledgeImpact: true, expectedImpact: '0:2:0:0' });
    expect(postReadable(s.ctx.db, admin, 10n)).toBe(false);
    expect(commentReadable(s.ctx.db, admin, s.rows('feedComment')[1] as never)).toBe(false);
    expect(() => toggleFeedReaction(s.ctx, { targetKind: 'post', targetId: 10n, emoji: '👍' })).toThrow('disponible');
    moderateContentItem(s.ctx, { ...action, operationId: 'restore', expectedVersion: 2, withdrawn: false });
    expect(postReadable(s.ctx.db, admin, 10n)).toBe(true);
    expect(s.rows('feedComment').map((row) => commentReadable(s.ctx.db, admin, row as never))).toEqual([false, true, false]);
    expect(s.rows('notification')).toEqual([]);
    expect(() => withdrawContent(s.ctx, { ...withdraw, kind: 'feed_comment', targetId: 13n, withdrawn: false })).toThrow('definitivamente');
  });

  it('redacta mensajes y citas en las vistas, impide interacciones y mantiene respuestas al purgar', () => {
    const s = setup({ groupMessage: [message(10n), { ...message(11n, other), replyToId: 10n }],
      channelMessage: [{ ...message(20n), channelId: 1n }, { ...message(21n, other), channelId: 1n, replyToId: 20n }],
      chatChannel: [{ id: 1n, name: 'Materia' }], messageReaction: [{ id: 1n, scope: 'group', messageId: 10n, member: other, emoji: '👍' }],
    });
    s.as(admin);
    for (const [kind, targetId] of [['group_message', 10n], ['channel_message', 20n]] as const) withdrawContent(s.ctx, { ...withdraw, kind, targetId, reason: 'Moderación', acknowledgeImpact: true });
    const view = group_messages as unknown as (ctx: Ctx) => Row[];
    const channelView = channel_messages as unknown as (ctx: Ctx) => Row[];
    expect(view(s.ctx)[0]).toMatchObject({ id: 10n, text: '', deletedAt: at });
    expect(channelView(s.ctx)[0]).toMatchObject({ id: 20n, text: '', deletedAt: at });
    expect(canReadTarget(s.ctx.db, admin, 'group_message', 10n)).toBe(false);
    const react = toggle_reaction as unknown as (ctx: Ctx, args: object) => void;
    expect(() => react(s.ctx, { scope: 'group', messageId: 10n, emoji: '👍' })).toThrow('retirado');
    s.as(author); const edit = edit_message as unknown as (ctx: Ctx, args: object) => void;
    expect(() => edit(s.ctx, { scope: 'group', messageId: 10n, text: 'Evitar moderación' })).toThrow('retirado');
    s.maintenance(); s.time(at.microsSinceUnixEpoch + RETENTION_MICROS); purgeDue(s.ctx, { batchSize: 20 });
    expect(s.rows('groupMessage')[0]).toMatchObject({ id: 10n, text: '', deletedAt: s.ctx.timestamp });
    expect(s.rows('groupMessage')[1]).toMatchObject({ id: 11n, replyToId: 10n, text: 'Texto grupal confidencial' });
    expect(s.rows('channelMessage')[1]).toMatchObject({ id: 21n, replyToId: 20n });
    expect(s.rows('messageReaction')).toEqual([]);
    expect(s.rows('contentRetention').every((row) => row.state === 'purged')).toBe(true);
  });

  it('registra fallos por versiones concurrentes y no altera la membresía previamente retirada', () => {
    const s = setup({ feedPost: [post(10n)] }); s.as(admin);
    s.rows('member').find((row) => row.identity === author)!.status = 'removed';
    moderateContentItem(s.ctx, { ...action, expectedVersion: 9 });
    expect(s.rows('adminContentResult')[0]).toMatchObject({ status: 'failed', version: 1 });
    expect(s.rows('member').find((row) => row.identity === author)?.status).toBe('removed');
    moderateContentItem(s.ctx, { ...action, operationId: 'fresh-review' });
    expect(s.rows('adminContentResult')[1]).toMatchObject({ status: 'completed' });
  });

  it('cierra descargas incluso administrativas salvo autorización independiente de un reporte', () => {
    const s = setup({ groupMessage: [message(10n)], resourceFile: [{ id: 'group-file', targetKind: 'group_message', targetId: 10n,
      name: 'Adjunto grupal', storageKey: 'external-safe-key', size: 4n, contentType: 'text/plain', etag: 'etag', uploadedBy: author, createdAt: at }] });
    const download = get_file_download_access as unknown as (ctx: { withTx: (callback: (tx: Ctx) => string) => string }, input: { fileId: string }) => string;
    const read = () => download({ withTx: (callback) => callback(s.ctx) }, { fileId: 'group-file' });
    s.as(admin); expect(JSON.parse(read()).fileId).toBe('group-file');
    withdrawContent(s.ctx, { ...withdraw, kind: 'group_message', targetId: 10n, reason: 'Retirada' });
    expect(read).toThrow('retirado');
    s.rows('messageReport').push({ id: 1n, scope: 'group', messageId: 10n, reporter: other, evidenceText: 'Evidencia autorizada', attachmentIds: ['group-file'] });
    expect(JSON.parse(read()).fileId).toBe('group-file');
    s.as(author); expect(read).toThrow('retirado');
    s.maintenance(); s.time(at.microsSinceUnixEpoch + RETENTION_MICROS); purgeDue(s.ctx, { batchSize: 20 });
    expect(s.rows('resourceFile')).toHaveLength(1);
    s.as(admin); expect(JSON.parse(read()).fileId).toBe('group-file');
    s.as(other); expect(JSON.parse(read()).fileId).toBe('group-file');
  });

  it('retirar un mensaje cierra el acceso a stickers privados compartidos únicamente en él', () => {
    const s = setup({ groupMessage: [{ ...message(10n), text: '[[sticker:21]]' }],
      sticker: [{ id: 21n, packId: 20n }], stickerPack: [{ id: 20n, owner: author, shared: false }] });
    expect(visibleStickerIds(s.ctx.db, admin).has(21n)).toBe(true);
    s.as(admin); withdrawContent(s.ctx, { ...withdraw, kind: 'group_message', targetId: 10n, reason: 'Retirada' });
    expect(visibleStickerIds(s.ctx.db, admin).has(21n)).toBe(false);
    expect(visibleStickerIds(s.ctx.db, author).has(21n)).toBe(true);
  });

  it('rechaza una aceptación de impacto obsoleta aunque la versión del aporte no cambie', () => {
    const s = setup({ feedPost: [post(10n)], feedComment: [comment(11n)] }); s.as(admin);
    s.rows('feedComment').push(comment(12n));
    moderateContentItem(s.ctx, { ...action, acknowledgeImpact: true, expectedImpact: '0:1:0:0' });
    expect(s.rows('adminContentResult')[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('impacto') });
    expect(s.rows('contentStatus')).toEqual([]);
    moderateContentItem(s.ctx, { ...action, operationId: 'updated-review', acknowledgeImpact: true, expectedImpact: '0:2:0:0' });
    expect(s.rows('adminContentResult')[1]).toMatchObject({ status: 'completed' });
  });

  it('un enlace de texto no concede archivos privados; las referencias tipadas conservan sus permisos propios', () => {
    const s = setup({ resourceFile: [{ id: 'private-file', targetKind: 'note', targetId: 2n, name: 'Privado', storageKey: 'external-safe-key', size: 4n,
      contentType: 'text/plain', etag: 'etag', uploadedBy: author, createdAt: at }] });
    s.rows('note').find((row) => row.id === 1n)!.body = '(resource:private-file)';
    const download = get_file_download_access as unknown as (ctx: { withTx: (callback: (tx: Ctx) => string) => string }, input: { fileId: string }) => string;
    const read = () => download({ withTx: (callback) => callback(s.ctx) }, { fileId: 'private-file' });
    s.as(admin); expect(read).toThrow('acceso');
    s.rows('note').push({ ...s.note(3n, 'personal'), author: other });
    s.rows('noteVersion').push({ id: 1n, noteId: 3n, version: 1, author: other, visibility: 'personal', attachmentIds: ['private-file'] });
    expect(read).toThrow('acceso');
    s.as(other); expect(JSON.parse(read()).fileId).toBe('private-file');
    s.rows('note').push(s.note(4n));
    s.rows('noteVersion').push({ id: 2n, noteId: 4n, version: 1, author, visibility: 'group', attachmentIds: ['private-file'] });
    s.as(author); withdrawContent(s.ctx, { ...withdraw, targetId: 2n });
    s.as(admin); expect(JSON.parse(read()).fileId).toBe('private-file');
    s.maintenance(); s.time(at.microsSinceUnixEpoch + RETENTION_MICROS); purgeDue(s.ctx, { batchSize: 20 });
    s.as(admin); expect(JSON.parse(read()).fileId).toBe('private-file');
    s.rows('member').find((row) => row.identity === admin)!.status = 'removed';
    expect(read).toThrow('activo');
  });
});
