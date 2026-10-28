import { describe, expect, it, vi } from 'vitest';
import type { VisualProject } from '@b20/core';
import type { DbConnection } from '../module_bindings';
import type { Note, Snapshot } from './types';
import { createVisualProjectsActions } from './visualProjectsActions';
import { emptySnapshot, PUBLIC_VIEWS, readSnapshot } from './spacetimeSnapshot';
import { readVisualProjectsSnapshot } from './visualProjectsSnapshot';

const SELF = '00000000000000000000000000000000000000000000000000000000000000aa';
const OTHER = '00000000000000000000000000000000000000000000000000000000000000bb';
const HIGH = 18_446_744_073_709_551_614n;
const at = new Date('2026-10-26T18:00:00Z');
const timestamp = { toDate: () => new Date(at) };
const identity = (id = SELF) => ({ toHexString: () => id });
const member = (id = SELF) => ({ identity: identity(id), displayName: 'Integrante', status: 'active', isCreator: true, joinedAt: timestamp });
const project = (extra: Partial<VisualProject> = {}): VisualProject => ({ id: HIGH.toString(), authorId: SELF,
  title: 'Explicación de hardware', kind: '3d', description: '', objective: '', topic: '', tags: [], subjectIds: [],
  links: [], resources: [], visibility: 'personal', archived: false, version: 1, createdAt: at.getTime(), updatedAt: at.getTime(), ...extra });
const row = (value = project(), requestId = '') => ({ id: BigInt(value.id), requestId, json: JSON.stringify(value) });
const academicSnapshot = (notes: Note[] = []): Snapshot => ({ ...emptySnapshot('ready'),
  me: { id: SELF, displayName: 'Integrante', status: 'active', isCreator: true, joinedAt: at }, notes });
const note = (extra: Partial<Note> = {}): Note => ({ id: '17', subjectId: '1', topic: '', title: 'Fuente autorizada', body: 'Contenido',
  tags: [], visibility: 'group', source: 'student', authorId: SELF, version: 1, createdAt: at, updatedAt: at, ...extra });

function setup(initial: Record<string, unknown[]> = {}, reducers: Record<string, unknown> = {}) {
  const rows: Record<string, unknown[]> = { myMember: [member()], members: [member(), member(OTHER)], ...initial };
  const db = new Proxy({}, { get: (_target, name: string) => ({ iter: () => (rows[name] ?? []).values() }) });
  const connection = { db, reducers } as unknown as DbConnection;
  return { rows, connection, actions: createVisualProjectsActions(() => connection, () => SELF) };
}

describe('adaptador del laboratorio visual', () => {
  it('suscribe solo la vista filtrada y conserva IDs u64, fechas y versiones', () => {
    expect(PUBLIC_VIEWS).toContain('visual_projects');
    expect(PUBLIC_VIEWS).not.toContain('visual_project');
    const { connection } = setup({ visualProjects: [row()] });
    expect(readSnapshot(connection, SELF).visualProjects).toEqual([project()]);
    expect(emptySnapshot('offline').visualProjects).toEqual([]);
  });

  it('descarta caché privada ajena y archivos de sus proyectos incluso para un administrador', () => {
    const { connection } = setup({ visualProjects: [row(project({ authorId: OTHER, title: 'Secreto', kind: 'futuro' as '3d' }))],
      resourceFiles: [{ id: 'archivo-privado', targetKind: 'visual_project', targetId: HIGH,
        name: 'privada.png', size: 8n, contentType: 'image/png', uploadedBy: identity(OTHER), createdAt: timestamp }] });
    const snapshot = readSnapshot(connection, SELF);
    expect(snapshot.visualProjects).toEqual([]);
    expect(snapshot.resourceFiles).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('Secreto');
  });

  it('oculta proyectos archivados ajenos y limpia la caché al perder membresía', () => {
    const { connection, rows } = setup({ visualProjects: [row(project({ authorId: OTHER, visibility: 'group', archived: true }))] });
    expect(readSnapshot(connection, SELF).visualProjects).toEqual([]);
    rows.myMember = [member(OTHER)];
    expect(readSnapshot(connection, SELF).visualProjects).toEqual([]);
  });

  it('convierte una relación que desapareció del snapshot en un marcador exclusivo del autor', () => {
    const { connection } = setup({ visualProjects: [row(project({ visibility: 'group', links: [{ kind: 'note', id: '17' }] }))] });
    const value = readSnapshot(connection, SELF).visualProjects[0]!;
    expect(value.links).toEqual([]);
    expect(value.unavailableLinks).toEqual([{ kind: 'note', id: '17' }]);
  });

  it('conserva marcadores del servidor sin copiar títulos ni reactivarlos desde un snapshot anterior', () => {
    const { connection, rows } = setup({ visualProjects: [{ id: HIGH, requestId: '', json: JSON.stringify({ ...project(),
      links: [{ kind: 'note', id: '17' }], unavailableLinks: [{ kind: 'note', id: '17', title: 'Secreto anterior', url: 'https://example.com/privado' }] }) }] });
    const value = readVisualProjectsSnapshot(connection, academicSnapshot([note()]), SELF)[0]!;
    expect(value.links).toEqual([]);
    expect(value.unavailableLinks).toEqual([{ kind: 'note', id: '17' }]);
    expect(JSON.stringify(value)).not.toContain('Secreto anterior');
    expect(JSON.stringify(value)).not.toContain('https://example.com/privado');
    rows.visualProjects = [row(project({ links: [{ kind: 'note', id: '17' }] }))];
    const restored = readVisualProjectsSnapshot(connection, academicSnapshot([note()]), SELF)[0]!;
    expect(restored.links).toEqual([{ kind: 'note', id: '17' }]);
    expect(restored.unavailableLinks).toBeUndefined();
  });

  it('descarta marcadores ajenos y referencias privadas de un snapshot rezagado incluso ante un administrador', () => {
    const { connection } = setup({ visualProjects: [{ id: HIGH, requestId: '', json: JSON.stringify({ ...project({ authorId: OTHER, visibility: 'group' }),
      links: [{ kind: 'note', id: '17' }], unavailableLinks: [{ kind: 'note', id: '99', title: 'Fuente oculta' }] }) }] });
    const value = readVisualProjectsSnapshot(connection, academicSnapshot([note({ authorId: OTHER, visibility: 'personal' })]), SELF)[0]!;
    expect(value.links).toEqual([]);
    expect(value.unavailableLinks).toBeUndefined();
    expect(JSON.stringify(value)).not.toContain('Fuente oculta');
    expect(JSON.stringify(value)).not.toContain('"17"');
    expect(JSON.stringify(value)).not.toContain('"99"');
  });

  it('ignora un campo de marcadores ajeno inválido sin romper la ficha pública', () => {
    const { connection } = setup({ visualProjects: [{ id: HIGH, requestId: '', json: JSON.stringify({ ...project({ authorId: OTHER, visibility: 'group' }), unavailableLinks: 'datos ajenos' }) }] });
    const value = readVisualProjectsSnapshot(connection, academicSnapshot(), SELF)[0]!;
    expect(value.title).toBe('Explicación de hardware');
    expect(value.unavailableLinks).toBeUndefined();
  });

  it('rechaza contratos propios inválidos con un error recuperable', () => {
    const { connection } = setup({ visualProjects: [row(project({ kind: 'futuro' as '3d' }))] });
    const base = { ...emptySnapshot('ready'), me: { id: SELF, displayName: 'Integrante', status: 'active' as const, isCreator: true, joinedAt: at } };
    expect(() => readVisualProjectsSnapshot(connection, base, SELF)).toThrow('actualización');
  });

  it('confirma una creación por el recibo propio y reenvía el mismo identificador al reintentar', async () => {
    let rows: Record<string, unknown[]>;
    const saveVisualProject = vi.fn(async () => {
      rows.visualProjects = [row(project({ id: '12', authorId: OTHER }), 'estable'), row(project(), 'estable')];
    });
    const setupResult = setup({ visualProjects: [] }, { saveVisualProject });
    rows = setupResult.rows;
    const input = { title: 'Explicación de hardware', kind: '3d' as const, requestId: 'estable' };
    await expect(setupResult.actions.saveVisualProject(input)).resolves.toBe(HIGH.toString());
    await expect(setupResult.actions.saveVisualProject(input)).resolves.toBe(HIGH.toString());
    expect(saveVisualProject).toHaveBeenCalledWith({ projectId: undefined, expectedVersion: undefined,
      requestId: 'estable', payload: JSON.stringify({ title: input.title, kind: input.kind }) });
  });

  it('no devuelve una página ajena cuando falta el recibo de creación', async () => {
    const { actions } = setup({ visualProjects: [row(project({ authorId: OTHER }), 'estable')] }, { saveVisualProject: vi.fn(async () => {}) });
    await expect(actions.saveVisualProject({ title: 'Proyecto', kind: '3d', requestId: 'estable' })).rejects.toThrow('confirmar');
  });

  it('envía IDs y versiones exactas al editar, publicar y archivar sin modificar la caché', async () => {
    const saveVisualProject = vi.fn(async () => {});
    const setVisualProjectVisibility = vi.fn(async () => {});
    const archiveVisualProject = vi.fn(async () => {});
    const { actions, rows } = setup({ visualProjects: [row()] }, { saveVisualProject, setVisualProjectVisibility, archiveVisualProject });
    await expect(actions.saveVisualProject({ id: HIGH.toString(), title: 'Nueva versión', kind: 'mixed', expectedVersion: 7, requestId: 'edicion' })).resolves.toBe(HIGH.toString());
    await actions.setVisualProjectVisibility(HIGH.toString(), 'group', 7);
    await actions.archiveVisualProject(HIGH.toString(), true, 8);
    expect(saveVisualProject).toHaveBeenCalledWith({ projectId: HIGH, expectedVersion: 7, requestId: 'edicion', payload: JSON.stringify({ title: 'Nueva versión', kind: 'mixed' }) });
    expect(setVisualProjectVisibility).toHaveBeenCalledWith({ projectId: HIGH, visibility: 'group', expectedVersion: 7 });
    expect(archiveVisualProject).toHaveBeenCalledWith({ projectId: HIGH, archived: true, expectedVersion: 8 });
    expect(rows.visualProjects).toEqual([row()]);
  });

  it('envía retiradas expresas en el JSON existente sin convertirlas en metadatos de la ficha', async () => {
    const saveVisualProject = vi.fn(async (_input: { payload: string }) => {});
    const { actions, rows } = setup({ visualProjects: [row()] }, { saveVisualProject });
    await actions.saveVisualProject({ id: HIGH.toString(), title: 'Reparada', kind: '3d', expectedVersion: 1,
      removedLinks: [{ kind: 'note', id: '17' }], links: [{ kind: 'guide', id: '18' }] });
    const payload = JSON.parse(saveVisualProject.mock.calls[0]![0].payload);
    expect(payload.removedLinks).toEqual([{ kind: 'note', id: '17' }]);
    expect(payload.links).toEqual([{ kind: 'guide', id: '18' }]);
    expect(rows.visualProjects).toEqual([row()]);
  });

  it('no usa la confirmación anterior si cambia la cuenta durante el envío', async () => {
    let actor = SELF;
    const { connection } = setup({ visualProjects: [row(project(), 'estable')] }, { saveVisualProject: vi.fn(async () => { actor = OTHER; }) });
    const actions = createVisualProjectsActions(() => connection, () => actor);
    await expect(actions.saveVisualProject({ title: 'Proyecto', kind: '3d', requestId: 'estable' })).rejects.toThrow('sesión cambió');
  });

  it.each(['visibility', 'archive'] as const)('ignora una confirmación de %s si cambió la cuenta', async (operation) => {
    let actor = SELF;
    const changeAccount = vi.fn(async () => { actor = OTHER; });
    const { connection } = setup({}, { setVisualProjectVisibility: changeAccount, archiveVisualProject: changeAccount });
    const actions = createVisualProjectsActions(() => connection, () => actor);
    const pending = operation === 'visibility' ? actions.setVisualProjectVisibility(HIGH.toString(), 'group', 1)
      : actions.archiveVisualProject(HIGH.toString(), true, 1);
    await expect(pending).rejects.toThrow('sesión cambió');
  });

  it.each(['visibility', 'archive'] as const)('ignora una confirmación de %s si cambió la conexión', async (operation) => {
    const { connection } = setup();
    const replacement = setup().connection;
    let current = connection;
    const changeConnection = vi.fn(async () => { current = replacement; });
    Object.assign(connection, { reducers: { setVisualProjectVisibility: changeConnection, archiveVisualProject: changeConnection } });
    const actions = createVisualProjectsActions(() => current, () => SELF);
    const pending = operation === 'visibility' ? actions.setVisualProjectVisibility(HIGH.toString(), 'group', 1)
      : actions.archiveVisualProject(HIGH.toString(), true, 1);
    await expect(pending).rejects.toThrow('sesión cambió');
  });
});
