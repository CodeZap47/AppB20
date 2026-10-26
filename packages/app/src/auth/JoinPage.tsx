import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { DISPLAY_NAME_MAX_LENGTH, displayNameError } from '@b20/core';
import { useAction } from '../components/useAction';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { useSession, useSessionStore } from './AuthContext';
import { AuthFrame } from './AuthFrame';
import { clearPendingInvitation, getPendingInvitation } from './pendingInvitation';
import { clearInviteLink } from './inviteLink';

/** Pide el nombre al ingresar al grupo o al corregir un perfil anterior. */
export function JoinPage() {
  const source = useDataSource();
  const { me } = useSnapshot();
  const session = useSession();
  const sessionStore = useSessionStore();
  const profile = session?.status === 'signedIn' ? session.profile : undefined;
  const [name, setName] = useState('');
  const [invitation, setInvitation] = useState(getPendingInvitation);
  const [access, setAccess] = useState({ blocked: false, canRejoin: false });
  const [accessReady, setAccessReady] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [touched, setTouched] = useState(false);
  const submitting = useRef(false);
  const errorId = useId();
  const { error, pending, run } = useAction();
  const correction = me?.status === 'active';
  const validationError = displayNameError(name);
  const feedback = (touched ? validationError : undefined) ?? error;
  useEffect(() => {
    let active = true;
    setAccessReady(false); setAccessError('');
    void Promise.resolve().then(() => source.getMyMembershipAccess()).then((value) => {
      if (active) { setAccess(value); setAccessReady(true); }
    }).catch((failure: unknown) => { if (active) setAccessError(failure instanceof Error ? failure.message : 'No se pudo comprobar tu acceso al grupo.'); });
    return () => { active = false; };
  }, [source, me?.status, accessAttempt]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current || !accessReady || access.blocked || me?.status === 'removed' && !access.canRejoin) return;
    setTouched(true);
    if (validationError) return;
    submitting.current = true;
    try {
      await run(async () => {
        if (correction) await source.updateProfile(name.trim(), me.photoUrl);
        else if (access.canRejoin) await source.joinGroup(name.trim());
        else if (invitation && me?.status !== 'removed') await source.joinWithInvitationLink(invitation, name.trim());
        else await source.joinGroup(name.trim());
        clearPendingInvitation();
        clearInviteLink();
      });
    } finally {
      submitting.current = false;
    }
  };

  if (!accessReady) return <AuthFrame title="Comprobando tu invitación" busy={!accessError}>
    {accessError ? <><p role="alert" className="auth-feedback auth-feedback--error">{accessError}</p><button type="button" className="auth-action" onClick={() => setAccessAttempt((attempt) => attempt + 1)}>Volver a comprobar</button></>
      : <p role="status">Comprobando tu acceso y las invitaciones individuales disponibles…</p>}
  </AuthFrame>;

  if (access.blocked || me?.status === 'removed' && !access.canRejoin) {
    return (
      <AuthFrame title="Tu acceso al grupo está cerrado"
        description={access.blocked ? 'Tu correo está bloqueado. Administración debe desbloquearlo y enviarte una invitación individual para regresar.' : 'Tu acceso fue dado de baja. Pide a Administración una nueva invitación individual para regresar.'}>
        <button type="button" className="auth-action" disabled={pending} onClick={() => void run(async () => { setAccess(await source.getMyMembershipAccess()); })}>Comprobar nueva invitación</button>
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
        : access.canRejoin ? me?.status === 'removed' ? 'Tienes una nueva invitación individual. Recuperarás tu misma membresía y autoría.' : 'Tienes una invitación individual disponible. Se conservará el rol que Administración te concedió.' : invitation ? 'Te incorporarás mediante un enlace de invitación. Escribe el nombre que verá el grupo.' : 'Escribe el nombre que verá el grupo.'}</>}>
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
      {invitation && <button type="button" className="auth-action auth-action--secondary" disabled={pending} onClick={() => { clearPendingInvitation(); setInvitation(undefined); }}>Cancelar invitación del enlace</button>}
      <button type="button" className="auth-link" onClick={() => sessionStore?.signOut()}>
        Usar otra cuenta
      </button>
    </AuthFrame>
  );
}
