import { describe, expect, it } from 'vitest';
import { canEncrypt, decryptAiKey, encryptAiKey } from './crypto.ts';

const secrets = { AI_MASTER_VERSION: 'v2', AI_MASTER_KEYS_JSON: JSON.stringify({ v1: btoa('1'.repeat(32)), v2: btoa('2'.repeat(32)) }) };
const context = { actor: 'a'.repeat(64), provider: 'gemini' as const, keyId: crypto.randomUUID() };
describe('Cifrado BYOK independiente del proceso', () => {
  it('cifra AES256GCM con IV aleatorio y recupera tras reiniciar con solo el secreto', async () => {
    const one = await encryptAiKey(secrets, context, 'test-secret-1234567890');
    const two = await encryptAiKey(secrets, context, 'test-secret-1234567890');
    expect(one.iv).not.toBe(two.iv);
    expect(atob(one.iv)).toHaveLength(12);
    expect(one.ciphertext).not.toContain('test-secret');
    expect(await decryptAiKey({ ...secrets }, context, one)).toBe('test-secret-1234567890');
    expect(await canEncrypt(secrets)).toBe(true);
  });
  it('rechaza alteración, otro alumno, otro keyId y versión desconocida', async () => {
    const envelope = await encryptAiKey(secrets, context, 'test-secret-1234567890');
    await expect(decryptAiKey(secrets, { ...context, actor: 'b'.repeat(64) }, envelope)).rejects.toThrow();
    await expect(decryptAiKey(secrets, { ...context, keyId: crypto.randomUUID() }, envelope)).rejects.toThrow();
    await expect(decryptAiKey(secrets, context, { ...envelope, masterVersion: 'missing' })).rejects.toThrow();
    await expect(decryptAiKey(secrets, context, { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, 3)}X${envelope.ciphertext.slice(4)}` })).rejects.toThrow();
    await expect(decryptAiKey(secrets, context, { ...envelope, iv: btoa('invalid') })).rejects.toThrow();
  });
  it('mantiene lecturas de versiones anteriores durante una rotación', async () => {
    const envelope = await encryptAiKey({ ...secrets, AI_MASTER_VERSION: 'v1' }, context, 'old-secret-1234567890');
    expect(await decryptAiKey(secrets, context, envelope)).toBe('old-secret-1234567890');
    expect(await canEncrypt({ AI_MASTER_VERSION: 'v1', AI_MASTER_KEYS_JSON: '{}' })).toBe(false);
  });
});
