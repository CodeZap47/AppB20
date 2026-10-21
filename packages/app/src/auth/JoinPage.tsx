import { useState, type FormEvent } from 'react';
import { useAction } from '../components/useAction';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { useSession, useSessionStore } from './AuthContext';
import { AuthFrame } from './AuthFrame';

/** Con sesión pero sin membresía: unirse con el nombre que verá el grupo. */
export function JoinPage() {
  const source = useDataSource();
  const { me } = useSnapshot();
  const session = useSession();
  const sessionStore = useSessionStore();
  const profile = session?.status === 'signedIn' ? session.profile : undefined;
  const [name, setName] = useState(profile?.name ?? '');
  const { error, pending, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await run(() => source.joinGroup(name));
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
    <AuthFrame title="Tu lugar en el grupo"
      description={<>Entraste como <strong>{profile?.email}</strong>. Elige el nombre que verá el grupo.</>}>
      <form className="auth-form" onSubmit={submit} aria-busy={pending}>
        <label className="field">
          <span className="field__label">Tu nombre</span>
          <input autoComplete="name" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
        </label>
        {error && (
          <p className="auth-feedback auth-feedback--error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="auth-action" disabled={pending || !name.trim()}>
          {pending ? 'Uniéndote…' : 'Unirme al grupo'}
        </button>
      </form>
      <button type="button" className="auth-link" onClick={() => sessionStore?.signOut()}>
        Usar otra cuenta
      </button>
    </AuthFrame>
  );
}
