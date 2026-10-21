import { describe, expect, it } from 'vitest';
import { InMemoryWebStorage, OidcClient, WebStorageStateStore } from 'oidc-client-ts';
import { buildOidcSettings } from './oidc';

function client(storage: InMemoryWebStorage) {
  return new OidcClient({
    ...buildOidcSettings({ clientId: 'client_test', platform: 'web', origin: 'https://app-b20.pages.dev' }),
    // Metadatos fijos: se prueba la continuidad de PKCE sin contactar al proveedor ni emitir tokens.
    metadata: {
      issuer: 'https://auth.spacetimedb.com/oidc',
      authorization_endpoint: 'https://auth.spacetimedb.com/oidc/auth',
      token_endpoint: 'https://auth.spacetimedb.com/oidc/token',
    },
    stateStore: new WebStorageStateStore({ store: storage, prefix: 'b20.oidc.state.' }),
  });
}

describe('retorno del correo en otra pestaña', () => {
  it('recupera el verificador PKCE desde el almacenamiento compartido y consume el estado una sola vez', async () => {
    const sameOriginStorage = new InMemoryWebStorage();
    const originalTab = client(sameOriginStorage);
    const callbackTab = client(sameOriginStorage);
    const request = await originalTab.createSigninRequest({ request_type: 'si:r', state: { returnTo: '/#/m/tareas' } });
    const authorization = new URL(request.url);
    const callback = `https://app-b20.pages.dev/auth/callback?code=test&state=${authorization.searchParams.get('state')}`;

    const { state } = await callbackTab.readSigninResponseState(callback, true);
    expect(state.data).toEqual({ returnTo: '/#/m/tareas' });
    expect(state.code_verifier).toBeTruthy();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state.code_verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(challenge).toBe(authorization.searchParams.get('code_challenge'));
    await expect(originalTab.readSigninResponseState(callback)).rejects.toThrow('No matching state');
  });

  it('rechaza el callback si llega a un navegador sin el estado original', async () => {
    const request = await client(new InMemoryWebStorage()).createSigninRequest({ request_type: 'si:r' });
    const state = new URL(request.url).searchParams.get('state');
    const otherBrowser = client(new InMemoryWebStorage());
    await expect(otherBrowser.readSigninResponseState(`https://app-b20.pages.dev/auth/callback?code=test&state=${state}`))
      .rejects.toThrow('No matching state');
  });
});
