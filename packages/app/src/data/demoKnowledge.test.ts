import { describe, expect, it, vi } from 'vitest';
import { DemoKnowledgeStore } from './demoKnowledge';
import type { Member, ResourceFile, SaveNoteInput } from './types';

function setup() {
  const createdAt = new Date('2026-10-20T16:00:00Z');
  const members: Member[] = ['demo-1', 'demo-4'].map((id) => ({ id, displayName: id, status: 'active', isCreator: id === 'demo-1', joinedAt: createdAt }));
  const state: ReturnType<ConstructorParameters<typeof DemoKnowledgeStore>[0]['state']> = {
    subjects: [{ id: 'subject', name: 'Lógica', period: 1 }], terms: [], assignments: [], activities: [], works: [], notes: [], guides: [], guideSources: [],
    questions: [{ id: 'question', subjectId: 'subject', topic: 'Tema', title: 'Pregunta', body: '', authorId: 'demo-1', status: 'open', createdAt }],
    answers: [{ id: 'answer', questionId: 'question', authorId: 'demo-4', body: 'Respuesta', createdAt }],
  }; let viewer = 'demo-1'; let counter = 10_000;
  let files: ResourceFile[] = [];
  const now = new Date('2026-10-21T16:00:00Z');
  const emit = vi.fn();
  const store = new DemoKnowledgeStore({ state: () => state, active: () => {
    const me = members.find((member) => member.id === viewer && member.status === 'active');
    if (!me) throw new Error('No eres miembro activo del grupo.'); return me;
  }, id: () => String(counter++), now: () => now, emit,
  files: () => files,
  restoreFiles: (kind, id, selected) => {
    if (selected.some((fileId) => !files.some((file) => file.id === fileId && file.targetKind === kind && file.targetId === id))) throw new Error('Un archivo ya no está disponible.');
    files = files.map((file) => file.targetKind === kind && file.targetId === id ? { ...file, removedAt: selected.includes(file.id) ? undefined : now } : file);
  }, copyFiles: (from, to) => {
    const copied = new Map<string, string>();
    const additions = files.filter((file) => file.targetKind === 'note' && file.targetId === from && !file.removedAt).map((file): ResourceFile => {
      const id = `published-${to}-${file.id}`; copied.set(file.id, id); return { ...file, id, targetId: to };
    }); files = [...files, ...additions]; return copied;
  } });
  const subject = state.subjects[0]!;
  const input: SaveNoteInput = { subjectId: subject.id, title: 'Nota personal', topic: 'Tema', body: 'Apunte inicial', tags: ['tema'], visibility: 'personal', source: 'student', session: '2026-10-21' };
  return { state, members, store, input, emit, as: (id: string) => { viewer = id; }, addFile: (file: ResourceFile) => { files.push(file); }, files: () => files };
}

describe('simulación de notas y guías', () => {
  it('publica una versión y conserva privados sus cambios posteriores y sus archivos originales', () => {
    const { state, store, input, addFile } = setup();
    const id = store.saveNote({ ...input, body: '![Dibujo](resource:privado)' });
    addFile({ id: 'privado', targetKind: 'note', targetId: id, name: 'dibujo.png', size: 12, contentType: 'image/png', uploadedBy: 'demo-1', createdAt: new Date() });
    const groupId = store.publishNoteVersion(id, 1);
    expect(store.publishNoteVersion(id, 1)).toBe(groupId);
    const published = state.notes.find((note) => note.id === groupId)!;
    expect(published.visibility).toBe('group'); expect(published.body).toContain(`resource:published-${groupId}-privado`);
    store.saveNote({ ...input, id, body: 'Cambio secreto posterior', expectedVersion: 1 });
    expect(state.notes.find((note) => note.id === groupId)?.body).not.toContain('Cambio secreto posterior');
    expect(store.snapshot('demo-4').noteVersions.some((version) => version.noteId === id)).toBe(false);
    expect(store.snapshot('demo-1').noteVersions.filter((version) => version.noteId === id)).toHaveLength(2);
  });

  it('recupera una versión completa, conserva al autor y detecta una edición que ya cambió', () => {
    const { state, store, input } = setup();
    const id = store.saveNote(input);
    store.saveNote({ ...input, id, expectedVersion: 1, title: 'Texto cambiado', session: '2026-10-22' });
    expect(() => store.restoreNoteVersion(id, 1, 1)).toThrow('cambió');
    store.restoreNoteVersion(id, 1, 2);
    const restored = state.notes.find((note) => note.id === id)!;
    expect(restored.title).toBe('Nota personal'); expect(restored.session).toBe('2026-10-21'); expect(restored.authorId).toBe('demo-1'); expect(restored.version).toBe(3);
    expect(store.snapshot('demo-1').noteVersions.find((version) => version.noteId === id && version.version === 3)?.restoredFromVersion).toBe(1);
    expect(() => store.saveNote({ ...input, id, expectedVersion: 3, visibility: 'group' })).toThrow('visibilidad');
  });

  it('no permite editar a otro autor ni enlazar una nota personal desde una pregunta compartida', () => {
    const { store, input, state, as } = setup(); const id = store.saveNote(input);
    as('demo-4'); expect(() => store.saveNote({ ...input, id, expectedVersion: 1 })).toThrow('no existe');
    as('demo-1');
    const question = state.questions.find((item) => item.subjectId === input.subjectId)!;
    expect(() => store.saveQuestionLinks(question.id, [id], [])).toThrow('compartido');
    const published = store.publishNoteVersion(id, 1);
    store.saveQuestionLinks(question.id, [published, published], []);
    expect(store.snapshot('demo-1').questionLinks.filter((link) => link.questionId === question.id)).toHaveLength(1);
  });

  it('las aclaraciones no cuentan como respuestas y las señales de utilidad no se autoasignan', () => {
    const { store, state, members, as } = setup();
    const answer = state.answers[0]!; const before = state.answers.length;
    store.commentQuestion(answer.questionId, '¿Puedes explicar el paso?', answer.id);
    expect(state.answers).toHaveLength(before); expect(store.snapshot('demo-1').questionComments).toHaveLength(1);
    as(answer.authorId); expect(() => store.toggleAnswerUsefulness(answer.id)).toThrow('propia');
    const other = members.find((member) => member.id !== answer.authorId && member.status === 'active')!;
    as(other.id); store.toggleAnswerUsefulness(answer.id); expect(store.snapshot(other.id).answerUsefulness).toHaveLength(1);
    store.toggleAnswerUsefulness(answer.id); expect(store.snapshot(other.id).answerUsefulness).toHaveLength(0);
  });

  it('quien restaura una guía conserva la autoría y la fecha original de sus fuentes', () => {
    const { state, store, input, as } = setup();
    const noteId = store.saveNote({ ...input, visibility: 'group' }); const originalDate = new Date('2026-09-15T12:00:00Z');
    state.guides = [{ id: 'guide', subjectId: input.subjectId, title: 'Guía', topics: ['Tema'], sections: ['', '', '', '', '', '', '', ''], version: 1, createdBy: 'demo-1', createdAt: originalDate, updatedBy: 'demo-1', updatedAt: originalDate }];
    state.guideSources = [{ id: 'source', guideId: 'guide', kind: 'nota', refId: noteId, sourceVersion: 1, status: 'processed', reason: '', topics: ['Tema'], addedBy: 'demo-1', addedAt: originalDate }];
    store.captureGuide('guide');
    state.guides = state.guides.map((guide) => ({ ...guide, version: 2, title: 'Cambio' })); state.guideSources = [];
    as('demo-4'); store.restoreGuideVersion('guide', 1, 2);
    expect(state.guideSources[0]).toMatchObject({ addedBy: 'demo-1', addedAt: originalDate, refId: noteId, status: 'processed' });
    expect(state.guides[0]?.updatedBy).toBe('demo-4');
  });
});
