import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import { sha256 } from '@noble/hashes/sha2.js';

// Ejecuta los handlers reales. El registro del SDK requiere el runtime del servidor.
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return {
    SenderError: class SenderError extends Error {},
    t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }),
  };
});

import {
  academic_comments, add_evidence, add_guide_sources, assignment_details, attach_work_file, authorize_file_upload, backfill_academic_v2,
  comment_academic, finalize_file_upload, get_file_download_access, get_file_upload_status,
  my_progress, on_connect, page_snapshots, publish_work_v2, remove_resource_file, remove_work_file,
  resource_files, restore_page_snapshot, restore_work_version, review_work, save_activity_links,
  save_work_version, set_file_service, set_progress, update_activity_v2, update_assignment_v2,
  work_details, work_revisions, work_reviews,
  begin_resource_upload, put_resource_chunk, finalize_resource_upload, cancel_resource_upload,
  get_resource_upload_status, get_resource_manifest, read_resource_chunk, set_resource_capacity, expire_resource_upload,
} from './index';

const person = (digit: string) => Identity.fromString(digit.repeat(64));
const owner = person('a');
const author = person('b');
const coauthor = person('c');
const removed = person('d');
const service = person('e');
const keyOf = (value: unknown) => typeof value === 'object' && value !== null && 'toHexString' in value
  ? (value as ReturnType<typeof person>).toHexString() : String(value);
type Row = Record<string, unknown>;

function tableStore(key: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[key]), row]));
  let next = 1n + initial.reduce((max, row) => typeof row.id === 'bigint' && row.id > max ? row.id : max, 0n);
  return new Proxy({ rows,
    iter: () => rows.values(),
    insert: (value: Row) => {
      const row: Row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) };
      rows.set(keyOf(row[key]), row); return row;
    },
  }, {
    get(target, name) {
      if (name in target) return target[name as keyof typeof target];
      return {
        find: (value: unknown) => rows.get(keyOf(value)),
        update: (row: Row) => { rows.set(keyOf(row[key]), { ...row }); return row; },
        delete: (value: unknown) => rows.delete(keyOf(value)),
        filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[String(name)]) === keyOf(value)),
      };
    },
  });
}

function setup() {
  const at = new Timestamp(1_700_000_000_000_000n);
  const keys: Record<string, string> = {
    member: 'identity', personalProgress: 'key', assignmentDetail: 'assignmentId',
    workDetail: 'workId', evidenceDetail: 'evidenceId',
  };
  const initial: Record<string, Row[]> = {
    appConfig: [{ id: 0, owner }],
    authConfig: [{ id: 0, issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['test'] }],
    member: [owner, author, coauthor, removed].map((identity) => ({ identity,
      displayName: identity.toHexString()[0], status: identity === removed ? 'removed' : 'active', isCreator: identity === owner })),
    subject: [{ id: 1n, name: 'Lógica' }, { id: 2n, name: 'Álgebra' }],
    term: [{ id: 11n, subjectId: 1n }, { id: 12n, subjectId: 2n }],
    assignment: [{ id: 20n, subjectId: 1n, termId: 11n, kind: 'tarea', title: 'Consigna', instructions: 'Original',
      dueDate: '2026-10-22', version: 2, createdBy: author, updatedBy: author, createdAt: at, updatedAt: at }],
    activity: [{ id: 30n, subjectId: 1n, termId: 11n, topic: 'Tema', date: '2026-10-21', title: 'Clase', objective: 'Objetivo',
      instructions: 'Práctica', version: 1, createdBy: author, updatedBy: author, createdAt: at, updatedAt: at }],
    work: [{ id: 10n, assignmentId: 20n, title: 'Primera', description: 'Contenido', version: 3,
      createdBy: author, createdAt: at, updatedAt: at }],
    workAuthor: [{ id: 1n, workId: 10n, author }, { id: 2n, workId: 10n, author: coauthor }],
    workFile: [{ id: 8n, workId: 10n, name: 'original.pdf', size: 12n, contentType: 'application/pdf',
      storageKey: 'legacy/original', uploadedBy: author, createdAt: at }],
    evidence: [{ id: 40n, activityId: 30n, author, participants: [author, coauthor], content: 'Solución', createdAt: at }],
    note: [{ id: 70n, subjectId: 1n, visibility: 'group' }, { id: 71n, subjectId: 1n, visibility: 'personal', author }],
  };
  const tables = new Map<string, ReturnType<typeof tableStore>>();
  const db = new Proxy({}, { get: (_target, property: string) => {
    if (!tables.has(property)) tables.set(property, tableStore(keys[property] ?? 'id', initial[property]));
    return tables.get(property);
  } });
  const state = { db, sender: author, identity: service, timestamp: at,
    env: { B20_FILE_SERVICE_IDENTITY: service.toHexString() },
    senderAuth: { jwt: { issuer: 'https://auth.spacetimedb.com/oidc', audience: ['test'],
      fullPayload: { email: 'alumno@example.com', email_verified: true } } },
  };
  const ctx = state as unknown as Parameters<typeof set_progress>[0] & Parameters<typeof my_progress>[0];
  const proc = { withTx: (fn: (tx: typeof ctx) => unknown) => fn(ctx) } as unknown as Parameters<typeof authorize_file_upload>[0];
  const rows = (table: string) => [...(db as Record<string, ReturnType<typeof tableStore>>)[table].rows.values()];
  const as = (identity: ReturnType<typeof person>) => { state.sender = identity; };
  const tick = (minutes = 1) => { state.timestamp = new Timestamp(state.timestamp.microsSinceUnixEpoch + BigInt(minutes) * 60n * 1_000_000n); };
  return { ctx, proc, rows, as, tick, db: ctx.db };
}

const workInput = { workId: 10n, title: 'Final', description: 'Versión nueva', topic: 'Ciclos', status: 'final', expectedVersion: 3 };
const upload = { targetKind: 'work', targetId: 10n, expectedVersion: 3, uploadId: '12345678-1234-4234-8234-123456789abc' };
const finalUpload = { ...upload, actor: author.toHexString(), name: 'trabajo.txt', size: 20n,
  contentType: 'text/plain', storageKey: 'academic/verified-object', etag: 'verified-etag' };

const hash = (bytes: Uint8Array) => Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
const nativeBytes = new Uint8Array([0, 255, 128, 10, 42]);
const nativeUpload = { ...upload, name: 'prueba.bin', mime: 'application/octet-stream', bytes: BigInt(nativeBytes.length), sha256: hash(nativeBytes) };
const nativeChunk = { uploadId: upload.uploadId, index: 0, bytes: nativeBytes, sha256: hash(nativeBytes) };

describe('archivos privados en SpacetimeDB', () => {
  it('reanuda sin duplicar bytes, confirmaciones ni versiones y conserva el historial', () => {
    const { ctx, proc, rows } = setup();
    begin_resource_upload(ctx, nativeUpload);
    begin_resource_upload(ctx, nativeUpload);
    put_resource_chunk(ctx, nativeChunk);
    put_resource_chunk(ctx, nativeChunk);
    expect(JSON.parse(get_resource_upload_status(proc, upload))).toMatchObject({ state: 'pending', receivedIndexes: [0] });
    expect(rows('resourceChunk')).toHaveLength(1);
    expect(rows('work')[0].version).toBe(3);
    expect(resource_files(ctx)).toEqual([]);
    finalize_resource_upload(ctx, upload);
    finalize_resource_upload(ctx, upload);
    begin_resource_upload(ctx, nativeUpload);
    expect(rows('work')[0].version).toBe(4);
    expect(rows('resourceCapacity')[0].reservedBytes).toBe(5n);
    expect(JSON.parse(get_resource_manifest(proc, { fileId: upload.uploadId }))).toMatchObject({ storageKind: 'spacetime', chunkCount: 1, bytes: '5' });
    expect(read_resource_chunk(proc, { fileId: upload.uploadId, index: 0 }).bytes).toEqual(nativeBytes);
    remove_resource_file(ctx, { fileId: upload.uploadId, expectedVersion: 4 });
    expect(read_resource_chunk(proc, { fileId: upload.uploadId, index: 0 }).bytes).toEqual(nativeBytes);
    restore_work_version(ctx, { workId: 10n, version: 4, expectedVersion: 5 });
    expect(resource_files(ctx).find((file) => file.id === upload.uploadId)?.removedAt).toBeUndefined();
    expect(rows('resourceChunk')).toHaveLength(1);
  });

  it('comprueba autoría en cada bloque y lectura, incluso después de retirar a un miembro', () => {
    const { ctx, proc, as } = setup();
    begin_resource_upload(ctx, nativeUpload);
    as(coauthor);
    expect(() => put_resource_chunk(ctx, nativeChunk)).toThrow('pertenece');
    expect(() => get_resource_upload_status(proc, upload)).toThrow('pertenece');
    expect(() => read_resource_chunk(proc, { fileId: upload.uploadId, index: 0 })).toThrow('no existe');
    as(author); put_resource_chunk(ctx, nativeChunk); finalize_resource_upload(ctx, upload);
    as(owner); expect(read_resource_chunk(proc, { fileId: upload.uploadId, index: 0 }).bytes).toEqual(nativeBytes);
    as(removed);
    expect(() => get_resource_manifest(proc, { fileId: upload.uploadId })).toThrow('activo');
    expect(() => read_resource_chunk(proc, { fileId: upload.uploadId, index: 0 })).toThrow('activo');
  });

  it('rechaza bloques corruptos, reemplazos, límites y confirmaciones incompletas', () => {
    const { ctx } = setup();
    expect(() => begin_resource_upload(ctx, { ...nativeUpload, bytes: 52_428_801n })).toThrow('50 MB');
    expect(() => begin_resource_upload(ctx, { ...nativeUpload, bytes: 0n })).toThrow('1 byte');
    begin_resource_upload(ctx, nativeUpload);
    expect(() => put_resource_chunk(ctx, { ...nativeChunk, bytes: new Uint8Array([1]) })).toThrow('Tamaño');
    expect(() => put_resource_chunk(ctx, { ...nativeChunk, index: 1 })).toThrow('índice');
    expect(() => put_resource_chunk(ctx, { ...nativeChunk, sha256: '0'.repeat(64) })).toThrow('integridad');
    expect(() => finalize_resource_upload(ctx, upload)).toThrow('Faltan bloques');
    put_resource_chunk(ctx, nativeChunk);
    const replacement = nativeBytes.map((byte) => byte ^ 1);
    expect(() => put_resource_chunk(ctx, { ...nativeChunk, bytes: replacement, sha256: hash(replacement) })).toThrow('sustituirse');
    expect(() => begin_resource_upload(ctx, { ...nativeUpload, name: 'otro.bin' })).toThrow('otro archivo');
  });

  it('verifica el hash completo y el conflicto de edición sin publicar archivos parciales', () => {
    const { ctx, rows } = setup();
    begin_resource_upload(ctx, { ...nativeUpload, sha256: '0'.repeat(64) });
    put_resource_chunk(ctx, nativeChunk);
    expect(() => finalize_resource_upload(ctx, upload)).toThrow('integridad');
    expect(rows('resourceFile')).toHaveLength(0);
    save_work_version(ctx, workInput);
    expect(() => finalize_resource_upload(ctx, upload)).toThrow('cambió');
    cancel_resource_upload(ctx, upload);
    expect(rows('resourceChunk')).toHaveLength(0);
    expect(rows('resourceCapacity')[0].reservedBytes).toBe(0n);
  });

  it('reserva antes de cargar, limita pendientes y libera al cancelar o vencer', () => {
    const { ctx, proc, rows, as, tick } = setup();
    as(owner); set_resource_capacity(ctx, { bytes: 20n }); as(author);
    for (let n = 0; n < 3; n++) begin_resource_upload(ctx, { ...nativeUpload, uploadId: `12345678-1234-4234-8234-123456789ab${n}` });
    expect(() => begin_resource_upload(ctx, nativeUpload)).toThrow('tres subidas');
    const firstId = '12345678-1234-4234-8234-123456789ab0';
    put_resource_chunk(ctx, { ...nativeChunk, uploadId: firstId });
    cancel_resource_upload(ctx, { uploadId: firstId });
    cancel_resource_upload(ctx, { uploadId: firstId });
    expect(JSON.parse(get_resource_upload_status(proc, { uploadId: firstId })).state).toBe('cancelled');
    expect(rows('resourceCapacity')[0].reservedBytes).toBe(10n);
    expect(rows('resourceChunk')).toHaveLength(0);
    begin_resource_upload(ctx, nativeUpload);
    tick(24 * 60);
    expect(() => put_resource_chunk(ctx, nativeChunk)).toThrow('venció');
    expect(JSON.parse(get_resource_upload_status(proc, upload)).state).toBe('expired');
    const event = rows('resourceExpiry').find((row) => row.uploadId === upload.uploadId)! as unknown as Parameters<typeof expire_resource_upload>[1]['event'];
    expect(() => expire_resource_upload(ctx, { event })).toThrow('programador');
    as(service); expire_resource_upload(ctx, { event });
    expect(rows('resourceCapacity')[0].reservedBytes).toBe(10n);
    expect(rows('resourceUpload').some((row) => row.id === upload.uploadId)).toBe(false);
  });

  it('aplica capacidad global y reserva los ajustes al propietario', () => {
    const { ctx, as } = setup();
    expect(() => set_resource_capacity(ctx, { bytes: 10n })).toThrow('propietario');
    as(owner); set_resource_capacity(ctx, { bytes: 4n }); as(author);
    expect(() => begin_resource_upload(ctx, nativeUpload)).toThrow('espacio');
    as(owner); set_resource_capacity(ctx, { bytes: 10n }); as(author);
    begin_resource_upload(ctx, nativeUpload);
    as(owner);
    expect(() => set_resource_capacity(ctx, { bytes: 4n })).toThrow('reservado');
    expect(() => set_resource_capacity(ctx, { bytes: 512n * 1024n * 1024n + 1n })).toThrow('512');
  });

  it('distingue archivos anteriores sin publicar ubicaciones en el manifiesto', () => {
    const { proc } = setup();
    const manifest = JSON.parse(get_resource_manifest(proc, { fileId: 'legacy:8' }));
    expect(manifest.storageKind).toBe('legacy');
    expect(manifest.storageKey).toBeUndefined();
    expect(() => read_resource_chunk(proc, { fileId: 'legacy:8', index: 0 })).toThrow('anterior');
  });
});

describe('Tareas y Actividades: progreso y edición con versiones', () => {
  it('mantiene el avance privado, separado del trabajo y fuera del registro público', () => {
    const { ctx, as, rows } = setup();
    set_progress(ctx, { targetKind: 'assignment', targetId: 20n, status: 'in_progress' });
    expect(my_progress(ctx)).toHaveLength(1);
    expect(rows('work')[0].version).toBe(3);
    expect(rows('changeLog')).toHaveLength(0);
    as(owner);
    expect(my_progress(ctx)).toEqual([]);
    set_progress(ctx, { targetKind: 'assignment', targetId: 20n, status: 'done' });
    expect(my_progress(ctx)[0].status).toBe('done');
    as(removed);
    expect(my_progress(ctx)).toEqual([]);
    expect(() => set_progress(ctx, { targetKind: 'assignment', targetId: 20n, status: 'done' })).toThrow('activo');
  });

  it('crea y restaura historial sin renumerar ni inventar versiones perdidas', () => {
    const { ctx, rows } = setup();
    save_work_version(ctx, workInput);
    expect(work_revisions(ctx).map((r) => r.version)).toEqual([3, 4]);
    expect(work_revisions(ctx)[0].attachmentIds).toEqual(['legacy:8']);
    expect(work_details(ctx)[0]).toMatchObject({ status: 'final', topic: 'Ciclos' });
    restore_work_version(ctx, { workId: 10n, version: 3, expectedVersion: 4 });
    expect(rows('work')[0]).toMatchObject({ title: 'Primera', version: 5 });
    expect(work_details(ctx)[0].status).toBe('draft');
    expect(work_revisions(ctx).at(-1)).toMatchObject({ restoredFrom: 3, version: 5 });
    expect(() => restore_work_version(ctx, { workId: 10n, version: 1, expectedVersion: 5 })).toThrow('no está disponible');
  });

  it('exige autoría y detecta una edición simultánea antes de guardar', () => {
    const { ctx, as, rows } = setup();
    as(owner);
    expect(() => save_work_version(ctx, workInput)).toThrow('coautores');
    as(coauthor);
    save_work_version(ctx, workInput);
    expect(() => save_work_version(ctx, workInput)).toThrow('cambió');
    expect(rows('work')[0].version).toBe(4);
  });

  it('solo otro compañero revisa una versión final con comentario y la revisión no se transfiere', () => {
    const { ctx, as, rows } = setup();
    as(owner);
    expect(() => review_work(ctx, { workId: 10n, expectedVersion: 3, comment: 'Leído' })).toThrow('final');
    as(author); save_work_version(ctx, workInput);
    expect(() => review_work(ctx, { workId: 10n, expectedVersion: 4, comment: 'Yo reviso' })).toThrow('coautor');
    as(coauthor);
    expect(() => review_work(ctx, { workId: 10n, expectedVersion: 4, comment: 'Mi trabajo' })).toThrow('coautor');
    as(owner);
    expect(() => review_work(ctx, { workId: 10n, expectedVersion: 4, comment: ' ' })).toThrow('vacío');
    review_work(ctx, { workId: 10n, expectedVersion: 4, comment: 'Probé el caso de lista vacía.' });
    expect(() => review_work(ctx, { workId: 10n, expectedVersion: 4, comment: 'Otra' })).toThrow('Ya revisaste');
    as(author);
    save_work_version(ctx, { ...workInput, expectedVersion: 4, description: 'Corrección' });
    expect(work_reviews(ctx)).toHaveLength(1);
    expect(work_reviews(ctx)[0].version).toBe(4);
    expect(rows('work')[0].version).toBe(5);
    expect(work_details(ctx)[0].status).toBe('final');
  });

  it('publica con metadatos desde la primera versión', () => {
    const { ctx } = setup();
    publish_work_v2(ctx, { assignmentId: 20n, title: 'Otro proyecto', description: 'Descripción', coauthors: [coauthor], topic: 'Tema', status: 'draft' });
    expect(work_revisions(ctx).at(-1)).toMatchObject({ version: 1, topic: 'Tema', status: 'draft' });
  });

  it('comentarios de trabajo y evidencia no cambian las soluciones ni sus autores', () => {
    const { ctx, as, rows } = setup();
    as(owner);
    comment_academic(ctx, { targetKind: 'work', targetId: 10n, text: 'Propongo otra solución' });
    comment_academic(ctx, { targetKind: 'evidence', targetId: 40n, text: '¿Cómo midieron el resultado?' });
    expect(academic_comments(ctx)).toHaveLength(2);
    expect(rows('work')[0].version).toBe(3);
    expect(rows('evidence')[0].content).toBe('Solución');
    expect(() => comment_academic(ctx, { targetKind: 'evidence', targetId: 999n, text: 'No existe' })).toThrow('no existe');
    as(removed); expect(academic_comments(ctx)).toEqual([]);
  });

  it('restaura clasificación, tema, fecha y enlaces de páginas completas', () => {
    const { ctx, rows } = setup();
    update_assignment_v2(ctx, { assignmentId: 20n, subjectId: 2n, termId: 12n, kind: 'examen', title: 'Cambio',
      instructions: 'Nueva', dueDate: '2026-11-01', topic: 'Tema nuevo', expectedVersion: 2 });
    restore_page_snapshot(ctx, { page: 'assignment', pageId: 20n, version: 2, expectedVersion: 3 });
    expect(rows('assignment')[0]).toMatchObject({ subjectId: 1n, termId: 11n, kind: 'tarea', title: 'Consigna', version: 4, dueDate: '2026-10-22' });
    expect(assignment_details(ctx)[0].topic).toBe('');
    save_activity_links(ctx, { activityId: 30n, assignmentIds: [20n], noteIds: [70n], expectedVersion: 1 });
    update_activity_v2(ctx, { activityId: 30n, subjectId: 1n, termId: 11n, topic: 'Otro tema', date: '2026-10-22',
      title: 'Otra', objective: 'Otro objetivo', instructions: 'Nueva práctica', expectedVersion: 2 });
    restore_page_snapshot(ctx, { page: 'activity', pageId: 30n, version: 2, expectedVersion: 3 });
    expect(rows('activity')[0]).toMatchObject({ topic: 'Tema', date: '2026-10-21', title: 'Clase', version: 4 });
    expect(page_snapshots(ctx).filter((r) => r.page === 'activity').at(-1)).toMatchObject({ assignmentIds: [20n], noteIds: [70n], restoredFrom: 2 });
    expect(() => save_activity_links(ctx, { activityId: 30n, assignmentIds: [], noteIds: [71n], expectedVersion: 4 })).toThrow('compartidas');
  });

  it('backfill es idempotente y deja pendientes de revisión los datos heredados', () => {
    const { ctx, as, rows } = setup(); as(owner);
    backfill_academic_v2(ctx, {});
    const counts = ['workRevision', 'pageSnapshot', 'resourceFile'].map((name) => rows(name).length);
    backfill_academic_v2(ctx, {});
    expect(['workRevision', 'pageSnapshot', 'resourceFile'].map((name) => rows(name).length)).toEqual(counts);
    expect(rows('work')[0]).toMatchObject({ id: 10n, version: 3 });
    expect(work_details(ctx)[0].status).toBe('draft');
    expect(rows('resourceFile')[0].id).toBe('legacy:8');
  });

  it('la versión citada en una guía queda obsoleta cuando cambia una evidencia de la actividad', () => {
    const { ctx, proc, as, rows, db } = setup();
    db.studyGuide.insert({ id: 80n, subjectId: 1n, termId: 11n, title: 'Guía', topics: ['Tema'],
      sections: [], version: 1, createdBy: author, createdAt: ctx.timestamp, updatedBy: author, updatedAt: ctx.timestamp });
    add_guide_sources(ctx, { guideId: 80n, sources: [{ kind: 'actividad', refId: 30n }] });
    expect(rows('guideSource')[0].sourceVersion).toBe(1);
    add_evidence(ctx, { activityId: 30n, content: 'Otra solución del equipo', participants: [coauthor] });
    expect(rows('activity')[0].version).toBe(2);
    expect(rows('guideSource')[0].sourceVersion).toBeLessThan(rows('activity')[0].version as number);
    const request = { ...upload, targetKind: 'evidence', targetId: 40n, expectedVersion: 1 };
    authorize_file_upload(proc, request); as(service);
    finalize_file_upload(ctx, { ...finalUpload, ...request }); as(author);
    expect(rows('activity')[0].version).toBe(3);
    comment_academic(ctx, { targetKind: 'evidence', targetId: 40n, text: 'Una aclaración' });
    expect(rows('activity')[0].version).toBe(3);
    remove_resource_file(ctx, { fileId: upload.uploadId, expectedVersion: 2 });
    expect(rows('activity')[0].version).toBe(4);
    expect(page_snapshots(ctx).filter((r) => r.page === 'activity').map((r) => r.version)).toEqual([1, 2, 3, 4]);
    restore_page_snapshot(ctx, { page: 'activity', pageId: 30n, version: 1, expectedVersion: 4 });
    expect(rows('evidence')).toHaveLength(2);
    expect(rows('activity')[0].version).toBe(5);
  });
});

describe('Archivos: autorización, atestación del servicio e historial', () => {
  it('cierra el reducer antiguo que aceptaba claves arbitrarias', () => {
    const { ctx } = setup();
    expect(() => attach_work_file(ctx, { workId: 10n, name: 'falso', size: 3n, contentType: 'text/plain', storageKey: 'objeto-ajeno' })).toThrow('verificados');
  });

  it('confirma una sola vez, conserva estado final y no filtra storageKey por las vistas', () => {
    const { ctx, proc, as, rows } = setup();
    save_work_version(ctx, workInput);
    const request = { ...upload, expectedVersion: 4 };
    expect(JSON.parse(authorize_file_upload(proc, request))).toMatchObject({ actor: author.toHexString(), expectedVersion: 4 });
    expect(() => finalize_file_upload(ctx, { ...finalUpload, expectedVersion: 4 })).toThrow('servicio');
    as(service);
    finalize_file_upload(ctx, { ...finalUpload, expectedVersion: 4 });
    finalize_file_upload(ctx, { ...finalUpload, expectedVersion: 4 });
    expect(rows('work')[0].version).toBe(5);
    expect(JSON.parse(get_file_upload_status(proc, { actor: author.toHexString(), uploadId: upload.uploadId }))).toMatchObject({ fileId: upload.uploadId });
    as(author);
    expect(work_details(ctx)[0].status).toBe('final');
    expect(resource_files(ctx).find((f) => f.id === upload.uploadId)).not.toHaveProperty('storageKey');
    expect(work_revisions(ctx).at(-1)?.attachmentIds).toEqual([upload.uploadId, 'legacy:8'].sort());
    expect(JSON.parse(authorize_file_upload(proc, request)).fileId).toBe(upload.uploadId);
    expect(JSON.parse(get_file_download_access(proc, { fileId: upload.uploadId })).storageKey).toBe(finalUpload.storageKey);
  });

  it('no permite confirmar sin autorización ni suplantar actor o destino', () => {
    const { ctx, proc, as } = setup();
    as(service);
    expect(() => finalize_file_upload(ctx, finalUpload)).toThrow('autorización');
    as(author); authorize_file_upload(proc, upload);
    as(service);
    expect(() => finalize_file_upload(ctx, { ...finalUpload, actor: owner.toHexString() })).toThrow('autorización');
    expect(() => finalize_file_upload(ctx, { ...finalUpload, targetId: 999n })).toThrow('autorización');
    as(owner);
    expect(() => authorize_file_upload(proc, upload)).toThrow('coautores');
    expect(() => get_file_upload_status(proc, { actor: author.toHexString(), uploadId: upload.uploadId })).toThrow('servicio');
  });

  it('revalida versión y revocación de membresía al finalizar', () => {
    const { ctx, proc, as, db } = setup();
    authorize_file_upload(proc, upload);
    save_work_version(ctx, workInput);
    as(service);
    expect(() => finalize_file_upload(ctx, finalUpload)).toThrow('cambió');
    as(author);
    const next = { ...upload, expectedVersion: 4, uploadId: '22345678-1234-4234-8234-123456789abc' };
    authorize_file_upload(proc, next);
    const row = db.member.identity.find(author as unknown as Parameters<typeof db.member.identity.find>[0])!;
    db.member.identity.update({ ...row, status: 'removed' });
    as(service);
    expect(() => finalize_file_upload(ctx, { ...finalUpload, ...next })).toThrow('activo');
  });

  it('rechaza autorizaciones vencidas y escrituras de participantes que no sean autores', () => {
    const { ctx, proc, as, tick } = setup();
    authorize_file_upload(proc, upload); tick(31); as(service);
    expect(() => finalize_file_upload(ctx, finalUpload)).toThrow('venció');
    as(coauthor);
    expect(() => authorize_file_upload(proc, { ...upload, targetKind: 'evidence', targetId: 40n, expectedVersion: 1 })).toThrow('Solo el autor');
  });

  it('retira y restaura archivos legacy sin destruir el objeto histórico', () => {
    const { ctx, proc, rows } = setup();
    remove_work_file(ctx, { fileId: 8n });
    expect(rows('workFile')).toHaveLength(0);
    expect(rows('resourceFile')[0].removedAt).toBeDefined();
    expect(JSON.parse(get_file_download_access(proc, { fileId: 'legacy:8' })).storageKey).toBe('legacy/original');
    restore_work_version(ctx, { workId: 10n, version: 3, expectedVersion: 4 });
    expect(rows('workFile')[0].id).toBe(8n);
    expect(rows('resourceFile')[0].removedAt).toBeUndefined();
    expect(work_revisions(ctx).map((r) => r.attachmentIds)).toEqual([['legacy:8'], [], ['legacy:8']]);
  });

  it('restaurar una página recupera también sus recursos retirados', () => {
    const { ctx, proc, as, rows } = setup();
    const request = { ...upload, targetKind: 'assignment', targetId: 20n, expectedVersion: 2 };
    authorize_file_upload(proc, request); as(service);
    finalize_file_upload(ctx, { ...finalUpload, ...request }); as(author);
    remove_resource_file(ctx, { fileId: upload.uploadId, expectedVersion: 3 });
    expect(rows('resourceFile')[0].removedAt).toBeDefined();
    restore_page_snapshot(ctx, { page: 'assignment', pageId: 20n, version: 3, expectedVersion: 4 });
    expect(rows('resourceFile')[0].removedAt).toBeUndefined();
    expect(page_snapshots(ctx).at(-1)).toMatchObject({ pageId: 20n, version: 5,
      attachmentIds: [upload.uploadId], restoredFrom: 3 });
    expect(JSON.parse(get_file_download_access(proc, { fileId: upload.uploadId })).etag).toBe('verified-etag');
  });

  it.each(['assignment', 'activity', 'work', 'evidence'])('sube y retira recursos de %s con control de versión', (kind) => {
    const { ctx, proc, as, rows } = setup();
    const ids: Record<string, bigint> = { assignment: 20n, activity: 30n, work: 10n, evidence: 40n };
    const versions: Record<string, number> = { assignment: 2, activity: 1, work: 3, evidence: 1 };
    const request = { ...upload, targetKind: kind, targetId: ids[kind], expectedVersion: versions[kind] };
    authorize_file_upload(proc, request); as(service);
    finalize_file_upload(ctx, { ...finalUpload, ...request }); as(author);
    expect(() => remove_resource_file(ctx, { fileId: upload.uploadId, expectedVersion: versions[kind] })).toThrow('cambió');
    remove_resource_file(ctx, { fileId: upload.uploadId, expectedVersion: versions[kind] + 1 });
    expect(rows('resourceFile').find((row) => row.id === upload.uploadId)?.removedAt).toBeDefined();
  });

  it('solo el propietario puede cambiar la identidad de servicio', () => {
    const { ctx, as } = setup();
    expect(() => set_file_service(ctx, { identity: service as unknown as Parameters<typeof set_file_service>[1]['identity'] })).toThrow('propietario');
    as(owner);
    expect(() => set_file_service(ctx, { identity: service as unknown as Parameters<typeof set_file_service>[1]['identity'] })).not.toThrow();
  });

  it('la identidad técnica conecta por HTTP sin adquirir acceso académico', () => {
    const { ctx, proc, as } = setup();
    as(service);
    // La identidad técnica usa su token de servicio, no un correo OIDC de alumno.
    Object.assign(ctx.senderAuth, { jwt: null });
    expect(() => on_connect(ctx, {})).not.toThrow();
    expect(get_file_upload_status(proc, { actor: author.toHexString(), uploadId: upload.uploadId })).toBe('null');
    expect(my_progress(ctx)).toEqual([]);
    expect(work_revisions(ctx)).toEqual([]);
    expect(resource_files(ctx)).toEqual([]);
    expect(() => set_progress(ctx, { targetKind: 'assignment', targetId: 20n, status: 'done' })).toThrow('SpacetimeAuth');
    expect(() => save_work_version(ctx, workInput)).toThrow('SpacetimeAuth');
    expect(() => get_file_download_access(proc, { fileId: 'legacy:8' })).toThrow('SpacetimeAuth');
    as(person('f'));
    expect(() => on_connect(ctx, {})).toThrow('SpacetimeAuth');
  });
});
