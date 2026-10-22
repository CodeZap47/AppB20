import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { Icon, type IconName } from './Icon';
import { useAction } from './useAction';

const TOUR_EVENT = 'b20:open-tour';
export function replayWelcomeTour() {
  window.dispatchEvent(new Event(TOUR_EVENT));
}

const steps: { title: string; description: string; icon: IconName; detail: string }[] = [
  {
    title: 'Tu grupo. Tu espacio.',
    description: 'Bienvenido a B20. Aquí las buenas ideas no se quedan en un solo cuaderno.',
    icon: 'users',
    detail:
      'Comparte lo que sabes, pregunta lo que necesitas y encuentra a tus compañeros. Los mensajes directos y tu avance personal conservan su privacidad.',
  },
  {
    title: 'Cada entrega, en su lugar.',
    description: 'Menos buscar entre mensajes. Más tiempo para entender.',
    icon: 'calendar',
    detail:
      'En Calendario verás las tareas en su fecha de entrega. En Materias están las consignas, las notas del grupo y los apuntes vinculados a cada tarea.',
  },
  {
    title: 'Dale tu personalidad.',
    description: 'Tu perfil es el lugar para presentarte al grupo.',
    icon: 'users',
    detail:
      'Elige una portada, agrega tu foto y cuenta qué te interesa. Puedes compartir habilidades, materias y portafolio. Tu información personal es voluntaria.',
  },
  {
    title: 'Aprender también es compartir.',
    description: 'Ya tienes todo para empezar.',
    icon: 'file',
    detail:
      'Publica tus apuntes, consulta guías y conversa con el grupo. Puedes volver a este recorrido desde Ajustes cuando quieras.',
  },
];

export function WelcomeTour() {
  const source = useDataSource();
  const { me, onboardingCompleted } = useSnapshot();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const { run, pending, error } = useAction();
  useEffect(() => {
    if (me?.status === 'active' && !onboardingCompleted) setOpen(true);
  }, [source, me?.id, me?.status, onboardingCompleted]);
  useEffect(() => {
    const start = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_EVENT, start);
    return () => window.removeEventListener(TOUR_EVENT, start);
  }, []);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (element && !element.open) {
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
    }
    title.current?.focus();
  }, [open, step]);
  if (!open || !me) return null;
  const current = steps[step]!;
  const finish = async (profile: boolean) => {
    if (
      !(await run(async () => {
        await source.completeOnboarding();
        return true;
      }))
    )
      return;
    setOpen(false);
    if (profile) void navigate(`/perfil/${me.id}?personalizar=1`);
  };
  return (
    <dialog
      className="welcome-tour"
      ref={dialog}
      aria-labelledby="tour-title"
      onCancel={(event) => event.preventDefault()}
    >
      <div className={`welcome-tour__art welcome-tour__art--${step}`} aria-hidden="true">
        <span className="welcome-tour__shape" />
        <Icon name={current.icon} size={72} />
        <span className="welcome-tour__spark" />
      </div>
      <div className="welcome-tour__body">
        <h2 id="tour-title" tabIndex={-1} ref={title}>
          {current.title}
        </h2>
        <p className="welcome-tour__description">{current.description}</p>
        <p className="muted">{current.detail}</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="welcome-tour__progress" aria-label={`Paso ${step + 1} de ${steps.length}`}>
          {steps.map((entry, index) => (
            <span key={entry.title} data-current={index === step} />
          ))}
          <span>
            {step + 1} / {steps.length}
          </span>
        </div>
        <div className="welcome-tour__actions">
          {step > 0 && (
            <button className="secondary" onClick={() => setStep(step - 1)} disabled={pending}>
              Atrás
            </button>
          )}
          {step < steps.length - 1 ? (
            <button onClick={() => setStep(step + 1)}>
              Continuar <Icon name="forward" size={16} />
            </button>
          ) : (
            <>
              <button className="secondary" onClick={() => void finish(false)} disabled={pending}>
                Ir al inicio
              </button>
              <button onClick={() => void finish(true)} disabled={pending}>
                {pending ? 'Guardando…' : 'Personalizar mi perfil'}
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
