import { describe, expect, it } from 'vitest';
import { ANDROID_REDIRECT_URI, buildOidcSettings, matchesCallback, signinReturnTo } from './oidc';

const web = { platform: 'web' as const, origin: 'https://b20.example', clientId: 'client_b20' };

describe('configuración de SpacetimeAuth', () => {
  it('usa code/PKCE sin secreto y los scopes que necesita la invitación', () => {
    const settings = buildOidcSettings(web);
    expect(settings).toMatchObject({ authority: 'https://auth.spacetimedb.com/oidc', client_id: 'client_b20',
      redirect_uri: 'https://b20.example/auth/callback', post_logout_redirect_uri: 'https://b20.example/auth/logout',
      response_type: 'code', automaticSilentRenew: false, scope: 'openid profile email' });
    expect(settings.disablePKCE).not.toBe(true);
    expect(settings.client_secret).toBeUndefined();
  });
  it('detiene la app si falta el cliente o hay un emisor distinto', () => {
    expect(() => buildOidcSettings({ ...web, clientId: '' })).toThrow('Client ID');
    expect(() => buildOidcSettings({ ...web, authority: 'https://attacker.example' })).toThrow('autoridad');
  });
  it('rechaza callbacks inseguros, de otro origen o con query/hash', () => {
    for (const redirectUri of ['https://other.example/auth/callback', 'http://b20.example/auth/callback',
      'https://b20.example/auth/callback#/', 'https://b20.example/auth/callback?code=1']) {
      expect(() => buildOidcSettings({ ...web, redirectUri })).toThrow();
    }
    expect(buildOidcSettings({ ...web, origin: 'http://localhost:5173' }).redirect_uri).toBe('http://localhost:5173/auth/callback');
  });
  it('cada plataforma requiere su devolución real', () => {
    expect(buildOidcSettings({ ...web, platform: 'android' }).redirect_uri).toBe(ANDROID_REDIRECT_URI);
    expect(() => buildOidcSettings({ ...web, platform: 'extension-panel' })).toThrow('Chrome');
    expect(buildOidcSettings({ ...web, platform: 'extension-panel', extensionRedirectUri: 'https://abc.chromiumapp.org/auth/callback',
      extensionLogoutUri: 'https://abc.chromiumapp.org/auth/logout' }).redirect_uri).toBe('https://abc.chromiumapp.org/auth/callback');
  });
});

describe('retorno de autenticación', () => {
  it('conserva la pantalla anterior y quita los parámetros OAuth', () => {
    expect(signinReturnTo({ returnTo: '/?code=secret&state=secret&session_state=secret#/m/tareas' }, web.origin)).toBe('/#/m/tareas');
  });
  it('impide redirecciones fuera de B20 y bucles de callback', () => {
    for (const returnTo of ['//attacker.example', '/\\attacker.example', 'https://attacker.example', '/auth/callback?code=x']) {
      expect(signinReturnTo({ returnTo }, web.origin)).toBe('/');
    }
  });
  it('solo acepta el host, esquema y ruta exactos para Android o Chrome', () => {
    expect(matchesCallback(`${ANDROID_REDIRECT_URI}?code=abc&state=xyz`, ANDROID_REDIRECT_URI)).toBe(true);
    expect(matchesCallback('mx.b20.app://auth/callback/evil?code=x', ANDROID_REDIRECT_URI)).toBe(false);
    expect(matchesCallback('mx.b20.app://evil/callback?code=x', ANDROID_REDIRECT_URI)).toBe(false);
    expect(matchesCallback('https://abc.chromiumapp.org.evil/auth/callback', 'https://abc.chromiumapp.org/auth/callback')).toBe(false);
  });
});
