import { Identity, Timestamp } from 'spacetimedb';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it, vi } from 'vitest';
import type { VisualProject } from '../../core/src/visualProjects';
vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, clientDisconnected: handler, view: handler }) };
});
import { save_visual_project, set_visual_project_visibility, archive_visual_project, visual_projects, resource_files,
  begin_resource_upload, put_resource_chunk, finalize_resource_upload, get_resource_manifest, read_resource_chunk, change_history,
  type Ctx } from './index';

type Row = Record<string, unknown>;
const author = Identity.fromString('a'.repeat(64)), peer = Identity.fromString('b'.repeat(64)), admin = Identity.fromString('c'.repeat(64));
const outsider = Identity.fromString('d'.repeat(64)), session = Identity.fromString('e'.repeat(64));
const keyOf = (value: unknown) => value instanceof Identity ? value.toHexString() : String(value);
function store(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map(row => [keyOf(row[primary]), row])); let next = 1n;
  return new Proxy({ rows, iter: () => rows.values(), insert(input: Row) {
    while (rows.has(String(next))) next++;
    const row: Row = { ...input, ...(input.id === 0n ? { id: next++ } : {}) };
    rows.set(keyOf(row[primary]), row); return row;
  } }, { get(target, field: string) {
    if (field in target) return target[field as keyof typeof target];
    return { find: (value: unknown) => [...rows.values()].find(row => keyOf(row[field]) === keyOf(value)),
      filter: (value: unknown) => [...rows.values()].filter(row => keyOf(row[field]) === keyOf(value)),
      update: (row: Row) => { rows.set(keyOf(row[primary]), { ...row }); return row; }, delete: (value: unknown) => rows.delete(keyOf(value)) };
  } });
}
function setup() {
  const initial: Record<string, Row[]> = {
    appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }],
    member: [author, peer, admin].map(identity => ({ identity, status: 'active', isCreator: identity === admin })),
    subject: [{ id: 1n }], term: [{ id: 2n }],
    note: [{ id: 10n, author, visibility: 'personal', subjectId: 1n, version: 1, title: 'Nota privada' }],
    assignment: [{ id: 20n, subjectId: 1n, termId: 2n, version: 1 }],
    activity: [{ id: 30n, subjectId: 1n, termId: 2n, version: 1 }],
    studyGuide: [{ id: 40n, subjectId: 1n, createdBy: author, version: 1 }],
  };
  const primary: Record<string, string> = { member: 'identity', authIdentityLink: 'sessionIdentity', contentStatus: 'key', contentRetention: 'key' };
  const stores = new Map<string, ReturnType<typeof store>>();
  const db = new Proxy({}, { get: (_, name: string) => {
    if (!stores.has(name)) stores.set(name, store(primary[name] ?? 'id', initial[name])); return stores.get(name);
  } });
  const mutable = { db, sender: author, identity: admin, timestamp: new Timestamp(1_800_000_000_000_000n), env: {},
    senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'student@example.test', email_verified: true } } },
    withTx: (fn: (ctx: unknown) => unknown) => fn(mutable) };
  const ctx = mutable as unknown as Ctx & Parameters<typeof get_resource_manifest>[0] & Parameters<typeof visual_projects>[0];
  const view = () => visual_projects(ctx).map(row => JSON.parse(row.json) as VisualProject);
  const save = (extra: Record<string, unknown> = {}, projectId?: bigint, expectedVersion?: number, requestId = 'create-one') => save_visual_project(ctx, {
    projectId, expectedVersion, requestId, payload: JSON.stringify({ title: 'Mi computadora', kind: '3d', subjectIds: ['1'], termId: '2', ...extra }),
  });
  const publish = (id = 1n, expectedVersion = view()[0]!.version) => set_visual_project_visibility(ctx, { projectId: id, expectedVersion, visibility: 'group' });
  return { ctx, mutable, as: (identity: Identity) => { mutable.sender = identity; }, view, save, publish,
    rows: (name: string) => [...(db as Record<string, ReturnType<typeof store>>)[name]!.rows.values()] };
}
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const digest = (input: Uint8Array) => Array.from(sha256(input), b => b.toString(16).padStart(2, '0')).join('');
function cover(s: ReturnType<typeof setup>, uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', content = bytes) {
  begin_resource_upload(s.ctx, { uploadId, targetKind: 'visual_project', targetId: 1n, expectedVersion: s.view()[0]!.version,
    name: 'Portada.png', mime: 'image/png', bytes: BigInt(content.length), sha256: digest(content) });
  put_resource_chunk(s.ctx, { uploadId, index: 0, bytes: content, sha256: digest(content) });
  finalize_resource_upload(s.ctx, { uploadId });
  return uploadId;
}

describe('Laboratorio visual: server persistence and authorization', () => {
  it('keeps drafts private from peers/admins and makes creation retry idempotent', () => {
    const s = setup(); s.save(); s.save(); expect(s.view()).toHaveLength(1);
    expect(s.view()[0]).toMatchObject({ visibility: 'personal', version: 1, authorId: author.toHexString(), links: [], archived: false });
    expect(() => s.save({ title: 'Different' })).toThrow(/solicitud/);
    s.as(peer); expect(s.view()).toEqual([]); expect(change_history(s.ctx)).toEqual([]);
    expect(() => s.save({}, 1n, 1)).toThrow(/autor/);
    s.as(admin); expect(s.view()).toEqual([]); expect(() => s.publish(1n, 1)).toThrow(/autor/);
    s.as(outsider); expect(s.view()).toEqual([]); expect(() => s.save()).toThrow(/activo/);
  });
  it('validates classification, source access and public note permission on save/publication', () => {
    const s = setup();
    expect(() => s.save({ subjectIds: ['99'] })).toThrow(/materia/);
    expect(() => s.save({ termId: '99' })).toThrow(/parcial/);
    expect(() => s.save({ links: [{ kind: 'note', id: '99' }] })).toThrow(/recurso/);
    s.save({ links: [{ kind: 'note', id: '10' }, { kind: 'assignment', id: '20' }, { kind: 'activity', id: '30' }, { kind: 'guide', id: '40' }] });
    expect(() => s.publish()).toThrow(/notas/);
    s.ctx.db.note.id.update({ ...s.ctx.db.note.id.find(10n)!, visibility: 'group' }); s.publish();
    s.as(peer); expect(s.view()[0]!.links).toHaveLength(4); expect(visual_projects(s.ctx)[0]!.requestId).toBe('');
    s.ctx.db.note.id.update({ ...s.ctx.db.note.id.find(10n)!, visibility: 'personal' });
    expect(s.view()[0]!.links).toHaveLength(3);
    s.ctx.db.contentStatus.insert({ key: 'activity:30', kind: 'activity', targetId: 30n, withdrawnAt: s.ctx.timestamp, withdrawnBy: author, reason: '' });
    expect(s.view()[0]!.links).toHaveLength(2);
    s.as(author); s.save({ links: [{ kind: 'note', id: '10' }] }, 1n, s.view()[0]!.version);
    expect(s.view()[0]!.unavailableLinks).toEqual([{ kind: 'activity', id: '30' }]);
    expect(() => s.publish()).toThrow(/notas/);
    s.ctx.db.note.insert({ ...s.ctx.db.note.id.find(10n)!, id: 11n });
    expect(() => s.save({ links: [{ kind: 'note', id: '11' }] }, 1n, s.view()[0]!.version)).toThrow(/notas/);
  });
  it('preserves hidden references across unrelated edits and exposes generic markers only to the author', () => {
    const s = setup();
    s.ctx.db.note.id.update({ ...s.ctx.db.note.id.find(10n)!, visibility: 'group' });
    s.save({ links: [{ kind: 'note', id: '10' }] }); s.publish();
    s.ctx.db.contentStatus.insert({ key: 'note:10', kind: 'note', targetId: 10n, withdrawnAt: s.ctx.timestamp, withdrawnBy: author, reason: '' });
    expect(s.view()[0]!.links).toEqual([]);
    expect(s.view()[0]!.unavailableLinks).toEqual([{ kind: 'note', id: '10' }]);
    s.save({ title: 'Título ajustado', links: [] }, 1n, s.view()[0]!.version);
    expect(JSON.parse(s.rows('visualProject')[0]!.metadata as string).links).toEqual([{ kind: 'note', id: '10' }]);
    expect(s.view()[0]!.title).toBe('Título ajustado');
    for (const viewer of [peer, admin]) {
      s.as(viewer);
      expect(s.view()[0]!.links).toEqual([]);
      expect(s.view()[0]).not.toHaveProperty('unavailableLinks');
      expect(JSON.stringify(s.view())).not.toContain('Nota privada');
    }
    s.as(author); expect(() => s.publish()).toThrow(/recurso/);
    s.ctx.db.contentStatus.key.delete('note:10');
    expect(s.view()[0]!.links).toEqual([{ kind: 'note', id: '10' }]);
    expect(s.view()[0]!.unavailableLinks).toEqual([]);
  });
  it('handles a source disappearing after opening the editor and explicit atomic replacement', () => {
    const s = setup(); s.save({ links: [{ kind: 'activity', id: '30' }] });
    const opened = s.view()[0]!;
    s.ctx.db.contentStatus.insert({ key: 'activity:30', kind: 'activity', targetId: 30n, withdrawnAt: s.ctx.timestamp, withdrawnBy: author, reason: '' });
    s.save({ title: 'Cambio preparado antes de retirar la fuente', links: opened.links }, 1n, opened.version);
    expect(s.view()[0]!.unavailableLinks).toEqual([{ kind: 'activity', id: '30' }]);
    s.save({ links: [{ kind: 'assignment', id: '20' }], removedLinks: [{ kind: 'activity', id: '30' }] }, 1n, s.view()[0]!.version);
    expect(s.view()[0]!.links).toEqual([{ kind: 'assignment', id: '20' }]);
    expect(s.view()[0]!.unavailableLinks).toEqual([]);
    expect(JSON.parse(s.rows('visualProject')[0]!.metadata as string).links).toEqual([{ kind: 'assignment', id: '20' }]);
    expect(() => s.save({ removedLinks: [{ kind: 'activity', id: '30' }] }, 1n, s.view()[0]!.version)).toThrow(/no pertenece/);
    expect(() => s.save({ links: [{ kind: 'note', id: '99' }] }, 1n, s.view()[0]!.version)).toThrow(/recurso/);
    expect(s.view()[0]!.links).toEqual([{ kind: 'assignment', id: '20' }]);
  });
  it('honors a deliberate removal when the source disappears after it was unchecked', () => {
    const s = setup(); s.save({ links: [{ kind: 'activity', id: '30' }] });
    s.ctx.db.contentStatus.insert({ key: 'activity:30', kind: 'activity', targetId: 30n, withdrawnAt: s.ctx.timestamp, withdrawnBy: author, reason: '' });
    s.save({ links: [], removedLinks: [{ kind: 'activity', id: '30' }] }, 1n, 1);
    expect(s.view()[0]!.links).toEqual([]); expect(s.view()[0]!.unavailableLinks).toEqual([]);
    expect(JSON.parse(s.rows('visualProject')[0]!.metadata as string).links).toEqual([]);
    expect(() => s.save({ removedLinks: [{ kind: 'activity', id: '30' }] }, undefined, undefined, 'new-with-removal')).toThrow(/proyecto nuevo/);
  });
  it('guards revisions and lets only the owner archive, restore and unpublish', () => {
    const s = setup(); s.save();
    s.save({ title: 'Nueva versión' }, 1n, 1); expect(s.view()[0]!.version).toBe(2);
    expect(() => s.save({}, 1n, 1)).toThrow(/cambió/); expect(s.view()[0]!.title).toBe('Nueva versión');
    s.publish();
    s.as(peer); expect(() => archive_visual_project(s.ctx, { projectId: 1n, archived: true, expectedVersion: 3 })).toThrow(/autor/);
    s.as(author); archive_visual_project(s.ctx, { projectId: 1n, archived: true, expectedVersion: 3 });
    expect(() => s.save({}, 1n, 4)).toThrow(/Restaura/);
    s.as(peer); expect(s.view()).toEqual([]);
    s.as(author); archive_visual_project(s.ctx, { projectId: 1n, archived: false, expectedVersion: 4 });
    set_visual_project_visibility(s.ctx, { projectId: 1n, visibility: 'personal', expectedVersion: 5 });
    s.as(peer); expect(s.view()).toEqual([]);
  });
  it('stores only bounded, content-checked native covers and revokes all download paths', () => {
    const s = setup(); s.save(); const fileId = cover(s);
    expect(s.view()[0]!.coverFileId).toBe(fileId); expect(s.view()[0]!.version).toBe(2);
    expect(resource_files(s.ctx)).toHaveLength(1);
    s.as(peer); expect(resource_files(s.ctx)).toHaveLength(0);
    expect(() => get_resource_manifest(s.ctx, { fileId })).toThrow(/acceso/);
    expect(() => read_resource_chunk(s.ctx, { fileId, index: 0 })).toThrow(/acceso/);
    s.as(admin); expect(() => get_resource_manifest(s.ctx, { fileId })).toThrow(/acceso/);
    s.as(author); s.publish(); s.as(peer);
    expect(JSON.parse(get_resource_manifest(s.ctx, { fileId })).mime).toBe('image/png');
    expect(read_resource_chunk(s.ctx, { fileId, index: 0 }).bytes).toEqual(bytes);
    s.as(author); archive_visual_project(s.ctx, { projectId: 1n, archived: true, expectedVersion: 3 });
    s.as(peer); expect(() => get_resource_manifest(s.ctx, { fileId })).toThrow(/acceso/);
    s.as(author); expect(JSON.parse(get_resource_manifest(s.ctx, { fileId })).mime).toBe('image/png');
  });
  it('never lets a shared note reference override a private or replaced cover', () => {
    const s = setup(); s.save(); const fileId = cover(s);
    s.ctx.db.note.id.update({ ...s.ctx.db.note.id.find(10n)!, visibility: 'group' });
    s.ctx.db.noteVersion.insert({ id: 0n, noteId: 10n, version: 1, subjectId: 1n, termId: undefined, session: '',
      topic: '', title: 'Nota pública', body: '', tags: [], visibility: 'group', source: 'student', author,
      assignmentIds: [], activityIds: [], questionIds: [], attachmentIds: [fileId], editedBy: author,
      editedAt: s.ctx.timestamp, restoredFromVersion: undefined });
    s.as(peer); expect(resource_files(s.ctx)).toHaveLength(0);
    expect(() => get_resource_manifest(s.ctx, { fileId })).toThrow(/acceso/);
    expect(() => read_resource_chunk(s.ctx, { fileId, index: 0 })).toThrow(/acceso/);
    s.as(author); s.publish();
    s.mutable.timestamp = new Timestamp(s.ctx.timestamp.microsSinceUnixEpoch + 1n);
    const newer = cover(s, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    s.as(peer); expect(resource_files(s.ctx).map(file => file.id)).toEqual([newer]);
    expect(() => read_resource_chunk(s.ctx, { fileId, index: 0 })).toThrow(/acceso/);
    expect(read_resource_chunk(s.ctx, { fileId: newer, index: 0 }).bytes).toEqual(bytes);
  });

  it('checks cover MIME, size, signature, owner and stale upload versions', () => {
    const s = setup(); s.save();
    const input = { uploadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', targetKind: 'visual_project', targetId: 1n, expectedVersion: 1,
      name: 'cover.png', mime: 'image/png', bytes: 10n, sha256: digest(bytes) };
    expect(() => begin_resource_upload(s.ctx, { ...input, bytes: 5n * 1024n * 1024n + 1n })).toThrow(/portada/);
    expect(() => begin_resource_upload(s.ctx, { ...input, mime: 'image/svg+xml' })).toThrow(/portada/);
    s.as(peer); expect(() => begin_resource_upload(s.ctx, input)).toThrow(/disponible/);
    s.as(author); expect(() => cover(s, input.uploadId, new Uint8Array([1, 2, 3]))).toThrow(/contenido/);
    expect(s.rows('resourceFile')).toHaveLength(0);
    s.save({}, 1n, 1);
    expect(() => begin_resource_upload(s.ctx, { ...input, uploadId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })).toThrow(/cambió/);
  });
  it('honors linked session identity and revokes removed memberships', () => {
    const s = setup(); s.save();
    s.ctx.db.authIdentityLink.insert({ sessionIdentity: session, memberIdentity: author, createdAt: s.ctx.timestamp });
    s.as(session); expect(s.view()[0]!.authorId).toBe(author.toHexString());
    s.ctx.db.member.identity.update({ ...s.ctx.db.member.identity.find(author)!, status: 'removed' });
    expect(s.view()).toEqual([]); expect(() => s.save()).toThrow(/activo/);
  });
});
