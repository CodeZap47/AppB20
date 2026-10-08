import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { isValidBirthday, nextCelebration } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { useAction } from '../components/useAction';
import { formatDayMonth, memberName } from '../lib/format';

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('es-MX', { month: 'long' }).format(new Date(2000, i, 1)),
);

function MyBirthday() {
  const source = useDataSource();
  const { me, birthdays } = useSnapshot();
  const mine = birthdays.find((b) => b.memberId === me?.id);
  const [day, setDay] = useState(mine?.day ?? 1);
  const [month, setMonth] = useState(mine?.month ?? 1);
  const [remind, setRemind] = useState(mine?.remind ?? true);
  const { error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => source.shareBirthday(day, month, remind));
  };

  return (
    <form className="form card-surface" onSubmit={submit}>
      <h2>Tu cumpleaños</h2>
      <p className="muted">
        Es voluntario. Solo se comparten día y mes, nunca el año, y puedes retirarlo cuando quieras.
      </p>
      <div className="row">
        <label className="field">
          Día
          <input
            type="number"
            min={1}
            max={31}
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
          />
        </label>
        <label className="field">
          Mes
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
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
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={!isValidBirthday({ day, month })}>
          {mine ? 'Actualizar' : 'Compartir'}
        </button>
        {mine && (
          <button type="button" className="secondary" onClick={() => source.withdrawBirthday()}>
            Dejar de compartir
          </button>
        )}
      </div>
    </form>
  );
}

export function BirthdaysPage() {
  const { members, birthdays } = useSnapshot();
  const today = new Date();
  const upcoming = birthdays
    .map((b) => ({ ...b, next: nextCelebration(b, today) }))
    .sort((a, b) => a.next.getTime() - b.next.getTime());

  return (
    <>
      <h1>Cumpleaños</h1>
      {upcoming.length ? (
        <ul className="list">
          {upcoming.map((b) => (
            <li key={b.memberId} className="list__item list__item--row">
              <Link to={`/perfil/${b.memberId}`}>{memberName(members, b.memberId)}</Link>
              <span className="muted">{formatDayMonth(b.day, b.month)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nadie ha compartido su cumpleaños todavía.</p>
      )}
      <MyBirthday />
    </>
  );
}
