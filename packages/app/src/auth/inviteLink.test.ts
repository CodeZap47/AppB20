// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { captureInviteLink, clearInviteLink, inviteLinkUrl, newInviteCode, pendingInviteLink } from './inviteLink';

const code = 'Ab_-'.repeat(10) + 'xyz';

beforeEach(() => { sessionStorage.clear(); window.history.replaceState({}, '', '/'); });

describe('enlace de invitación en el navegador', () => {
  it('guarda el código del enlace y lo quita de la dirección', () => {
    window.history.replaceState({}, '', `/#/unirme/${code}`);
    captureInviteLink();
    expect(pendingInviteLink()).toBe(code);
    expect(window.location.hash).toBe('');
    clearInviteLink();
    expect(pendingInviteLink()).toBeUndefined();
  });

  it('ignora otras rutas y códigos mal formados', () => {
    for (const hash of ['#/m/tareas', '#/unirme/corto', `#/unirme/${code}/extra`]) {
      window.history.replaceState({}, '', `/${hash}`);
      captureInviteLink();
      expect(pendingInviteLink()).toBeUndefined();
    }
  });

  it('genera un código de 32 bytes y su hash SHA-256; la dirección apunta a la web', async () => {
    const { code: generated, hash } = await newInviteCode();
    expect(generated).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(generated)));
    expect(hash).toBe([...expected].map((b) => b.toString(16).padStart(2, '0')).join(''));
    expect(inviteLinkUrl(generated)).toBe(`${window.location.origin}/#/unirme/${generated}`);
  });
});
