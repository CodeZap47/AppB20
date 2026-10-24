import { useId, type ReactNode } from 'react';
import { Icon } from '../components/Icon';

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
            <p className="auth-intro__title">Buenas ideas.<br />Mejor <span>en grupo.</span></p>
            <p className="auth-intro__description">
              Tus apuntes, tus entregas y tu gente.<br />Un espacio para aprender y llegar más lejos, juntos.
            </p>
            <LearningComposition />
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
function LearningComposition() {
  return <div className="learning-composition" aria-hidden="true">
    <div className="learning-orbit learning-orbit--one" /><div className="learning-orbit learning-orbit--two" />
    <div className="learning-symbol"><svg viewBox="0 0 100 100" fill="none"><path d="M50 4v92M4 50h92M18 18l64 64M18 82l64-64" stroke="currentColor" strokeWidth="18" /></svg></div>
    <div className="learning-note"><Icon name="file" size={24} /><span>Lo entendiste.<br /><strong>Ahora compártelo.</strong></span><div className="learning-note__lines"><i /><i /><i /></div></div>
    <div className="learning-pill"><Icon name="users" size={19} /><span>Hecho entre compañeros</span></div>
    <span className="learning-word">b20.</span>
  </div>;
}
