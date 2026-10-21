import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from '../data/demo';
import { guideAiAttachments, guideAiCandidates } from './guideAiSources';

describe('material compartido para guías con IA', () => {
  it('excluye notas personales incluso propias y no incluye otras guías', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1');
    const subjectId = source.getSnapshot().subjects[0]!.id;
    const input = { subjectId, title: 'Material', topic: 'Tema', body: 'Texto', source: 'student' as const, tags: [] };
    const own = source.saveNote({ ...input, visibility: 'personal' });
    const shared = source.saveNote({ ...input, visibility: 'group' });
    const guide = source.createGuide({ subjectId, title: 'Guía manual', topicsText: 'Tema', sections: ['Objetivo'] }, []);
    const candidates = guideAiCandidates(source.getSnapshot(), subjectId);
    expect(candidates.some((row) => row.refId === own)).toBe(false);
    expect(candidates.some((row) => row.refId === shared && row.kind === 'note')).toBe(true);
    expect(candidates.some((row) => row.refId === guide && String(row.kind) === 'guide')).toBe(false);
    source.dispose();
  });

  it('las respuestas retiradas no entran en la revisión y el cambio público invalida la selección', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1');
    const data = source.getSnapshot(); const subjectId = data.subjects[0]!.id;
    const question = { id: '991', subjectId, title: 'Duda', body: '¿Cómo funciona?', topic: 'Tema', authorId: data.me!.id, status: 'open' as const, createdAt: new Date() };
    const answer = { id: '992', questionId: question.id, body: 'Explicación pública', authorId: data.me!.id, createdAt: new Date() };
    const before = guideAiCandidates({ ...data, questions: [question], answers: [answer] }, subjectId)[0]!;
    const after = guideAiCandidates({ ...data, questions: [question], answers: [{ ...answer, withdrawnAt: new Date() }] }, subjectId)[0]!;
    expect(before.kind).toBe('question'); expect(before.termId).toBeUndefined();
    expect(before.revision).not.toBe(after.revision);
    expect(guideAiCandidates({ ...data, questions: [{ ...question, withdrawnAt: new Date() }] }, subjectId).some((row) => row.kind === 'question')).toBe(false);
    source.dispose();
  });

  it('los adjuntos corresponden a la fuente seleccionada y excluyen retirados', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1'); const data = source.getSnapshot();
    const candidate = { kind: 'activity' as const, refId: '11', subjectId: data.subjects[0]!.id, title: 'Actividad', topics: [], version: 1, revision: '1' };
    const file = { id: 'a', targetKind: 'activity' as const, targetId: '11', name: 'material.txt', size: 10, contentType: 'text/plain', uploadedBy: data.me!.id, createdAt: new Date() };
    const input = { ...data, resourceFiles: [file, { ...file, id: 'b', removedAt: new Date() }, { ...file, id: 'c', targetId: '12' }] };
    expect(guideAiAttachments(input, candidate).map((row) => row.id)).toEqual(['a']); source.dispose();
  });
});
