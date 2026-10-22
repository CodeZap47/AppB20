import { useState, type FormEvent } from 'react';
import { config } from '../config';
import { useSupabaseAuth } from './SupabaseAuthProvider';
import { AuthFrame } from './AuthFrame';

export function SupabaseSignInForm() {
  const auth = useSupabaseAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [register, setRegister] = useState(false);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  if (!auth) return null;
  const run = async (action: () => Promise<unknown>) => {
    setError(''); setNotice('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo completar el acceso.'); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const message = await auth.password(email.trim(), password, register);
      setPassword('');
      if (message) setNotice(message);
    });
  };
  return <>
    {config.supabaseOAuthProviders.map((provider) => <button key={provider} type="button" className="auth-action auth-action--social" disabled={auth.busy}
      onClick={() => void run(() => auth.oauth(provider))}>Continuar con {provider === 'google' ? 'Google' : 'GitHub'}</button>)}
    {auth.passkeysAvailable && <button type="button" className="auth-action auth-action--social" disabled={auth.busy}
      onClick={() => void run(() => auth.passkey())}>Entrar con una passkey</button>}
    {(config.supabaseOAuthProviders.length > 0 || auth.passkeysAvailable) && <div className="auth-divider"><span>o usa tu correo</span></div>}
    <form className="auth-form" onSubmit={submit} aria-busy={auth.busy}>
      <label className="auth-email"><span>Correo electrónico</span><input type="email" autoComplete="email" required value={email} onChange={(event) => { setEmail(event.target.value); setSent(false); }} placeholder="tu@correo.com" /></label>
      <label className="auth-email"><span>Contraseña</span><input type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 8 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button className="auth-action" disabled={auth.busy}>{auth.busy ? 'Un momento…' : register ? 'Crear mi cuenta' : 'Entrar a B20'}</button>
    </form>
    <button type="button" className="auth-link" disabled={auth.busy} onClick={() => { setRegister(!register); setError(''); setNotice(''); setPassword(''); }}>
      {register ? 'Ya tengo una cuenta' : 'Es mi primera vez · crear cuenta'}
    </button>
    <div className="auth-divider"><span>otras formas de entrar</span></div>
    <button type="button" className="auth-action auth-action--secondary" disabled={auth.busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
      onClick={() => void run(async () => { await auth.emailLink(email.trim()); setSent(true); setNotice('Revisa tu correo. Usa el enlace en este navegador o escribe el código si tu correo incluye uno.'); })}>Enviarme acceso por correo</button>
    {sent && <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void run(() => auth.verifyCode(email.trim(), code.trim())); }}>
      <label className="auth-email"><span>Código del correo</span><input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <button className="auth-action auth-action--secondary" disabled={auth.busy || !code.trim()}>Confirmar código</button>
    </form>}
    <button type="button" className="auth-link" disabled={auth.busy || !email.trim()} onClick={() => void run(async () => {
      await auth.reset(email.trim()); setNotice('Si el correo corresponde a una cuenta, recibirás un enlace para cambiar la contraseña.');
    })}>Olvidé mi contraseña</button>
    {notice && <p role="status" className="auth-feedback">{notice}</p>}
    {error && <p role="alert" className="auth-feedback auth-feedback--error">{error}</p>}
  </>;
}

export function PasswordRecoveryPage() {
  const auth = useSupabaseAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return <AuthFrame title="Una nueva contraseña" description="Guarda una contraseña de al menos ocho caracteres para volver a tu grupo.">
    <form className="auth-form" onSubmit={(event) => {
      event.preventDefault(); setError('');
      void auth?.updatePassword(password).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'No se pudo guardar la contraseña.'));
    }}>
      <label className="auth-email"><span>Nueva contraseña</span><input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button className="auth-action" disabled={auth?.busy}>{auth?.busy ? 'Guardando…' : 'Guardar contraseña'}</button>
      {error && <p role="alert" className="auth-feedback auth-feedback--error">{error}</p>}
    </form>
  </AuthFrame>;
}

export function PasskeySettings() {
  const auth = useSupabaseAuth();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  if (!auth?.passkeysAvailable) return null;
  return <section className="panel settings"><h2>Acceso con passkey</h2><p className="muted">Usa la huella, el PIN o el gestor de contraseñas de tu dispositivo para entrar.</p>
    <button type="button" className="secondary" disabled={auth.busy} onClick={() => {
      setError(''); setNotice('');
      void auth.passkey(true).then(() => setNotice('Passkey registrada. Ya puedes usarla para entrar.')).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'No se pudo registrar la passkey.'));
    }}>Añadir una passkey</button>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
