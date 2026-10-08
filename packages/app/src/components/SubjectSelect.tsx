import { periodLabel } from '@b20/core';
import type { Subject } from '../data/types';
import { bySubject } from '../lib/works';

export function SubjectSelect({
  subjects,
  value,
  onChange,
  allowAll = false,
  label = 'Materia',
}: {
  subjects: Subject[];
  value: string;
  onChange: (id: string) => void;
  allowAll?: boolean;
  label?: string;
}) {
  // Con 45 materias, la lista va agrupada por cuatrimestre.
  const periods = [...new Set(subjects.map((s) => s.period))].sort((a, b) => a - b);
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAll && <option value="">Todas</option>}
        {periods.map((period) => (
          <optgroup key={period} label={periodLabel(period)}>
            {subjects
              .filter((s) => s.period === period)
              .sort(bySubject)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
