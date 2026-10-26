import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import type { DbConnection } from '../module_bindings';
import { createSpacetimeActions } from './spacetimeActions';
import { readSnapshot } from './spacetimeSnapshot';
import type { SaveNoteInput } from './types';

const SELF = 'a'.repeat(64); const OTHER = 'b'.repeat(64);
const person = (id = SELF) => Identity.fromString(id);
const at = Timestamp.fromDate(new Date('2026-10-21T16:00:00Z'));
function setup(reducers: Record<string, unknown> = {}, initial: Record<string, unknown[]> = {}) {
  const rows = { ...initial };
  const db = new Proxy({}, { get: (_target, name: string) => ({ iter: () => (rows[name] ?? []).values() }) });
  const connection = { db, reducers } as unknown as DbConnection;
  return { rows, connection, actions: createSpacetimeActions(() => connection, () => SELF) };
}
const input: SaveNoteInput = { subjectId: '9007199254740993', title: 'Nota', topic: '', body: 'Contenido', tags: [], visibility: 'personal', source: 'student' };

describe('contrato de conocimiento conectado a SpacetimeDB', () => {
  it('crea notas por V3 con valores vacíos explícitos y encuentra el alta propia entre publicaciones concurrentes', async () => {
    const saveNote = vi.fn();
    const saveNoteV3 = vi.fn(async () => {
      rows.notes!.push({ id: 1n, subjectId: 9007199254740993n, author: person(OTHER), title: 'Nota' });
      rows.notes!.push({ id: 18446744073709551614n, subjectId: 9007199254740993n, author: person(), title: 'Nota' });
    });
    const { actions, rows } = setup({ saveNote, saveNoteV3 }, { notes: [] });
    await expect(actions.saveNote(input)).resolves.toBe('18446744073709551614');
    expect(saveNoteV3).toHaveBeenCalledWith({ noteId: undefined, subjectId: 9007199254740993n, termId: undefined, session: '', topic: '', title: 'Nota', body: 'Contenido', tags: [], visibility: 'personal', source: 'student', isFinal: undefined, assignmentIds: [], activityIds: [], questionIds: [], expectedVersion: undefined });
    expect(saveNote).not.toHaveBeenCalled();
  });

  it('preserva los IDs u64 y la versión capturada por el editor aunque la caché haya cambiado', async () => {
    const saveNoteV3 = vi.fn(async () => {});
    const { actions } = setup({ saveNoteV3 }, { notes: [{ id: 10n, version: 9 }] });
    await actions.saveNote({ ...input, id: '10', expectedVersion: 3, termId: '9007199254740994', session: '2026-10-21', assignmentIds: ['18446744073709551614'], activityIds: ['20'], questionIds: ['30'] });
    expect(saveNoteV3).toHaveBeenLastCalledWith(expect.objectContaining({ noteId: 10n, expectedVersion: 3, termId: 9007199254740994n, session: '2026-10-21', assignmentIds: [18446744073709551614n], activityIds: [20n], questionIds: [30n] }));
    await actions.saveNote({ ...input, id: '10' });
    expect(saveNoteV3).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 9 }));
  });

  it('edita guías mediante V2 y conserva la expectativa del formulario o de la llamada heredada', async () => {
    const updateGuide = vi.fn(); const updateGuideV2 = vi.fn(async () => {});
    const { actions } = setup({ updateGuide, updateGuideV2 }, { studyGuides: [{ id: 80n, version: 7 }] });
    const guide = { subjectId: '9007199254740993', title: 'Guía', topicsText: 'Tema A\nTema B', sections: ['Objetivos'] };
    await actions.updateGuide('80', guide, 3);
    expect(updateGuideV2).toHaveBeenLastCalledWith({ guideId: 80n, subjectId: 9007199254740993n, termId: undefined, title: 'Guía', topics: ['Tema A', 'Tema B'], sections: ['Objetivos'], expectedVersion: 3 });
    await actions.updateGuide('80', guide);
    expect(updateGuideV2).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 7 }));
    expect(updateGuide).not.toHaveBeenCalled();
  });

  it('recupera el mismo ID de una publicación reintentada y manda restauraciones completas con versión', async () => {
    const publishNoteVersion = vi.fn(async () => {}); const restoreNoteVersion = vi.fn(async () => {}); const restoreGuideVersion = vi.fn(async () => {});
    const { actions } = setup({ publishNoteVersion, restoreNoteVersion, restoreGuideVersion }, { noteDetails: [{ noteId: 9007199254740993n, publishedFromId: 70n, publishedFromVersion: 4 }] });
    await expect(actions.publishNoteVersion('70', 4)).resolves.toBe('9007199254740993');
    await expect(actions.publishNoteVersion('70', 4)).resolves.toBe('9007199254740993');
    expect(publishNoteVersion).toHaveBeenLastCalledWith({ noteId: 70n, expectedVersion: 4 });
    await actions.restoreNoteVersion('70', 2, 4); expect(restoreNoteVersion).toHaveBeenCalledWith({ noteId: 70n, version: 2, expectedVersion: 4 });
    await actions.restoreGuideVersion('80', 1, 8); expect(restoreGuideVersion).toHaveBeenCalledWith({ guideId: 80n, version: 1, expectedVersion: 8 });
  });

  it('mantiene separados aclaraciones, utilidad, referencias y retirada reversible', async () => {
    const commentQuestion = vi.fn(async () => {}); const toggleAnswerUsefulness = vi.fn(async () => {}); const saveQuestionLinks = vi.fn(async () => {}); const withdrawContent = vi.fn(async () => {});
    const { actions } = setup({ commentQuestion, toggleAnswerUsefulness, saveQuestionLinks, withdrawContent });
    await actions.commentQuestion('40', '¿Qué versión usaste?');
    expect(commentQuestion).toHaveBeenLastCalledWith({ questionId: 40n, text: '¿Qué versión usaste?', answerId: undefined });
    await actions.commentQuestion('40', '¿Cómo funciona este paso?', '50');
    expect(commentQuestion).toHaveBeenLastCalledWith({ questionId: 40n, text: '¿Cómo funciona este paso?', answerId: 50n });
    await actions.toggleAnswerUsefulness('50'); expect(toggleAnswerUsefulness).toHaveBeenCalledWith({ answerId: 50n });
    await actions.saveQuestionLinks('40', ['9007199254740993'], ['80']); expect(saveQuestionLinks).toHaveBeenCalledWith({ questionId: 40n, noteIds: [9007199254740993n], guideIds: [80n] });
    await actions.withdrawContent('note', '70', true, 4, 'Duplicado'); expect(withdrawContent).toHaveBeenLastCalledWith({ kind: 'note', targetId: 70n, withdrawn: true, expectedVersion: 4, reason: 'Duplicado' });
    await actions.withdrawContent('note', '70', false, 5); expect(withdrawContent).toHaveBeenLastCalledWith({ kind: 'note', targetId: 70n, withdrawn: false, expectedVersion: 5, reason: '' });
  });

  it('compone clasificación, historia y archivos retirados sin recuperar cuerpos privados de otra cuenta', () => {
    const member = { identity: person(), displayName: 'Alumno', status: 'active', isCreator: false, joinedAt: at };
    const note = { id: 70n, subjectId: 1n, title: 'Compartida', topic: 'Tema', body: 'Actual', tags: [], visibility: 'group', source: 'student', author: person(OTHER), version: 3, createdAt: at, updatedAt: at };
    const version = { id: 1n, noteId: 70n, version: 2, subjectId: 1n, termId: 11n, session: '2026-10-21', topic: 'Tema', title: 'Anterior', body: 'Versión compartida', tags: ['tema'], visibility: 'group', source: 'student', author: person(OTHER), assignmentIds: [20n], activityIds: [30n], questionIds: [40n], attachmentIds: ['file-retirado'], editedBy: person(OTHER), editedAt: at, restoredFromVersion: undefined };
    const { connection } = setup({}, { myMember: [member], members: [member], notes: [note], noteDetails: [{ noteId: 70n, termId: 11n, session: '2026-10-21', assignmentIds: [20n], activityIds: [30n], questionIds: [40n] }],
      noteVersions: [version, { ...version, id: 2n, version: 1, body: 'Borrador secreto de otra persona', visibility: 'personal' }],
      contentStatuses: [{ key: 'note:70', kind: 'note', targetId: 70n, withdrawnAt: at, withdrawnBy: person(OTHER), reason: 'Retirada' }],
      resourceFiles: [{ id: 'file-retirado', targetKind: 'note', targetId: 70n, name: 'anterior.pdf', size: 3n, contentType: 'application/pdf', uploadedBy: person(OTHER), createdAt: at, removedAt: at, etag: '' }],
      questions: [{ id: 40n, subjectId: 1n, topic: '', title: 'Pregunta', body: '', author: person(), status: 'open', createdAt: at }],
      answers: [{ id: 50n, questionId: 40n, author: person(), body: 'Respuesta', createdAt: at }],
      resourceVersions: [{ key: 'question:40', targetKind: 'question', targetId: 40n, version: 4 }, { key: 'answer:50', targetKind: 'answer', targetId: 50n, version: 2 }],
    });
    const snapshot = readSnapshot(connection, SELF);
    expect(snapshot.notes[0]).toMatchObject({ termId: '11', session: '2026-10-21', assignmentIds: ['20'], activityIds: ['30'], questionIds: ['40'], withdrawnAt: at.toDate() });
    expect(snapshot.noteVersions).toHaveLength(1); expect(snapshot.noteVersions[0]).toMatchObject({ body: 'Versión compartida', authorId: OTHER, attachmentIds: ['file-retirado'], editedBy: OTHER });
    expect(snapshot.resourceFiles[0]).toMatchObject({ id: 'file-retirado', removedAt: at.toDate() });
    expect(snapshot.questions[0]?.version).toBe(4); expect(snapshot.answers[0]?.version).toBe(2);
    expect(snapshot.noteVersions.map((revision) => revision.body).join('\n')).not.toContain('Borrador secreto');
  });
});
