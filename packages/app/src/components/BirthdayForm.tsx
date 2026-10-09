import { useState, type FormEvent } from 'react';
import { isValidBirthday } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { useAction } from './useAction';

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('es-MX', { month: 'long' }).format(new Date(2000, i, 1)),
);

/** Días que puede tener un mes; febrero admite el 29 porque no se guarda el año. */
const daysIn = (month: number) => new Date(2000, month, 0).getDate();

/**
 * Captura del cumpleaños propio (3.10). Es el único lugar donde se agrega o cambia: vive en el
 * perfil de cada quien, y el calendario solo lo muestra.
 */
export function BirthdayForm({ onDone }: { onDone: () => void }) {
  const source = useDataSource();
  const { me, birthdays } = useSnapshot();
  const mine = birthdays.find((b) => b.memberId === me?.id);
  const [day, setDay] = useState(mine?.day ?? 0);
  const [month, setMonth] = useState(mine?.month ?? 0);
  const [remind, setRemind] = useState(mine?.remind ?? true);
  const { error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => (source.shareBirthday(day, month, remind), true))) onDone();
  };

  const withdraw = () => {
    if (run(() => (source.withdrawBirthday(), true))) onDone();
  };

  return (
    <form className="bday-form" onSubmit={submit}>
      <p className="muted">Solo se comparten el día y el mes, nunca el año.</p>
      <div className="bday-form__date">
        <label className="field">
          Día
          <select value={day} onChange={(e) => setDay(Number(e.target.value))} required>
            <option value={0} disabled>
              Día
            </option>
            {Array.from({ length: daysIn(month || 1) }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Mes
          <select
            value={month}
            onChange={(e) => {
              const next = Number(e.target.value);
              setMonth(next);
              setDay((d) => Math.min(d, daysIn(next)));
            }}
            required
          >
            <option value={0} disabled>
              Mes
            </option>
            {MONTHS.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
        Recordar al grupo
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={!isValidBirthday({ day, month })}>
          Guardar
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
      </div>
      {mine && (
        <button type="button" className="link-button bday-form__withdraw" onClick={withdraw}>
          Dejar de compartirlo
        </button>
      )}
    </form>
  );
}
