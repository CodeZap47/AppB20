import type { Subject } from '../data/types';

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
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAll && <option value="">Todas</option>}
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
