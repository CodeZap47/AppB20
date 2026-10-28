import { afterEach, describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';

const sources: DemoDataSource[] = [];
function setup() {
  const state = createDemoState(new Date('2026-10-26T15:00:00Z'));
  const data = new DemoDataSource(state, 'demo-1', () => new Date('2026-10-26T18:00:00Z'));
  sources.push(data);
  return { data, state };
}
const png = () => new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])], 'portada.png', { type: 'image/png' });
afterEach(() => sources.splice(0).forEach((source) => source.dispose()));

describe('catálogo visual en demostración', () => {
  it('guarda fichas privadas y las conserva al recrear la fuente con el mismo estado', async () => {
    const { data, state } = setup();
    const id = await data.saveVisualProject({ title: '  Cómo funciona la RAM  ', kind: '3d', requestId: 'guardar-ram',
      subjectIds: [state.subjects[0]!.id], links: [{ kind: 'assignment', id: state.assignments[0]!.id }],
      resources: [{ label: 'Modelo', url: 'https://example.com/modelo.glb', author: 'Autora', license: 'CC BY' }] });
    expect(data.getSnapshot().visualProjects).toMatchObject([{ id, title: 'Cómo funciona la RAM', visibility: 'personal', version: 1 }]);
    const reconnected = new DemoDataSource(state, 'demo-1'); sources.push(reconnected);
    expect(reconnected.getSnapshot().visualProjects[0]?.id).toBe(id);
    data.setViewer('demo-2');
    expect(data.getSnapshot().visualProjects).toEqual([]);
    await expect(data.saveVisualProject({ id, title: 'Cambio ajeno', kind: 'graphic', expectedVersion: 1 })).rejects.toThrow('autor');
    await expect(data.setVisualProjectVisibility(id, 'group', 1)).rejects.toThrow('autor');
  });

  it('identifica reintentos de creación sin duplicar ni aceptar otro contenido con el mismo envío', async () => {
    const { data } = setup();
    const input = { title: 'Hardware', kind: '3d' as const, requestId: 'mismo-envio' };
    const id = await data.saveVisualProject(input);
    await expect(data.saveVisualProject(input)).resolves.toBe(id);
    expect(data.getSnapshot().visualProjects).toHaveLength(1);
    await expect(data.saveVisualProject({ ...input, title: 'Otro' })).rejects.toThrow('otro proyecto');
  });

  it('comparte, vuelve a privado y archiva sin dar permisos de escritura al grupo', async () => {
    const { data } = setup();
    const id = await data.saveVisualProject({ title: 'Redes', kind: 'simulation' });
    await data.setVisualProjectVisibility(id, 'group', 1);
    data.setViewer('demo-2');
    expect(data.getSnapshot().visualProjects[0]?.visibility).toBe('group');
    await expect(data.archiveVisualProject(id, true, 2)).rejects.toThrow('autor');
    data.setViewer('demo-1');
    await data.archiveVisualProject(id, true, 2);
    expect(data.getSnapshot().visualProjects[0]?.archived).toBe(true);
    data.setViewer('demo-2'); expect(data.getSnapshot().visualProjects).toEqual([]);
    data.setViewer('demo-1');
    await expect(data.saveVisualProject({ id, title: 'Editar archivado', kind: '3d', expectedVersion: 3 })).rejects.toThrow('Restaura');
    await data.archiveVisualProject(id, false, 3);
    await data.setVisualProjectVisibility(id, 'personal', 4);
    data.setViewer('demo-2'); expect(data.getSnapshot().visualProjects).toEqual([]);
  });

  it('bloquea publicar notas personales y vuelve a revisar fuentes al editar un proyecto compartido', async () => {
    const { data, state } = setup();
    const noteId = data.saveNote({ subjectId: state.subjects[0]!.id, title: 'Apunte personal', body: 'Privado',
      visibility: 'personal', source: 'student', topic: '', tags: [] });
    const id = await data.saveVisualProject({ title: 'CPU', kind: '3d', links: [{ kind: 'note', id: noteId }] });
    await expect(data.setVisualProjectVisibility(id, 'group', 1)).rejects.toThrow('grupo');
    await data.saveVisualProject({ id, title: 'CPU', kind: '3d', links: [], expectedVersion: 1 });
    await data.setVisualProjectVisibility(id, 'group', 2);
    await expect(data.saveVisualProject({ id, title: 'CPU', kind: '3d', links: [{ kind: 'note', id: noteId }], expectedVersion: 3 })).rejects.toThrow('grupo');
    expect(data.getSnapshot().visualProjects[0]?.links).toEqual([]);
  });

  it('oculta relaciones cuando una fuente cambia a privada y permite restaurar sin quedar atrapado', async () => {
    const { data, state } = setup();
    const noteId = data.saveNote({ subjectId: state.subjects[0]!.id, title: 'Referencia compartida', body: 'Contenido',
      visibility: 'group', source: 'student', topic: '', tags: [] });
    const id = await data.saveVisualProject({ title: 'Memoria', kind: 'graphic', links: [{ kind: 'note', id: noteId }] });
    await data.setVisualProjectVisibility(id, 'group', 1);
    await data.archiveVisualProject(id, true, 2);
    state.notes = state.notes.map((note) => note.id === noteId ? { ...note, visibility: 'personal' } : note);
    await data.archiveVisualProject(id, false, 3);
    data.setViewer('demo-2');
    expect(data.getSnapshot().visualProjects[0]?.links).toEqual([]);
    expect(JSON.stringify(data.getSnapshot().visualProjects)).not.toContain(noteId);
    data.setViewer('demo-1');
    await data.setVisualProjectVisibility(id, 'personal', 4);
    expect(data.getSnapshot().visualProjects[0]?.links).toEqual([{ kind: 'note', id: noteId }]);
  });

  it('conserva una fuente retirada al editar el título y la vuelve a resolver cuando se restaura', async () => {
    const { data, state } = setup();
    const noteId = data.saveNote({ subjectId: state.subjects[0]!.id, title: 'Fuente que se retira', body: 'Contenido',
      visibility: 'group', source: 'student', topic: '', tags: [] });
    const relation = { kind: 'note' as const, id: noteId };
    const id = await data.saveVisualProject({ title: 'Ficha original', kind: '3d', links: [relation] });
    await data.setVisualProjectVisibility(id, 'group', 1);
    data.withdrawContent('note', noteId, true, 1);
    expect(data.getSnapshot().visualProjects[0]).toMatchObject({ links: [], unavailableLinks: [relation] });
    // An older editor submits only the visible references and must not drop the hidden one.
    await data.saveVisualProject({ id, title: 'Título corregido', kind: '3d', links: [], expectedVersion: 2 });
    expect(state.visualProjects[0]?.links).toEqual([relation]);
    expect(data.getSnapshot().visualProjects[0]).toMatchObject({ title: 'Título corregido', unavailableLinks: [relation] });
    await expect(data.setVisualProjectVisibility(id, 'group', 3)).rejects.toThrow('disponible');
    for (const viewer of ['demo-2', 'demo-3']) {
      data.setViewer(viewer);
      const view = data.getSnapshot().visualProjects[0]!;
      expect(view.links).toEqual([]);
      expect(view.unavailableLinks).toBeUndefined();
      expect(JSON.stringify(view)).not.toContain(noteId);
    }
    data.setViewer('demo-1');
    const noteVersion = state.notes.find(note => note.id === noteId)!.version;
    data.withdrawContent('note', noteId, false, noteVersion);
    expect(data.getSnapshot().visualProjects[0]?.links).toEqual([relation]);
    expect(data.getSnapshot().visualProjects[0]?.unavailableLinks).toBeUndefined();
  });

  it('conserva una referencia que se retira después de abrir el editor y respeta la retirada expresa', async () => {
    const { data, state } = setup();
    const noteId = data.saveNote({ subjectId: state.subjects[0]!.id, title: 'Fuente original', body: 'Contenido',
      visibility: 'group', source: 'student', topic: '', tags: [] });
    const relation = { kind: 'note' as const, id: noteId };
    const id = await data.saveVisualProject({ title: 'Hardware', kind: '3d', links: [relation] });
    const editorLinks = data.getSnapshot().visualProjects[0]!.links;
    data.withdrawContent('note', noteId, true, 1);
    await data.saveVisualProject({ id, title: 'Editada desde una sesión anterior', kind: '3d', links: editorLinks, expectedVersion: 1 });
    expect(state.visualProjects[0]?.links).toEqual([relation]);
    await data.saveVisualProject({ id, title: 'Relación retirada expresamente', kind: '3d', links: [], removedLinks: [relation], expectedVersion: 2 });
    expect(state.visualProjects[0]?.links).toEqual([]);
    expect(data.getSnapshot().visualProjects[0]?.unavailableLinks).toBeUndefined();
  });

  it('reemplaza una referencia no disponible de forma atómica y rechaza fuentes nuevas sin acceso', async () => {
    const { data, state } = setup();
    const noteId = data.saveNote({ subjectId: state.subjects[0]!.id, title: 'Referencia anterior', body: 'Contenido',
      visibility: 'group', source: 'student', topic: '', tags: [] });
    const relation = { kind: 'note' as const, id: noteId };
    const id = await data.saveVisualProject({ title: 'Diseño', kind: 'graphic', links: [relation] });
    data.withdrawContent('note', noteId, true, 1);
    await expect(data.saveVisualProject({ id, title: 'Reemplazo inválido', kind: 'graphic', links: [{ kind: 'note', id: 'inaccesible' }],
      removedLinks: [relation], expectedVersion: 1 })).rejects.toThrow('disponible');
    expect(state.visualProjects[0]?.links).toEqual([relation]);
    expect(state.visualProjects[0]?.title).toBe('Diseño');
    const replacement = { kind: 'assignment' as const, id: state.assignments[0]!.id };
    await data.saveVisualProject({ id, title: 'Reemplazo autorizado', kind: 'graphic', links: [replacement], removedLinks: [relation], expectedVersion: 1 });
    expect(state.visualProjects[0]?.links).toEqual([replacement]);
    expect(state.visualProjects[0]).not.toHaveProperty('removedLinks');
    expect(state.visualProjects[0]).not.toHaveProperty('unavailableLinks');
  });

  it('conserva relaciones antes compartibles que pasan a personales y exige resolverlas al publicar', async () => {
    const { data, state } = setup();
    const noteId = data.saveNote({ subjectId: state.subjects[0]!.id, title: 'Fuente compartida', body: 'Contenido',
      visibility: 'group', source: 'student', topic: '', tags: [] });
    const relation = { kind: 'note' as const, id: noteId };
    const id = await data.saveVisualProject({ title: 'Explicación', kind: 'mixed', links: [relation] });
    await data.setVisualProjectVisibility(id, 'group', 1);
    state.notes = state.notes.map(note => note.id === noteId ? { ...note, visibility: 'personal' } : note);
    await data.saveVisualProject({ id, title: 'Título actualizado', kind: 'mixed', links: [], expectedVersion: 2 });
    expect(state.visualProjects[0]?.links).toEqual([relation]);
    await expect(data.setVisualProjectVisibility(id, 'group', 3)).rejects.toThrow('grupo');
    data.setViewer('demo-2');
    expect(data.getSnapshot().visualProjects[0]?.links).toEqual([]);
    expect(data.getSnapshot().visualProjects[0]?.unavailableLinks).toBeUndefined();
  });

  it('rechaza retiradas inventadas o contradictorias sin mutar la ficha', async () => {
    const { data, state } = setup();
    const relation = { kind: 'assignment' as const, id: state.assignments[0]!.id };
    await expect(data.saveVisualProject({ title: 'Nueva', kind: '3d', removedLinks: [relation] })).rejects.toThrow('todavía no existe');
    const id = await data.saveVisualProject({ title: 'Original', kind: '3d', links: [relation] });
    await expect(data.saveVisualProject({ id, title: 'Contradicción', kind: '3d', links: [relation], removedLinks: [relation], expectedVersion: 1 })).rejects.toThrow('conservar y quitar');
    await expect(data.saveVisualProject({ id, title: 'Retirada inventada', kind: '3d', removedLinks: [{ kind: 'note', id: 'ajena' }], expectedVersion: 1 })).rejects.toThrow('no pertenece');
    expect(state.visualProjects[0]).toMatchObject({ title: 'Original', version: 1, links: [relation] });
  });

  it('protege las portadas privadas, confirma su versión y sigue la disponibilidad del proyecto', async () => {
    const { data } = setup();
    const id = await data.saveVisualProject({ title: 'Placa base', kind: '3d' });
    const file = await data.attachResourceFile('visual_project', id, png(), 1);
    expect(data.getSnapshot().visualProjects[0]).toMatchObject({ version: 2, coverFileId: file });
    expect((await data.downloadResourceFile(file)).size).toBe(8);
    data.setViewer('demo-2');
    expect(data.getSnapshot().resourceFiles.some((entry) => entry.id === file)).toBe(false);
    await expect(data.downloadResourceFile(file)).rejects.toThrow('acceso');
    data.setViewer('demo-1'); await data.setVisualProjectVisibility(id, 'group', 2);
    data.setViewer('demo-2');
    expect(data.getSnapshot().resourceFiles.some((entry) => entry.id === file)).toBe(true);
    await expect(data.attachResourceFile('visual_project', id, png(), 3)).rejects.toThrow('autor');
    data.setViewer('demo-1'); await data.setVisualProjectVisibility(id, 'personal', 3);
    data.setViewer('demo-2'); await expect(data.downloadResourceFile(file)).rejects.toThrow('acceso');
  });

  it('conserva las portadas al recrear la fuente y las comparte entre sesiones del mismo estado', async () => {
    const { data, state } = setup();
    const id = await data.saveVisualProject({ title: 'Modelo persistente', kind: '3d' });
    const coverId = await data.attachResourceFile('visual_project', id, png(), 1);
    const peer = new DemoDataSource(state, 'demo-2'); sources.push(peer);
    expect(peer.getSnapshot().resourceFiles.some((file) => file.id === coverId)).toBe(false);
    await expect(peer.downloadResourceFile(coverId)).rejects.toThrow('acceso');
    data.dispose();
    const reconnected = new DemoDataSource(state, 'demo-1'); sources.push(reconnected);
    expect(reconnected.getSnapshot().visualProjects[0]?.coverFileId).toBe(coverId);
    expect((await reconnected.downloadResourceFile(coverId)).size).toBe(8);
    await reconnected.setVisualProjectVisibility(id, 'group', 2);
    expect(peer.getSnapshot().visualProjects[0]?.coverFileId).toBe(coverId);
    expect((await peer.downloadResourceFile(coverId)).size).toBe(8);
    const replacement = await reconnected.attachResourceFile('visual_project', id, png(), 3);
    expect(peer.getSnapshot().visualProjects[0]?.coverFileId).toBe(replacement);
    await expect(peer.downloadResourceFile(coverId)).rejects.toThrow('acceso');
    await reconnected.archiveVisualProject(id, true, 4);
    expect((await reconnected.downloadResourceFile(replacement)).size).toBe(8);
    await expect(peer.downloadResourceFile(replacement)).rejects.toThrow('acceso');
    await reconnected.archiveVisualProject(id, false, 5);
    await reconnected.setVisualProjectVisibility(id, 'personal', 6);
    await expect(peer.downloadResourceFile(replacement)).rejects.toThrow('acceso');
    reconnected.removeResourceFile(replacement, 7);
    expect(reconnected.getSnapshot().visualProjects[0]?.coverFileId).toBe(coverId);
    await expect(reconnected.downloadResourceFile(replacement)).rejects.toThrow('retirada');
  });

  it('no entrega una portada pendiente si cambia la cuenta antes de recibirla', async () => {
    const { data } = setup();
    const id = await data.saveVisualProject({ title: 'Portada privada', kind: '3d' });
    const coverId = await data.attachResourceFile('visual_project', id, png(), 1);
    const pending = data.downloadResourceFile(coverId);
    data.setViewer('demo-2');
    await expect(pending).rejects.toThrow('sesión cambió');
  });

  it('rechaza portadas falsas o demasiado pesadas y enlaces inválidos sin alterar la ficha', async () => {
    const { data } = setup();
    const id = await data.saveVisualProject({ title: 'Modelo', kind: '3d' });
    await expect(data.attachResourceFile('visual_project', id, new File(['texto'], 'falsa.png', { type: 'image/png' }), 1)).rejects.toThrow('imagen');
    await expect(data.attachResourceFile('visual_project', id, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' }), 1)).rejects.toThrow('5 MiB');
    await expect(data.saveVisualProject({ id, expectedVersion: 1, title: 'Modelo', kind: '3d', resources: [{ label: 'Archivo', url: 'javascript:alert(1)' }] })).rejects.toThrow('HTTPS');
    expect(data.getSnapshot().visualProjects[0]?.version).toBe(1);
    expect(data.getSnapshot().visualProjects[0]?.coverFileId).toBeUndefined();
  });

  it('rechaza versiones antiguas y recursos no disponibles sin perder los cambios guardados', async () => {
    const { data } = setup();
    const id = await data.saveVisualProject({ title: 'Primera', kind: 'mixed' });
    await data.saveVisualProject({ id, title: 'Guardada', kind: 'mixed', expectedVersion: 1 });
    await expect(data.saveVisualProject({ id, title: 'Antigua', kind: '3d', expectedVersion: 1 })).rejects.toThrow('cambió');
    await expect(data.saveVisualProject({ id, title: 'Inválida', kind: '3d', expectedVersion: 2, links: [{ kind: 'note', id: 'no-existe' }] })).rejects.toThrow('disponible');
    expect(data.getSnapshot().visualProjects[0]?.title).toBe('Guardada');
    expect(data.getSnapshot().visualProjects[0]?.version).toBe(2);
  });
});
