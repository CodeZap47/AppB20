import { useState, type FormEvent } from 'react';
import {
  canManageCalendar,
  PERIOD_COUNT,
  periodLabel,
  TERMS_PER_PERIOD,
  type TermDates,
  type TermDatesInput,
} from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { formatMediumDate, parseDay } from '../lib/format';
import { currentPlacement } from '../lib/period';
import { useAction } from './useAction';

const PERIODS = Array.from({ length: PERIOD_COUNT }, (_, i) => i + 1);
const TERM_NUMBERS = Array.from({ length: TERMS_PER_PERIOD }, (_, i) => i + 1);

const range = (entry: TermDates) =>
  `del ${formatMediumDate(parseDay(entry.startDate))} al ${formatMediumDate(parseDay(entry.endDate))}`;

function rowsOf(calendar: TermDates[], period: number): TermDatesInput[] {
  return TERM_NUMBERS.map((term) => {
    const entry = calendar.find((e) => e.period === period && e.term === term);
    return { startDate: entry?.startDate ?? '', endDate: entry?.endDate ?? '' };
  });
}

/** Fechas de los tres parciales de un cuatrimestre; solo lo ven editable los administradores. */
function PeriodForm({ period, calendar }: { period: number; calendar: TermDates[] }) {
  const source = useDataSource();
  const { error, run } = useAction();
  const saved = rowsOf(calendar, period);
  const [rows, setRows] = useState(saved);
  const [done, setDone] = useState(false);
  const changed = rows.some(
    (row, i) => row.startDate !== saved[i]?.startDate || row.endDate !== saved[i]?.endDate,
  );

  const set = (index: number, change: Partial<TermDatesInput>) => {
    setDone(false);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDone(Boolean(run(() => (source.saveCalendar(period, rows), true))));
  };

  return (
    <form className="form" onSubmit={submit}>
      <div className="calendar">
        {rows.map((row, i) => (
          <fieldset key={i} className="calendar__term">
            <legend className="field__label">Parcial {i + 1}</legend>
            <label className="field">
              <span className="field__hint">Empieza</span>
              <input
                type="date"
                value={row.startDate}
                max={row.endDate || undefined}
                onChange={(e) => set(i, { startDate: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__hint">Termina</span>
              <input
                type="date"
                value={row.endDate}
                min={row.startDate || undefined}
                onChange={(e) => set(i, { endDate: e.target.value })}
              />
            </label>
          </fieldset>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form__actions">
        <span className="muted form__note" role="status">
          {done && !changed
            ? 'Fechas guardadas.'
            : 'Deja las dos fechas vacías en un parcial que todavía no quieras configurar.'}
        </span>
        <button type="submit" disabled={!changed}>
          Guardar fechas
        </button>
      </div>
    </form>
  );
}

/**
 * Calendario de parciales (Ajustes). Todos ven en qué cuatrimestre y parcial va el grupo; solo
 * los administradores cambian las fechas, porque de ellas depende cómo abren los formularios
 * de «Registrar actividad» y «Nueva tarea o actividad» para todo el grupo.
 */
export function CalendarSettings() {
  const { me, calendar } = useSnapshot();
  const current = currentPlacement(calendar);
  const [period, setPeriod] = useState(current?.period ?? 1);
  const admin = canManageCalendar(me);
  const configured = calendar.filter((entry) => entry.period === period).sort((a, b) => a.term - b.term);

  return (
    <section className="panel settings">
      <h2>Calendario de parciales</h2>
      <p className="muted">
        Con estas fechas la app sabe en qué cuatrimestre y parcial va el grupo. Al llegar el primer día
        de un parcial, los formularios de «Registrar actividad» y «Nueva tarea o actividad» abren ya
        con ese cuatrimestre y ese parcial elegidos.
      </p>
      <p className="calendar__now">
        <strong>Hoy:</strong>{' '}
        {current
          ? `${periodLabel(current.period)}, parcial ${current.term} (${range(current)}).`
          : 'todavía no empieza ningún parcial con fechas.'}
      </p>

      <div className="chips chips--scroll" role="group" aria-label="Cuatrimestre">
        {PERIODS.map((n) => (
          <button
            key={n}
            type="button"
            className="chip"
            aria-pressed={period === n}
            onClick={() => setPeriod(n)}
          >
            {periodLabel(n)}
            {calendar.some((entry) => entry.period === n) && (
              <span className="chip__count">
                {calendar.filter((entry) => entry.period === n).length} de {TERMS_PER_PERIOD}
              </span>
            )}
          </button>
        ))}
      </div>

      {admin ? (
        <PeriodForm key={period} period={period} calendar={calendar} />
      ) : (
        <>
          {configured.length ? (
            <dl className="facts calendar__readonly">
              {configured.map((entry) => (
                <div key={entry.term}>
                  <dt>Parcial {entry.term}</dt>
                  <dd>{range(entry)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">Este cuatrimestre todavía no tiene fechas.</p>
          )}
          <p className="field__hint">Solo los administradores del grupo pueden cambiar estas fechas.</p>
        </>
      )}
    </section>
  );
}
