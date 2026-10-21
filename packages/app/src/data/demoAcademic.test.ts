import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import { guideStatus } from '../lib/guides';

const source = () => new DemoDataSource(createDemoState(new Date(2026, 9, 20)), 'demo-1');
const publish = (data: DemoDataSource) => data.publishWork({ assignmentId: 't1', title: 'Trabajo propio',
  description: 'Versión inicial', coauthorIds: ['demo-2'] });

describe('datos académicos con versiones', () => {
  it('conserva registros antiguos y muestra el contenido actual como base sin inventar historia', () => {
    const data = source();
    const legacy = data.getSnapshot().works.find((work) => work.id === 'w4')!;
    expect(legacy.status).toBe('draft');
    const history = data.getSnapshot().workRevisions.filter((revision) => revision.workId === legacy.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ version: legacy.version, description: legacy.description });
    expect(history.some((revision) => revision.version < legacy.version)).toBe(false);
    expect(data.getSnapshot().pageSnapshots.length).toBeGreaterThan(0);
    const id = publish(data);
    expect(data.getSnapshot().works.find((work) => work.id === id)?.status).toBe('draft');
  });

  it('el avance es personal y nunca aparece al cambiar a otro alumno', () => {
    const data = source();
    data.setProgress('assignment', 't1', 'done');
    expect(data.getSnapshot().myProgress).toMatchObject([{ targetId: 't1', status: 'done' }]);
    data.setViewer('demo-2');
    expect(data.getSnapshot().myProgress).toEqual([]);
    data.setProgress('assignment', 't1', 'in_progress');
    data.setViewer('demo-1');
    expect(data.getSnapshot().myProgress[0]?.status).toBe('done');
    data.setViewer('externo');
    expect(data.getSnapshot().myProgress).toEqual([]);
    expect(() => data.setProgress('assignment', 't1', 'done')).toThrow('miembro activo');
  });

  it('exige versión final y comentario de un compañero ajeno a todos los autores', () => {
    const data = source();
    const id = publish(data);
    data.setViewer('demo-3');
    expect(() => data.reviewWork(id, 1, 'Correcto')).toThrow('versión final');
    data.setViewer('demo-1');
    data.saveWorkVersion(id, { title: 'Final', description: 'Explicación', topic: 'Ciclos', status: 'final' }, 1);
    expect(() => data.reviewWork(id, 2, 'Correcto')).toThrow('coautores');
    data.setViewer('demo-2');
    expect(() => data.reviewWork(id, 2, 'Correcto')).toThrow('coautores');
    data.setViewer('demo-3');
    expect(() => data.reviewWork(id, 1, 'Correcto')).toThrow('cambió');
    expect(() => data.reviewWork(id, 2, '  ')).toThrow('vacío');
    data.reviewWork(id, 2, 'Probé el ejemplo y funciona.');
    expect(data.getSnapshot().works.find((work) => work.id === id)?.status).toBe('reviewed');
    expect(data.getSnapshot().workReviews).toMatchObject([{ workId: id, workVersion: 2, reviewerId: 'demo-3' }]);
    data.commentAcademic('work', id, 'Una pregunta para los autores');
    expect(() => data.saveWorkVersion(id, { title: '', description: '', topic: '', status: 'draft' }, 2)).toThrow('Solo el autor');
    data.setViewer('demo-2');
    data.saveWorkVersion(id, { title: 'Corregido', description: 'Nueva explicación', topic: 'Ciclos', status: 'final' }, 2);
    expect(data.getSnapshot().works.find((work) => work.id === id)?.status).toBe('final');
    expect(data.getSnapshot().workReviews[0]?.workVersion).toBe(2);
  });

  it('rechaza ediciones antiguas y restaura creando otra versión sin duplicar el trabajo', () => {
    const data = source();
    const id = publish(data);
    data.saveWorkVersion(id, { title: 'Nueva', description: 'Nueva descripción', topic: 'Tema', status: 'final' }, 1);
    expect(() => data.saveWorkVersion(id, { title: 'Obsoleta', description: '', topic: '', status: 'draft' }, 1)).toThrow('cambió');
    data.restoreWorkVersion(id, 1, 2);
    expect(data.getSnapshot().works.filter((work) => work.id === id)).toHaveLength(1);
    expect(data.getSnapshot().works.find((work) => work.id === id)).toMatchObject({ version: 3, title: 'Trabajo propio', status: 'draft' });
    expect(data.getSnapshot().workRevisions.filter((revision) => revision.workId === id).map((revision) => revision.version)).toEqual([1, 2, 3]);
  });

  it('versiona adjuntos, conserva descargas históricas e invalida revisiones sin cambiar final a borrador', async () => {
    const data = source();
    const id = publish(data);
    data.saveWorkVersion(id, { title: 'Final', description: '', topic: '', status: 'final' }, 1);
    const fileId = await data.attachResourceFile('work', id, new File(['bytes históricos'], 'reporte.txt'), 2);
    expect(data.getSnapshot().works.find((work) => work.id === id)).toMatchObject({ version: 3, status: 'final' });
    data.setViewer('demo-3');
    data.reviewWork(id, 3, 'Revisé el archivo.');
    data.setViewer('demo-1');
    data.removeResourceFile(fileId, 3);
    expect(data.getSnapshot().works.find((work) => work.id === id)).toMatchObject({ version: 4, status: 'final' });
    expect(data.getSnapshot().workFiles.some((file) => file.id === fileId)).toBe(false);
    expect(data.getSnapshot().workRevisions.find((revision) => revision.workId === id && revision.version === 3)?.attachmentIds).toEqual([fileId]);
    expect(await (await data.downloadResourceFile(fileId)).text()).toBe('bytes históricos');
    data.restoreWorkVersion(id, 3, 4);
    expect(data.getSnapshot().workFiles.some((file) => file.id === fileId)).toBe(true);
    expect(data.getSnapshot().works.find((work) => work.id === id)).toMatchObject({ version: 5, status: 'final' });
  });

  it('restaura fechas, clasificación y recursos de la consigna', async () => {
    const data = source();
    const subject = data.getSnapshot().subjects[0]!;
    const term = data.getSnapshot().terms.find((item) => item.subjectId === subject.id)!;
    const input = { subjectId: subject.id, termId: term.id, kind: 'examen' as const, title: 'Examen',
      topic: 'Álgebra', instructions: 'Primera consigna', dueDate: '2026-10-23' };
    const id = data.createAssignment(input);
    const fileId = await data.attachResourceFile('assignment', id, new File(['consigna'], 'original.pdf'), 1);
    data.updateAssignment(id, { ...input, kind: 'tarea', topic: 'Otro tema', instructions: 'Cambio', dueDate: '2026-10-25' }, 2);
    data.removeResourceFile(fileId, 3);
    data.restorePageSnapshot('assignment', id, 2, 4);
    expect(data.getSnapshot().assignments.find((item) => item.id === id)).toMatchObject({ ...input, version: 5 });
    expect(data.getSnapshot().resourceFiles.find((file) => file.id === fileId)?.removedAt).toBeUndefined();
    expect(data.getSnapshot().pageSnapshots.find((item) => item.pageId === id && item.version === 5)?.attachmentIds).toEqual([fileId]);
  });

  it('solo el autor adjunta archivos a evidencias y los enlaces no publican notas personales', async () => {
    const data = source();
    const activity = data.getSnapshot().activities[0]!;
    const id = data.addEvidence(activity.id, 'Resultado', ['demo-2']);
    data.setViewer('demo-2');
    await expect(data.attachResourceFile('evidence', id, new File(['x'], 'evidencia.txt'), 1)).rejects.toThrow('Solo el autor');
    data.setViewer('demo-1');
    await data.attachResourceFile('evidence', id, new File(['x'], 'evidencia.txt'), 1);
    expect(data.getSnapshot().evidences.find((item) => item.id === id)?.version).toBe(2);
    data.commentAcademic('evidence', id, 'Otro enfoque');
    const personal = data.saveNote({ subjectId: activity.subjectId, topic: '', title: 'Privada', body: 'No compartir',
      tags: [], visibility: 'personal', source: 'student' });
    const currentVersion = data.getSnapshot().activities.find((row) => row.id === activity.id)!.version;
    expect(() => data.saveActivityLinks(activity.id, [], [personal], currentVersion)).toThrow('compartida');
    const assignment = data.createAssignment({ subjectId: activity.subjectId, termId: activity.termId,
      title: 'Continuación', instructions: '', kind: 'tarea' });
    data.saveActivityLinks(activity.id, [assignment], [], currentVersion);
    expect(data.getSnapshot().activityLinks).toMatchObject([{ activityId: activity.id, targetId: assignment, targetKind: 'assignment' }]);
  });

  it('cambiar un archivo advierte a la guía que su fuente material quedó desactualizada', async () => {
    const data = source();
    const id = publish(data);
    const assignment = data.getSnapshot().assignments.find((item) => item.id === 't1')!;
    const guideId = data.createGuide({ subjectId: assignment.subjectId, termId: assignment.termId,
      title: 'Guía vinculada', topicsText: 'Tema', sections: [] }, [{ kind: 'trabajo', refId: id }]);
    await data.attachResourceFile('work', id, new File(['cambio'], 'nuevo.txt'), 1);
    const snapshot = data.getSnapshot();
    expect(guideStatus(snapshot.guides.find((guide) => guide.id === guideId)!, snapshot).outdated).toBe(1);
  });

  it('nuevas evidencias y sus archivos cambian la fuente actividad; comentar y restaurar no eliminan evidencias', async () => {
    const data = source();
    const activity = data.getSnapshot().activities[0]!;
    const guideId = data.createGuide({ subjectId: activity.subjectId, termId: activity.termId,
      title: 'Guía de la sesión', topicsText: 'Tema', sections: [] }, [{ kind: 'actividad', refId: activity.id }]);
    const status = () => {
      const snapshot = data.getSnapshot();
      return guideStatus(snapshot.guides.find((row) => row.id === guideId)!, snapshot).outdated;
    };
    const refresh = () => data.refreshGuideSource(data.getSnapshot().guideSources.find((row) => row.guideId === guideId)!.id);
    const version = () => data.getSnapshot().activities.find((row) => row.id === activity.id)!.version;
    const evidenceId = data.addEvidence(activity.id, 'Resultado conservado', []);
    expect(version()).toBe(activity.version + 1);
    expect(status()).toBe(1);
    refresh();
    const fileId = await data.attachResourceFile('evidence', evidenceId, new File(['captura'], 'captura.png'), 1);
    expect(version()).toBe(activity.version + 2);
    expect(status()).toBe(1);
    refresh();
    data.commentAcademic('evidence', evidenceId, 'Comparación de enfoques');
    expect(version()).toBe(activity.version + 2);
    expect(status()).toBe(0);
    data.removeResourceFile(fileId, 2);
    expect(version()).toBe(activity.version + 3);
    expect(status()).toBe(1);
    const current = version();
    data.restorePageSnapshot('activity', activity.id, activity.version, current);
    expect(version()).toBe(current + 1);
    expect(data.getSnapshot().evidences.find((row) => row.id === evidenceId)).toMatchObject({ content: 'Resultado conservado', version: 3 });
    expect(data.getSnapshot().resourceFiles.find((row) => row.id === fileId)?.removedAt).toBeDefined();
    expect(data.getSnapshot().pageSnapshots.filter((row) => row.page === 'activity' && row.pageId === activity.id)
      .map((row) => row.version)).toEqual([activity.version, activity.version + 1, activity.version + 2, activity.version + 3, activity.version + 4]);
  });
});
