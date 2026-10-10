import { useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  canReviewGuide,
  GUIDE_SECTIONS,
  isValidPeriod,
  PERIOD_COUNT,
  periodLabel,
  type GuideReviewVerdict,
  type GuideSourceStatus,
} from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { GuideSource, GuideSourceRef, Snapshot, StudyGuide } from '../data/types';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { RichText } from '../components/RichText';
import { useAction } from '../components/useAction';
import { formatTime, memberName } from '../lib/format';
import { candidateSources, guideStatus, isOutdated, type SourceInfo } from '../lib/guides';
import { currentPlacement, lastPeriod, rememberPeriod, termAt } from '../lib/period';
import { bySubject } from '../lib/works';

const PERIODS = Array.from({ length: PERIOD_COUNT }, (_, i) => i + 1);
const refKey = (ref: GuideSourceRef) => `${ref.kind}:${ref.refId}`;

function placeLabel(guide: StudyGuide, data: Snapshot): string {
  const subject = data.subjects.find((s) => s.id === guide.subjectId);
  const term = data.terms.find((t) => t.id === guide.termId);
  return [subject?.name ?? 'Materia', term?.name ?? 'Sin parcial'].join(' · ');
}

function NotFound() {
  return (
    <Empty
      icon="file"
      title="No encontramos esta guía"
      action={
        <Link to="/m/guias" className="button">
          Ver las guías
        </Link>
      }
    >
      Puede que el enlace esté incompleto o que la guía ya no exista.
    </Empty>
  );
}

/** Barra de cobertura: cuántos temas del temario tienen al menos una fuente procesada. */
function CoverageBar({ covered, total }: { covered: number; total: number }) {
  const percent = total ? Math.round((covered / total) * 100) : 0;
  return (
    <span className="coverage">
      <span
        className="coverage__bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={covered}
        aria-label="Temas cubiertos"
      >
        <span style={{ width: `${percent}%` }} />
      </span>
      <span className="coverage__label">
        {covered} de {total} {total === 1 ? 'tema cubierto' : 'temas cubiertos'}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

/** Guías de estudio (3.5): una por materia y parcial, con fuentes y cobertura a la vista. */
export function GuidesPage() {
  const data = useSnapshot();
  const { guides, subjects, members } = data;
  const [params, setParams] = useSearchParams();
  const period = Number(params.get('cuatri')) || 0;
  const subjectId = params.get('materia') ?? '';

  const subjectOf = (g: StudyGuide) => subjects.find((s) => s.id === g.subjectId);
  const inPeriod = guides.filter((g) => !period || subjectOf(g)?.period === period);
  const shown = inPeriod
    .filter((g) => !subjectId || g.subjectId === subjectId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const subjectChips = subjects
    .map((s) => ({ ...s, count: inPeriod.filter((g) => g.subjectId === s.id).length }))
    .filter((s) => s.count > 0)
    .sort(bySubject);
  const compendiumPeriod =
    period || (shown[0] && subjectOf(shown[0])?.period) || currentPlacement(data.calendar)?.period;

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Guías de estudio</h1>
          <p className="muted">
            Una guía por materia y parcial, armada con los trabajos, actividades, apuntes y
            preguntas del grupo. Cada una dice qué fuentes usó y qué temas del temario faltan.
          </p>
        </div>
        <div className="row">
          {guides.length > 0 && (
            <Link
              to={`/m/guias/compendio${compendiumPeriod ? `?cuatri=${compendiumPeriod}` : ''}`}
              className="button secondary"
            >
              Compendio del cuatrimestre
            </Link>
          )}
          <Link to="/m/guias/nueva" className="button with-icon">
            <Icon name="plus" size={18} /> Nueva guía
          </Link>
        </div>
      </header>

      {guides.length === 0 ? (
        <Empty
          icon="file"
          title="Todavía no hay guías"
          action={
            <Link to="/m/guias/nueva" className="button">
              Crear la primera
            </Link>
          }
        >
          Elige una materia y un parcial, escribe el temario y la app te propone el material del
          grupo que le corresponde.
        </Empty>
      ) : (
        <>
          <div className="toolbar">
            <select
              aria-label="Cuatrimestre"
              value={period || ''}
              onChange={(e) => update({ cuatri: e.target.value, materia: '' })}
            >
              <option value="">Todos los cuatrimestres</option>
              {PERIODS.map((n) => (
                <option key={n} value={n}>
                  {periodLabel(n)}
                </option>
              ))}
            </select>
          </div>
          {subjectChips.length > 1 && (
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
          {shown.length === 0 ? (
            <Empty icon="search" title="No hay guías con estos filtros">
              Prueba con otro cuatrimestre o crea la guía que falta.
            </Empty>
          ) : (
            <ul className="work-grid">
              {shown.map((guide) => {
                const status = guideStatus(guide, data);
                return (
                  <li key={guide.id}>
                    <Link to={`/m/guias/${guide.id}`} className="work-card guide-card">
                      <span className="work-card__context">{placeLabel(guide, data)}</span>
                      <strong className="work-card__title">{guide.title}</strong>
                      <CoverageBar covered={status.covered} total={guide.topics.length} />
                      <span className="guide-card__facts">
                        <span>
                          {status.sources.length}{' '}
                          {status.sources.length === 1 ? 'fuente' : 'fuentes'}
                          {status.pending > 0 && ` · ${status.pending} pendientes`}
                        </span>
                        {status.outdated > 0 && (
                          <span className="badge badge--warn">
                            {status.outdated === 1
                              ? '1 fuente cambió'
                              : `${status.outdated} fuentes cambiaron`}
                          </span>
                        )}
                        {status.changeRequests > 0 ? (
                          <span className="badge badge--open">Con cambios propuestos</span>
                        ) : status.approvals > 0 ? (
                          <span className="badge badge--resolved">Revisada</span>
                        ) : (
                          <span className="badge">Sin revisar</span>
                        )}
                      </span>
                      <span className="work-card__footer">
                        <span className="work-card__authors">
                          Versión {guide.version} · {memberName(members, guide.updatedBy)}
                        </span>
                        <span className="work-card__date">{formatTime(guide.updatedAt)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

type Tab = '' | 'fuentes' | 'revisiones';

export function GuidePage() {
  const { guideId = '' } = useParams();
  const data = useSnapshot();
  const [params, setParams] = useSearchParams();
  const guide = data.guides.find((g) => g.id === guideId);
  if (!guide) return <NotFound />;

  const tabParam = params.get('pestana');
  const tab: Tab = tabParam === 'fuentes' || tabParam === 'revisiones' ? tabParam : '';
  const status = guideStatus(guide, data);
  const written = GUIDE_SECTIONS.map((section, i) => ({
    ...section,
    text: guide.sections[i] ?? '',
  }));
  const missingSections = written.filter((s) => !s.text);
  const term = data.terms.find((t) => t.id === guide.termId);
  const subject = data.subjects.find((s) => s.id === guide.subjectId);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: '', label: 'Guía' },
    { id: 'fuentes', label: 'Fuentes', count: status.sources.length },
    { id: 'revisiones', label: 'Revisiones', count: status.reviews.length },
  ];

  return (
    <>
      <Link to="/m/guias" className="back with-icon">
        <Icon name="back" size={16} /> Guías de estudio
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">{placeLabel(guide, data)}</p>
          <h1>{guide.title}</h1>
          <p className="muted">
            Versión {guide.version} · guardada por {memberName(data.members, guide.updatedBy)} ·{' '}
            {formatTime(guide.updatedAt)}
          </p>
        </div>
        <div className="row">
          <Link to={`/m/guias/${guide.id}/editar`} className="button secondary with-icon">
            <Icon name="edit" size={16} /> Editar
          </Link>
        </div>
      </header>

      <div className="detail">
        <div className="detail__main">
          <div className="segmented guide-tabs" role="group" aria-label="Sección de la guía">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tab === t.id}
                onClick={() => setParams(t.id ? { pestana: t.id } : {}, { replace: true })}
              >
                {t.label}
                {t.count !== undefined && <span className="chip__count"> {t.count}</span>}
              </button>
            ))}
          </div>

          {tab === '' && (
            <article className="panel guide-body">
              <p className="guide-disclaimer">
                Esta guía reúne el material del grupo. No promete conocer el examen ni reemplaza el
                temario del docente; revisa las respuestas y el código antes de darlos por buenos.
              </p>
              <section>
                <h2>Temario</h2>
                <ol className="guide-topics">
                  {status.coverage.map((c) => (
                    <li key={c.topic}>
                      <span>{c.topic}</span>
                      <TopicState processed={c.processed} pending={c.pending} />
                    </li>
                  ))}
                </ol>
              </section>
              {written
                .filter((s) => s.text)
                .map((s) => (
                  <section key={s.id}>
                    <h2>{s.title}</h2>
                    <RichText text={s.text} />
                  </section>
                ))}
              {missingSections.length > 0 && (
                <p className="muted guide-missing">
                  Sin escribir todavía: {missingSections.map((s) => s.title).join(', ')}.{' '}
                  <Link to={`/m/guias/${guide.id}/editar`}>Completar</Link>
                </p>
              )}
            </article>
          )}
          {tab === 'fuentes' && <SourcesTab guide={guide} />}
          {tab === 'revisiones' && <ReviewsTab guide={guide} />}
        </div>

        <aside className="detail__side">
          <section className="panel">
            <h2 className="label">Cobertura del temario</h2>
            <CoverageBar covered={status.covered} total={guide.topics.length} />
            {status.covered < guide.topics.length && (
              <p className="muted guide-side-note">
                Un tema cuenta como cubierto cuando al menos una fuente procesada lo trata.
              </p>
            )}
          </section>
          <section className="panel">
            <h2 className="label">Fuentes</h2>
            <dl className="facts">
              <dt>Procesadas</dt>
              <dd>{status.processed}</dd>
              <dt>Pendientes</dt>
              <dd>{status.pending}</dd>
              {status.outdated > 0 && (
                <>
                  <dt>Cambiaron</dt>
                  <dd>{status.outdated}</dd>
                </>
              )}
            </dl>
            <button
              type="button"
              className="link-button guide-side-note"
              onClick={() => setParams({ pestana: 'fuentes' }, { replace: true })}
            >
              Ver el índice de fuentes
            </button>
          </section>
          <section className="panel">
            <h2 className="label">Datos</h2>
            <dl className="facts">
              <dt>Materia</dt>
              <dd>{subject?.name}</dd>
              <dt>Parcial</dt>
              <dd>{term?.name ?? 'Sin parcial'}</dd>
              <dt>Creó</dt>
              <dd>{memberName(data.members, guide.createdBy)}</dd>
              <dt>Revisión</dt>
              <dd>
                {status.changeRequests > 0
                  ? 'Con cambios propuestos'
                  : status.approvals > 0
                    ? `Aprobada por ${status.approvals}`
                    : 'Sin revisar'}
              </dd>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

function TopicState({ processed, pending }: { processed: number; pending: number }) {
  if (processed > 0) {
    return (
      <span className="topic-state topic-state--ok">
        <Icon name="check" size={14} /> {processed} {processed === 1 ? 'fuente' : 'fuentes'}
      </span>
    );
  }
  if (pending > 0) {
    return <span className="topic-state topic-state--pending">Fuente pendiente</span>;
  }
  return <span className="topic-state topic-state--none">Sin fuentes</span>;
}

/** Índice de fuentes: cada una procesada o pendiente con su razón, sus temas y su versión. */
function SourcesTab({ guide }: { guide: StudyGuide }) {
  const data = useSnapshot();
  const source = useDataSource();
  const { error, run } = useAction();
  const [adding, setAdding] = useState(false);
  const status = guideStatus(guide, data);
  const sorted = [...status.sources].sort(
    (a, b) =>
      Number(a.source.status === 'processed') - Number(b.source.status === 'processed') ||
      (a.info?.title ?? '').localeCompare(b.info?.title ?? '', 'es'),
  );

  return (
    <section className="guide-sources">
      <div className="guide-sources__header">
        <p className="muted">
          Toda fuente queda como procesada o pendiente con su razón, para que la guía no oculte lo
          que falta.
        </p>
        <button
          type="button"
          className="secondary with-icon"
          onClick={() => setAdding(!adding)}
          aria-expanded={adding}
        >
          <Icon name="plus" size={16} /> Agregar fuentes
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {adding && (
        <AddSources
          guide={guide}
          onDone={(refs) => {
            if (refs.length && !run(() => (source.addGuideSources(guide.id, refs), true))) return;
            setAdding(false);
          }}
        />
      )}
      {sorted.length === 0 ? (
        <Empty icon="folder" title="Sin fuentes todavía">
          Agrega los trabajos, actividades, apuntes o preguntas que usa esta guía.
        </Empty>
      ) : (
        <ul className="source-list">
          {sorted.map(({ source: s, info }) => (
            <SourceRow key={s.id} guide={guide} source={s} info={info} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SourceRow({
  guide,
  source: s,
  info,
}: {
  guide: StudyGuide;
  source: GuideSource;
  info: SourceInfo | undefined;
}) {
  const data = useDataSource();
  const { error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<GuideSourceStatus>(s.status);
  const [reason, setReason] = useState(s.reason);
  const [topics, setTopics] = useState(s.topics);
  const outdated = isOutdated(s, info);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => (data.updateGuideSource(s.id, { status, reason, topics }), true))) {
      setEditing(false);
    }
  };

  return (
    <li className={`source source--${s.status}`}>
      <div className="source__main">
        <span className="badge">{info?.label ?? 'Fuente'}</span>
        <span className={`badge source__status source__status--${s.status}`}>
          {s.status === 'processed' ? 'Procesada' : 'Pendiente'}
        </span>
        {info ? (
          <Link to={info.link} className="source__title">
            {info.title}
          </Link>
        ) : (
          <span className="source__title muted">Ya no está disponible</span>
        )}
        {info?.context && <span className="source__context muted">{info.context}</span>}
        {s.status === 'pending' && <span className="source__reason">Pendiente: {s.reason}</span>}
        {s.topics.length > 0 && (
          <span className="source__topics">
            {s.topics.map((t) => (
              <span key={t} className="badge">
                {t}
              </span>
            ))}
          </span>
        )}
        {outdated && info && (
          <span className="source__changed">
            Cambió desde que se agregó (versión {s.sourceVersion} → {info.version}). Revisa si la
            guía necesita ajustes.
            <button
              type="button"
              className="link-button"
              onClick={() => run(() => data.refreshGuideSource(s.id))}
            >
              Ya la revisé
            </button>
          </span>
        )}
      </div>
      {!editing && (
        <div className="source__actions">
          <button type="button" className="link-button" onClick={() => setEditing(true)}>
            Editar
          </button>
          <button
            type="button"
            className="link-button source__remove"
            onClick={() => run(() => data.removeGuideSource(s.id))}
          >
            Quitar
          </button>
        </div>
      )}
      {editing && (
        <form className="source__form" onSubmit={save}>
          <fieldset className="field">
            <legend className="field__label">Estado</legend>
            <div className="segmented">
              {(['processed', 'pending'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                >
                  {value === 'processed' ? 'Procesada' : 'Pendiente'}
                </button>
              ))}
            </div>
          </fieldset>
          {status === 'pending' && (
            <label className="field">
              <span className="field__label">Por qué sigue pendiente</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Escaneo ilegible, formato no admitido, falta leerla…"
                maxLength={200}
                required
              />
            </label>
          )}
          <fieldset className="field">
            <legend className="field__label">Temas del temario que cubre</legend>
            <div className="chips chips--small">
              {guide.topics.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="chip"
                  aria-pressed={topics.includes(t)}
                  onClick={() =>
                    setTopics(topics.includes(t) ? topics.filter((x) => x !== t) : [...topics, t])
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit">Guardar</button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setEditing(false);
                setStatus(s.status);
                setReason(s.reason);
                setTopics(s.topics);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {!editing && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function AddSources({
  guide,
  onDone,
}: {
  guide: StudyGuide;
  onDone: (refs: GuideSourceRef[]) => void;
}) {
  const data = useSnapshot();
  const existing = data.guideSources.filter((s) => s.guideId === guide.id);
  const { matched, unplaced } = candidateSources(guide.subjectId, guide.termId, data, existing);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  return (
    <div className="panel add-sources">
      <SourcePicker
        matched={matched}
        unplaced={unplaced}
        picked={picked}
        onChange={setPicked}
        emptyText="Ya está todo el material de esta materia."
      />
      <div className="row">
        <button
          type="button"
          disabled={!picked.size}
          onClick={() =>
            onDone(
              [...matched, ...unplaced]
                .filter((i) => picked.has(refKey(i)))
                .map(({ kind, refId }) => ({ kind, refId })),
            )
          }
        >
          Agregar {picked.size || ''}
        </button>
        <button type="button" className="secondary" onClick={() => onDone([])}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function SourcePicker({
  matched,
  unplaced,
  picked,
  onChange,
  emptyText,
}: {
  matched: SourceInfo[];
  unplaced: SourceInfo[];
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
  emptyText: string;
}) {
  const toggle = (info: SourceInfo) => {
    const next = new Set(picked);
    if (next.has(refKey(info))) next.delete(refKey(info));
    else next.add(refKey(info));
    onChange(next);
  };
  const group = (title: string, hint: string, items: SourceInfo[]) =>
    items.length > 0 && (
      <fieldset className="source-picker__group">
        <legend>
          {title} <span className="muted">· {hint}</span>
        </legend>
        <ul>
          {items.map((info) => (
            <li key={refKey(info)}>
              <label className="source-pick">
                <input
                  type="checkbox"
                  checked={picked.has(refKey(info))}
                  onChange={() => toggle(info)}
                />
                <span className="badge">{info.label}</span>
                <span className="source-pick__text">
                  <strong>{info.title}</strong>
                  <span className="muted">{info.context}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    );

  if (!matched.length && !unplaced.length) return <p className="muted">{emptyText}</p>;
  return (
    <div className="source-picker">
      {group('Del parcial', 'propuestas para la guía', matched)}
      {group('Sin parcial', 'revisa si aplican a este parcial', unplaced)}
    </div>
  );
}

/** Revisión entre compañeros: cada quien aprueba o propone cambios sobre la versión actual. */
function ReviewsTab({ guide }: { guide: StudyGuide }) {
  const data = useSnapshot();
  const source = useDataSource();
  const { error, run } = useAction();
  const [verdict, setVerdict] = useState<GuideReviewVerdict>('approved');
  const [comment, setComment] = useState('');
  const { reviews } = guideStatus(guide, data);
  const canReview = Boolean(data.me && canReviewGuide(data.me.id, guide.updatedBy));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => (source.reviewGuide(guide.id, verdict, comment), true))) setComment('');
  };

  return (
    <section className="guide-reviews">
      {canReview ? (
        <form className="panel review-form" onSubmit={submit}>
          <h2 className="label">Revisar la versión {guide.version}</h2>
          <div className="segmented" role="group" aria-label="Resultado">
            <button
              type="button"
              aria-pressed={verdict === 'approved'}
              onClick={() => setVerdict('approved')}
            >
              Está bien
            </button>
            <button
              type="button"
              aria-pressed={verdict === 'changes'}
              onClick={() => setVerdict('changes')}
            >
              Propongo cambios
            </button>
          </div>
          <label className="field">
            <span className="field__label">
              Comentario{' '}
              {verdict === 'approved' && <span className="field__optional">opcional</span>}
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={
                verdict === 'changes'
                  ? 'Qué corregirías, qué falta o qué está mal.'
                  : 'Algo que quieras destacar.'
              }
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit">Enviar revisión</button>
          </div>
        </form>
      ) : (
        <p className="muted panel">
          Guardaste la versión {guide.version}, así que la revisa otro compañero. Cuando alguien más
          la edite, podrás revisarla tú.
        </p>
      )}
      {reviews.length === 0 ? (
        <p className="muted">Nadie la ha revisado todavía.</p>
      ) : (
        <ul className="review-list">
          {reviews.map((r) => (
            <li key={r.id} className="review">
              <Avatar member={data.members.find((m) => m.id === r.reviewerId)} size={32} />
              <div className="review__body">
                <div className="review__head">
                  <strong>{memberName(data.members, r.reviewerId)}</strong>
                  <span
                    className={
                      r.verdict === 'approved' ? 'badge badge--resolved' : 'badge badge--open'
                    }
                  >
                    {r.verdict === 'approved' ? 'Está bien' : 'Propone cambios'}
                  </span>
                  <span className="muted">
                    Versión {r.guideVersion}
                    {r.guideVersion === guide.version ? ' (actual)' : ''} ·{' '}
                    {formatTime(r.createdAt)}
                  </span>
                </div>
                {r.comment && <p className="prewrap">{r.comment}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Crear y editar
// ---------------------------------------------------------------------------

export function GuideFormPage() {
  const { guideId } = useParams();
  const { guides } = useSnapshot();
  const guide = guides.find((g) => g.id === guideId);
  if (guideId && !guide) return <NotFound />;
  return <GuideForm key={guide?.id ?? 'nueva'} guide={guide} />;
}

function GuideForm({ guide }: { guide: StudyGuide | undefined }) {
  const data = useSnapshot();
  const source = useDataSource();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { subjects, terms, calendar } = data;
  const { error, run } = useAction();
  const current = currentPlacement(calendar);
  const backTo = guide ? `/m/guias/${guide.id}` : '/m/guias';

  const asked = subjects.find((s) => s.id === (guide?.subjectId ?? params.get('materia')));
  const [period, setPeriod] = useState(() => asked?.period ?? current?.period ?? lastPeriod());
  const firstIn = (n: number) =>
    subjects.filter((s) => s.period === n).sort(bySubject)[0]?.id ?? '';
  const [subjectId, setSubjectId] = useState(() => asked?.id ?? firstIn(period));
  const currentTermOf = (subject: string, n: number) =>
    n === current?.period ? (termAt(terms, subject, current.term)?.id ?? '') : '';
  const [termId, setTermId] = useState(() =>
    guide ? (guide.termId ?? '') : currentTermOf(subjectId, period),
  );
  const [title, setTitle] = useState(guide?.title ?? '');
  const [topicsText, setTopicsText] = useState(guide?.topics.join('\n') ?? '');
  const [sections, setSections] = useState<string[]>(() =>
    GUIDE_SECTIONS.map((_, i) => guide?.sections[i] ?? ''),
  );

  const candidates = guide
    ? { matched: [], unplaced: [] }
    : candidateSources(subjectId, termId || undefined, data);
  // Lo del parcial va marcado; lo que no tiene parcial se ofrece sin marcar.
  const defaultPick = (list: SourceInfo[]) => new Set(list.map(refKey));
  const [picked, setPicked] = useState(() => defaultPick(candidates.matched));
  const [pickedFor, setPickedFor] = useState(`${subjectId}|${termId}`);
  if (!guide && pickedFor !== `${subjectId}|${termId}`) {
    setPickedFor(`${subjectId}|${termId}`);
    setPicked(defaultPick(candidates.matched));
  }

  const periodSubjects = subjects.filter((s) => s.period === period).sort(bySubject);
  const subjectTerms = terms
    .filter((t) => t.subjectId === subjectId)
    .sort((a, b) => a.position - b.position);
  const termName = subjectTerms.find((t) => t.id === termId)?.name;
  const subjectName = subjects.find((s) => s.id === subjectId)?.name;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input = { subjectId, termId: termId || undefined, title, topicsText, sections };
    const id = run(() => {
      if (guide) {
        source.updateGuide(guide.id, input);
        return guide.id;
      }
      const refs = [...candidates.matched, ...candidates.unplaced]
        .filter((i) => picked.has(refKey(i)))
        .map(({ kind, refId }) => ({ kind, refId }));
      return source.createGuide(input, refs);
    });
    if (!id) return;
    rememberPeriod(period);
    void navigate(`/m/guias/${id}${guide ? '' : '?pestana=fuentes'}`);
  };

  return (
    <>
      <Link to={backTo} className="back with-icon">
        <Icon name="back" size={16} /> {guide ? guide.title : 'Guías de estudio'}
      </Link>
      <header className="page-header">
        <div>
          <h1>{guide ? 'Editar guía' : 'Nueva guía de estudio'}</h1>
          <p className="muted">
            {guide
              ? `Es del grupo. Tu cambio se guarda como versión ${guide.version + 1} a tu nombre, y las revisiones de la versión anterior se conservan.`
              : 'Esta primera versión se escribe a mano. El borrador con Gemini llegará cuando se active la IA con tu propia clave.'}
          </p>
        </div>
      </header>

      <form className="panel form form--wide" onSubmit={submit}>
        <section className="form__section">
          <h2>De qué materia y parcial</h2>
          <div className="form__grid">
            <label className="field">
              <span className="field__label">Cuatrimestre</span>
              <select
                value={period}
                disabled={Boolean(guide)}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (!isValidPeriod(next)) return;
                  const subject = firstIn(next);
                  setPeriod(next);
                  setSubjectId(subject);
                  setTermId(currentTermOf(subject, next));
                }}
              >
                {PERIODS.map((n) => (
                  <option key={n} value={n}>
                    {periodLabel(n)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Materia</span>
              <select
                value={subjectId}
                disabled={Boolean(guide)}
                onChange={(e) => {
                  const position = terms.find((t) => t.id === termId)?.position;
                  setSubjectId(e.target.value);
                  setTermId(termAt(terms, e.target.value, position)?.id ?? '');
                }}
              >
                {periodSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Parcial</span>
              <select value={termId} onChange={(e) => setTermId(e.target.value)}>
                <option value="">Sin parcial</option>
                {subjectTerms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {guide && <p className="field__hint">La materia de una guía no cambia; el parcial sí.</p>}
        </section>

        <section className="form__section">
          <h2>Temario</h2>
          <label className="field">
            <span className="field__label">Título de la guía</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                subjectName ? `Guía de ${subjectName}${termName ? `, ${termName}` : ''}` : ''
              }
              maxLength={200}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Temas, uno por renglón</span>
            <textarea
              value={topicsText}
              onChange={(e) => setTopicsText(e.target.value)}
              rows={6}
              required
            />
            <span className="field__hint">
              Cópialo del temario del docente. Cada tema muestra si alguna fuente procesada lo
              cubre.
            </span>
          </label>
        </section>

        {!guide && (
          <section className="form__section">
            <h2>Fuentes</h2>
            <p className="field__hint">
              Entran como pendientes. En la guía marcas cuáles ya procesaste y qué temas cubre cada
              una.
            </p>
            <SourcePicker
              matched={candidates.matched}
              unplaced={candidates.unplaced}
              picked={picked}
              onChange={setPicked}
              emptyText="Todavía no hay material de esta materia. Puedes crear la guía y agregar fuentes después."
            />
          </section>
        )}

        <section className="form__section">
          <h2>Contenido</h2>
          <p className="field__hint">
            Escribe lo que ya tengas; las secciones vacías no se muestran y quedan señaladas como
            pendientes.
          </p>
          {GUIDE_SECTIONS.map((section, i) => (
            <label key={section.id} className="field">
              <span className="field__label">
                {section.title} <span className="field__optional">opcional</span>
              </span>
              <textarea
                value={sections[i]}
                onChange={(e) =>
                  setSections(sections.map((text, j) => (j === i ? e.target.value : text)))
                }
                rows={section.id === 'codigo' ? 6 : 4}
                className={section.id === 'codigo' ? 'mono' : undefined}
              />
              <span className="field__hint">{section.hint}</span>
            </label>
          ))}
        </section>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form__actions">
          <Link to={backTo} className="button secondary">
            Cancelar
          </Link>
          <button type="submit" disabled={!subjectId}>
            {guide ? 'Guardar versión nueva' : 'Crear guía'}
          </button>
        </div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Compendio
// ---------------------------------------------------------------------------

/** Compendio del periodo: las guías de un cuatrimestre juntas, cada materia por separado. */
export function GuideCompendiumPage() {
  const data = useSnapshot();
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get('cuatri'));
  const period = isValidPeriod(asked) ? asked : (currentPlacement(data.calendar)?.period ?? 1);
  const termPosition = (g: StudyGuide) => data.terms.find((t) => t.id === g.termId)?.position ?? 99;
  const bySubjectInPeriod = data.subjects
    .filter((s) => s.period === period)
    .sort(bySubject)
    .map((subject) => ({
      subject,
      guides: data.guides
        .filter((g) => g.subjectId === subject.id)
        .sort((a, b) => termPosition(a) - termPosition(b)),
    }))
    .filter((s) => s.guides.length > 0);

  return (
    <>
      <Link to="/m/guias" className="back with-icon no-print">
        <Icon name="back" size={16} /> Guías de estudio
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">Compendio</p>
          <h1>{periodLabel(period)}</h1>
          <p className="muted">
            Las guías de este cuatrimestre en un solo lugar, cada materia por separado y con sus
            fuentes.
          </p>
        </div>
        <div className="row no-print">
          <select
            aria-label="Cuatrimestre"
            value={period}
            onChange={(e) => setParams({ cuatri: e.target.value }, { replace: true })}
          >
            {PERIODS.map((n) => (
              <option key={n} value={n}>
                {periodLabel(n)}
              </option>
            ))}
          </select>
          {bySubjectInPeriod.length > 0 && (
            <button type="button" className="secondary" onClick={() => window.print()}>
              Imprimir o guardar PDF
            </button>
          )}
        </div>
      </header>

      {bySubjectInPeriod.length === 0 ? (
        <Empty
          icon="file"
          title="No hay guías en este cuatrimestre"
          action={
            <Link to="/m/guias/nueva" className="button">
              Crear una guía
            </Link>
          }
        />
      ) : (
        <>
          <nav className="panel compendium-index no-print" aria-label="Materias del compendio">
            <h2 className="label">Materias</h2>
            <ul className="links">
              {bySubjectInPeriod.map(({ subject, guides }) => (
                <li key={subject.id}>
                  <a href={`#materia-${subject.id}`} onClick={(e) => jumpTo(e, subject.id)}>
                    <strong>{subject.name}</strong>
                    <span className="muted">
                      {guides.length} {guides.length === 1 ? 'guía' : 'guías'}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {bySubjectInPeriod.map(({ subject, guides }) => (
            <section key={subject.id} id={`materia-${subject.id}`} className="compendium-subject">
              <h2>{subject.name}</h2>
              {guides.map((guide) => (
                <CompendiumGuide key={guide.id} guide={guide} />
              ))}
            </section>
          ))}
        </>
      )}
    </>
  );
}

/** Con hash routing, un enlace `#ancla` cambiaría de ruta: se desplaza a mano. */
function jumpTo(e: MouseEvent, subjectId: string) {
  e.preventDefault();
  document.getElementById(`materia-${subjectId}`)?.scrollIntoView({ behavior: 'smooth' });
}

function CompendiumGuide({ guide }: { guide: StudyGuide }) {
  const data = useSnapshot();
  const status = guideStatus(guide, data);
  const term = data.terms.find((t) => t.id === guide.termId);
  return (
    <article className="panel guide-body compendium-guide">
      <p className="eyebrow">
        {term?.name ?? 'Sin parcial'} · versión {guide.version}
      </p>
      <h3>
        <Link to={`/m/guias/${guide.id}`}>{guide.title}</Link>
      </h3>
      <section>
        <h4>Temario</h4>
        <ol className="guide-topics">
          {status.coverage.map((c) => (
            <li key={c.topic}>
              <span>{c.topic}</span>
              <TopicState processed={c.processed} pending={c.pending} />
            </li>
          ))}
        </ol>
      </section>
      {GUIDE_SECTIONS.map((section, i) =>
        guide.sections[i] ? (
          <section key={section.id}>
            <h4>{section.title}</h4>
            <RichText text={guide.sections[i]!} />
          </section>
        ) : null,
      )}
      <section>
        <h4>Fuentes</h4>
        <ul className="compendium-sources">
          {status.sources.map(({ source, info }) => (
            <li key={source.id}>
              {info ? `${info.label}: ${info.title}` : 'Fuente que ya no está disponible'} · versión{' '}
              {source.sourceVersion} ·{' '}
              {source.status === 'processed' ? 'procesada' : `pendiente (${source.reason})`}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
