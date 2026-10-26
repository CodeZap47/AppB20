import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { Empty } from '../components/Empty';
import { useAction } from '../components/useAction';
import { Icon } from '../components/Icon';
import { ClassicNewsList } from '../components/whatsNew/ClassicNewsList';
import { FeedComposer } from '../components/whatsNew/FeedComposer';
import { FeedView } from '../components/whatsNew/FeedView';
import { NewsSidebar } from '../components/whatsNew/NewsSidebar';
import { StoriesBar } from '../components/whatsNew/StoriesBar';
import { useSharedFeedExams } from '../components/whatsNew/useSharedFeedExams';
import { formatClock, formatDayLabel } from '../lib/format';
import {
  birthdaysToday,
  buildNews,
  NEWS_LABEL,
  ownFeedNews,
  summarizeNews,
  unreadMessages,
  upcomingDue,
  type NewsItem,
  type NewsKind,
} from '../lib/whatsNew';
import { bySubject } from '../lib/works';
import './whatsNew.css';

type View = 'feed' | 'clasica';
const VIEW_KEY = 'b20:inicio:vista';

const isKind = (value: string | null): value is NewsKind => Boolean(value && Object.hasOwn(NEWS_LABEL, value));
const isView = (value: string | null | undefined): value is View => value === 'feed' || value === 'clasica';

/** La vista elegida se recuerda en este dispositivo; sin almacenamiento se usa el feed. */
function storedView(): View {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return isView(value) ? value : 'feed';
  } catch {
    return 'feed';
  }
}

/** «hoy a las 9:30 a.m.», «ayer a las…» o «el lunes, 5 de octubre a las…». */
function seenLabel(date: Date): string {
  const day = formatDayLabel(date);
  const prefix = day === 'Hoy' || day === 'Ayer' ? day.toLowerCase() : `el ${day.toLowerCase()}`;
  return `${prefix} a las ${formatClock(date)}`;
}

/**
 * Pantalla de inicio: lo que pasó en el grupo desde tu última visita (7.1), sin IA. Se ve como
 * feed (tarjetas con vista previa, reacciones y publicaciones propias) o en la lista clásica.
 */
export function WhatsNewPage() {
  const source = useDataSource();
  const { error, pending: marking, run } = useAction();
  const snapshot = useSnapshot();
  const { me, members, subjects, lastSeenAt, assignments, birthdays } = snapshot;
  const [params, setParams] = useSearchParams();
  const [now, setNow] = useState(() => new Date());
  const sharedExams = useSharedFeedExams(true);
  const news = useMemo(() => buildNews(snapshot, now, sharedExams.exams), [snapshot, now, sharedExams.exams]);
  const mine = useMemo(() => ownFeedNews(snapshot, now, sharedExams.exams), [snapshot, now, sharedExams.exams]);
  useEffect(() => {
    const tick = () => { if (document.visibilityState !== 'hidden') setNow(new Date()); };
    const interval = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
  }, []);

  const highlightPostId = params.get('publicacion') ?? undefined;
  const requested = params.get('vista');
  const view: View = highlightPostId ? 'feed' : isView(requested) ? requested : storedView();

  const isPending = (item: NewsItem) => item.actorId !== me?.id && (!lastSeenAt || item.at > lastSeenAt);
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

  const chooseView = (next: View) => {
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* La preferencia sigue en la URL de esta visita. */
    }
    update({ vista: next, publicacion: '' });
  };

  // En el feed también se ven tus publicaciones: todas en «Todo» y las recientes en «Pendientes».
  const own = view === 'feed' ? mine.filter((n) => showAll || !lastSeenAt || n.at > lastSeenAt) : [];
  const highlighted = highlightPostId ? [...news, ...mine].filter((n) => n.target?.kind === 'post' && n.target.id === highlightPostId) : [];
  const base = [...new Map([...(showAll ? news : pending), ...own, ...highlighted].map((item) => [item.key, item])).values()]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.key.localeCompare(b.key));
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
    <div className="whats-new-page">
      <header className="page-header feed-page-header">
        <div>
          <span className="feed-page-header__eyebrow">COMUNIDAD B20</span>
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
          <div className="segmented" role="group" aria-label="Vista">
            <button type="button" aria-pressed={view === 'feed'} onClick={() => chooseView('feed')}>
              Feed
            </button>
            <button type="button" aria-pressed={view === 'clasica'} onClick={() => chooseView('clasica')}>
              Clásica
            </button>
          </div>
          <button
            type="button"
            className="secondary with-icon"
            onClick={async () => {
              if (await run(async () => { await source.markSeen(); return true; })) update({ ver: '' });
            }}
            disabled={!pending.length || marking}
          >
            <Icon name="check" size={16} /> Marcar todo como visto
          </button>
        </div>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="feed-privacy"><Icon name="users" size={15} />Un espacio para lo que compartimos. La lectura de tus chats se guarda por separado.</p>

      <div className={view === 'feed' ? 'detail detail--feed' : 'detail'}>
        <div className="detail__main">
          {view === 'feed' && (
            <>
              <StoriesBar meId={me?.id} members={members} celebrating={celebrating} messages={messages} due={due} />
              <FeedComposer key={me?.id} me={me} subjects={subjects} />
            </>
          )}

          <div className="feed-filter-panel">
          <div className="toolbar feed-filter-panel__head">
            <h2>Explora el grupo</h2>
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
          </div>

          {sharedExams.error && <div className="feed-sync-notice" role="status">
            <span>No se pudieron actualizar los exámenes compartidos.</span>
            <button type="button" className="link-button" disabled={sharedExams.loading} onClick={sharedExams.refresh}>Reintentar</button>
          </div>}

          {shown.length === 0 ? (
            news.length === 0 && mine.length === 0 ? (
              <Empty icon="check" title="Todavía no pasa nada en el grupo">
                Aquí verás las tareas, apuntes, preguntas, retos y demás aportes que compartan contigo.
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
          ) : view === 'feed' ? (
            <FeedView key={me?.id} items={shown} snapshot={snapshot} sharedExams={sharedExams.exams} isPending={isPending} now={now} highlightPostId={highlightPostId} />
          ) : (
            <ClassicNewsList items={shown} members={members} subjects={subjects} isPending={isPending} />
          )}
        </div>

        <NewsSidebar meId={me?.id} members={members} subjects={subjects} celebrating={celebrating} messages={messages} due={due} />
      </div>
    </div>
  );
}
