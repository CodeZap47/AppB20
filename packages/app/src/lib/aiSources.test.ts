import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from '../data/demo';
import { aiSourceCandidates } from './aiSources';

describe('candidatos para preparar material de IA', () => {
  it('incluye notas propias y del grupo, excluye privadas ajenas y retiradas', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1');
    const data = source.getSnapshot();
    const subjectId = data.subjects[0]!.id;
    const base = { subjectId, title: 'Nota', topic: 'Tema', body: 'Texto académico', tags: [], source: 'student' as const };
    const mine = source.saveNote({ ...base, visibility: 'personal' });
    source.setViewer('demo-4');
    const theirs = source.saveNote({ ...base, visibility: 'personal' });
    const shared = source.saveNote({ ...base, visibility: 'group' });
    source.setViewer('demo-1');
    const snapshot = source.getSnapshot();
    const candidates = aiSourceCandidates(snapshot, subjectId);
    expect(candidates.find((row) => row.refId === mine)?.personal).toBe(true);
    expect(candidates.some((row) => row.refId === theirs)).toBe(false);
    expect(candidates.find((row) => row.refId === shared)?.personal).toBe(false);
    const withdrawn = { ...snapshot, notes: snapshot.notes.map((note) => note.id === shared ? { ...note, withdrawnAt: new Date() } : note) };
    expect(aiSourceCandidates(withdrawn, subjectId).some((row) => row.refId === shared)).toBe(false);
    source.dispose();
  });

  it('usa la clasificación del padre e invalida ante cambios de contenido sin historial', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1');
    const data = source.getSnapshot();
    const activity = data.activities[0]!;
    const evidence = { id: '987', activityId: activity.id, authorId: data.me!.id, participantIds: [], content: 'Inicial', createdAt: new Date() };
    const withEvidence = { ...data, evidences: [evidence], activities: data.activities.map((entry) => entry.id === activity.id ? { ...entry, termId: '123' } : entry) };
    expect(aiSourceCandidates(withEvidence, activity.subjectId, '456').some((row) => row.kind === 'evidence')).toBe(false);
    const before = aiSourceCandidates(withEvidence, activity.subjectId, '123').find((row) => row.kind === 'evidence')!;
    expect(before.termId).toBe('123');
    const after = aiSourceCandidates({ ...withEvidence, evidences: [{ ...evidence, content: 'Editado sin cambiar versión' }] }, activity.subjectId, '123').find((row) => row.kind === 'evidence')!;
    expect(before.revision).not.toBe(after.revision);
    expect(aiSourceCandidates({ ...withEvidence, activities: [] }, activity.subjectId).some((row) => row.kind === 'evidence')).toBe(false);
    source.dispose();
  });
});
