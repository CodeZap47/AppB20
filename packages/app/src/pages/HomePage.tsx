import { Link } from 'react-router';
import { MODULES, type Stage } from '@b20/core';
import { usePlatform } from '../components/PlatformContext';
import { PLATFORM_LABEL } from '../platform';

const STAGE_LABEL: Record<Stage, string> = {
  0: 'Etapa 0 · Prototipo',
  1: 'Etapa 1 · MVP',
  2: 'Etapa 2 · Colaboración y estudio',
  3: 'Etapa 3 · Comunidad',
};

export function HomePage() {
  const platform = usePlatform();
  const stages = [1, 2, 3] as const;

  return (
    <>
      <h1>App B20</h1>
      <p className="muted">
        Espacio del grupo para colaborar, organizar trabajos por materia y estudiar. Estás en:{' '}
        {PLATFORM_LABEL[platform]}.
      </p>
      {stages.map((stage) => (
        <section key={stage}>
          <h2>{STAGE_LABEL[stage]}</h2>
          <ul className="cards">
            {MODULES.filter((m) => m.stage === stage).map((m) => (
              <li key={m.id} className="card">
                <Link to={`/m/${m.id}`}>
                  <strong>{m.title}</strong>
                  <span className="muted">{m.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
