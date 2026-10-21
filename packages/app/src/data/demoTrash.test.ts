import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import type { SaveNoteInput } from './types';

let source: DemoDataSource; let now: Date;
beforeEach(() => { now = new Date('2026-10-21T12:00:00Z'); source = new DemoDataSource(createDemoState(now), 'demo-2', () => now); });
afterEach(() => source.dispose());
const input = (): SaveNoteInput => ({ subjectId: source.getSnapshot().subjects[0]!.id, topic: 'Plazo', title: 'Aporte sintético para retención', body: 'Contenido exacto de la prueba de retención', tags: [], source: 'student', visibility: 'group' });
const days30 = 30 * 86_400_000;

describe('papelera local con el mismo reloj y permisos que SpacetimeDB', () => {
  it('restaura el mismo ID, versiones y adjuntos antes del límite, y rechaza exactamente al llegar', async () => {
    const id = source.saveNote(input());
    const file = await source.attachResourceFile('note', id, new File(['archivo sintético'], 'sintetico.txt'), 1);
    source.withdrawContent('note', id, true, 2);
    const entry = source.getSnapshot().trashEntries.find((row) => row.targetId === id)!;
    expect(entry.expiresAt.getTime() - entry.withdrawnAt.getTime()).toBe(days30);
    now = new Date(now.getTime() + days30 - 1);
    source.withdrawContent('note', id, false, 3);
    expect(source.getSnapshot().notes.find((row) => row.id === id)?.version).toBe(4);
    expect(source.getSnapshot().noteVersions.filter((row) => row.noteId === id)).toHaveLength(4);
    expect(await (await source.downloadResourceFile(file)).text()).toBe('archivo sintético');
    source.withdrawContent('note', id, true, 4);
    now = new Date(now.getTime() + days30);
    expect(() => source.withdrawContent('note', id, false, 5)).toThrow(/30 días/);
    await source.getTrashClock();
    expect(source.getSnapshot().notes.some((row) => row.id === id)).toBe(false);
    expect(source.getSnapshot().noteVersions.some((row) => row.noteId === id)).toBe(false);
    await expect(source.downloadResourceFile(file)).rejects.toThrow(/acceso|no existe/);
  });
  it('purga la copia privada sin perder los bytes de su publicación independiente', async () => {
    const id = source.saveNote({ ...input(), visibility: 'personal' });
    const file = await source.attachResourceFile('note', id, new File(['bytes compartidos explícitamente'], 'privado.txt'), 1);
    const publishedId = source.publishNoteVersion(id, 2);
    const alias = source.getSnapshot().resourceFiles.find((row) => row.targetKind === 'note' && row.targetId === publishedId)!;
    source.withdrawContent('note', id, true, 2);
    now = new Date(now.getTime() + days30); await source.getTrashClock();
    expect(source.getSnapshot().resourceFiles.some((row) => row.id === file)).toBe(false);
    source.setViewer('demo-4');
    expect(await (await source.downloadResourceFile(alias.id)).text()).toBe('bytes compartidos explícitamente');
    expect(source.getSnapshot().notes.find((row) => row.id === publishedId)?.publishedFromId).toBeUndefined();
    source.setViewer('demo-2'); source.withdrawContent('note', publishedId, true, 1);
    now = new Date(now.getTime() + days30); await source.getTrashClock();
    await expect(source.downloadResourceFile(alias.id)).rejects.toThrow(/acceso|no existe/);
  });
  it('conserva crédito canónico mediante hash cuando se recrea una publicación purgada', async () => {
    const fields = input(); const first = source.saveNote(fields); const createdAt = now;
    source.withdrawContent('note', first, true, 1);
    now = new Date(now.getTime() + days30); await source.getTrashClock();
    const clone = source.saveNote(fields);
    const origin = source.getSnapshot().contributionOrigins.find((row) => row.kind === 'apunte' && row.refId === clone)!;
    expect(origin.duplicateOf).toBe(first); expect(origin.creditedAt).toEqual(createdAt);
    expect(JSON.stringify(origin)).not.toContain(fields.body);
    source.setViewer('demo-3'); const other = source.saveNote(fields);
    expect(source.getSnapshot().contributionOrigins.find((row) => row.refId === other)?.duplicateOf).toBeUndefined();
  });
  it('mantiene la moderación y la privacidad personal durante el plazo', () => {
    const privateId = source.saveNote({ ...input(), visibility: 'personal' });
    const id = source.saveNote(input()); source.setViewer('demo-1');
    expect(() => source.withdrawContent('note', privateId, true, 1, 'Motivo')).toThrow();
    source.withdrawContent('note', id, true, 1, 'Motivo sintético'); source.setViewer('demo-2');
    expect(source.getSnapshot().trashEntries.find((row) => row.targetId === id)?.canRestore).toBe(false);
    expect(() => source.withdrawContent('note', id, false, 2)).toThrow(/administrador/);
    source.setViewer('demo-1'); source.withdrawContent('note', id, false, 2);
    expect(source.getSnapshot().notes.find((row) => row.id === id)?.withdrawnAt).toBeUndefined();
  });
});
