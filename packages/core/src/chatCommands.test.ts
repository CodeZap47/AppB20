import { describe, expect, it } from 'vitest';
import { CHAT_RESOURCE_KINDS, cleanChatCommand } from './chatCommands';

describe('comandos de texto y creación', () => {
  it('conserva comandos antiguos como plantillas privadas y normaliza una sola vez', () => {
    expect(cleanChatCommand({ name: '/Saludó', description: ' Saludo ', text: ' Hola ' })).toEqual({
      name: 'saludo', description: 'Saludo', text: 'Hola', visibility: 'personal', actionKind: 'text', resourceKind: undefined,
    });
  });
  it('admite los cinco formularios compartibles sin ejecutar el contenido como código', () => {
    for (const resourceKind of CHAT_RESOURCE_KINDS) expect(cleanChatCommand({ name: 'crear-material', description: '', text: 'ignorado',
      visibility: 'classroom', actionKind: 'create', resourceKind })).toMatchObject({ text: '', visibility: 'classroom', actionKind: 'create', resourceKind });
  });
  it('rechaza acciones, alcances y nombres no permitidos', () => {
    const base = { name: 'prueba', description: '', text: 'Hola' };
    for (const input of [{ ...base, name: 'tarea' }, { ...base, text: '' }, { ...base, text: 'a'.repeat(2001) },
      { ...base, visibility: 'public' }, { ...base, actionKind: 'script' }, { ...base, actionKind: 'create', resourceKind: 'shell' }]) {
      expect(() => cleanChatCommand(input)).toThrow();
    }
  });
});
