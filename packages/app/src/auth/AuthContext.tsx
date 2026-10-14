import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { initGoogleSignIn, type GoogleSignIn } from './google';
import { SessionStore, type SessionState } from './session';

interface AuthValue {
  store: SessionStore;
  /** GIS listo para dibujar el botón; `null` mientras carga. */
  google: GoogleSignIn | null;
  /** Error al cargar Google (sin red, bloqueado por el navegador). */
  loadError: string | null;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Inicio de sesión con Google para la web. Sin `clientId` no hay sesión posible. */
export function AuthProvider({ clientId, children }: { clientId: string; children: ReactNode }) {
  const googleRef = useRef<GoogleSignIn | null>(null);
  const [google, setGoogle] = useState<GoogleSignIn | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const store = useMemo(
    () =>
      new SessionStore({
        renewSilently: () => googleRef.current?.promptSilently(() => store.renewalFailed()),
        disableAutoSelect: () => googleRef.current?.disableAutoSelect(),
        storage: typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
      }),
    [],
  );

  useEffect(() => {
    store.restore();
    let cancelled = false;
    initGoogleSignIn(clientId, (token) => store.receiveToken(token)).then(
      (g) => {
        if (cancelled) return;
        googleRef.current = g;
        setGoogle(g);
        // Quien ya entró antes en este navegador vuelve sin elegir cuenta.
        if (store.getSnapshot().status === 'signedOut') g.promptSilently(() => {});
      },
      (e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [clientId, store]);

  return <AuthContext value={{ store, google, loadError }}>{children}</AuthContext>;
}

function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Falta AuthProvider');
  return value;
}

/** Estado de la sesión; `null` fuera de un `AuthProvider` (modo de prueba). */
export function useSession(): SessionState | null {
  const value = useContext(AuthContext);
  return useSyncExternalStore(
    (listener) => value?.store.subscribe(listener) ?? (() => {}),
    () => value?.store.getSnapshot() ?? null,
  );
}

export function useSessionStore(): SessionStore | null {
  return useContext(AuthContext)?.store ?? null;
}

/** Botón oficial de Google, o el motivo por el que no aparece. */
export function GoogleButton() {
  const { google, loadError } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (google && ref.current) google.renderButton(ref.current);
  }, [google]);
  if (loadError) return <p className="error">{loadError}</p>;
  return <div ref={ref} className="google-button" aria-busy={!google} />;
}
