import { useId, type ReactNode } from 'react';

/** Marco visual del acceso. La autenticación y la elección de datos viven fuera de él. */
export function AuthFrame({ title, description, variant = 'compact', busy = false, children }: {
  title: string;
  description?: ReactNode;
  variant?: 'welcome' | 'compact';
  busy?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <main className={`auth-screen auth-screen--${variant}`} aria-busy={busy}>
      <header className="auth-brand" aria-label="B20">
        <span className="auth-brand__mark" aria-hidden="true">B20</span>
        <span className="auth-brand__caption">Espacio del grupo</span>
      </header>
      <div className="auth-layout">
        {variant === 'welcome' && (
          <div className="auth-intro">
            <p className="auth-intro__title">Tu grupo,<br />en un mismo lugar.</p>
            <p className="auth-intro__description">
              Comparte materiales, organiza tus tareas y sigue las conversaciones de tu grupo.
              Aprender juntos empieza aquí.
            </p>
            <StudyComposition />
          </div>
        )}
        <section className="auth-card" aria-labelledby={titleId}>
          <h1 id={titleId} className="auth-card__title">{title}</h1>
          {description && <p className="auth-card__description">{description}</p>}
          <div className="auth-card__content">{children}</div>
        </section>
      </div>
      <footer className="auth-footer">Un espacio para aprender en grupo.</footer>
    </main>
  );
}

/** Tres trazos de un cuaderno se encuentran en un mismo espacio, como el grupo. */
function StudyComposition() {
  return (
    <svg className="auth-composition" viewBox="0 0 520 238" fill="none" aria-hidden="true" focusable="false">
      <path className="auth-composition__rule" d="M0 64h520M0 119h520M0 174h520" />
      <path className="auth-composition__margin" d="M42 10v218" />
      <path className="auth-composition__trace" d="M42 64h68c57 0 55 55 112 55h88" />
      <path className="auth-composition__trace auth-composition__trace--middle" d="M42 119h268" />
      <path className="auth-composition__trace" d="M42 174h68c57 0 55-55 112-55h88" />
      <circle className="auth-composition__point" cx="42" cy="64" r="5" />
      <circle className="auth-composition__point" cx="42" cy="119" r="5" />
      <circle className="auth-composition__point" cx="42" cy="174" r="5" />
      <path className="auth-composition__bracket" d="M284 34h38a26 26 0 0 1 26 26v118a26 26 0 0 1-26 26h-38" />
      <rect className="auth-composition__tile" x="290" y="77" width="128" height="84" rx="20" />
      <text className="auth-composition__word" x="354" y="130" textAnchor="middle">B20</text>
      <circle className="auth-composition__end" cx="468" cy="119" r="6" />
      <path className="auth-composition__trace" d="M418 119h44" />
    </svg>
  );
}
