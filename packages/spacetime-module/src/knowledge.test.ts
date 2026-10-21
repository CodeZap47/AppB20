import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }), table: () => ({ rowType: builder }),
    schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import { accept_answer, get_resource_manifest, note_details, note_versions, notes, read_resource_chunk,
  restore_guide_version, restore_note_version, save_note, save_note_v2, update_guide, update_guide_v2, withdraw_content, type Ctx } from './index';
import { captureGuide, captureNote } from './delivery2Handlers';
import { commentQuestion, publishNoteVersion, restoreGuideVersion, restoreNoteVersion, saveNoteV2, saveQuestionLinks, toggleAnswerUsefulness, type SaveNoteV2Input } from './knowledgeHandlers';

const person = (digit: string) => Identity.fromString(digit.repeat(64));
const author = person('a'); const peer = person('b'); const removed = person('c');
type Row = Record<string, unknown>;
const keyOf = (value: unknown) => typeof value === 'object' && value !== null && 'toHexString' in value ? (value as Identity).toHexString() : String(value);
function tableStore(key: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[key]), row]));
  let next = initial.reduce((max, row) => typeof row.id === 'bigint' && row.id >= max ? row.id + 1n : max, 1n);
  return new Proxy({ rows, iter: () => rows.values(), insert: (value: Row) => {
    const row: Row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) }; rows.set(keyOf(row[key]), row); return row;
  } }, { get(target, name) {
    if (name in target) return target[name as keyof typeof target];
    return { find: (value: unknown) => rows.get(keyOf(value)), update: (row: Row) => { rows.set(keyOf(row[key]), { ...row }); return row; },
      delete: (value: unknown) => rows.delete(keyOf(value)), filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[String(name)]) === keyOf(value)) };
  } });
}
const noteInput: SaveNoteV2Input = { noteId: 70n, expectedVersion: 1, subjectId: 1n, termId: 11n, session: '2026-10-21', topic: 'Tema',
  title: 'Apunte editado', body: 'Nueva versión privada', tags: [' Tema ', 'tema'], visibility: 'personal', source: 'student', assignmentIds: [20n], activityIds: [30n], questionIds: [40n] };
function setup() {
  const at = new Timestamp(1_700_000_000_000_000n);
  const privateNote = { id: 70n, subjectId: 1n, topic: 'Tema', title: 'Apunte privado', body: 'Borrador secreto\n![Diagrama](resource:file-native)', tags: ['tema'], visibility: 'personal', source: 'student', author,
    version: 1, createdAt: at, updatedAt: at };
  const initial: Record<string, Row[]> = {
    authConfig: [{ id: 0, issuer: 'https://auth.spacetimedb.com/oidc', audiences: ['test'] }],
    member: [author, peer, removed].map((identity) => ({ identity, displayName: identity.toHexString()[0], status: identity.isEqual(removed) ? 'removed' : 'active', isCreator: identity.isEqual(author) })),
    subject: [{ id: 1n, name: 'Lógica' }, { id: 2n, name: 'Álgebra' }], term: [{ id: 11n, subjectId: 1n }, { id: 12n, subjectId: 2n }],
    assignment: [{ id: 20n, subjectId: 1n }], activity: [{ id: 30n, subjectId: 1n }],
    question: [{ id: 40n, subjectId: 1n, author }, { id: 41n, subjectId: 1n, author: peer }],
    answer: [{ id: 50n, questionId: 40n, author: peer }, { id: 51n, questionId: 41n, author }],
    note: [privateNote, { ...privateNote, id: 71n, visibility: 'group', title: 'Apunte compartido', body: 'Contenido publicado' }],
    noteDetail: [{ noteId: 70n, termId: 11n, session: '2026-10-20', assignmentIds: [], activityIds: [], questionIds: [], publishedFromId: undefined, publishedFromVersion: undefined }],
    studyGuide: [{ id: 80n, subjectId: 1n, termId: 11n, title: 'Guía original', topics: ['Tema'], sections: ['Objetivo', '', '', '', '', '', '', ''], version: 1, createdBy: author, updatedBy: author, createdAt: at, updatedAt: at }],
    guideSource: [{ id: 90n, guideId: 80n, kind: 'nota', refId: 71n, sourceVersion: 1, status: 'processed', reason: '', topics: ['Tema'], addedBy: author, addedAt: at }],
    resourceFile: [{ id: 'file-native', targetKind: 'note', targetId: 70n, name: 'diagrama.png', size: 3n, contentType: 'image/png', storageKey: 'stdb:file-native', etag: 'hash', uploadedBy: author, createdAt: at, removedAt: undefined }],
    resourceUpload: [{ id: 'file-native', state: 'ready', chunkCount: 1, sha256: 'hash' }],
    resourceChunk: [{ id: 'file-native:0', uploadId: 'file-native', index: 0, bytes: new Uint8Array([1, 2, 3]), sha256: 'hash' }],
  };
  const keys: Record<string, string> = { member: 'identity', noteDetail: 'noteId', answerUsefulness: 'key', contentStatus: 'key', resourceVersion: 'key' };
  const tables = new Map<string, ReturnType<typeof tableStore>>();
  const db = new Proxy({}, { get: (_target, name: string) => { if (!tables.has(name)) tables.set(name, tableStore(keys[name] ?? 'id', initial[name])); return tables.get(name); } });
  const state = { db, sender: author, identity: author, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://auth.spacetimedb.com/oidc', audience: ['test'], fullPayload: { email: 'alumno@example.com', email_verified: true } } } };
  const ctx = state as unknown as Ctx & Parameters<typeof note_versions>[0];
  const proc = { withTx: (fn: (tx: typeof ctx) => unknown) => fn(ctx) } as unknown as Parameters<typeof get_resource_manifest>[0];
  const rows = (name: string) => [...(db as Record<string, ReturnType<typeof tableStore>>)[name].rows.values()];
  return { ctx, proc, rows, as: (identity: Identity) => { state.sender = identity; }, tick: () => { state.timestamp = new Timestamp(state.timestamp.microsSinceUnixEpoch + 86_400_000_000n); } };
}

describe('notas privadas e historial de conocimiento', () => {
  it('conserva el borrador privado y publica una copia con alias binarios independientes e idempotentes', () => {
    const { ctx, proc, rows, as } = setup();
    captureNote(ctx, 70n, author); publishNoteVersion(ctx, { noteId: 70n, expectedVersion: 1 });
    const published = rows('note').find((row) => row.id !== 70n && row.id !== 71n)!;
    const alias = rows('resourceFile').find((row) => row.id !== 'file-native')!;
    expect(alias.storageKey).toBe('stdb:file-native'); expect(alias.targetId).toBe(published.id);
    expect(published.body).toContain(`resource:${alias.id}`);
    publishNoteVersion(ctx, { noteId: 70n, expectedVersion: 1 }); expect(rows('note')).toHaveLength(3); expect(rows('resourceFile')).toHaveLength(2);
    saveNoteV2(ctx, noteInput); expect(rows('note').find((row) => row.id === published.id)?.body).toContain('Borrador secreto');
    as(peer);
    expect(notes(ctx).some((note) => note.id === 70n)).toBe(false); expect(note_versions(ctx).some((revision) => revision.noteId === 70n)).toBe(false);
    expect(note_versions(ctx).find((revision) => revision.noteId === published.id)?.version).toBe(1);
    expect(note_details(ctx).find((detail) => detail.noteId === published.id)?.publishedFromId).toBeUndefined();
    expect(() => get_resource_manifest(proc, { fileId: 'file-native' })).toThrow();
    expect(JSON.parse(get_resource_manifest(proc, { fileId: String(alias.id) })).storageKind).toBe('spacetime');
    expect(read_resource_chunk(proc, { fileId: String(alias.id), index: 0 }).bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('restaura contenido, clasificación, relaciones y adjuntos sin borrar versiones posteriores', () => {
    const { ctx, rows } = setup();
    saveNoteV2(ctx, noteInput);
    ctx.db.resourceFile.id.update({ ...ctx.db.resourceFile.id.find('file-native')!, removedAt: ctx.timestamp });
    saveNoteV2(ctx, { ...noteInput, expectedVersion: 2, termId: undefined, session: '', assignmentIds: [], body: 'Cambio posterior' });
    restoreNoteVersion(ctx, { noteId: 70n, version: 1, expectedVersion: 3 });
    const current = ctx.db.note.id.find(70n)!; const detail = ctx.db.noteDetail.noteId.find(70n)!;
    expect(current.body).toContain('Borrador secreto'); expect(current.version).toBe(4); expect(current.author.isEqual(author)).toBe(true);
    expect(detail.session).toBe('2026-10-20'); expect(detail.termId).toBe(11n); expect(detail.assignmentIds).toEqual([]);
    expect(ctx.db.resourceFile.id.find('file-native')?.removedAt).toBeUndefined();
    expect(rows('noteVersion')).toHaveLength(4); expect(rows('noteVersion').at(-1)?.restoredFromVersion).toBe(1);
  });

  it('rechaza otra autoría, conflictos, visibilidad retroactiva, fechas falsas y vínculos ajenos', () => {
    const { ctx, rows, as } = setup();
    as(peer); expect(() => saveNoteV2(ctx, noteInput)).toThrow('no existe');
    as(author);
    expect(() => saveNoteV2(ctx, { ...noteInput, expectedVersion: undefined })).toThrow('versión');
    expect(() => saveNoteV2(ctx, { ...noteInput, expectedVersion: 8 })).toThrow('cambió');
    expect(() => saveNoteV2(ctx, { ...noteInput, visibility: 'group' })).toThrow('visibilidad');
    expect(() => saveNoteV2(ctx, { ...noteInput, session: '2026-02-30' })).toThrow('fecha');
    expect(() => saveNoteV2(ctx, { ...noteInput, termId: 12n })).toThrow('parcial');
    expect(() => saveNoteV2(ctx, { ...noteInput, questionIds: [999n] })).toThrow('vínculos');
    expect(rows('noteVersion')).toHaveLength(0);
    as(removed); expect(() => publishNoteVersion(ctx, { noteId: 70n, expectedVersion: 1 })).toThrow('activo'); expect(note_versions(ctx)).toEqual([]);
  });

  it('no revela versiones personales antiguas aunque una nota heredada tenga visibilidad de grupo', () => {
    const { ctx, as } = setup(); captureNote(ctx, 70n, author);
    ctx.db.note.id.update({ ...ctx.db.note.id.find(70n)!, visibility: 'group' });
    as(peer); expect(notes(ctx).some((note) => note.id === 70n)).toBe(true); expect(note_versions(ctx).some((revision) => revision.noteId === 70n)).toBe(false);
  });

  it('recupera una guía completa con estado, motivo y versión de cada fuente y registra a quien restaura', () => {
    const { ctx, rows, as, tick } = setup(); const sourceDate = ctx.db.guideSource.id.find(90n)!.addedAt; captureGuide(ctx, 80n, author);
    ctx.db.studyGuide.id.update({ ...ctx.db.studyGuide.id.find(80n)!, version: 2, title: 'Cambio', topics: ['Otro tema'], sections: ['', 'Texto nuevo', '', '', '', '', '', ''] });
    ctx.db.guideSource.id.update({ ...ctx.db.guideSource.id.find(90n)!, status: 'pending', reason: 'Cambio de fuente', topics: [] });
    captureGuide(ctx, 80n, author); as(peer); tick();
    expect(() => restoreGuideVersion(ctx, { guideId: 80n, version: 1, expectedVersion: 1 })).toThrow('cambió');
    restoreGuideVersion(ctx, { guideId: 80n, version: 1, expectedVersion: 2 });
    expect(ctx.db.studyGuide.id.find(80n)?.title).toBe('Guía original'); expect(ctx.db.studyGuide.id.find(80n)?.version).toBe(3);
    expect(ctx.db.studyGuide.id.find(80n)?.updatedBy.isEqual(peer)).toBe(true);
    const restored = rows('guideSource')[0]; expect(restored.status).toBe('processed'); expect(restored.reason).toBe(''); expect(restored.sourceVersion).toBe(1); expect(restored.topics).toEqual(['Tema']);
    expect((restored.addedBy as Identity).isEqual(author)).toBe(true); expect(restored.addedAt).toBe(sourceDate);
    expect(restored.addedAt).not.toBe(ctx.timestamp);
    expect(rows('guideVersion')).toHaveLength(3); expect(rows('guideVersion').at(-1)?.restoredFromVersion).toBe(1);
  });
});

describe('aclaraciones, utilidad y referencias de preguntas', () => {
  it('separa aclaraciones de respuestas y exige que la respuesta corresponda a la pregunta', () => {
    const { ctx, rows } = setup();
    commentQuestion(ctx, { questionId: 40n, text: '¿Qué versión usaste?' });
    commentQuestion(ctx, { questionId: 40n, answerId: 50n, text: '¿Puedes explicar este paso?' });
    expect(rows('answer')).toHaveLength(2); expect(rows('questionComment')).toHaveLength(2);
    expect(rows('questionComment')[0].answerId).toBeUndefined();
    expect(() => commentQuestion(ctx, { questionId: 40n, answerId: 51n, text: 'Incorrecto' })).toThrow('pertenece');
    expect(() => commentQuestion(ctx, { questionId: 40n, text: ' ' })).toThrow('vacío');
  });
  it('cada integrante aporta una señal revocable de utilidad y nadie marca su propia respuesta', () => {
    const { ctx, rows, as } = setup();
    toggleAnswerUsefulness(ctx, { answerId: 50n }); expect(rows('answerUsefulness')).toHaveLength(1);
    toggleAnswerUsefulness(ctx, { answerId: 50n }); expect(rows('answerUsefulness')).toHaveLength(0);
    as(peer); expect(() => toggleAnswerUsefulness(ctx, { answerId: 50n })).toThrow('propia');
    as(removed); expect(() => toggleAnswerUsefulness(ctx, { answerId: 50n })).toThrow('activo');
  });
  it('mantiene fuera de las referencias las notas privadas y el material de otra materia', () => {
    const { ctx, rows } = setup();
    saveQuestionLinks(ctx, { questionId: 40n, noteIds: [71n, 71n], guideIds: [80n] }); expect(rows('questionLink')).toHaveLength(2);
    expect(() => saveQuestionLinks(ctx, { questionId: 40n, noteIds: [70n], guideIds: [] })).toThrow('compartido');
    ctx.db.studyGuide.id.update({ ...ctx.db.studyGuide.id.find(80n)!, subjectId: 2n });
    expect(() => saveQuestionLinks(ctx, { questionId: 40n, noteIds: [], guideIds: [80n] })).toThrow('materia');
    expect(rows('questionLink')).toHaveLength(2);
  });
});

describe('cierres de rutas heredadas y recursos retirados', () => {
  const legacyNote = { noteId: 70n, subjectId: 1n, topic: '', title: 'Intento heredado', body: 'No debe publicarse', tags: [], visibility: 'group', source: 'student' };
  const guideInput = { guideId: 80n, subjectId: 1n, termId: 11n, title: 'Cambio autorizado', topics: ['Tema'], sections: ['Nuevo objetivo'] };

  it('el reducer heredado de notas rechaza toda edición sin versión, y V2 conserva la visibilidad personal', () => {
    const { ctx, rows } = setup();
    expect(() => save_note(ctx, legacyNote)).toThrow('Actualiza');
    expect(ctx.db.note.id.find(70n)?.visibility).toBe('personal'); expect(ctx.db.note.id.find(70n)?.version).toBe(1);
    expect(rows('noteVersion')).toHaveLength(0);
    save_note_v2(ctx, { ...noteInput, noteId: 70n, expectedVersion: 1, termId: 11n });
    expect(ctx.db.note.id.find(70n)?.version).toBe(2);
    expect(() => save_note_v2(ctx, { ...noteInput, noteId: 70n, expectedVersion: 2, termId: 11n, visibility: 'group' })).toThrow('visibilidad');
    save_note(ctx, { ...legacyNote, noteId: undefined, visibility: 'personal' });
    expect(rows('note')).toHaveLength(3);
  });

  it('actualizar una guía requiere V2 y la versión exacta sin llamar al reducer heredado', () => {
    const { ctx, rows } = setup();
    expect(() => update_guide(ctx, guideInput)).toThrow('Actualiza');
    expect(rows('guideVersion')).toHaveLength(0); expect(ctx.db.studyGuide.id.find(80n)?.version).toBe(1);
    expect(() => update_guide_v2(ctx, { ...guideInput, expectedVersion: 9 })).toThrow('cambió');
    update_guide_v2(ctx, { ...guideInput, expectedVersion: 1 });
    expect(ctx.db.studyGuide.id.find(80n)).toMatchObject({ title: 'Cambio autorizado', version: 2 });
    expect(rows('guideVersion')).toHaveLength(2);
  });

  it('ni una edición heredada ni el historial permiten reabrir una retirada por moderación', () => {
    const { ctx, as } = setup();
    ctx.db.note.id.update({ ...ctx.db.note.id.find(71n)!, author: peer });
    ctx.db.studyGuide.id.update({ ...ctx.db.studyGuide.id.find(80n)!, createdBy: peer });
    withdraw_content(ctx, { kind: 'note', targetId: 71n, withdrawn: true, expectedVersion: 1, reason: 'Revisar este material compartido' });
    withdraw_content(ctx, { kind: 'guide', targetId: 80n, withdrawn: true, expectedVersion: 1, reason: 'Revisar las fuentes compartidas' });
    as(peer);
    expect(() => save_note(ctx, { ...legacyNote, noteId: 71n })).toThrow('Actualiza');
    expect(() => save_note_v2(ctx, { ...noteInput, noteId: 71n, termId: 11n, expectedVersion: 2, visibility: 'group' })).toThrow('disponible');
    expect(() => restore_note_version(ctx, { noteId: 71n, version: 1, expectedVersion: 2 })).toThrow('disponible');
    expect(() => update_guide(ctx, guideInput)).toThrow('Actualiza');
    expect(() => update_guide_v2(ctx, { ...guideInput, expectedVersion: 2 })).toThrow('retirada');
    expect(() => restore_guide_version(ctx, { guideId: 80n, version: 1, expectedVersion: 2 })).toThrow('retirada');
    expect(() => withdraw_content(ctx, { kind: 'note', targetId: 71n, withdrawn: false, expectedVersion: 2, reason: '' })).toThrow('administrador');
    expect(() => withdraw_content(ctx, { kind: 'guide', targetId: 80n, withdrawn: false, expectedVersion: 2, reason: '' })).toThrow('administrador');
    as(author);
    withdraw_content(ctx, { kind: 'guide', targetId: 80n, withdrawn: false, expectedVersion: 2, reason: '' });
    as(peer); update_guide_v2(ctx, { ...guideInput, expectedVersion: 3 });
    expect(ctx.db.studyGuide.id.find(80n)?.version).toBe(4);
  });

  it('solo acepta respuestas disponibles y exige que la pregunta siga publicada', () => {
    const { ctx, as } = setup();
    as(peer); withdraw_content(ctx, { kind: 'answer', targetId: 50n, withdrawn: true, expectedVersion: 1, reason: '' });
    as(author); expect(() => accept_answer(ctx, { questionId: 40n, answerId: 50n })).toThrow('disponible');
    expect(ctx.db.question.id.find(40n)?.acceptedAnswerId).toBeUndefined();
    as(peer); withdraw_content(ctx, { kind: 'answer', targetId: 50n, withdrawn: false, expectedVersion: 2, reason: '' });
    as(author); accept_answer(ctx, { questionId: 40n, answerId: 50n });
    expect(ctx.db.question.id.find(40n)?.acceptedAnswerId).toBe(50n);
    withdraw_content(ctx, { kind: 'question', targetId: 40n, withdrawn: true, expectedVersion: 1, reason: '' });
    expect(() => accept_answer(ctx, { questionId: 40n, answerId: 50n })).toThrow('pregunta');
  });
});
