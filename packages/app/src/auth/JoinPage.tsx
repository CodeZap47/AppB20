import { useId, useRef, useState, type FormEvent } from 'react';
import { DISPLAY_NAME_MAX_LENGTH, displayNameError } from '@b20/core';
import { useAction } from '../components/useAction';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { useSession, useSessionStore } from './AuthContext';
import { AuthFrame } from './AuthFrame';
import { clearInviteLink } from './inviteLink';

/** Pide el nombre al ingresar al grupo o al corregir un perfil anterior. */
export function JoinPage() {
  const source = useDataSource();
  const { me } = useSnapshot();
  const session = useSession();
  const sessionStore = useSessionStore();
  const profile = session?.status === 'signedIn' ? session.profile : undefined;
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const submitting = useRef(false);
  const errorId = useId();
  const { error, pending, run } = useAction();
  const correction = me?.status === 'active';
  const validationError = displayNameError(name);
  const feedback = (touched ? validationError : undefined) ?? error;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current || me?.status === 'removed') return;
    setTouched(true);
    if (validationError) return;
    submitting.current = true;
    try {
      const saved = await run(async () => {
        if (correction) await source.updateProfile(name.trim(), me.photoUrl);
        else await source.joinGroup(name.trim());
        return true;
      });
      if (saved && !correction) clearInviteLink();
    } finally {
      submitting.current = false;
    }
  };

  if (me?.status === 'removed') {
    return (
      <AuthFrame title="Tu acceso al grupo está cerrado"
        description="Tu acceso fue dado de baja. Si es un error, habla con un creador de la app.">
        <button type="button" className="auth-action auth-action--secondary" onClick={() => sessionStore?.signOut()}>
          Usar otra cuenta
        </button>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title={correction ? 'Completa tu nombre' : 'Tu lugar en el grupo'}
      description={<>Entraste como <strong>{profile?.email}</strong>. {correction
        ? 'Escribe el nombre que verá el grupo para continuar.'
        : 'Escribe el nombre que verá el grupo.'}</>}>
      <form className="auth-form" onSubmit={submit} aria-busy={pending} noValidate>
        <label className="field">
          <span className="field__label">Tu nombre</span>
          <input autoComplete="name" value={name} maxLength={DISPLAY_NAME_MAX_LENGTH} required disabled={pending}
            aria-invalid={Boolean(feedback)} aria-describedby={feedback ? errorId : undefined}
            onBlur={() => setTouched(true)} onChange={(e) => { setName(e.target.value); setTouched(true); }} />
        </label>
        {feedback && (
          <p id={errorId} className="auth-feedback auth-feedback--error" role="alert">
            {feedback}
          </p>
        )}
        <button type="submit" className="auth-action" disabled={pending || Boolean(validationError)}>
          {pending ? (correction ? 'Guardando…' : 'Uniéndote…') : (correction ? 'Guardar nombre y continuar' : 'Unirme al grupo')}
        </button>
      </form>
      <button type="button" className="auth-link" onClick={() => sessionStore?.signOut()}>
        Usar otra cuenta
      </button>
    </AuthFrame>
  );
}
