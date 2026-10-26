import { useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { config } from '../config';
import type { Platform } from '../platform';
import { SessionStore, type SessionState } from './session';
import { AuthContext } from './accessContext';
import { SupabaseAuthProvider } from './SupabaseAuthProvider';

/** Supabase Auth es el único proveedor; el bypass solo existe en `vite dev` con datos simulados. */
export function AuthProvider({ platform = 'web', children }: { platform?: Platform; children: ReactNode }) {
  if (config.devAuthBypass) return <DevAuthProvider>{children}</DevAuthProvider>;
  return <SupabaseAuthProvider platform={platform}>{children}</SupabaseAuthProvider>;
}

/** Solo `vite dev` con datos simulados: sesión local sin proveedor. Nunca llega a un build. */
function DevAuthProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new SessionStore({ onSignOut: async () => {} }), []);
  useEffect(() => {
    store.receiveToken(devIdToken());
    return () => store.dispose();
  }, [store]);
  return <AuthContext value={{ store, busy: false }}>{children}</AuthContext>;
}

function devIdToken(): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_');
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({ sub: 'dev-local', email: 'dev@localhost', email_verified: true, name: 'Desarrollo local',
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 }),
    'dev',
  ].join('.');
}

/** `null` únicamente fuera del proveedor, por ejemplo al probar componentes aislados. */
export function useSession(): SessionState | null {
  const value = useContext(AuthContext);
  return useSyncExternalStore(
    (listener) => value?.store.subscribe(listener) ?? (() => {}),
    () => value?.store.getSnapshot() ?? null,
  );
}
export function useSessionStore(): SessionStore | null { return useContext(AuthContext)?.store ?? null; }
