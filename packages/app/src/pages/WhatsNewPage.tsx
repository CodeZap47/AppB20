import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { formatClock, formatDayLabel, memberName, peopleList } from '../lib/format';
import {
  birthdaysToday,
  buildNews,
  NEWS_LABEL,
  summarizeNews,
  unreadMessages,
  upcomingDue,
  type NewsItem,
  type NewsKind,
} from '../lib/whatsNew';
import { bySubject } from '../lib/works';

const isKind = (value: string | null): value is NewsKind => Boolean(value && value in NEWS_LABEL);

function dueLabel(days: number): string {
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `En ${days} días`;
}

/** «hoy a las 9:30 a.m.», «ayer a las…» o «el lunes, 5 de octubre a las…». */
function seenLabel(date: Date): string {
  const day = formatDayLabel(date);
  const prefix = day === 'Hoy' || day === 'Ayer' ? day.toLowerCase() : `el ${day.toLowerCase()}`;
  return `${prefix} a las ${formatClock(date)}`;
}

/** Agrupa por día para poner separadores como en un chat: «Hoy», «Ayer», «Lunes, 5 de octubre». */
function byDay(items: NewsItem[]) {
  const groups: { label: string; items: NewsItem[] }[] = [];
  for (const item of items) {
    const label = formatDayLabel(item.at);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/** Pantalla de inicio: lo que pasó en el grupo desde tu última visita (7.1), sin IA. */
export function WhatsNewPage() {
  const source = useDataSource();
  const snapshot = useSnapshot();
  const { me, members, subjects, lastSeenAt, assignments, birthdays } = snapshot;
  const [params, setParams] = useSearchParams();
  const news = useMemo(() => buildNews(snapshot), [snapshot]);
  const now = new Date();

  const isPending = (item: NewsItem) => !lastSeenAt || item.at > lastSeenAt;
  const pending = news.filter(isPending);
  // Sin pendientes no tiene caso abrir en una lista vacía: se muestra todo.
  const showAll = params.get('ver') === 'todo' || pending.length === 0;
  const kind = isKind(params.get('tipo')) ? (params.get('tipo') as NewsKind) : '';
  const subjectId = params.get('materia') ?? '';

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  const base = showAll ? news : pending;
  const bySubjectFilter = base.filter((n) => !subjectId || n.subjectId === subjectId);
  const shown = bySubjectFilter.filter((n) => !kind || n.kind === kind);
  const kinds = (Object.keys(NEWS_LABEL) as NewsKind[])
    .map((k) => ({ id: k, count: bySubjectFilter.filter((n) => n.kind === k).length }))
    .filter((k) => k.count > 0 || k.id === kind);
  const subjectChips = subjects
    .map((s) => ({ ...s, count: base.filter((n) => n.subjectId === s.id).length }))
    .filter((s) => s.count > 0 || s.id === subjectId)
    .sort(bySubject);

  const summary = summarizeNews(pending);
  const messages = unreadMessages(snapshot, lastSeenAt);
  const due = upcomingDue(assignments, now);
  const celebrating = birthdaysToday(
    birthdays.filter((b) => members.some((m) => m.id === b.memberId && m.status === 'active')),
    now,
  );

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {lastSeenAt ? `Marcaste todo como visto ${seenLabel(lastSeenAt)}` : 'Primera visita'}
          </p>
          <h1>¿Qué me perdí?</h1>
          <p className="muted">
            {summary
              ? `${lastSeenAt ? 'Desde tu última visita hay' : 'En el grupo hay'} ${summary}.`
              : 'Estás al corriente: no hay nada nuevo desde tu última visita.'}
          </p>
        </div>
        <div className="row">
          <button
            type="button"
            className="secondary with-icon"
            onClick={() => {
              source.markSeen();
              update({ ver: '' });
            }}
            disabled={!pending.length}
          >
            <Icon name="check" size={16} /> Marcar todo como visto
          </button>
        </div>
      </header>

      <div className="detail">
        <div className="detail__main">
          <div className="toolbar">
            <div className="segmented" role="group" aria-label="Qué mostrar">
              <button
                type="button"
                aria-pressed={!showAll}
                disabled={!pending.length}
                onClick={() => update({ ver: '' })}
              >
                Pendientes <span className="chip__count">{pending.length}</span>
              </button>
              <button type="button" aria-pressed={showAll} onClick={() => update({ ver: 'todo' })}>
                Todo
              </button>
            </div>
          </div>

          {base.length > 0 && (
            <>
              <div className="chips chips--scroll" role="group" aria-label="Tipo de novedad">
                <button
                  type="button"
                  className="chip"
                  aria-pressed={!kind}
                  onClick={() => update({ tipo: '' })}
                >
                  Todo <span className="chip__count">{bySubjectFilter.length}</span>
                </button>
                {kinds.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    className="chip"
                    aria-pressed={kind === k.id}
                    onClick={() => update({ tipo: k.id })}
                  >
                    {NEWS_LABEL[k.id]} <span className="chip__count">{k.count}</span>
                  </button>
                ))}
              </div>
              {subjectChips.length > 0 && (
                <div className="chips chips--small chips--scroll" role="group" aria-label="Materia">
                  <button
                    type="button"
                    className="chip"
                    aria-pressed={!subjectId}
                    onClick={() => update({ materia: '' })}
                  >
                    Todas las materias
                  </button>
                  {subjectChips.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="chip"
                      aria-pressed={subjectId === s.id}
                      onClick={() => update({ materia: s.id })}
                    >
                      {s.name} <span className="chip__count">{s.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {shown.length === 0 ? (
            news.length === 0 ? (
              <Empty icon="check" title="Todavía no pasa nada en el grupo">
                Aquí vas a ver tareas nuevas, cambios de fecha, apuntes, trabajos subidos y
                respuestas, en cuanto alguien los publique.
              </Empty>
            ) : (
              <Empty
                icon="search"
                title="Nada con estos filtros"
                action={
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => update({ tipo: '', materia: '' })}
                  >
                    Quitar filtros
                  </button>
                }
              >
                Prueba con otro tipo de novedad o con todas las materias.
              </Empty>
            )
          ) : (
            byDay(shown).map((group) => (
              <section key={group.label} className="news-day">
                <h2 className="label">{group.label}</h2>
                <ul className="news">
                  {group.items.map((n) => {
                    const subject = subjects.find((s) => s.id === n.subjectId);
                    const isNew = isPending(n);
                    return (
                      <li key={n.key}>
                        <Link
                          to={n.link}
                          className={isNew ? 'news-item news-item--pending' : 'news-item'}
                        >
                          <Avatar member={members.find((m) => m.id === n.actorId)} size={36} />
                          <span className="news-item__body">
                            <span className="news-item__text">
                              <strong>{memberName(members, n.actorId)}</strong> {n.text}
                            </span>
                            <span className="news-item__meta">
                              <span className={`badge news-kind news-kind--${n.kind}`}>
                                {NEWS_LABEL[n.kind]}
                              </span>
                              <span>
                                {subject?.name ?? 'Sin materia'} ·{' '}
                                <time dateTime={n.at.toISOString()}>{formatClock(n.at)}</time>
                              </span>
                            </span>
                          </span>
                          {isNew && (
                            <span className="news-item__dot" role="img" aria-label="Pendiente" />
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        <aside className="detail__side">
          {celebrating.length > 0 && (
            <section className="panel news-birthday">
              <span className="news-birthday__emoji" aria-hidden="true">
                🎂
              </span>
              <p>
                Hoy {celebrating.length === 1 ? 'cumple' : 'cumplen'}{' '}
                <strong>
                  {peopleList(
                    celebrating.map((b) => b.memberId),
                    members,
                    me?.id,
                  )}
                </strong>
                .{' '}
                {celebrating.length === 1 && celebrating[0]!.memberId !== me?.id ? (
                  <Link to={`/perfil/${celebrating[0]!.memberId}`}>Ver perfil</Link>
                ) : (
                  <Link to="/m/cumpleanos">Ver cumpleaños</Link>
                )}
              </p>
            </section>
          )}

          <section className="panel">
            <h2 className="label">Mensajes nuevos</h2>
            {messages.group === 0 && messages.direct.length === 0 ? (
              <p className="muted">No tienes mensajes nuevos.</p>
            ) : (
              <ul className="links">
                {messages.group > 0 && (
                  <li>
                    <Link to="/m/mensajes" className="news-link">
                      <span className="avatar avatar--group news-link__icon" aria-hidden="true">
                        <Icon name="users" size={16} />
                      </span>
                      <span className="news-link__text">Canal del salón</span>
                      <span className="news-count">{messages.group}</span>
                    </Link>
                  </li>
                )}
                {messages.direct.map((d) => (
                  <li key={d.conversation.id}>
                    <Link to={`/m/mensajes/directos/${d.conversation.id}`} className="news-link">
                      <Avatar member={members.find((m) => m.id === d.otherId)} size={28} />
                      <span className="news-link__text">{memberName(members, d.otherId)}</span>
                      <span className="news-count">{d.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2 className="label">Entregas de esta semana</h2>
            {due.length === 0 ? (
              <p className="muted">Nada que entregar en los próximos 7 días.</p>
            ) : (
              <ul className="links">
                {due.map(({ assignment, inDays }) => (
                  <li key={assignment.id}>
                    <Link to={`/m/tareas/${assignment.id}`} className="news-link">
                      <span className="news-link__text">
                        <strong>{assignment.title}</strong>
                        <span className="muted">
                          {subjects.find((s) => s.id === assignment.subjectId)?.name}
                        </span>
                      </span>
                      <span className={inDays <= 1 ? 'news-due news-due--soon' : 'news-due'}>
                        {dueLabel(inDays)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Link to="/modulos" className="news-modules">
            Ver todos los módulos
          </Link>
        </aside>
      </div>
    </>
  );
}
