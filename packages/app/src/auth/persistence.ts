const REMEMBER_KEY = 'b20.auth.remember';
export function rememberSession(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== 'false';
  } catch {
    return false;
  }
}
export function setRememberSession(value: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, String(value));
  } catch {
    /* Storage may be disabled. */
  }
}
