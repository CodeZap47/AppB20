import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) };
});
import { saveMemberProfile, saveProfileCover, withdrawContent } from './communityHandlers';
import { bumpExtra, profileImageVisible } from './delivery2Handlers';
import type { Ctx } from './index';
import './index';

const identity = (digit: string) => Identity.fromString(digit.repeat(64));
const admin = identity('a'); const author = identity('b'); const other = identity('c'); const removed = identity('d');
const at = new Timestamp(1_700_000_000_000_000n);
type Row = Record<string, unknown>;
const keyOf = (value: unknown): string => value && typeof value === 'object' && 'toHexString' in value
  ? (value as Identity).toHexString() : String(value);

function store(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[primary]), row]));
  let next = 100n;
  return new Proxy({ rows, iter: () => rows.values(), insert: (value: Row) => {
    const row: Row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) };
    rows.set(keyOf(row[primary]), row); return row;
  } }, { get(target, name: string) {
    if (name in target) return target[name as keyof typeof target];
    return { find: (value: unknown) => [...rows.values()].find((row) => keyOf(row[name]) === keyOf(value)),
      filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[name]) === keyOf(value)),
      update: (row: Row) => { rows.set(keyOf(row[primary]), { ...row }); return row; },
      delete: (value: unknown) => rows.delete(keyOf(value)) };
  } });
}

function setup() {
  const member = [admin, author, other, removed].map((person) => ({ identity: person, displayName: 'Alumno', isCreator: person === admin, status: person === removed ? 'removed' : 'active' }));
  const note = (id: bigint, visibility: string) => ({ id, subjectId: 1n, title: 'Apunte', topic: '', body: 'Contenido', tags: [], visibility, source: 'student', author, version: 1, createdAt: at, updatedAt: at });
  const initial: Record<string, Row[]> = {
    member, appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }],
    subject: [{ id: 1n, name: 'Lógica' }], note: [note(1n, 'group'), note(2n, 'personal')],
    question: [{ id: 3n, author, subjectId: 1n, title: 'Pregunta', body: 'Texto', topic: '', createdAt: at, status: 'open' }],
    answer: [{ id: 4n, author, questionId: 3n, body: 'Respuesta', createdAt: at }],
  };
  const keys: Record<string, string> = { member: 'identity', contentStatus: 'key', noteDetail: 'noteId', resourceVersion: 'key', resourceFile: 'id', resourceUpload: 'id', memberProfileCover: 'profileId' };
  const tables = new Map<string, ReturnType<typeof store>>();
  const db = new Proxy({}, { get(_target, property: string) {
    if (!tables.has(property)) tables.set(property, store(keys[property] ?? 'id', initial[property]));
    return tables.get(property);
  } });
  const state = { db, sender: author, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'alumno@example.com', email_verified: true } } } };
  return { ctx: state as unknown as Ctx, as: (sender: Identity) => { state.sender = sender; },
    rows: (table: string) => [...(db as Record<string, ReturnType<typeof store>>)[table].rows.values()],
    insert: (table: string, row: Row) => (db as Record<string, ReturnType<typeof store>>)[table].insert(row) };
}
const profile = { preferredName: ' Luis ', bio: '', interests: ['Rust', 'Rust'], learningGoals: '', skills: [], helpTopics: [], portfolioLinks: ['https://example.com'], subjectIds: [1n, 1n], expectedVersion: 0 };

describe('perfiles privados del grupo', () => {
  it('solo escribe el perfil propio, conserva identidad y rechaza versiones obsoletas', () => {
    const { ctx, rows, as } = setup();
    saveMemberProfile(ctx, profile);
    expect(rows('memberProfile')).toMatchObject([{ preferredName: 'Luis', interests: ['Rust'], subjectIds: [1n], version: 1, memberId: author }]);
    expect(() => saveMemberProfile(ctx, profile)).toThrow('cambió');
    as(other); saveMemberProfile(ctx, profile);
    expect(rows('memberProfile')).toHaveLength(2);
    as(removed); expect(() => saveMemberProfile(ctx, profile)).toThrow('activo');
  });
  it('no acepta enlaces ejecutables ni referencias a fotos ajenas', () => {
    const { ctx, rows, insert, as } = setup();
    expect(() => saveMemberProfile(ctx, { ...profile, portfolioLinks: ['javascript:alert(1)'] })).toThrow('HTTPS');
    expect(rows('memberProfile')).toHaveLength(0);
    saveMemberProfile(ctx, profile);
    const ownId = rows('memberProfile')[0]!.id;
    insert('resourceFile', { id: 'photo', targetKind: 'profile', targetId: ownId, uploadedBy: author, size: 100n, contentType: 'image/png' });
    insert('resourceUpload', { id: 'photo', state: 'ready' });
    saveMemberProfile(ctx, { ...profile, expectedVersion: 1, photoFileId: 'photo' });
    expect(rows('memberProfile')[0]?.photoFileId).toBe('photo');
    as(other); expect(() => saveMemberProfile(ctx, { ...profile, photoFileId: 'photo' })).toThrow('foto');
    as(author); saveMemberProfile(ctx, { ...profile, expectedVersion: 2 });
    expect(rows('memberProfile')[0]?.photoFileId).toBeUndefined();
    expect(rows('resourceFile')).toHaveLength(1);
  });
});

describe('portada del perfil', () => {
  function withProfile() {
    const env = setup();
    saveMemberProfile(env.ctx, profile);
    const id = env.rows('memberProfile')[0]!.id as bigint;
    const image = (fileId: string, targetKind: string, uploadedBy = author) => {
      env.insert('resourceFile', { id: fileId, targetKind, targetId: id, uploadedBy, size: 100n, contentType: 'image/webp', createdAt: at });
      env.insert('resourceUpload', { id: fileId, state: 'ready' });
    };
    return { ...env, id, image };
  }

  it('guarda un degradado de la lista y rechaza valores desconocidos o versiones obsoletas', () => {
    const { ctx, rows, id } = withProfile();
    expect(() => saveProfileCover(ctx, { expectedVersion: 1, preset: 'neon' })).toThrow('portadas disponibles');
    saveProfileCover(ctx, { expectedVersion: 1, preset: 'oceano' });
    expect(rows('memberProfileCover')).toMatchObject([{ profileId: id, preset: 'oceano', fileId: undefined }]);
    expect(rows('memberProfile')[0]?.version).toBe(2);
    expect(() => saveProfileCover(ctx, { expectedVersion: 1, preset: 'menta' })).toThrow('cambió');
  });

  it('pide guardar la presentación antes de elegir portada', () => {
    const { ctx } = setup();
    expect(() => saveProfileCover(ctx, { expectedVersion: 0, preset: 'oceano' })).toThrow('presentación');
  });

  it('solo acepta como portada una imagen profile_cover propia y lista, nunca la foto', () => {
    const { ctx, rows, image } = withProfile();
    image('photo', 'profile'); image('cover', 'profile_cover'); image('ajena', 'profile_cover', other);
    expect(() => saveProfileCover(ctx, { expectedVersion: 1, preset: 'oceano', fileId: 'photo' })).toThrow('portada');
    expect(() => saveProfileCover(ctx, { expectedVersion: 1, preset: 'oceano', fileId: 'ajena' })).toThrow('portada');
    saveProfileCover(ctx, { expectedVersion: 1, preset: 'oceano', fileId: 'cover' });
    expect(rows('memberProfileCover')[0]?.fileId).toBe('cover');
  });

  it('al terminar de subir una portada la deja vigente sin tocar la foto', () => {
    const { ctx, rows, id, image } = withProfile();
    image('photo', 'profile');
    saveMemberProfile(ctx, { ...profile, expectedVersion: 1, photoFileId: 'photo' });
    image('cover', 'profile_cover');
    bumpExtra(ctx, 'profile_cover', id);
    expect(rows('memberProfile')[0]).toMatchObject({ photoFileId: 'photo', version: 3 });
    expect(rows('memberProfileCover')[0]).toMatchObject({ preset: 'lavanda', fileId: 'cover' });
  });

  it('otra persona solo ve la portada vigente; su dueño ve todas', () => {
    const { ctx, image, id } = withProfile();
    image('vieja', 'profile_cover'); image('cover', 'profile_cover');
    saveProfileCover(ctx, { expectedVersion: 1, preset: 'oceano', fileId: 'cover' });
    const file = (fileId: string) => ({ id: fileId, targetKind: 'profile_cover', targetId: id });
    expect(profileImageVisible(ctx.db, other, file('cover'))).toBe(true);
    expect(profileImageVisible(ctx.db, other, file('vieja'))).toBe(false);
    expect(profileImageVisible(ctx.db, author, file('vieja'))).toBe(true);
  });
});

describe('retirada y restauración con versiones', () => {
  const input = { kind: 'note', targetId: 1n, withdrawn: true, expectedVersion: 1, reason: '' };
  it('retira y restaura el mismo contenido sin destruir texto, archivos ni historial', () => {
    const { ctx, rows } = setup();
    withdrawContent(ctx, input);
    expect(rows('contentStatus')[0]?.withdrawnAt).toEqual(at);
    expect(rows('note')[0]).toMatchObject({ body: 'Contenido', version: 2 });
    expect(rows('noteVersion')).toHaveLength(2);
    expect(() => withdrawContent(ctx, { ...input, withdrawn: false })).toThrow('cambió');
    withdrawContent(ctx, { ...input, withdrawn: false, expectedVersion: 2 });
    expect(rows('contentStatus')[0]?.withdrawnAt).toBeUndefined();
    expect(rows('note')[0]).toMatchObject({ body: 'Contenido', version: 3 });
    expect(rows('noteVersion')).toHaveLength(3);
  });
  it('la moderación requiere motivo, no accede a notas personales y solo ella revierte su retirada', () => {
    const { ctx, as } = setup();
    as(other); expect(() => withdrawContent(ctx, input)).toThrow('autor');
    as(admin); expect(() => withdrawContent(ctx, input)).toThrow('motivo');
    expect(() => withdrawContent(ctx, { ...input, targetId: 2n, reason: 'Privado' })).toThrow('disponible');
    withdrawContent(ctx, { ...input, reason: 'No corresponde al grupo' });
    as(author); expect(() => withdrawContent(ctx, { ...input, withdrawn: false, expectedVersion: 2 })).toThrow('administrador');
    as(admin); withdrawContent(ctx, { ...input, withdrawn: false, expectedVersion: 2 });
  });
  it('un administrador no revierte la retirada voluntaria del autor y el control sigue al estar retirado', () => {
    const { ctx, as } = setup();
    withdrawContent(ctx, input);
    as(other); expect(() => withdrawContent(ctx, { ...input, withdrawn: false, expectedVersion: 2 })).toThrow('disponible');
    as(admin); expect(() => withdrawContent(ctx, { ...input, withdrawn: false, expectedVersion: 2 })).toThrow('autores');
  });
  it('un coautor conserva la opción de restaurar el mismo trabajo del equipo', () => {
    const { ctx, as, insert, rows } = setup();
    insert('work', { id: 9n, assignmentId: 10n, createdBy: author, title: 'Equipo', description: 'Trabajo', version: 1, createdAt: at, updatedAt: at });
    insert('workAuthor', { id: 1n, workId: 9n, author });
    insert('workAuthor', { id: 2n, workId: 9n, author: other });
    as(other);
    withdrawContent(ctx, { kind: 'work', targetId: 9n, withdrawn: true, expectedVersion: 1, reason: '' });
    withdrawContent(ctx, { kind: 'work', targetId: 9n, withdrawn: false, expectedVersion: 2, reason: '' });
    expect(rows('work')[0]?.version).toBe(3);
    expect(rows('workRevision')).toHaveLength(3);
  });
});
