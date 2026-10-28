import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from '../data/demo';
import { filterGuideMaterials, guideAiAttachments, guideAiCandidates, guideAiCandidateText, GUIDE_MATERIAL_PRIMARY_TYPES, type GuideAiCandidate } from './guideAiSources';

describe('material compartido para guías con IA', () => {
  it('incluye notas personales propias, excluye las ajenas y no incluye otras guías', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1');
    const subjectId = source.getSnapshot().subjects[0]!.id;
    const input = { subjectId, title: 'Material', topic: 'Tema', body: 'Texto', source: 'student' as const, tags: [] };
    const own = source.saveNote({ ...input, visibility: 'personal' });
    const shared = source.saveNote({ ...input, visibility: 'group' });
    const guide = source.createGuide({ subjectId, title: 'Guía manual', topicsText: 'Tema', sections: ['Objetivo'] }, []);
    const candidates = guideAiCandidates(source.getSnapshot(), subjectId);
    expect(candidates.find((row) => row.refId === own)).toMatchObject({ visibility: 'personal', authorIds: ['demo-1'] });
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

  it('conserva autores de equipos y clasifica notas y tareas para la selección por persona y módulo', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1');
    const data = source.getSnapshot(); const subjectId = data.subjects[0]!.id;
    const assignmentId = source.createAssignment({ subjectId, kind: 'tarea', title: 'Tarea del equipo', instructions: 'Resuelve el ejercicio' });
    const workId = source.publishWork({ assignmentId, title: 'Equipo para guía', description: 'Contenido del equipo', coauthorIds: ['demo-2'] });
    const noteId = source.saveNote({ subjectId, title: 'Apunte propio', topic: 'Tema', body: 'Contenido compartido', visibility: 'group', source: 'student', tags: [] });
    const candidates = guideAiCandidates(source.getSnapshot(), subjectId);
    expect(candidates.find((row) => row.refId === workId && row.kind === 'work')).toMatchObject({ module: 'tasks', authorIds: ['demo-1', 'demo-2'] });
    expect(candidates.find((row) => row.refId === noteId && row.kind === 'note')).toMatchObject({ module: 'notes', authorIds: ['demo-1'] });
    expect(guideAiCandidateText(source.getSnapshot(), candidates.find((row) => row.refId === workId && row.kind === 'work')!)).toBe('Contenido del equipo');
    source.dispose();
  });

  it('separa tareas, actividades y exámenes según la consigna y admite ambos orígenes de examen', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1'), subjectId = source.getSnapshot().subjects[0]!.id;
    const assignmentId = source.createAssignment({ subjectId, kind: 'examen', title: 'Examen subido', instructions: 'Preguntas' });
    const workId = source.publishWork({ assignmentId, title: 'Examen resuelto', description: 'Solución', coauthorIds: [] });
    const activity = source.createAssignment({ subjectId, kind: 'actividad', title: 'Actividad', instructions: 'Trabajo' });
    const exam = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', subjectId, title: 'Examen del módulo', version: 2, topics: ['Tema'], ownerId: 'demo-1', visibility: 'personal' as const, canIncludeSolutions: true };
    const candidates = guideAiCandidates(source.getSnapshot(), subjectId, undefined, [exam]);
    expect(candidates.find((row) => row.kind === 'assignment' && row.refId === assignmentId)?.module).toBe('exams');
    expect(candidates.find((row) => row.kind === 'work' && row.refId === workId)?.module).toBe('exams');
    expect(candidates.find((row) => row.refId === activity && row.kind === 'assignment')?.module).toBe('activities');
    expect(candidates.find((row) => row.kind === 'exam')).toMatchObject({ module: 'exams', visibility: 'personal', version: 2 }); source.dispose();
  });

  it('combina procedencia, varias personas, tipo, parcial y privacidad sin modificar el catálogo', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1'), data = source.getSnapshot(), subjectId = data.subjects[0]!.id;
    const candidates: GuideAiCandidate[] = [
      { kind: 'note', refId: '1', subjectId, title: 'Propia', topics: ['Tema'], version: 1, revision: '1', authorIds: ['demo-1'], module: 'notes', visibility: 'personal', termId: '101' },
      { kind: 'work', refId: '2', subjectId, title: 'Equipo', topics: ['Tema'], version: 1, revision: '1', authorIds: ['demo-1', 'demo-2'], module: 'tasks', visibility: 'group', termId: '102' },
      { kind: 'note', refId: '3', subjectId, title: 'Ajena', topics: ['Tema'], version: 1, revision: '1', authorIds: ['demo-3'], module: 'notes', visibility: 'group' },
    ];
    const filtered = filterGuideMaterials(candidates, { origin: 'peers', personIds: ['demo-2', 'demo-3'], types: ['tasks'], allTerms: false, termIds: ['102'], privacy: 'group', search: 'equipo' }, data);
    expect(filtered.map((row) => row.refId)).toEqual(['2']); expect(candidates).toHaveLength(3);
    expect(filterGuideMaterials(candidates, { origin: 'own', personIds: [], types: GUIDE_MATERIAL_PRIMARY_TYPES, allTerms: true, termIds: [], privacy: 'personal', search: '' }, data).map((row) => row.refId)).toEqual(['1']); source.dispose();
  });

  it('solo admite proyecciones personales de examen ajeno cuando ya fueron autorizadas por el servidor', () => {
    const source = new DemoDataSource(createDemoState(), 'demo-1'), data = source.getSnapshot(), subjectId = data.subjects[0]!.id;
    const projection = { id: 'abababab-abab-4aba-8aba-abababababab', title: 'Examen ajeno con mi acceso a soluciones', subjectId, version: 2, topics: ['Tema'], ownerId: 'demo-2', visibility: 'personal' as const, canIncludeSolutions: true };
    expect(guideAiCandidates(data, subjectId, undefined, [projection]).some((candidate) => candidate.kind === 'exam')).toBe(false);
    expect(guideAiCandidates(data, subjectId, undefined, [projection], true).find((candidate) => candidate.kind === 'exam')).toMatchObject({ authorIds: ['demo-2'], visibility: 'personal', version: 2 }); source.dispose();
  });

});
