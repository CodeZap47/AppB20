import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ResourceComments } from '../components/whatsNew/ResourceComments';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  breakdown,
  CONTRIBUTION_KINDS,
  CONTRIBUTION_RULES,
  NOT_SCORED,
  RECOGNITIONS,
  leaderChanges,
  rankingFeedId,
  type ContributionKind,
  type RecognitionId,
} from '@b20/core';
import { useSnapshot } from '../data/DataContext';
import type { Member, Snapshot } from '../data/types';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { formatTime } from '../lib/format';
import { matches } from '../lib/search';
import {
  buildLeaderboard,
  leaderboardPeriods,
  standingSummary,
  type LeaderboardPeriod,
  type MemberStanding,
} from '../lib/contributions';

const pointsFormat = new Intl.NumberFormat('es-MX');
const points = (n: number) => `${pointsFormat.format(n)} ${n === 1 ? 'punto' : 'puntos'}`;

/** Periodo elegido en `?periodo=`; si no existe, el primero disponible. */
function usePeriod(data: Snapshot) {
  const [params, setParams] = useSearchParams();
  const periods = useMemo(() => leaderboardPeriods(data.calendar), [data.calendar]);
  const period = periods.find((p) => p.id === params.get('periodo')) ?? periods[0]!;
  const choose = (next: LeaderboardPeriod) =>
    setParams(next.id === periods[0]?.id ? {} : { periodo: next.id }, { replace: true });
  return { periods, period, choose, query: params.get('periodo') ? `?periodo=${period.id}` : '' };
}

function PeriodPicker({
  periods,
  period,
  choose,
}: {
  periods: LeaderboardPeriod[];
  period: LeaderboardPeriod;
  choose: (p: LeaderboardPeriod) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Periodo">
      {periods.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={p.id === period.id}
          onClick={() => choose(p)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Hojas de una rama del laurel: en pares a los lados de un tallo curvo alrededor del número,
 * apuntando hacia arriba como en una corona de premiación.
 */
const LEAVES = [126, 156, 186, 216].flatMap((degrees) =>
  [
    { radius: 12.6, tilt: -38 },
    { radius: 8.6, tilt: 38 },
  ].map(({ radius, tilt }) => {
    const angle = ((degrees + 8) * Math.PI) / 180;
    const x = (16 + radius * Math.cos(angle)).toFixed(2);
    const y = (16.5 + radius * Math.sin(angle)).toFixed(2);
    return { key: `${degrees}${tilt}`, x, y, rotate: degrees + tilt };
  }),
);

/** Insignia de laurel para los tres primeros lugares, como en una premiación. */
function Medal({ rank }: { rank: number }) {
  return (
    <span className={`medal medal--${rank}`} aria-label={`Lugar ${rank}`}>
      <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
        {[0, 1].map((side) => (
          <g key={side} transform={side ? 'translate(32 0) scale(-1 1)' : undefined}>
            <path
              d="M14.5 27.4A10.6 10.6 0 0 1 8 8.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            {LEAVES.map((leaf) => (
              <ellipse
                key={leaf.key}
                cx={leaf.x}
                cy={leaf.y}
                rx="1.1"
                ry="2.4"
                fill="currentColor"
                transform={`rotate(${leaf.rotate} ${leaf.x} ${leaf.y})`}
              />
            ))}
          </g>
        ))}
      </svg>
      <span className="medal__rank">{rank}</span>
    </span>
  );
}

function RecognitionBadges({ ids }: { ids: RecognitionId[] }) {
  if (!ids.length) return null;
  return (
    <span className="badges recognitions">
      {ids.map((id) => (
        <span key={id} className="badge badge--recognition" title={RECOGNITIONS[id].rule}>
          {RECOGNITIONS[id].title}
        </span>
      ))}
    </span>
  );
}

function NotFound() {
  return (
    <Empty
      icon="users"
      title="No encontramos a esta persona"
      action={
        <Link to="/m/leaderboard" className="button">
          Ver el leaderboard
        </Link>
      }
    >
      Puede que el enlace esté incompleto o que ya no forme parte del grupo.
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

/** Contribuciones (3.6): leaderboard del grupo por periodo, con las reglas a la vista. */
export function LeaderboardPage() {
  const data = useSnapshot();
  const [params] = useSearchParams();
  const linkedAnnouncement = params.get('aviso');
  const announcements = leaderChanges(data).slice(-6).reverse().map((change) => ({
    id: rankingFeedId(change),
    title: `${data.members.find((member) => member.id === change.memberId)?.displayName ?? 'Integrante'} · ${change.periodLabel} · ${change.points} puntos`,
  }));
  if (linkedAnnouncement && !announcements.some((entry) => entry.id === linkedAnnouncement)) {
    announcements.unshift({ id: linkedAnnouncement, title: 'Aviso de contribuciones compartido' });
  }
  useEffect(() => {
    if (!linkedAnnouncement) return;
    const element = document.getElementById('ranking-shared-announcement');
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: 'center' });
  }, [linkedAnnouncement]);
  const { periods, period, choose, query } = usePeriod(data);
  const board = useMemo(() => buildLeaderboard(data, period.window), [data, period]);
  const memberOf = (id: string) => data.members.find((m) => m.id === id);
  const ranked = board.filter((s) => s.rank > 0);
  const podium = ranked.filter((s) => s.rank <= 3).slice(0, 3);
  const rest = board.filter((s) => !podium.includes(s));
  const mine = board.find((s) => s.memberId === data.me?.id);
  const meOnPodium = Boolean(mine && podium.includes(mine));

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Contribuciones</h1>
          <p className="muted">
            Reconoce lo que cada quien aporta al grupo. No mide calificaciones y no hace falta para
            ver ningún material.
          </p>
        </div>
      </header>

      <div className="toolbar">
        <PeriodPicker periods={periods} period={period} choose={choose} />
        <span className="muted board__period">{period.detail}</span>
      </div>

      <div className="detail">
        <div className="detail__main">
          {announcements.length > 0 && <section className="panel" id="ranking-shared-announcement" tabIndex={-1} aria-label="Conversaciones de los avisos del ranking">
            <h2>Avisos del ranking</h2>
            {announcements.map((entry) => <ResourceComments key={entry.id} target={{ kind: 'ranking', id: entry.id }} title={entry.title} initiallyOpen={entry.id === linkedAnnouncement} />)}
          </section>}
          {ranked.length === 0 ? (
            <section className="panel">
              <Empty icon="users" title="Aún no hay aportes en este periodo">
                Los trabajos, apuntes, respuestas y guías que se publiquen aparecerán aquí.
                {period.id !== 'todo' && ' Revisa «Todo» para ver periodos anteriores.'}
              </Empty>
            </section>
          ) : (
            <section className="panel board" aria-labelledby="board-title">
              <h2 id="board-title" className="board__title">
                Leaderboard
              </h2>
              <ol className="podium">
                {podium.map((standing, index) => (
                  <li key={standing.memberId} className="podium__row">
                    <Medal rank={standing.rank} />
                    <Pill
                      standing={standing}
                      member={memberOf(standing.memberId)}
                      isMe={standing.memberId === data.me?.id}
                      to={`/m/leaderboard/${standing.memberId}${query}`}
                      style={{ '--pill-scale': 1 - index * 0.08 } as CSSProperties}
                    />
                  </li>
                ))}
              </ol>

              {mine && !meOnPodium && (
                <>
                  <p className="podium__gap" aria-hidden="true">
                    •••
                  </p>
                  <div className="podium__row podium__row--me">
                    <span className="podium__place" title="Tu lugar">
                      {mine.rank ? `${mine.rank}.º` : '—'}
                    </span>
                    <Pill
                      standing={mine}
                      member={memberOf(mine.memberId)}
                      isMe
                      to={`/m/leaderboard/${mine.memberId}${query}`}
                      style={{ '--pill-scale': 0.8 } as CSSProperties}
                    />
                  </div>
                </>
              )}

              {rest.length > 0 && (
                <>
                  <h3 className="board__subtitle">Todo el grupo</h3>
                  <ol className="ranking">
                    {rest.map((standing) => (
                      <RankingRow
                        key={standing.memberId}
                        standing={standing}
                        member={memberOf(standing.memberId)}
                        isMe={standing.memberId === data.me?.id}
                        to={`/m/leaderboard/${standing.memberId}${query}`}
                      />
                    ))}
                  </ol>
                </>
              )}
            </section>
          )}
          <RulesPanel />
        </div>

        <aside className="detail__side">
          {mine && <MySummary standing={mine} total={ranked.length} query={query} />}
          <RecognitionsPanel />
        </aside>
      </div>
    </>
  );
}

function Pill({
  standing,
  member,
  isMe,
  to,
  style,
}: {
  standing: MemberStanding;
  member: Member | undefined;
  isMe: boolean;
  to: string;
  style: CSSProperties;
}) {
  return (
    <Link to={to} className={`pill${isMe ? ' pill--me' : ''}`} style={style}>
      <span className="pill__text">
        <span className="pill__name">{isMe ? 'Tú' : (member?.displayName ?? 'Miembro')}</span>
        <span className="pill__points">{points(standing.points)}</span>
      </span>
      <Avatar member={member} size={40} />
    </Link>
  );
}

function RankingRow({
  standing,
  member,
  isMe,
  to,
}: {
  standing: MemberStanding;
  member: Member | undefined;
  isMe: boolean;
  to: string;
}) {
  const summary = standingSummary(standing);
  return (
    <li>
      <Link to={to} className={`ranking__row${isMe ? ' ranking__row--me' : ''}`}>
        <span className="ranking__place">{standing.rank || '—'}</span>
        <Avatar member={member} size={40} />
        <span className="ranking__who">
          <span className="ranking__name">
            {member?.displayName ?? 'Miembro'}
            {isMe && <span className="muted"> (tú)</span>}
          </span>
          <span className="ranking__summary muted">{summary || 'Sin aportes en este periodo'}</span>
          <RecognitionBadges ids={standing.recognitions} />
        </span>
        <span className="ranking__points">{pointsFormat.format(standing.points)}</span>
      </Link>
    </li>
  );
}

function MySummary({
  standing,
  total,
  query,
}: {
  standing: MemberStanding;
  total: number;
  query: string;
}) {
  const rows = breakdown(standing.events).filter((row) => row.counted);
  return (
    <section className="panel">
      <h2 className="label">Tus contribuciones</h2>
      <p className="my-points">
        <strong>{pointsFormat.format(standing.points)}</strong>{' '}
        {standing.points === 1 ? 'punto' : 'puntos'}
        <span className="muted">
          {standing.rank ? ` · lugar ${standing.rank} de ${total}` : ' · aún sin lugar'}
        </span>
      </p>
      <RecognitionBadges ids={standing.recognitions} />
      {rows.length > 0 && (
        <dl className="facts">
          {rows.map((row) => (
            <Fragment key={row.kind}>
              <dt>{CONTRIBUTION_RULES[row.kind].label}</dt>
              <dd>{row.points}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      <p>
        <Link to={`/m/leaderboard/${standing.memberId}${query}`}>
          Ver de dónde salió cada punto
        </Link>
      </p>
    </section>
  );
}

const RULE_CATEGORIES = {
  materiales: 'Materiales de estudio',
  trabajos: 'Trabajos y actividades',
  preguntas: 'Preguntas y respuestas',
  revision: 'Revisión y mejoras',
} as const;

type RuleCategory = keyof typeof RULE_CATEGORIES;

const RULE_CATEGORY: Record<ContributionKind, RuleCategory> = {
  guia: 'materiales',
  apunte: 'materiales',
  fuente: 'materiales',
  trabajo: 'trabajos',
  evidencia: 'trabajos',
  pagina: 'trabajos',
  respuesta: 'preguntas',
  'respuesta-aceptada': 'preguntas',
  'revision-guia': 'revision',
  correccion: 'revision',
  comentario: 'revision',
};

const RANKING_RULES = CONTRIBUTION_KINDS.map((kind, index) => ({
  ...CONTRIBUTION_RULES[kind],
  kind,
  category: RULE_CATEGORY[kind],
  index,
}));
const RULE_POINTS = [...new Set(RANKING_RULES.map((rule) => rule.points))].sort((a, b) => a - b);

function RulesPanel() {
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [category, setCategory] = useState<RuleCategory | 'all'>('all');
  const [pointFilter, setPointFilter] = useState('all');
  const shown = RANKING_RULES.filter((rule) =>
    (category === 'all' || rule.category === category)
    && (pointFilter === 'all' || rule.points === Number(pointFilter))
    && matches(search, rule.label, rule.rule, rule.limit ?? ''),
  ).sort((a, b) => (order === 'asc' ? a.points - b.points : b.points - a.points) || a.index - b.index);

  function clearFilters() {
    setSearch('');
    setOrder('asc');
    setCategory('all');
    setPointFilter('all');
  }

  return (
    <section className="panel ranking-rules" aria-label="Reglas del ranking">
      <header className="ranking-rules__header">
        <div>
          <p className="eyebrow">Contribuciones</p>
          <h2>Reglas del ranking</h2>
          <p className="muted">Explora qué acciones suman puntos y las condiciones de cada aporte.</p>
        </div>
        <span className="ranking-rules__icon"><Icon name="book" size={24} /></span>
      </header>

      <div className="ranking-rules__toolbar">
        <label className="field ranking-rules__search">
          <span className="field__label">Buscar regla</span>
          <span className="ranking-rules__search-input">
            <Icon name="search" size={20} />
            <input type="search" placeholder="Busca una acción o condición…" value={search}
              onChange={(event) => setSearch(event.target.value)} />
          </span>
        </label>
        <div className="ranking-rules__filters">
          <label className="field">
            <span className="field__label">Orden</span>
            <select value={order} onChange={(event) => setOrder(event.target.value as 'asc' | 'desc')}>
              <option value="asc">Menor a mayor</option>
              <option value="desc">Mayor a menor</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Categoría</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as RuleCategory | 'all')}>
              <option value="all">Todas</option>
              {Object.entries(RULE_CATEGORIES).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Puntos</span>
            <select value={pointFilter} onChange={(event) => setPointFilter(event.target.value)}>
              <option value="all">Todos</option>
              {RULE_POINTS.map((value) => <option key={value} value={value}>{points(value)}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="ranking-rules__results">
        <p className="ranking-rules__count" role="status" aria-live="polite" aria-atomic="true">
          {shown.length} de {RANKING_RULES.length} reglas
        </p>
        <button type="button" className="secondary ranking-rules__reset" onClick={clearFilters}>
          Limpiar filtros
        </button>
      </div>

      {shown.length ? (
        <ul className="ranking-rules__list">
          {shown.map((rule) => (
            <li key={rule.kind} className="ranking-rules__row">
              <div className="ranking-rules__points">
                <strong>+{pointsFormat.format(rule.points)}</strong>
                <span>{rule.points === 1 ? 'punto' : 'puntos'}</span>
              </div>
              <div className="ranking-rules__body">
                <div className="ranking-rules__row-heading">
                  <h3>{rule.label}</h3>
                  <span className="ranking-rules__category">{RULE_CATEGORIES[rule.category]}</span>
                </div>
                <p className="ranking-rules__description">{rule.rule}</p>
                {rule.limit && <p className="ranking-rules__limit"><strong>Condición: </strong>{rule.limit}</p>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ranking-rules__empty">
          <Icon name="search" size={28} />
          <h3>No hay reglas con estos filtros</h3>
          <p className="muted">Prueba otra búsqueda o limpia los filtros para ver todas las acciones.</p>
          <button type="button" className="secondary" onClick={clearFilters}>Limpiar filtros</button>
        </div>
      )}

      <footer className="ranking-rules__notes">
        <section>
          <h3>Qué no suma</h3>
          <ul className="ranking-rules__excluded">{NOT_SCORED.map((label) => <li key={label}>{label}</li>)}</ul>
          <p>Los borradores y los aportes retirados tampoco cuentan.</p>
        </section>
        <section>
          <h3>Cómo se aplican las reglas</h3>
          <p>Las copias idénticas del mismo autor y contexto no vuelven a sumar; se conserva el primer aporte y su fecha. Se comparan texto y referencias de archivos, sin interpretar el código ni suponer que dos archivos distintos contienen los mismos bytes.</p>
          <p>Restaurar un aporte recupera su puntuación original sin duplicarla. Los límites se conservan al cambiar de periodo.</p>
        </section>
        <p className="ranking-rules__notice">Son puntos de prueba: se ajustarán después de probarlos con el grupo.</p>
      </footer>
    </section>
  );
}

function RecognitionsPanel() {
  return (
    <section className="panel rules">
      <h2 className="label">Reconocimientos</h2>
      <ul className="rules__list rules__list--plain">
        {Object.values(RECOGNITIONS).map((r) => (
          <li key={r.title}>
            <span>
              <strong>{r.title}.</strong> {r.rule}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Desglose de una persona
// ---------------------------------------------------------------------------

/** De dónde salió cada punto de una persona en el periodo: cada aporte abre su registro. */
export function ContributorPage() {
  const data = useSnapshot();
  const { memberId } = useParams();
  const { periods, period, choose } = usePeriod(data);
  const board = useMemo(() => buildLeaderboard(data, period.window), [data, period]);
  const standing = board.find((s) => s.memberId === memberId);
  const member = data.members.find((m) => m.id === memberId);
  if (!standing || !member) return <NotFound />;

  const isMe = member.id === data.me?.id;
  const ranked = board.filter((s) => s.rank > 0).length;
  const rows = breakdown(standing.events);

  return (
    <>
      <Link
        to={`/m/leaderboard${period.id === periods[0]?.id ? '' : `?periodo=${period.id}`}`}
        className="back with-icon"
      >
        <Icon name="back" size={16} /> Contribuciones
      </Link>
      <header className="page-header contributor">
        <Avatar member={member} size={56} />
        <div>
          <p className="eyebrow">{period.detail}</p>
          <h1>{isMe ? `${member.displayName} (tú)` : member.displayName}</h1>
          <p className="muted">
            {points(standing.points)}
            {standing.rank
              ? ` · lugar ${standing.rank} de ${ranked}`
              : ' · sin lugar en este periodo'}
            {' · '}
            <Link to={`/perfil/${member.id}`}>Ver perfil</Link>
          </p>
          <RecognitionBadges ids={standing.recognitions} />
        </div>
      </header>

      <div className="toolbar">
        <PeriodPicker periods={periods} period={period} choose={choose} />
      </div>

      <div className="detail">
        <div className="detail__main">
          <section className="panel">
            <h2 className="label">Aportes</h2>
            {standing.events.length === 0 ? (
              <p className="muted">Sin aportes en este periodo.</p>
            ) : (
              <ul className="ledger">
                {standing.events.map((event) => (
                  <li
                    key={`${event.kind}:${event.refId}`}
                    className={event.points ? 'ledger__row' : 'ledger__row ledger__row--skipped'}
                  >
                    <span className="ledger__points">
                      {event.points ? `+${event.points}` : '0'}
                    </span>
                    <span className="ledger__what">
                      <span className="ledger__kind">{CONTRIBUTION_RULES[event.kind].label}</span>
                      <Link to={event.link}>{event.title}</Link>
                      {event.skipped && (
                        <span className="ledger__note">No contó: {event.skipped}</span>
                      )}
                    </span>
                    <time className="muted ledger__when" dateTime={event.at.toISOString()}>
                      {formatTime(event.at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <RulesPanel />
        </div>
        <aside className="detail__side">
          <section className="panel">
            <h2 className="label">Desglose</h2>
            {rows.length === 0 ? (
              <p className="muted">Nada que desglosar todavía.</p>
            ) : (
              <table className="tally">
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.kind}>
                      <th scope="row">
                        {CONTRIBUTION_RULES[row.kind].label}
                        <span className="muted">
                          {' '}
                          {row.counted} × {CONTRIBUTION_RULES[row.kind].points}
                          {row.skipped > 0 &&
                            ` · ${row.skipped} no ${row.skipped === 1 ? 'contó' : 'contaron'}`}
                        </span>
                      </th>
                      <td>{row.points}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Total</th>
                    <td>{standing.points}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </section>
          <RecognitionsPanel />
        </aside>
      </div>
    </>
  );
}
