import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { celebrationDate, daysUntil, monthGrid } from '@b20/core';
import { useSnapshot } from '../data/DataContext';
import type { Birthday, Member } from '../data/types';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { formatDayMonth, hueOf, memberName, peopleList } from '../lib/format';

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => {
  const date = new Date(2026, 1, 1 + i); // 1 de febrero de 2026 fue domingo.
  return {
    short: new Intl.DateTimeFormat('es-MX', { weekday: 'narrow' }).format(date),
    long: new Intl.DateTimeFormat('es-MX', { weekday: 'long' }).format(date),
  };
});
const monthTitle = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' });
const dayTitle = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const monthName = new Intl.DateTimeFormat('es-MX', { month: 'long' });
const MAX_DOTS = 3;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const monthParam = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/** Lee `?mes=AAAA-MM`; si falta o no es válido, el mes en curso. */
function parseMonth(value: string | null, today: Date): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (match && month >= 1 && month <= 12) return { year, month };
  return { year: today.getFullYear(), month: today.getMonth() + 1 };
}

function whenLabel(days: number): string {
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `En ${days} días`;
}

function PersonRow({
  member,
  birthday,
  today,
  meId,
}: {
  member: Member | undefined;
  birthday: Birthday;
  today: Date;
  meId: string | undefined;
}) {
  const days = daysUntil(birthday, today);
  return (
    <li>
      <Link to={`/perfil/${birthday.memberId}`} className="bday-person">
        <Avatar member={member} size={36} />
        <span className="bday-person__body">
          <strong>
            {member?.displayName ?? 'Integrante'}
            {birthday.memberId === meId && <span className="muted"> (tú)</span>}
          </strong>
          <span className="muted">{formatDayMonth(birthday.day, birthday.month)}</span>
        </span>
        <span className={days === 0 ? 'bday-when bday-when--today' : 'bday-when'}>
          {whenLabel(days)}
        </span>
      </Link>
    </li>
  );
}

/** Calendario de cumpleaños (3.10): cada punto es alguien que cumple ese día. */
export function BirthdaysPage() {
  const { me, members, birthdays } = useSnapshot();
  const [params, setParams] = useSearchParams();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const { year, month } = parseMonth(params.get('mes'), today);
  const selectedDay = Number(params.get('dia')) || 0;
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;

  const active = new Set(members.filter((m) => m.status === 'active').map((m) => m.id));
  const shared = birthdays.filter((b) => active.has(b.memberId));
  const byName = (a: Birthday, b: Birthday) =>
    memberName(members, a.memberId).localeCompare(memberName(members, b.memberId), 'es');
  const on = (date: Date) =>
    shared.filter((b) => sameDay(celebrationDate(b, date.getFullYear()), date)).sort(byName);
  const inMonth = shared
    .filter((b) => celebrationDate(b, year).getMonth() === month - 1)
    .sort(
      (a, b) =>
        celebrationDate(a, year).getDate() - celebrationDate(b, year).getDate() || byName(a, b),
    );

  const mine = shared.find((b) => b.memberId === me?.id);
  const selected = selectedDay ? new Date(year, month - 1, selectedDay) : undefined;
  const selectedValid = selected && selected.getMonth() === month - 1 ? selected : undefined;

  const go = (y: number, m: number, day?: number) => {
    const date = new Date(y, m - 1, 1);
    const next: Record<string, string> = {
      mes: monthParam(date.getFullYear(), date.getMonth() + 1),
    };
    if (day) next.dia = String(day);
    setParams(next, { replace: true });
  };
  const select = (date: Date) =>
    go(year, month, selectedValid && sameDay(selectedValid, date) ? undefined : date.getDate());

  const shown = selectedValid ? on(selectedValid) : inMonth;
  // Los que ya aparecen en el panel del mes o del día no se repiten en «Próximos».
  const upcoming = shared
    .filter((b) => !shown.includes(b))
    .sort((a, b) => daysUntil(a, today) - daysUntil(b, today) || byName(a, b))
    .slice(0, 5);
  const findMember = (id: string) => members.find((m) => m.id === id);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Cumpleaños</h1>
          <p className="muted">
            Cada punto es alguien del grupo que cumple ese día. Cada quien agrega su fecha desde su
            perfil y solo se comparten día y mes.
          </p>
        </div>
        {me && (
          <div className="row">
            <Link to={`/perfil/${me.id}?cumple=editar`} className="button secondary with-icon">
              <Icon name={mine ? 'edit' : 'plus'} size={16} />{' '}
              {mine ? 'Cambiar mi cumpleaños' : 'Agregar mi cumpleaños'}
            </Link>
          </div>
        )}
      </header>

      <div className="detail">
        <section className="panel bday-cal" aria-labelledby="bday-month">
          <header className="bday-cal__header">
            <h2 id="bday-month">{capitalize(monthTitle.format(new Date(year, month - 1, 1)))}</h2>
            <div className="bday-cal__nav">
              <button
                type="button"
                className="secondary"
                disabled={isCurrentMonth && !selectedValid}
                onClick={() => go(today.getFullYear(), today.getMonth() + 1)}
              >
                Hoy
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Mes anterior"
                onClick={() => go(year, month - 1)}
              >
                <Icon name="back" size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Mes siguiente"
                onClick={() => go(year, month + 1)}
              >
                <Icon name="forward" size={18} />
              </button>
            </div>
          </header>

          <div className="bday-cal__weekdays" aria-hidden="true">
            {WEEKDAYS.map((d) => (
              <span key={d.long} title={d.long}>
                {d.short}
              </span>
            ))}
          </div>
          <ol className="bday-cal__grid">
            {monthGrid(year, month).map((date) => {
              if (date.getMonth() !== month - 1) {
                return (
                  <li
                    key={date.toISOString()}
                    className="bday-day bday-day--outside"
                    aria-hidden="true"
                  >
                    <span className="bday-day__number">{date.getDate()}</span>
                  </li>
                );
              }
              const people = on(date);
              const isToday = sameDay(date, today);
              const names = peopleList(
                people.map((b) => b.memberId),
                members,
              );
              const label = [
                capitalize(dayTitle.format(date)),
                isToday && 'hoy',
                people.length ? `${people.length > 1 ? 'cumplen' : 'cumple'} ${names}` : '',
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <li key={date.toISOString()}>
                  <button
                    type="button"
                    className={[
                      'bday-day',
                      isToday && 'bday-day--today',
                      people.length > 0 && 'bday-day--has',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-pressed={Boolean(selectedValid && sameDay(selectedValid, date))}
                    aria-label={label}
                    title={names || undefined}
                    onClick={() => select(date)}
                  >
                    <span className="bday-day__number">{date.getDate()}</span>
                    {people.length > 0 && (
                      <span className="bday-day__dots" aria-hidden="true">
                        {people.slice(0, MAX_DOTS).map((b) => (
                          <span
                            key={b.memberId}
                            className="bday-dot"
                            style={{ '--hue': hueOf(b.memberId) } as CSSProperties}
                          />
                        ))}
                        {people.length > MAX_DOTS && (
                          <span className="bday-day__more">+{people.length - MAX_DOTS}</span>
                        )}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="detail__side">
          <section className="panel" aria-live="polite">
            <h2 className="label">
              {selectedValid
                ? capitalize(dayTitle.format(selectedValid))
                : `En ${monthName.format(new Date(year, month - 1, 1))}`}
            </h2>
            {shown.length ? (
              <ul className="bday-people">
                {shown.map((b) => (
                  <PersonRow
                    key={b.memberId}
                    member={findMember(b.memberId)}
                    birthday={b}
                    today={today}
                    meId={me?.id}
                  />
                ))}
              </ul>
            ) : (
              <p className="muted">
                {selectedValid ? 'Nadie cumple años este día.' : 'Nadie cumple años este mes.'}
              </p>
            )}
            {selectedValid && (
              <button type="button" className="link-button" onClick={() => go(year, month)}>
                Ver todo el mes
              </button>
            )}
          </section>

          <section className="panel">
            <h2 className="label">Próximos</h2>
            {upcoming.length ? (
              <ul className="bday-people">
                {upcoming.map((b) => (
                  <PersonRow
                    key={b.memberId}
                    member={findMember(b.memberId)}
                    birthday={b}
                    today={today}
                    meId={me?.id}
                  />
                ))}
              </ul>
            ) : (
              <p className="muted">
                {shared.length
                  ? 'Nadie más ha compartido su cumpleaños.'
                  : 'Nadie ha compartido su cumpleaños todavía.'}
              </p>
            )}
          </section>

          {me && !mine && (
            <section className="panel bday-cta">
              <Icon name="cake" size={24} />
              <p>
                Todavía no agregas tu cumpleaños. Es voluntario y se hace desde{' '}
                <Link to={`/perfil/${me.id}?cumple=editar`}>tu perfil</Link>.
              </p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
