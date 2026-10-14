import { useState, type FormEvent } from 'react';
import { useAction } from '../components/useAction';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { useSession, useSessionStore } from './AuthContext';

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
      <main className="signin">
        <h1>B20</h1>
        <p>Tu acceso al grupo fue dado de baja. Si es un error, habla con un creador de la app.</p>
        <button type="button" className="secondary" onClick={() => sessionStore?.signOut()}>
          Usar otra cuenta
        </button>
      </main>
    );
  }

  return (
    <main className="signin">
      <h1>B20</h1>
      <p>
        Entraste como <strong>{profile?.email}</strong>. Elige el nombre que verá el grupo.
      </p>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Tu nombre</span>
          <input value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending || !name.trim()}>
          Unirme al grupo
        </button>
      </form>
      <button type="button" className="link-button" onClick={() => sessionStore?.signOut()}>
        Usar otra cuenta
      </button>
    </main>
  );
}
