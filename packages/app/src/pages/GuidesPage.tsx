import { ResourceComments } from '../components/whatsNew/ResourceComments';
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { RelatedVisualProjects } from '../components/RelatedVisualProjects';
import {
  canReviewGuide,
  GUIDE_SECTIONS,
  isValidPeriod,
  PERIOD_COUNT,
  periodLabel,
  parseTopics,
  type GuideAiSourceRef,
  type GuideReviewVerdict,
  type GuideSourceStatus,
} from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { GuideSource, GuideSourceRef, ResourceFile, Snapshot, StudyGuide } from '../data/types';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { Icon, type IconName } from '../components/Icon';
import { ResourceDownloads, ResourceSection } from '../components/AcademicTools';
import { StructuredEditor, StructuredText } from '../components/StructuredText';
import { ContentWithdrawal } from '../components/ContentWithdrawal';
import { GuideAiPanel } from '../components/GuideAiPanel';
import { GuideMaterialPicker } from '../components/GuideMaterialPicker';
import { GuideMaterialDraftStatus } from '../components/GuideMaterialDraftStatus';
import { useGuideMaterialSelection } from '../lib/useGuideMaterialSelection';
import type { GuideAiCandidate } from '../lib/guideAiSources';
import { GuideAiProvenance } from '../components/GuideAiProvenance';
import { ExamMaterialLink } from '../components/ExamMaterialLink';
import { useAction } from '../components/useAction';
import { AttachmentUploader, useResourceUploadQueue } from '../components/uploads/ResourceUploader';
import { formatListTime, formatTime, memberName } from '../lib/format';
import { candidateSources, describeSource, guideScopeLabel, guideStatus, isOutdated, type SourceInfo } from '../lib/guides';
import { currentPlacement, lastPeriod, rememberPeriod, termAt } from '../lib/period';
import { bySubject } from '../lib/works';
import './GuidesPage.css';

const PERIODS = Array.from({ length: PERIOD_COUNT }, (_, i) => i + 1);
const refKey = (ref: GuideSourceRef) => `${ref.kind}:${ref.refId}`;

function placeLabel(guide: StudyGuide, data: Snapshot): string {
  const subject = data.subjects.find((s) => s.id === guide.subjectId);
  return [subject?.name ?? 'Materia', guideScopeLabel(guide, data)].join(' · ');
}

function NotFound() {
  return (
    <div className="guides-page"><div className="guides-empty guides-surface">
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
    </div></div>
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

/** Biblioteca de guías parciales y cuatrimestrales, con fuentes y cobertura a la vista. */
export function GuidesPage() {
  const data = useSnapshot();
  const { guides, subjects, members } = data;
  const [withdrawn, setWithdrawn] = useState(false);
  const [showAi, setShowAi] = useState(() => new URLSearchParams(window.location.search || window.location.hash.split('?')[1]).get('modo') === 'ia');
  const [params, setParams] = useSearchParams();
  const period = Number(params.get('cuatri')) || 0;
  const subjectId = params.get('materia') ?? '';
  const guideType = params.get('tipo') === 'partial' ? 'partial' : params.get('tipo') === 'quarter' ? 'quarter' : '';

  const subjectOf = (g: StudyGuide) => subjects.find((s) => s.id === g.subjectId);
  const inPeriod = guides.filter((g) => withdrawn ? Boolean(g.withdrawnAt) : !g.withdrawnAt)
    .filter((g) => !period || subjectOf(g)?.period === period)
    .filter((g) => !guideType || (guideType === 'partial' ? Boolean(g.termId) : !g.termId));
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
    <div className="guides-page guides-page--library">
      <header className="guides-header">
        <div>
          <p className="guides-eyebrow"><Icon name="book" size={16} /> Tu biblioteca de estudio</p>
          <h1>Guías de estudio</h1>
          <p className="muted">
            Conecta los apuntes, las fuentes y las ideas del grupo. Un lugar para preparar cada
            parcial o todo el cuatrimestre y ver qué falta por repasar.
          </p>
        </div>
        <div className="row">
          <button type="button" className="secondary with-icon" aria-expanded={showAi} aria-controls="guides-ai-workspace" onClick={() => setShowAi(!showAi)}><Icon name="reply" size={16} /> Preparar guía con IA</button>
          {guides.length > 0 && (
            <Link
              to={`/m/guias/compendio${compendiumPeriod ? `?cuatri=${compendiumPeriod}` : ''}`}
              className="button secondary"
            >
              Compendio del cuatrimestre
            </Link>
          )}
          <Link to="/m/guias/nueva" className="button with-icon guides-primary">
            <Icon name="plus" size={18} /> Nueva guía
          </Link>
        </div>
      </header>
      {showAi && <div className="guides-ai-workspace" id="guides-ai-workspace">
        <div className="guides-ai-intro">
          <span className="guides-feature-icon"><Icon name="reply" size={23} /></span>
          <div><p className="guides-eyebrow">De tus fuentes a un borrador</p><h2>Prepara, revisa y comparte</h2><p>Elige el material que quieres usar. Tu borrador sigue siendo privado hasta que decidas publicarlo.</p></div>
        </div>
        <GuideAiPanel />
      </div>}

      {guides.length === 0 ? (
        <section className="guides-surface guides-empty">
        <Empty
          icon="file"
          title="Todavía no hay guías"
          action={
            <Link to="/m/guias/nueva" className="button guides-primary">
              Crear la primera
            </Link>
          }
        >
          Elige una materia y el alcance de la guía, escribe el temario y la app te propone el material del
          grupo que le corresponde.
        </Empty>
        <ol className="guides-start-steps" aria-label="Cómo empezar una guía">
          <li><span>01</span><div><strong>Elige el alcance</strong><p>Prepara un parcial o integra todo el cuatrimestre de una materia.</p></div></li>
          <li><span>02</span><div><strong>Reúne las fuentes</strong><p>Conecta trabajos, actividades y apuntes del grupo.</p></div></li>
          <li><span>03</span><div><strong>Repasen juntos</strong><p>Escriban, revisen y completen lo que falta.</p></div></li>
        </ol>
        </section>
      ) : (
        <>
          <section className="guides-filters" aria-label="Filtrar guías">
          <div className="guides-filter-row">
            <label className="field guides-period-filter"><span>Cuatrimestre</span>
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
            </label>
            <label className="field guides-period-filter"><span>Tipo de guía</span>
              <select aria-label="Tipo de guía" value={guideType} onChange={(event) => update({ tipo: event.target.value })}>
                <option value="">Todos los tipos</option>
                <option value="partial">Guías de parcial</option>
                <option value="quarter">Guías cuatrimestrales</option>
              </select>
            </label>
            <label className="guides-withdrawn"><input type="checkbox" checked={withdrawn} onChange={(event) => setWithdrawn(event.target.checked)} />Ver guías retiradas que puedo recuperar</label>
          </div>
          {subjectChips.length > 1 && (
            <div className="guides-subjects" role="group" aria-label="Materia">
              <span className="guides-filter-label">Materia</span>
              <button
                type="button"
                className="guides-subject"
                aria-pressed={!subjectId}
                onClick={() => update({ materia: '' })}
              >
                Todas las materias
              </button>
              {subjectChips.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="guides-subject"
                  aria-pressed={subjectId === s.id}
                  onClick={() => update({ materia: s.id })}
                >
                  {s.name} <span className="guides-count">{s.count}</span>
                </button>
              ))}
            </div>
          )}
          </section>
          <div className="guides-results"><p aria-live="polite">{shown.length} {shown.length === 1 ? 'guía' : 'guías'} {withdrawn ? 'retiradas' : period || subjectId || guideType ? 'con estos filtros' : 'en tu biblioteca'}</p><span>Última actualización primero</span></div>
          {shown.length === 0 ? (
            <div className="guides-surface guides-empty">
            <Empty icon="search" title="No hay guías con estos filtros">
              Prueba con otro cuatrimestre o crea la guía que falta.
            </Empty>
            </div>
          ) : (
            <ul className="guides-grid" aria-label="Guías de estudio">
              {shown.map((guide) => {
                const status = guideStatus(guide, data);
                return (
                  <li key={guide.id}>
                    <Link to={`/m/guias/${guide.id}`} className="guides-card">
                      <span className="guides-card__context"><span className="guides-feature-icon"><Icon name="book" size={20} /></span><span>{placeLabel(guide, data)}</span></span>
                      <strong className="guides-card__title">{guide.title}</strong>
                      <span className="guides-scope-badge">{guide.termId ? 'Guía de parcial' : 'Alcance cuatrimestral'}</span>
                      <span className="guides-card__topics">{guide.topics.slice(0, 3).join(' · ')}{guide.topics.length > 3 ? '…' : ''}</span>
                      {guide.withdrawnAt && <span className="badge">Retirada</span>}
                      <span className="guides-card__coverage"><span className="guides-mini-label">Cobertura del temario</span>
                      <CoverageBar covered={status.covered} total={guide.topics.length} />
                      </span>
                      <span className="guides-card__facts">
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
                      <span className="guides-card__footer">
                        <Avatar member={members.find((member) => member.id === guide.updatedBy)} size={28} />
                        <span className="guides-card__author">{memberName(members, guide.updatedBy)}<span>Versión {guide.version}</span></span>
                        <time dateTime={guide.updatedAt.toISOString()}>{formatListTime(guide.updatedAt)}</time>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

type Tab = '' | 'fuentes' | 'revisiones' | 'historial';

function GuideStudyLink({ to, icon, label }: { to: string; icon: IconName; label: string }) {
  return <li><Link to={to} className="guides-study-link"><span className="guides-action-icon"><Icon name={icon} size={18} /></span><span>{label}</span><Icon name="forward" size={14} /></Link></li>;
}

export function GuidePage() {
  const { guideId = '' } = useParams();
  const data = useSnapshot();
  const [params, setParams] = useSearchParams();
  const guide = data.guides.find((g) => g.id === guideId);
  if (!guide) return <NotFound />;

  const tabParam = params.get('pestana');
  const tab: Tab = tabParam === 'fuentes' || tabParam === 'revisiones' || tabParam === 'historial' ? tabParam : '';
  const status = guideStatus(guide, data);
  const written = GUIDE_SECTIONS.map((section, i) => ({
    ...section,
    text: guide.sections[i] ?? '',
  }));
  const missingSections = written.filter((s) => !s.text);
  const subject = data.subjects.find((s) => s.id === guide.subjectId);
  const relatedCollections = data.spacedCollections.filter((collection) => !collection.archived
    && (collection.visibility === 'group' || collection.ownerId === data.me?.id)
    && data.spacedCards.some((card) => !card.archived && card.collectionId === collection.id
      && card.sourceKind === 'guide' && card.sourceId === guide.id));

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: '', label: 'Guía' },
    { id: 'fuentes', label: 'Fuentes', count: status.sources.length },
    { id: 'revisiones', label: 'Revisiones', count: status.reviews.length },
    { id: 'historial', label: 'Historial', count: data.guideVersions.filter((version) => version.guideId === guide.id).length },
  ];

  return (
    <div className="guides-page guides-page--reading">
      <Link to="/m/guias" className="back with-icon">
        <Icon name="back" size={16} /> Guías de estudio
      </Link>
      <header className="guides-header guides-header--document">
        <div>
          <p className="guides-eyebrow"><Link to={`/m/guias?materia=${encodeURIComponent(guide.subjectId)}`}>{subject?.name ?? 'Materia'}</Link><span>· {guideScopeLabel(guide, data)}</span></p>
          <h1>{guide.title}</h1>
          <div className="guides-byline"><Avatar member={data.members.find((member) => member.id === guide.updatedBy)} size={36} /><div><strong>{memberName(data.members, guide.updatedBy)}</strong><span>Versión {guide.version} · {formatTime(guide.updatedAt)}</span></div><span className={`badge ${guide.withdrawnAt ? '' : status.changeRequests ? 'badge--open' : status.approvals ? 'badge--resolved' : ''}`}>{guide.withdrawnAt ? 'Retirada' : status.changeRequests ? 'Con cambios propuestos' : status.approvals ? 'Revisada' : 'Pendiente de revisión'}</span></div>
        </div>
        {!guide.withdrawnAt && <div className="row">
          <Link to={`/m/guias/${guide.id}/editar`} className="button secondary with-icon">
            <Icon name="edit" size={16} /> Editar
          </Link>
        </div>}
      </header>

      <div className="guides-detail">
        <div className="guides-detail__main">
          <div className="guides-tabs" role="group" aria-label="Sección de la guía">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tab === t.id}
                onClick={() => setParams(t.id ? { pestana: t.id } : {}, { replace: true })}
              >
                {t.label}
                {t.count !== undefined && <span className="guides-count"> {t.count}</span>}
              </button>
            ))}
          </div>

          {tab === '' && (
            <>
            <article className="guides-surface guide-body guides-document" aria-label="Contenido de la guía">
              <p className="guide-disclaimer">
                Esta guía reúne el material del grupo. No promete conocer el examen ni reemplaza el
                temario del docente; revisa las respuestas y el código antes de darlos por buenos.
              </p>
              <section className="guides-outline">
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
                  <section key={s.id} className="guides-document-section">
                    <h2>{s.title}</h2>
                    <StructuredText text={s.text} />
                  </section>
                ))}
              <GuideAiProvenance guideId={guide.id} version={guide.version} />
              {missingSections.length > 0 && (
                <p className="muted guide-missing">
                  Sin escribir todavía: {missingSections.map((s) => s.title).join(', ')}.{' '}
                  {!guide.withdrawnAt && <Link to={`/m/guias/${guide.id}/editar`}>Completar</Link>}
                </p>
              )}
            </article>
            <div className="guides-surface guides-attachments"><ResourceSection kind="guide" id={guide.id} version={guide.version} canEdit={Boolean(data.me) && !guide.withdrawnAt} compactUpload /></div>
            <ResourceComments target={{ kind: 'guide', id: guide.id }} title="Comentarios de la guía" />
            </>
          )}
          {tab === 'fuentes' && <fieldset disabled={Boolean(guide.withdrawnAt)} className="guides-source-fields"><legend className="guides-sr">Fuentes de la guía</legend><SourcesTab guide={guide} /></fieldset>}
          {tab === 'revisiones' && <ReviewsTab guide={guide} />}
          {tab === 'historial' && <GuideHistory guide={guide} />}
        </div>

        <aside className="guides-detail__side" aria-label="Herramientas de la guía">
          {!guide.withdrawnAt && <RelatedVisualProjects kind="guide" id={guide.id} />}
          <section className="guides-surface guides-study">
            <p className="guides-eyebrow">Del material a la práctica</p>
            <h2>Estudiar con esta guía</h2>
            <ul className="guides-study-links">
              <GuideStudyLink to={`/m/repaso/tarjetas/nueva?guia=${encodeURIComponent(guide.id)}`} icon="copy" label="Crear tarjeta" />
              <GuideStudyLink to={`/m/aprende-ensenando/nueva?guia=${encodeURIComponent(guide.id)}`} icon="chat" label="Practicar explicándolo" />
              {!guide.withdrawnAt && <>
                <GuideStudyLink to={`/m/exposiciones/nueva?guia=${encodeURIComponent(guide.id)}`} icon="users" label="Ensayar exposición" />
                <GuideStudyLink to={`/m/salas?guia=${encodeURIComponent(guide.id)}`} icon="book" label="Estudiar en una sala" />
                <li className="guides-exam-action"><span className="guides-action-icon"><Icon name="file" size={18} /></span><ExamMaterialLink kind="guide" id={guide.id} className="" /><Icon name="forward" size={14} /></li>
                <GuideStudyLink to={`/ajustes?aiSource=guide:${guide.id}&purpose=guide`} icon="reply" label="Crear borrador con Gemini" />
              </>}
            </ul>
          </section>
          <section className="guides-surface guides-side-section">
            <h2>Repaso de esta guía</h2>
            {relatedCollections.length ? <ul className="links">{relatedCollections.map((collection) => <li key={collection.id}>
              <Link to={`/m/repaso/colecciones/${collection.id}`}>{collection.title}</Link>
            </li>)}</ul> : <p className="muted">Todavía no hay colecciones vinculadas a esta guía.</p>}
            <Link to={`/m/repaso/tarjetas/nueva?guia=${encodeURIComponent(guide.id)}`}>Crear una tarjeta de repaso</Link>
          </section>
          <section className="guides-surface guides-side-section guides-coverage-panel">
            <div className="guides-section-heading"><Icon name="check" size={18} /><h2>Cobertura del temario</h2></div>
            <CoverageBar covered={status.covered} total={guide.topics.length} />
            {status.covered < guide.topics.length && (
              <p className="muted guide-side-note">
                Un tema cuenta como cubierto cuando al menos una fuente procesada lo trata.
              </p>
            )}
          </section>
          <section className="guides-surface guides-side-section">
            <h2>Fuentes</h2>
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
          <section className="guides-surface guides-side-section">
            <h2>Datos</h2>
            <dl className="facts">
              <dt>Materia</dt>
              <dd>{subject?.name}</dd>
              <dt>Tipo de guía</dt>
              <dd>{guide.termId ? 'Guía de parcial' : 'Alcance cuatrimestral'}</dd>
              <dt>Alcance</dt>
              <dd>{guideScopeLabel(guide, data)}</dd>
              {subject && <><dt>Cuatrimestre</dt><dd>{periodLabel(subject.period)}</dd></>}
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
          {(guide.withdrawnAt || guide.createdBy === data.me?.id || data.me?.isCreator) && <section className="guides-surface guides-side-section guides-availability"><h2>Disponibilidad</h2><ContentWithdrawal kind="guide" id={guide.id} version={guide.version} withdrawnAt={guide.withdrawnAt}
            canEdit={guide.createdBy === data.me?.id || data.me?.isCreator} reasonRequired={guide.createdBy !== data.me?.id} /></section>}
        </aside>
      </div>
    </div>
  );
}

function GuideHistory({ guide }: { guide: StudyGuide }) {
  const data = useSnapshot();
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const history = data.guideVersions.filter((revision) => revision.guideId === guide.id).sort((a, b) => b.version - a.version);
  return <section className="guides-surface academic-history guides-history"><div className="guides-section-heading"><Icon name="calendar" size={19} /><h2>Historial recuperable</h2></div>
    <p className="field__hint">Cada versión conserva temario, secciones, fuentes, su estado de procesamiento y los archivos. Restaurar crea una versión nueva y conserva este historial.</p>
    {history.map((revision) => <details className="academic-version" key={revision.id}>
      <summary>Versión {revision.version} · {formatTime(revision.editedAt)}{revision.version === guide.version ? ' · Actual' : ''}</summary>
      <p className="muted">{revision.editedBy ? memberName(data.members, revision.editedBy) : 'Editor anterior no registrado'}{revision.restoredFromVersion ? ` · Restaurada de v${revision.restoredFromVersion}` : ''}</p>
      <h3>{revision.title}</h3><ol>{revision.topics.map((topic) => <li key={topic}>{topic}</li>)}</ol>
      {GUIDE_SECTIONS.map((section, index) => revision.sections[index] ? <section key={section.id}><h4>{section.title}</h4><StructuredText text={revision.sections[index]!} /></section> : null)}
      <h4>Fuentes de esta versión</h4><ul>{revision.sources.map((item) => {
        const described = describeSource(item, data);
        return <li key={`${item.kind}:${item.refId}`}>{described ? <Link to={described.link}>{described.title}</Link> : 'Material de origen no disponible'} · v{item.sourceVersion} · {item.status === 'processed' ? 'Procesada' : `Pendiente: ${item.reason}`}{item.topics.length ? ` · ${item.topics.join(', ')}` : ''}</li>;
      })}</ul>
      <ResourceDownloads files={data.resourceFiles.filter((file) => revision.attachmentIds.includes(file.id))} />
      <GuideAiProvenance guideId={guide.id} version={revision.version} />
      {revision.version !== guide.version && data.me && !guide.withdrawnAt && <button type="button" className="secondary" disabled={pending} onClick={() => void run(() => source.restoreGuideVersion(guide.id, revision.version, guide.version))}>Restaurar guía completa como versión nueva</button>}
    </details>)}
    {!history.length && <p className="muted">Las versiones se conservarán desde la activación del historial; no se reconstruyen ediciones antiguas que nunca se guardaron.</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
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
  const [addingVersion, setAddingVersion] = useState(guide.version);
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
          onClick={() => { setAddingVersion(guide.version); setAdding(!adding); }}
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
          onDone={async (refs) => {
            if (
              refs.length &&
              !(await run(async () => (await source.addGuideSources(guide.id, refs, addingVersion), true)))
            ) {
              return;
            }
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
  const [editingVersion, setEditingVersion] = useState(guide.version);
  const outdated = isOutdated(s, info);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(async () => (await data.updateGuideSource(s.id, { status, reason, topics }, editingVersion), true))) {
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
              onClick={() => run(() => data.refreshGuideSource(s.id, guide.version))}
            >
              Actualizar fuente para volver a procesarla
            </button>
          </span>
        )}
      </div>
      {!editing && (
        <div className="source__actions">
          <button type="button" className="link-button" onClick={() => { setEditingVersion(guide.version); setEditing(true); }}>
            Editar
          </button>
          <button
            type="button"
            className="link-button source__remove"
            onClick={() => run(() => data.removeGuideSource(s.id, guide.version))}
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
        wholePeriod={!guide.termId}
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
  wholePeriod = false,
  matched,
  unplaced,
  picked,
  onChange,
  emptyText,
}: {
  wholePeriod?: boolean;
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
      {group(wholePeriod ? 'De todos los parciales' : 'Del parcial', 'propuestas para la guía', matched)}
      {group('Sin parcial', wholePeriod ? 'revisa si corresponden a este cuatrimestre' : 'revisa si aplican a este parcial', unplaced)}
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
  const [reviewedVersion, setReviewedVersion] = useState(guide.version);
  const { reviews } = guideStatus(guide, data);
  const alreadyReviewed = reviews.some((review) => review.guideVersion === guide.version && review.reviewerId === data.me?.id);
  const canReview = Boolean(data.me && !guide.withdrawnAt && !alreadyReviewed && canReviewGuide(data.me.id, guide.updatedBy));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(async () => (await source.reviewGuide(guide.id, verdict, comment, reviewedVersion), true))) setComment('');
  };

  return (
    <section className="guide-reviews">
      {canReview ? (
        <form className="panel review-form" onSubmit={submit}>
          <h2 className="label">Revisar la versión {reviewedVersion}</h2>
          {reviewedVersion !== guide.version && <p role="alert" className="error">La guía cambió mientras la revisabas. Lee la versión actual antes de continuar. <button type="button" onClick={() => { setReviewedVersion(guide.version); setComment(''); }}>Revisar la versión {guide.version}</button></p>}
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
              Comentario de revisión
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={2000}
              required
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
          {guide.withdrawnAt ? 'Restaura la guía para que el grupo pueda revisarla de nuevo.' : alreadyReviewed ? `Ya revisaste la versión ${guide.version}. Tu revisión se conserva en el historial.` : `Guardaste la versión ${guide.version}, así que la revisa otro compañero. Cuando alguien más la edite, podrás revisarla tú.`}
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
  const { guides, me } = useSnapshot();
  const [params] = useSearchParams();
  const guide = guides.find((g) => g.id === guideId);
  if (guideId && !guide) return <NotFound />;
  if (guide?.withdrawnAt) return <div className="guides-page"><p className="guides-notice">Restaura la guía desde <Link to={`/m/guias/${guide.id}`}>su página</Link> antes de editarla.</p></div>;
  if (!guideId && params.get('modo') === 'ia') return <div className="guides-page"><Link to="/m/guias" className="back">Guías de estudio</Link><h1>Nueva guía de estudio</h1><GuideAiPanel /></div>;
  return <GuideForm key={`${guide?.id ?? 'nueva'}:${me?.id ?? ''}`} guide={guide} />;
}

function GuideSectionEditor({ section, index, value, onChange, files }: {
  section: (typeof GUIDE_SECTIONS)[number]; index: number; value: string;
  onChange: (value: string) => void; files: ResourceFile[];
}) {
  const [open, setOpen] = useState(Boolean(value.trim()) || index === 0);
  return <details className="guides-editor-disclosure" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span className="guides-editor-number">{String(index + 1).padStart(2, '0')}</span><span>{section.title}</span><span className="guides-editor-state">{value.trim() ? 'Con contenido' : 'Por escribir'}</span></summary>
    <div><StructuredEditor label={section.title} value={value} onChange={onChange} rows={section.id === 'codigo' ? 7 : 5} files={files} /><p className="field__hint">{section.hint}</p></div>
  </details>;
}

function GuideForm({ guide }: { guide: StudyGuide | undefined }) {
  const data = useSnapshot();
  const source = useDataSource();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { subjects, terms, calendar } = data;
  const { error, pending, run } = useAction();
  const queue = useResourceUploadQueue();
  const saved = useRef<{ id: string; version: number } | null>(null);
  const submitting = useRef(false);
  const active = useRef(true);
  const [contentSaved, setContentSaved] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const current = currentPlacement(calendar);
  const backTo = guide ? `/m/guias/${guide.id}` : '/m/guias';

  const asked = subjects.find((s) => s.id === (guide?.subjectId ?? params.get('materia')));
  const [period, setPeriod] = useState(() => asked?.period ?? current?.period ?? lastPeriod());
  const firstIn = (n: number) =>
    subjects.filter((s) => s.period === n).sort(bySubject)[0]?.id ?? '';
  const [subjectId, setSubjectId] = useState(() => asked?.id ?? firstIn(period));
  const currentTermOf = (subject: string, n: number) =>
    n === current?.period ? (termAt(terms, subject, current.term)?.id ?? '') : '';
  const firstTermOf = (subject: string) => terms.filter((term) => term.subjectId === subject).sort((a, b) => a.position - b.position)[0]?.id ?? '';
  const [guideType, setGuideType] = useState<'partial' | 'quarter'>(() => guide ? guide.termId ? 'partial' : 'quarter' : 'partial');
  const [termId, setTermId] = useState(() =>
    guide ? (guide.termId ?? '') : currentTermOf(subjectId, period) || firstTermOf(subjectId),
  );
  const [title, setTitle] = useState(guide?.title ?? '');
  const [topicsText, setTopicsText] = useState(guide?.topics.join('\n') ?? '');
  const [sections, setSections] = useState<string[]>(() =>
    GUIDE_SECTIONS.map((_, i) => guide?.sections[i] ?? ''),
  );
  const [baseVersion] = useState(guide?.version);
  const locked = pending || queue.busy || contentSaved;
  const conflict = Boolean(guide && !contentSaved && baseVersion !== guide.version);

  const [materials, setMaterials] = useState<GuideAiSourceRef[]>([]);
  const [chosenFileIds, setChosenFileIds] = useState<string[]>([]);
  const [pendingMaterials, setPendingMaterials] = useState(0);
  const [materialCatalogue, setMaterialCatalogue] = useState<GuideAiCandidate[]>([]);
  const manualRequest = useRef(crypto.randomUUID());
  const parsedTopics = parseTopics(topicsText);
  const materialDraft = useGuideMaterialSelection({ subjectId, termId: guideType === 'partial' ? termId || undefined : undefined, guideType, title, topicsText, sources: materials, chosenFileIds, manualSections: sections }, (record) => {
    setSubjectId(record.subjectId); setPeriod(subjects.find((entry) => entry.id === record.subjectId)?.period ?? period); setGuideType(record.guideType); setTermId(record.termId ?? ''); setTitle(record.title); setTopicsText(record.topicsText); setMaterials(record.sources); setChosenFileIds(record.chosenFileIds); if (record.manualSections) setSections(record.manualSections);
  }, !guide);
  const privateMaterials = materials.some((ref) => ref.kind === 'exam' && ref.includeSolutions || materialCatalogue.some((candidate) => candidate.kind === ref.kind && candidate.refId === ref.refId && candidate.visibility === 'personal'));
  const unavailableMaterials = materials.some((ref) => !materialCatalogue.some((candidate) => candidate.kind === ref.kind && candidate.refId === ref.refId));

  const periodSubjects = subjects.filter((s) => s.period === period).sort(bySubject);
  const subjectTerms = terms
    .filter((t) => t.subjectId === subjectId)
    .sort((a, b) => a.position - b.position);
  const termName = subjectTerms.find((t) => t.id === termId)?.name;
  const subjectName = subjects.find((s) => s.id === subjectId)?.name;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current || queue.busy || conflict || (!guide && (privateMaterials || unavailableMaterials || pendingMaterials || !materialDraft.ready)) || (guideType === 'partial' && !termId)) return;
    submitting.current = true;
    try {
      await run(async () => {
        if (!saved.current) {
          const input = { subjectId, termId: guideType === 'partial' ? termId || undefined : undefined, title, topicsText, sections };
          let id: string;
          if (guide) {
            await source.updateGuide(guide.id, input, baseVersion);
            id = guide.id;
          } else {
            await materialDraft.flush();
            if ('problem' in parsedTopics) throw new Error(parsedTopics.problem);
            if (materials.length) {
              const created = await source.createGuideFromMaterials({ subjectId, ...(guideType === 'partial' && termId ? { termId } : {}), guideType, period: String(period), title, topics: parsedTopics.topics, sources: materials, sections, requestId: manualRequest.current });
              id = created.id;
            } else id = await source.createGuide(input, []);
          }
          if (!active.current) return;
          saved.current = { id, version: guide ? baseVersion! + 1 : 1 };
          setContentSaved(true);
        }
        const target = saved.current;
        if (await queue.upload('guide', target.id, target.version) && active.current) {
          rememberPeriod(period);
          void navigate(`/m/guias/${target.id}${guide ? '' : '?pestana=fuentes'}`);
        }
      });
    } finally { submitting.current = false; }
  };

  return (
    <div className="guides-page guides-page--compose">
      <Link to={backTo} className="back with-icon">
        <Icon name="back" size={16} /> {guide ? guide.title : 'Guías de estudio'}
      </Link>
      <header className="guides-header">
        <div>
          <p className="guides-eyebrow"><Icon name="edit" size={16} /> Tu espacio para organizar lo aprendido</p>
          <h1>{guide ? 'Editar guía' : 'Nueva guía de estudio'}</h1>
          <p className="muted">
            {guide
              ? `Es del grupo. Tu cambio se guarda como versión ${guide.version + 1} a tu nombre, y las revisiones de la versión anterior se conservan.`
              : 'Define el alcance, agrega tus materiales y los del grupo, y redacta la guía o continúa con IA. Tu borrador y sus materiales se guardan de forma privada.'}
          </p>
        </div>
      </header>

      <form className={`guides-compose${guide ? '' : ' guides-compose--materials'}`} onSubmit={submit}>
        <fieldset className="guides-compose__settings" disabled={locked || !guide && !materialDraft.ready}>
          <legend className="guides-sr">Organización y fuentes</legend>
        <section className="guides-surface guides-form-section">
          <h2>Alcance de la guía</h2>
          <div className="guides-scope-options" role="group" aria-label="Tipo de guía">
            <button type="button" className="secondary" aria-pressed={guideType === 'partial'} onClick={() => {
              if (guideType === 'partial') return;
              setGuideType('partial'); setTermId(currentTermOf(subjectId, period) || firstTermOf(subjectId)); setMaterials((refs) => refs.map((ref) => ({ ...ref, includeOutsideTerm: true })));
            }}><strong>Para un parcial</strong>{' '}<span>Enfoca el temario de una evaluación.</span></button>
            <button type="button" className="secondary" aria-pressed={guideType === 'quarter'} onClick={() => {
              setGuideType('quarter'); setTermId('');
            }}><strong>Para el cuatrimestre</strong>{' '}<span>Integra todos los parciales de la materia.</span></button>
          </div>
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
                  setSubjectId(subject); setMaterials([]); setChosenFileIds([]); setMaterialCatalogue([]);
                  setTermId(guideType === 'partial' ? currentTermOf(subject, next) || firstTermOf(subject) : '');
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
                  setSubjectId(e.target.value); setMaterials([]); setChosenFileIds([]); setMaterialCatalogue([]);
                  setTermId(guideType === 'partial' ? termAt(terms, e.target.value, position)?.id ?? firstTermOf(e.target.value) : '');
                }}
              >
                {periodSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {guideType === 'partial' && <label className="field">
              <span className="field__label">Parcial</span>
              <select value={termId} onChange={(e) => { setTermId(e.target.value); setMaterials((refs) => refs.map((ref) => ({ ...ref, includeOutsideTerm: true }))); }} required>
                <option value="">Elige un parcial</option>
                {subjectTerms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>}
          </div>
          {guideType === 'quarter' && <p className="field__hint">Esta guía abarca todos los parciales de la materia en el cuatrimestre elegido.</p>}
          {guide && <p className="field__hint">La materia de una guía no cambia; puedes ajustar el alcance.</p>}
        </section>
          <div className="guides-compose-note"><Icon name="users" size={20} /><p>Los cambios se guardan a tu nombre. Las versiones anteriores y las revisiones del grupo se conservan.</p></div>
        </fieldset>
        {!guide && <section className="guides-compose__materials guides-surface" aria-label="Materiales para crear la guía"><h2>Materiales para tu guía</h2><p>Agrega notas, tareas, actividades y exámenes. Cambiar los filtros conserva todo lo agregado.</p>
          <GuideMaterialPicker key={subjectId} subjectId={subjectId} termId={guideType === 'partial' ? termId || undefined : undefined} topics={'topics' in parsedTopics ? parsedTopics.topics : []} selected={materials} onChange={setMaterials} chosenFileIds={chosenFileIds} onChosenFileIdsChange={setChosenFileIds} restoredTranscriptions={materialDraft.saved?.transcriptions} onPendingFilesChange={setPendingMaterials} onCandidatesChange={setMaterialCatalogue} disabled={locked || !materialDraft.ready} />
          <GuideMaterialDraftStatus draft={materialDraft} mode="manual" />
          {privateMaterials && <p className="guides-notice">Incluiste materiales personales: la selección y tu texto se guardan privados. Para crear una guía del grupo, retira esas fuentes o compártelas desde su módulo.</p>}
          {unavailableMaterials && <p className="guides-notice">Estamos comprobando los materiales agregados. Si alguno ya no está disponible, retíralo de la lista para continuar.</p>}
          {pendingMaterials > 0 && <p className="guides-notice">Revisa o quita los {pendingMaterials} archivos elegidos pendientes antes de crear la guía.</p>}
        </section>}
        <fieldset className="guides-compose__document guides-surface" disabled={locked || !guide && !materialDraft.ready}>
          <legend className="guides-sr">Contenido de la guía</legend>
        <section className="guides-form-section">
          <h2>Temario</h2>
          <label className="field">
            <span className="field__label">Título de la guía</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                subjectName ? `Guía de ${subjectName}${guideType === 'quarter' ? ', cuatrimestre completo' : termName ? `, ${termName}` : ''}` : ''
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
        <section className="guides-form-section guides-editor-section">
          <h2>Contenido</h2>
          <p className="field__hint">
            Escribe lo que ya tengas; las secciones vacías no se muestran y quedan señaladas como
            pendientes.
          </p>
          {GUIDE_SECTIONS.map((section, i) => <GuideSectionEditor key={section.id} section={section} index={i}
            value={sections[i] ?? ''} onChange={(value) => setSections(sections.map((text, j) => j === i ? value : text))}
            files={data.resourceFiles.filter((file) => file.targetKind === 'guide' && file.targetId === guide?.id)} />)}
        </section>
        </fieldset>
        <div className="guides-compose__attachments guides-surface"><AttachmentUploader queue={queue} disabled={pending || contentSaved} title="Archivos de la guía" /></div>
        <div className="guides-compose__status">
        {contentSaved && <p className="guides-notice" role="status">La guía ya está guardada. Termina o retira los archivos pendientes para continuar.</p>}
        {conflict && <p className="error" role="alert">La guía cambió mientras la editabas. Conserva tu borrador y abre de nuevo la edición para evitar sobrescribir el trabajo del grupo.</p>}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        </div>
        <div className="form__actions guides-compose__actions">
          <p className="guides-save-hint"><Icon name="users" size={16} /> Una guía del grupo, construida entre todos.</p>
          <Link to={backTo} className="button secondary">
            Cancelar
          </Link>
          <button type="submit" className="guides-primary" disabled={pending || queue.busy || !subjectId || conflict || (!guide && (privateMaterials || unavailableMaterials || pendingMaterials > 0 || !materialDraft.ready)) || (guideType === 'partial' && !termId)}>
            {contentSaved ? queue.pendingCount ? 'Reintentar archivos pendientes' : 'Continuar' : guide ? 'Guardar versión nueva' : 'Crear guía'}
          </button>
        </div>
      </form>
    </div>
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
  const termPosition = (g: StudyGuide) => g.termId ? data.terms.find((t) => t.id === g.termId)?.position ?? 99 : 0;
  const bySubjectInPeriod = data.subjects
    .filter((s) => s.period === period)
    .sort(bySubject)
    .map((subject) => ({
      subject,
      guides: data.guides
        .filter((g) => g.subjectId === subject.id && !g.withdrawnAt)
        .sort((a, b) => termPosition(a) - termPosition(b)),
    }))
    .filter((s) => s.guides.length > 0);

  return (
    <div className="guides-page guides-page--compendium">
      <Link to="/m/guias" className="back with-icon no-print">
        <Icon name="back" size={16} /> Guías de estudio
      </Link>
      <header className="guides-header">
        <div>
          <p className="guides-eyebrow"><Icon name="book" size={16} /> Compendio</p>
          <h1>{periodLabel(period)}</h1>
          <p className="muted">
            Las guías de parcial y las de alcance cuatrimestral en un solo lugar, cada materia
            por separado y con sus fuentes. Este compendio reúne las guías existentes.
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
        <div className="guides-surface guides-empty">
        <Empty
          icon="file"
          title="No hay guías en este cuatrimestre"
          action={
            <Link to="/m/guias/nueva" className="button">
              Crear una guía
            </Link>
          }
        />
        </div>
      ) : (
        <>
          <nav className="guides-surface compendium-index no-print" aria-label="Materias del compendio">
            <div className="guides-section-heading"><Icon name="folder" size={20} /><h2>Materias</h2><span className="guides-count">{bySubjectInPeriod.length}</span></div>
            <ul className="links">
              {bySubjectInPeriod.map(({ subject, guides }) => (
                <li key={subject.id}>
                  <a href={`#materia-${subject.id}`} onClick={(e) => jumpTo(e, subject.id)}>
                    <strong>{subject.name}</strong>
                    <span className="muted">
                      {guides.filter((guide) => !guide.termId).length} de alcance cuatrimestral · {guides.filter((guide) => guide.termId).length} de parcial
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="guides-compendium-content">
          {bySubjectInPeriod.map(({ subject, guides }) => (
            <section key={subject.id} id={`materia-${subject.id}`} className="compendium-subject">
              <h2>{subject.name}</h2>
              {guides.map((guide) => (
                <CompendiumGuide key={guide.id} guide={guide} />
              ))}
            </section>
          ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Con hash routing, un enlace `#ancla` cambiaría de ruta: se desplaza a mano. */
function jumpTo(e: MouseEvent, subjectId: string) {
  e.preventDefault();
  document.getElementById(`materia-${subjectId}`)?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function CompendiumGuide({ guide }: { guide: StudyGuide }) {
  const data = useSnapshot();
  const status = guideStatus(guide, data);
  return (
    <article className="guides-surface guide-body compendium-guide">
      <p className="guides-eyebrow">
        {guideScopeLabel(guide, data)} · versión {guide.version}
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
            <StructuredText text={guide.sections[i]!} />
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
