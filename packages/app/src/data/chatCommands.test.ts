import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';

let data: DemoDataSource;
beforeEach(() => { data = new DemoDataSource(createDemoState(), 'demo-2'); });
afterEach(() => data.dispose());
const template = { name: '/Saludó', description: 'Saludo', text: 'Hola a todos' };

describe('persistencia y permisos de comandos en la fuente de datos', () => {
  it('mantiene personales separados, permite compartir y evita colisiones del salón', () => {
    const personalId = data.saveChatCommand(template);
    expect(data.getSnapshot().chatCommands.find(c => c.id === personalId)).toMatchObject({ name: 'saludo', visibility: 'personal', actionKind: 'text' });
    data.setViewer('demo-3');
    expect(data.getSnapshot().chatCommands.some(c => c.id === personalId)).toBe(false);
    const sharedId = data.saveChatCommand({ ...template, name: 'saludo', visibility: 'classroom' });
    data.setViewer('demo-2');
    expect(data.getSnapshot().chatCommands.filter(c => c.name === 'saludo')).toHaveLength(2);
    expect(() => data.saveChatCommand({ ...template, id: personalId, visibility: 'classroom', expectedVersion: 1 })).toThrow(/salón/);
    expect(() => data.saveChatCommand({ ...template, id: sharedId, text: 'Modificado' })).toThrow(/autor/);
  });
  it('el administrador retira del salón y conserva el comando personal de su autor', () => {
    const id = data.saveChatCommand({ ...template, visibility: 'classroom' });
    data.setViewer('demo-3');
    expect(() => data.removeChatCommand(id)).toThrow(/retirar/);
    data.setViewer('demo-1');
    expect(() => data.saveChatCommand({ ...template, id, text: 'Otro texto' })).toThrow(/autor/);
    data.removeChatCommand(id);
    expect(data.getSnapshot().chatCommands.some(c => c.id === id)).toBe(false);
    data.setViewer('demo-2');
    expect(data.getSnapshot().chatCommands.find(c => c.id === id)).toMatchObject({ visibility: 'personal', text: template.text, version: 2 });
    data.removeChatCommand(id);
    expect(data.getSnapshot().chatCommands.some(c => c.id === id)).toBe(false);
  });
  it('guarda acciones de creación y detecta una edición simultánea', () => {
    const id = data.saveChatCommand({ name: 'duda', description: '', text: '', actionKind: 'create', resourceKind: 'pregunta', visibility: 'classroom' });
    const saved = data.getSnapshot().chatCommands.find(c => c.id === id)!;
    expect(saved).toMatchObject({ actionKind: 'create', resourceKind: 'pregunta', text: '', version: 1 });
    data.saveChatCommand({ ...saved, description: 'Abre una pregunta', expectedVersion: 1 });
    expect(() => data.saveChatCommand({ ...saved, description: 'Cambio atrasado', expectedVersion: 1 })).toThrow(/cambió/);
    expect(data.getSnapshot().chatCommands.find(c => c.id === id)?.description).toBe('Abre una pregunta');
  });
});
