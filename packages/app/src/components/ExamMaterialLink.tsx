import { Link } from 'react-router';
import type { AiSourceKind } from '@b20/core';

export function ExamMaterialLink({ kind, id }: { kind: AiSourceKind; id: string }) {
  return <Link to={`/m/examenes/nuevo?${new URLSearchParams({ fuente: kind, ref: id })}`} className="button secondary">Crear examen con este material</Link>;
}
