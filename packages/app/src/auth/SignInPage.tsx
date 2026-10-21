import { useEffect, useState } from 'react';
import { SpacetimeAuthButton, useSession } from './AuthContext';
import { config } from '../config';

/** Una cuenta real permite explorar la simulación; el grupo real conserva sus invitaciones. */
export function SignInPage() {
  const session = useSession();
  const simulated = config.dataMode === 'demo';
  const error = session?.status === 'signedOut' ? session.error : undefined;
  const [restarted] = useState(() => new URLSearchParams(window.location.search).get('auth_restart') === '1');
  useEffect(() => {
    if (!restarted) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('auth_restart');
    window.history.replaceState(window.history.state, '', url.href);
  }, [restarted]);
  return (
    <main className="signin">
      <h1>B20</h1>
      <p>{simulated
        ? 'Inicia sesión con SpacetimeAuth para explorar B20. Puedes usar cualquier correo verificado.'
        : 'Inicia sesión en SpacetimeAuth con el correo con el que te invitaron al grupo.'}</p>
      {restarted && <p role="status">El acceso debe iniciarse desde esta dirección de B20. Vuelve a intentarlo aquí.</p>}
      {session?.status === 'loading' ? <p className="muted">Preparando acceso…</p> : <SpacetimeAuthButton />}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted">{simulated
        ? 'Tu cuenta es real. El contenido y los perfiles de esta versión son simulados.'
        : 'Solo los correos invitados tienen acceso al grupo.'}</p>
    </main>
  );
}
