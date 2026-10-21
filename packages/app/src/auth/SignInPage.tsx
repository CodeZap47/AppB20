import { SpacetimeAuthButton, useSession } from './AuthContext';

/** Autenticarse no concede membresía: solo pueden unirse los correos invitados. */
export function SignInPage() {
  const session = useSession();
  const error = session?.status === 'signedOut' ? session.error : undefined;
  return (
    <main className="signin">
      <h1>B20</h1>
      <p>Inicia sesión en SpacetimeAuth con el correo con el que te invitaron al grupo.</p>
      {session?.status === 'loading' ? <p className="muted">Preparando acceso…</p> : <SpacetimeAuthButton />}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted">Solo los correos invitados tienen acceso al grupo.</p>
      <p className="muted">¿Solo quieres conocerla? <a href="?demo">Ver la demo</a> con datos de prueba.</p>
    </main>
  );
}
