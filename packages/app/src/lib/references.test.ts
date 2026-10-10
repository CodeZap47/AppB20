import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from '../data/demo';
import {
  formatReference,
  messagePreview,
  referencesIn,
  resolveReference,
  searchReferences,
  stickerOnly,
  stripReferences,
} from './references';

describe('referencias en mensajes', () => {
  it('encuentra cada referencia una vez y en orden', () => {
    const text = `Miren ${formatReference('tarea', 't1')} y ${formatReference('nota', 'n1')} ${formatReference('tarea', 't1')}`;
    expect(referencesIn(text)).toEqual([
      { kind: 'tarea', id: 't1' },
      { kind: 'nota', id: 'n1' },
    ]);
    expect(stripReferences(text)).toBe('Miren  y');
  });

  it('ignora lo que solo se parece a una referencia', () => {
    expect(referencesIn('[[otra:t1]] [tarea:t1] [[tarea:]]')).toEqual([]);
  });

  it('reconoce un mensaje que solo es un sticker', () => {
    expect(stickerOnly(' [[sticker:s1]] ')).toBe('s1');
    expect(stickerOnly('hola [[sticker:s1]]')).toBeUndefined();
  });

  it('resume el mensaje para la lista de conversaciones', () => {
    expect(messagePreview({ text: 'Va [[tarea:t1]]' })).toBe('Va · 1 referencia');
    expect(messagePreview({ text: '[[sticker:s1]]' })).toBe('Sticker');
    expect(messagePreview({ text: '', deletedAt: new Date() })).toBe('Mensaje eliminado');
  });

  it('resuelve contra lo que el usuario puede ver', () => {
    const data = new DemoDataSource(createDemoState(new Date(2026, 9, 8)), 'demo-1').getSnapshot();
    expect(resolveReference({ kind: 'tarea', id: 't1' }, data)).toMatchObject({
      link: '/m/tareas/t1',
    });
    expect(resolveReference({ kind: 'tarea', id: 'no-existe' }, data)).toBeUndefined();
    // La nota personal de otro alumno no está en su snapshot, así que no se puede citar.
    expect(resolveReference({ kind: 'nota', id: 'n2' }, data)).toBeUndefined();
    const notes = searchReferences('nota', '', data).map((r) => r.id);
    expect(notes).toContain('n1');
    expect(notes).not.toContain('n2');
  });
});
