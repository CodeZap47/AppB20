import { useEffect, useState } from 'react';
import { useSession } from './AuthContext';
import { config } from '../config';
import { AuthFrame } from './AuthFrame';
import { Icon } from '../components/Icon';
import { rememberSession, setRememberSession } from './persistence';
import { SupabaseSignInForm } from './SupabaseSignInForm';

/** Una cuenta real permite explorar la simulación; el grupo real conserva sus invitaciones. */
export function SignInPage() {
  const session = useSession();
  const simulated = config.dataMode === 'demo';
  const error = session?.status === 'signedOut' ? session.error : undefined;
  const [remember, setRemember] = useState(rememberSession);
  const [restarted] = useState(() => new URLSearchParams(window.location.search).get('auth_restart') === '1');
  useEffect(() => {
    if (!restarted) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('auth_restart');
    window.history.replaceState(window.history.state, '', url.href);
  }, [restarted]);
  return (
    <AuthFrame variant="welcome" title="Qué bueno verte."
      description={simulated
        ? 'Accede con tu correo y conoce el espacio de tu grupo.'
        : 'Accede con el correo con el que te invitaron al grupo.'}
      busy={session?.status === 'loading'}>
      {restarted && <p className="auth-feedback" role="status">El acceso debe iniciarse desde esta dirección de B20. Vuelve a intentarlo aquí.</p>}
      {session?.status === 'loading'
        ? <p className="auth-loading" role="status"><span className="auth-spinner" aria-hidden="true" />Preparando acceso…</p>
        : <>
          <SupabaseSignInForm />
          <label className="auth-remember"><input type="checkbox" checked={remember} onChange={(event) => { setRemember(event.target.checked); setRememberSession(event.target.checked); }} /> Mantener mi sesión iniciada</label>
        </>}
      {error && <p className="auth-feedback auth-feedback--error" role="alert">{error}</p>}
      <p className="auth-provider-note"><Icon name="lock" size={15} /> Tu cuenta, protegida con Supabase Auth</p>
      <div className="auth-mode-note">
        <span className="auth-mode-note__mark" aria-hidden="true" />
        <p>{simulated
          ? 'Tu cuenta es real. Esta versión utiliza datos de prueba.'
          : 'Solo los correos invitados tienen acceso al grupo.'}</p>
      </div>
    </AuthFrame>
  );
}
