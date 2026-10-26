import { describe, expect, it } from 'vitest';
import { decryptInvitationToken, encryptInvitationToken, generateInvitationToken, invitationTokenHash } from './linkCrypto.ts';

const context = { module: 'test-b20', id: crypto.randomUUID() };
const secrets = { INVITATION_MASTER_VERSION: 'v2', INVITATION_MASTER_KEYS_JSON: JSON.stringify({ v1: btoa('1'.repeat(32)), v2: btoa('2'.repeat(32)) }) };
describe('Secretos recuperables de invitaciones', () => {
  it('genera 32 bytes aleatorios, una huella SHA256 y envelopes AES256GCM distintos', async () => {
    const token = generateInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(atob(token.replace(/-/g, '+').replace(/_/g, '/') + '=')).toHaveLength(32);
    expect(generateInvitationToken()).not.toBe(token);
    const hash = await invitationTokenHash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await invitationTokenHash(token)).toBe(hash);
    const first = await encryptInvitationToken(secrets, context, token);
    const second = await encryptInvitationToken(secrets, context, token);
    expect(first.iv).not.toBe(second.iv);
    expect(atob(first.iv)).toHaveLength(12);
    expect(first.ciphertext).not.toContain(token);
    expect(await decryptInvitationToken({ ...secrets }, context, first)).toBe(token);
  });
  it('liga el secreto al módulo y enlace; rechaza alteración y claves inválidas', async () => {
    const token = generateInvitationToken();
    const saved = await encryptInvitationToken(secrets, context, token);
    await expect(decryptInvitationToken(secrets, { ...context, module: 'other-module' }, saved)).rejects.toThrow();
    await expect(decryptInvitationToken(secrets, { ...context, id: crypto.randomUUID() }, saved)).rejects.toThrow();
    await expect(decryptInvitationToken(secrets, context, { ...saved, ciphertext: `${saved.ciphertext[0] === 'A' ? 'B' : 'A'}${saved.ciphertext.slice(1)}` })).rejects.toThrow();
    await expect(decryptInvitationToken(secrets, context, { ...saved, iv: btoa('short') })).rejects.toThrow();
    await expect(decryptInvitationToken(secrets, context, { ...saved, keyVersion: 'unknown' })).rejects.toThrow();
    await expect(encryptInvitationToken({ ...secrets, INVITATION_MASTER_KEYS_JSON: '{' }, context, token)).rejects.toThrow();
    await expect(encryptInvitationToken({ ...secrets, INVITATION_MASTER_KEYS_JSON: JSON.stringify({ v2: btoa('short') }) }, context, token)).rejects.toThrow();
  });
  it('puede copiar envelopes de la versión anterior después de rotar la clave', async () => {
    const token = generateInvitationToken();
    const saved = await encryptInvitationToken({ ...secrets, INVITATION_MASTER_VERSION: 'v1' }, context, token);
    expect(await decryptInvitationToken(secrets, context, saved)).toBe(token);
    await expect(decryptInvitationToken({ ...secrets, INVITATION_MASTER_KEYS_JSON: JSON.stringify({ v2: btoa('2'.repeat(32)) }) }, context, saved)).rejects.toThrow();
  });
});
