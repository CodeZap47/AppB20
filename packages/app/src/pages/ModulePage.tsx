import { useParams } from 'react-router';
import { findModule } from '@b20/core';

export function ModulePage() {
  const { moduleId = '' } = useParams();
  const module = findModule(moduleId);

  if (!module) return <h1>Módulo no encontrado</h1>;

  return (
    <>
      <h1>{module.title}</h1>
      <p>{module.summary}</p>
      <p className="muted">
        Sección {module.section} de la definición · se incorpora en la Etapa {module.stage}.
        {module.worksWithoutAi ? '' : ' Usa Gemini (BYOK) cuando esté habilitado.'}
      </p>
      <p className="placeholder">Pantalla pendiente de implementar.</p>
    </>
  );
}
