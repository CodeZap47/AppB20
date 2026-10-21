import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';

function source() {
  return new DemoDataSource(createDemoState(new Date(2026, 9, 20)), 'demo-1');
}

afterEach(() => vi.restoreAllMocks());

describe('cierre de una simulación', () => {
  it('libera una vez cada adjunto, incluidos los restantes al salir', async () => {
    const create = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:primer-adjunto')
      .mockReturnValueOnce('blob:segundo-adjunto');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const data = source();
    const first = await data.attachWorkFile('w1', new File(['primero'], 'primero.txt'));
    await data.attachWorkFile('w1', new File(['segundo'], 'segundo.txt'));
    expect(create).toHaveBeenCalledTimes(2);

    data.removeWorkFile(first);
    expect(revoke.mock.calls).toEqual([['blob:primer-adjunto']]);
    data.dispose();
    data.dispose();

    expect(revoke.mock.calls).toEqual([['blob:primer-adjunto'], ['blob:segundo-adjunto']]);
    expect(data.getSnapshot().workFiles).toEqual([]);
  });

  it('descarta caché, datos privados e identidad y no permite reabrir la fuente', () => {
    const data = source();
    data.inviteMember('solo-en-esta-sesion@ejemplo.mx', false);
    data.updateProfile('Nombre temporal');
    data.sendGroupMessage('Contenido de esta sesión');
    data.setViewer('demo-2');
    const before = data.getSnapshot();
    expect(before.directMessages.length).toBeGreaterThan(0);
    expect(before.members.length).toBeGreaterThan(0);

    data.dispose();

    const after = data.getSnapshot();
    expect(after).not.toBe(before);
    expect(data.getSnapshot()).toBe(after);
    expect(after.connection).toBe('offline');
    expect(after.me).toBeUndefined();
    expect(after.lastSeenAt).toBeUndefined();
    expect(data.viewerId).toBe('');
    for (const value of Object.values(after)) {
      if (Array.isArray(value)) expect(value).toEqual([]);
    }
    expect(() => data.setViewer('demo-1')).toThrow('sesión de prueba ya terminó');
    expect(() => data.sendGroupMessage('No debe guardarse')).toThrow('sesión de prueba ya terminó');
    expect(() => data.joinGroup('Otra cuenta')).toThrow('sesión de prueba ya terminó');
    expect(() => data.withdrawBirthday()).toThrow('sesión de prueba ya terminó');
  });

  it('descarta suscripciones y mantiene aislada una nueva simulación', () => {
    const previous = source();
    const next = source();
    const listener = vi.fn();
    const unsubscribe = previous.subscribe(listener);
    previous.sendGroupMessage('Mensaje temporal');
    expect(listener).toHaveBeenCalledTimes(1);

    previous.dispose();
    const lateUnsubscribe = previous.subscribe(listener);
    next.sendGroupMessage('Mensaje de la nueva sesión');
    unsubscribe();
    lateUnsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(previous.getSnapshot().groupMessages).toEqual([]);
    expect(next.getSnapshot().groupMessages.some((message) => message.text === 'Mensaje temporal')).toBe(false);
    expect(next.getSnapshot().groupMessages.some((message) => message.text === 'Mensaje de la nueva sesión')).toBe(true);
  });

  it('cancela una importación pendiente sin restaurar stickers después de salir', async () => {
    const data = source();
    const file = new File(['imagen pendiente'], 'pendiente.png');
    let finishRead!: (bytes: ArrayBuffer) => void;
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>((resolve) => {
      finishRead = resolve;
    }));

    const importing = data.importStickers('Paquete temporal', [file]);
    data.dispose();
    finishRead(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer);

    await expect(importing).rejects.toThrow('sesión de prueba ya terminó');
    expect(data.getSnapshot().stickerPacks).toEqual([]);
    expect(data.getSnapshot().stickers).toEqual([]);
  });
});
