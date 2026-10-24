import { afterEach, describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';

const sources: DemoDataSource[] = [];
function source(viewer = 'demo-1') {
  const state = createDemoState(new Date(2026, 9, 8));
  state.members[0] = { ...state.members[0]!, photoUrl: 'https://example.com/foto.jpg' };
  const data = new DemoDataSource(state, viewer);
  sources.push(data);
  return { data, state };
}

afterEach(() => {
  sources.splice(0).forEach((data) => data.dispose());
});

describe('nombre del grupo en la simulación', () => {
  it.each(['', ' \t\n ', 'alumno@example.com', 'Ana @ Pérez', 'a'.repeat(81)])('rechaza editar el nombre a %j sin cambiar al miembro', (displayName) => {
    const { data } = source();
    const before = data.getSnapshot().me;
    expect(() => data.updateProfile(displayName, 'https://example.com/otra.jpg')).toThrow(/nombre/);
    expect(data.getSnapshot().me).toEqual(before);
  });

  it.each(['Ana', 'José Ángel', '李', 'Á'.repeat(80)])('guarda el nombre %j recortado y conserva los datos del miembro', (displayName) => {
    const { data } = source();
    const before = data.getSnapshot().me!;
    data.updateProfile(` ${displayName} `, before.photoUrl);
    expect(data.getSnapshot().me).toEqual({ ...before, displayName });
  });

  it.each(['', ' \t\n ', 'alumno@example.com', 'Ana @ Pérez', 'a'.repeat(81)])('valida %j antes de intentar un alta en la simulación', (displayName) => {
    const { data, state } = source('sin-membresia');
    const members = [...state.members];
    const invitations = [...state.invitations];
    expect(() => data.joinGroup(displayName)).toThrow(/nombre/);
    expect(state.members).toEqual(members);
    expect(state.invitations).toEqual(invitations);
  });

  it('mantiene idempotente el ingreso de un miembro existente aunque se envíe un correo', () => {
    const { data } = source();
    const before = data.getSnapshot().me;
    expect(() => data.joinGroup('alumno@example.com')).not.toThrow();
    expect(data.getSnapshot().me).toEqual(before);
  });

  it('permite corregir un correo previo y conserva identidad, membresía y foto', () => {
    const { data, state } = source();
    state.members[0] = { ...state.members[0]!, displayName: 'alumno@example.com' };
    const before = data.getSnapshot().me!;
    expect(before.displayName).toBe('alumno@example.com');
    const count = state.members.length;
    data.updateProfile(' José Ángel ', before.photoUrl);
    expect(state.members).toHaveLength(count);
    expect(data.getSnapshot().me).toEqual({ ...before, displayName: 'José Ángel' });
  });

  it('una persona sin membresía no puede editar su nombre', () => {
    const { data } = source('sin-membresia');
    expect(() => data.updateProfile('Ana')).toThrow(/miembro activo/);
  });
});
