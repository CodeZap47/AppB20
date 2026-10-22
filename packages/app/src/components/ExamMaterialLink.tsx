import { Link } from 'react-router';
import type { AiSourceKind } from '@b20/core';

export function ExamMaterialLink({ kind, id, className = 'button secondary' }: { kind: AiSourceKind; id: string; className?: string }) {
  return <Link to={`/m/examenes/nuevo?${new URLSearchParams({ fuente: kind, ref: id })}`} className={className}>Crear examen con este material</Link>;
}
