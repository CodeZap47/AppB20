// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { rememberSession, setRememberSession } from './persistence';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
describe('preferencia de sesión recordada', () => {
  it('por defecto conserva la sesión y respeta la elección de no hacerlo', () => {
    expect(rememberSession()).toBe(true);
    setRememberSession(false);
    expect(rememberSession()).toBe(false);
    setRememberSession(true);
    expect(rememberSession()).toBe(true);
  });
});
