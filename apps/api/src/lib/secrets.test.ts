import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EncryptedMemoryStore } from './secrets.ts';

describe('EncryptedMemoryStore', () => {
  it('guarda, lee y elimina una clave por usuario', async () => {
    const store = new EncryptedMemoryStore(randomBytes(32).toString('base64'));
    await store.put('a', 'clave-de-prueba');
    expect(await store.has('a')).toBe(true);
    expect(await store.get('a')).toBe('clave-de-prueba');
    expect(await store.get('b')).toBeUndefined();
    await store.delete('a');
    expect(await store.has('a')).toBe(false);
  });

  it('rechaza claves de cifrado de tamaño incorrecto', () => {
    expect(() => new EncryptedMemoryStore('corta')).toThrow();
  });
});
