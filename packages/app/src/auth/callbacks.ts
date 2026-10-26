// Direcciones de retorno del inicio de sesión con Supabase (OAuth y enlaces de correo).

/** Solo restaura una ruta local de la app, nunca una URL externa ni otra devolución OAuth. */
export function signinReturnTo(state: unknown, origin: string): string {
  const returnTo = state && typeof state === 'object' && 'returnTo' in state ? state.returnTo : undefined;
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//')) return '/';
  try {
    const url = new URL(returnTo, origin);
    if (url.origin !== origin || url.pathname.startsWith('/auth/')) return '/';
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('session_state');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/'; }
}

/** Compara la dirección exacta sin aceptar prefijos parecidos o rutas ajenas. */
export function matchesCallback(value: string, expected: string): boolean {
  try {
    const url = new URL(value);
    const target = new URL(expected);
    return url.protocol === target.protocol && url.host === target.host && url.pathname === target.pathname &&
      !url.username && !url.password;
  } catch { return false; }
}
