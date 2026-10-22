import { useState, type FormEvent } from 'react';
import { config } from '../config';
import { useSupabaseAuth } from './SupabaseAuthProvider';
import { AuthFrame } from './AuthFrame';

type Step = 'email' | 'password' | 'code';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sin registro abierto: B20 activa la cuenta y el primer acceso pide un código y una contraseña. */
export function SupabaseSignInForm() {
  const auth = useSupabaseAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  if (!auth) return null;
  const address = email.trim().toLowerCase();
  const run = async (action: () => Promise<unknown>) => {
    setError(''); setNotice('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo completar el acceso.'); }
  };
  const sendCode = () => run(async () => {
    await auth.sendCode(address);
    setCode(''); setStep('code');
    setNotice(`Te enviamos un código a ${address}.`);
  });
  const restart = () => { setStep('email'); setPassword(''); setCode(''); setError(''); setNotice(''); };
  const continueWithEmail = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const state = await auth.lookup(address);
      if (state === 'inactive') throw new Error('Tu correo todavía no está activado en B20. Pide a quien administra el grupo que te dé acceso.');
      if (state === 'password') { setStep('password'); return; }
      await auth.sendCode(address);
      setCode(''); setStep('code');
      setNotice(`Es tu primer acceso. Te enviamos un código a ${address} para crear tu contraseña.`);
    });
  };
  return <>
    {step === 'email' && <>
      {config.supabaseOAuthProviders.map((provider) => <button key={provider} type="button" className="auth-action auth-action--social" disabled={auth.busy}
        onClick={() => void run(() => auth.oauth(provider))}>Continuar con {provider === 'google' ? 'Google' : 'GitHub'}</button>)}
      {auth.passkeysAvailable && <button type="button" className="auth-action auth-action--social" disabled={auth.busy}
        onClick={() => void run(() => auth.passkey())}>Entrar con una passkey</button>}
      {(config.supabaseOAuthProviders.length > 0 || auth.passkeysAvailable) && <div className="auth-divider"><span>o usa tu correo</span></div>}
      <form className="auth-form" onSubmit={continueWithEmail} aria-busy={auth.busy}>
        <label className="auth-email"><span>Correo electrónico</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" /></label>
        <button className="auth-action" disabled={auth.busy || !EMAIL.test(address)}>{auth.busy ? 'Un momento…' : 'Continuar'}</button>
      </form>
    </>}
    {step === 'password' && <form className="auth-form" aria-busy={auth.busy} onSubmit={(event) => {
      event.preventDefault();
      void run(async () => { await auth.signIn(address, password); setPassword(''); });
    }}>
      <p className="auth-feedback">Entrar como <strong>{address}</strong></p>
      <label className="auth-email"><span>Contraseña</span><input type="password" autoComplete="current-password" required autoFocus value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button className="auth-action" disabled={auth.busy || !password}>{auth.busy ? 'Un momento…' : 'Entrar a B20'}</button>
      <button type="button" className="auth-link" disabled={auth.busy} onClick={() => void sendCode()}>Olvidé mi contraseña</button>
    </form>}
    {step === 'code' && <form className="auth-form" aria-busy={auth.busy} onSubmit={(event) => {
      event.preventDefault();
      void run(() => auth.verifyCode(address, code.trim()));
    }}>
      <label className="auth-email"><span>Código del correo</span><input inputMode="numeric" autoComplete="one-time-code" required autoFocus value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <button className="auth-action" disabled={auth.busy || !code.trim()}>{auth.busy ? 'Un momento…' : 'Confirmar código'}</button>
      <button type="button" className="auth-link" disabled={auth.busy} onClick={() => void sendCode()}>Enviar otro código</button>
    </form>}
    {step !== 'email' && <button type="button" className="auth-link" disabled={auth.busy} onClick={restart}>Usar otro correo</button>}
    {notice && <p role="status" className="auth-feedback">{notice}</p>}
    {error && <p role="alert" className="auth-feedback auth-feedback--error">{error}</p>}
  </>;
}

/** Obligatoria tras entrar con el código: primer acceso o contraseña olvidada. */
export function CreatePasswordPage() {
  const auth = useSupabaseAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  return <AuthFrame title="Crea tu contraseña" description="La usarás para entrar a B20 con tu correo. Debe tener al menos ocho caracteres.">
    <form className="auth-form" onSubmit={(event) => {
      event.preventDefault(); setError('');
      if (password !== confirmation) { setError('Las contraseñas no coinciden.'); return; }
      void auth?.updatePassword(password).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'No se pudo guardar la contraseña.'));
    }}>
      <label className="auth-email"><span>Contraseña</span><input type="password" autoComplete="new-password" required minLength={8} autoFocus value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label className="auth-email"><span>Repite la contraseña</span><input type="password" autoComplete="new-password" required minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <button className="auth-action" disabled={auth?.busy}>{auth?.busy ? 'Guardando…' : 'Guardar contraseña'}</button>
      {error && <p role="alert" className="auth-feedback auth-feedback--error">{error}</p>}
    </form>
  </AuthFrame>;
}

/** Se ofrece una vez, justo después de crear la contraseña; se puede omitir. */
export function PasskeySuggestionPage() {
  const auth = useSupabaseAuth();
  const [error, setError] = useState('');
  return <AuthFrame title="Entra más rápido con una passkey" description="Usa la huella, el rostro o el PIN de este dispositivo en lugar de escribir tu contraseña.">
    <button type="button" className="auth-action" disabled={auth?.busy} onClick={() => {
      setError('');
      void auth?.passkey(true).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'No se pudo registrar la passkey.'));
    }}>{auth?.busy ? 'Un momento…' : 'Añadir una passkey'}</button>
    <button type="button" className="auth-link" disabled={auth?.busy} onClick={() => auth?.skipPasskey()}>Ahora no</button>
    {error && <p role="alert" className="auth-feedback auth-feedback--error">{error}</p>}
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
