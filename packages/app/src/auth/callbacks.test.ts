import { describe, expect, it } from 'vitest';
import { matchesCallback, signinReturnTo } from './callbacks';

const origin = 'https://b20.example';
const ANDROID_CALLBACK = 'mx.b20.app://auth/callback';

describe('retorno de autenticación', () => {
  it('conserva la pantalla anterior y quita los parámetros OAuth', () => {
    expect(signinReturnTo({ returnTo: '/?code=secret&state=secret&session_state=secret#/m/tareas' }, origin)).toBe('/#/m/tareas');
  });
  it('impide redirecciones fuera de B20 y bucles de callback', () => {
    for (const returnTo of ['//attacker.example', '/\\attacker.example', 'https://attacker.example', '/auth/callback?code=x']) {
      expect(signinReturnTo({ returnTo }, origin)).toBe('/');
    }
  });
  it('solo acepta el host, esquema y ruta exactos para Android o Chrome', () => {
    expect(matchesCallback(`${ANDROID_CALLBACK}?code=abc&state=xyz`, ANDROID_CALLBACK)).toBe(true);
    expect(matchesCallback('mx.b20.app://auth/callback/evil?code=x', ANDROID_CALLBACK)).toBe(false);
    expect(matchesCallback('mx.b20.app://evil/callback?code=x', ANDROID_CALLBACK)).toBe(false);
    expect(matchesCallback('https://abc.chromiumapp.org.evil/auth/callback', 'https://abc.chromiumapp.org/auth/callback')).toBe(false);
  });
});
