import { GoogleButton, useSession } from './AuthContext';

/** Primera pantalla sin sesión: solo entran correos invitados al grupo. */
export function SignInPage() {
  const session = useSession();
  const error = session?.status === 'signedOut' ? session.error : undefined;
  return (
    <main className="signin">
      <h1>B20</h1>
      <p>Entra con la cuenta de Google con la que te invitaron al grupo.</p>
      {session?.status === 'loading' ? <p className="muted">Cargando…</p> : <GoogleButton />}
      {error && <p className="error">{error}</p>}
      <p className="muted">
        ¿Solo quieres conocerla? <a href="?demo">Ver la demo</a> con datos de prueba.
      </p>
    </main>
  );
}
