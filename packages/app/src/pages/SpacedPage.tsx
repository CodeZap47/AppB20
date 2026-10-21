import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { MAX_SPACED_TITLE_LENGTH, MAX_SPACED_QUESTION_LENGTH, MAX_SPACED_EXPLANATION_LENGTH, MAX_SPACED_HINT_LENGTH, SPACED_INTERVAL_DAYS, SPACED_RATING_LABEL, type SpacedRating, type SpacedSourceKind } from '@b20/core';
import { AiStudyModulePanel } from '../components/AiStudyModulePanel';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { RichText } from '../components/RichText';
import { SubjectSelect } from '../components/SubjectSelect';
import { useAction } from '../components/useAction';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { DataSource, Snapshot, SpacedCard, SpacedCollection } from '../data/types';
import { formatTime, memberName } from '../lib/format';
import { canReadSpacedCollection, spacedCardsForCollection, spacedQueue, spacedSource, spacedUpcoming } from '../lib/spaced';

const BASE = '/m/repaso';
const dueFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const dueLabel = (date: Date) => dueFormat.format(date);

interface SessionDraft {
  cardId: string;
  cardVersion: number;
  expectedRevision: number;
  answer: string;
  revealed: boolean;
  showHint: boolean;
  requestId: string;
  attemptedRating?: SpacedRating;
  saved: boolean;
}
interface SessionCache {
  memberId: string;
  routeKey: string;
  queue: { cardId: string; cardVersion: number; revision: number }[];
  index: number;
  draft?: SessionDraft;
  stopNavigationWatch?: () => void;
}

// Nothing is persisted to browser storage. Disposing a source also releases its cache.
const sessionCaches = new WeakMap<DataSource, SessionCache>();

function watchCachedNavigation(sourceRef: WeakRef<DataSource>, cacheRef: WeakRef<SessionCache>, hash: string) {
  const onHashChange = () => {
    if (window.location.hash === hash) return;
    const source = sourceRef.deref();
    const cache = cacheRef.deref();
    if (source && cache && sessionCaches.get(source) === cache) sessionCaches.delete(source);
    window.removeEventListener('hashchange', onHashChange);
  };
  window.addEventListener('hashchange', onHashChange);
  return () => window.removeEventListener('hashchange', onHashChange);
}

function availableCollections(data: Snapshot) {
  return data.spacedCollections.filter((collection) => canReadSpacedCollection(collection, data.me));
}

function cardSource(data: Snapshot, card: Pick<SpacedCard, 'sourceKind' | 'sourceId'>) {
  const source = spacedSource(card, data);
  return source && { ...source, personal: source.visibility === 'personal', href: source.link };
}

function availableCards(data: Snapshot, collectionId?: string) {
  return availableCollections(data).filter((c) => !c.archived && (!collectionId || c.id === collectionId))
    .flatMap((collection) => spacedCardsForCollection(data, collection.id, true));
}

function progressFor(data: Snapshot, card: SpacedCard) {
  return data.spacedProgress.find((p) => p.memberId === data.me?.id && p.cardId === card.id);
}

function filtersFor(params: URLSearchParams) {
  return { collectionId: params.get('coleccion') || undefined, subjectId: params.get('materia') || undefined,
    termId: params.get('parcial') || undefined };
}

function queueFor(data: Snapshot, params: URLSearchParams, now: number) {
  return spacedQueue(data, new Date(now), filtersFor(params));
}

function NotFound() {
  return <Empty icon="lock" title="Este contenido no está disponible"
    action={<Link to={BASE} className="button">Volver a Repaso</Link>}>
    Puede haberse archivado o haber cambiado tu acceso a la colección o a su fuente.
  </Empty>;
}

function PrivacyNote() {
  return <p className="spaced-privacy with-icon"><Icon name="lock" size={16} /> Tu progreso e historial son privados. Solo tú puedes consultarlos.</p>;
}

function SpacedFilters({ data, params, update }: {
  data: Snapshot; params: URLSearchParams; update: (key: string, value: string) => void;
}) {
  const subjectId = params.get('materia') ?? '';
  return <div className="spaced-filters">
    <SubjectSelect subjects={data.subjects} value={subjectId} allowAll onChange={(id) => update('materia', id)} />
    <label className="field">Parcial<select value={params.get('parcial') ?? ''} onChange={(e) => update('parcial', e.target.value)}>
      <option value="">Todos</option>
      {data.terms.filter((t) => !subjectId || t.subjectId === subjectId).map((term) => <option key={term.id} value={term.id}>{term.name}{!subjectId ? ` · ${data.subjects.find((s) => s.id === term.subjectId)?.name ?? ''}` : ''}</option>)}
    </select></label>
  </div>;
}

export function SpacedPage() {
  const data = useSnapshot();
  const [params, setParams] = useSearchParams();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key === 'materia') next.delete('parcial');
    setParams(next, { replace: true });
  };
  const filtered = availableCollections(data).filter((c) => (!params.get('materia') || c.subjectId === params.get('materia'))
    && (!params.get('parcial') || c.termId === params.get('parcial')));
  const collections = filtered.filter((c) => !c.archived);
  const archived = filtered.filter((c) => c.archived);
  const queue = queueFor(data, params, now);
  const newCount = queue.filter((entry) => !entry.dueAt).length;
  const upcoming = spacedUpcoming(data, new Date(now), filtersFor(params));
  const sessionParams = new URLSearchParams();
  if (params.get('materia')) sessionParams.set('materia', params.get('materia')!);
  if (params.get('parcial')) sessionParams.set('parcial', params.get('parcial')!);
  return <>
    <header className="page-header"><div><h1>Repaso espaciado</h1><p className="muted">Recuerda a tu ritmo con tarjetas basadas en tus notas y guías.</p></div>
      <Link to={`${BASE}/nueva`} className="button with-icon"><Icon name="plus" size={18} /> Nueva colección</Link></header>
    <PrivacyNote />
    <SpacedFilters data={data} params={params} update={update} />
    <section className="panel spaced-today" aria-label="Tu repaso de hoy"><div><h2>{queue.length} {queue.length === 1 ? 'tarjeta para repasar' : 'tarjetas para repasar'}</h2>
      <p className="muted">{queue.length - newCount} {queue.length - newCount === 1 ? 'pendiente' : 'pendientes'} · {newCount} {newCount === 1 ? 'nueva' : 'nuevas'}. Primero aparecen las pendientes.</p></div>
      {queue.length > 0 && <Link to={`${BASE}/sesion${sessionParams.size ? `?${sessionParams}` : ''}`} className="button">Comenzar repaso</Link>}
    </section>
    <section className="spaced-section"><h2>Próximas revisiones</h2>
      {upcoming.length ? <ul className="spaced-upcoming">{upcoming.slice(0, 5).map(({ card, dueAt }) => <li key={card.id}><Link to={`${BASE}/colecciones/${card.collectionId}`}>{card.question}</Link><time dateTime={dueAt!.toISOString()}>{dueLabel(dueAt!)}</time></li>)}</ul>
        : <p className="muted">Al revisar una tarjeta verás aquí cuándo retomarla.</p>}
    </section>
    <section className="spaced-section"><h2>Colecciones</h2>
      {collections.length ? <ul className="work-grid spaced-collections">{collections.map((collection) => <CollectionSummary key={collection.id} data={data} collection={collection} />)}</ul>
        : <Empty icon="folder" title={params.size ? 'No hay colecciones con estos filtros' : 'Tu primera colección empieza con una nota o guía'}>Crea tarjetas con una pregunta y una explicación; después añade la colección a tu repaso.</Empty>}
    </section>
    {archived.length > 0 && <details className="spaced-section"><summary>Colecciones archivadas ({archived.length})</summary><ul className="work-grid spaced-collections">{archived.map((collection) => <CollectionSummary key={collection.id} data={data} collection={collection} />)}</ul></details>}
    <ScheduleNote />
  </>;
}

function CollectionSummary({ collection, data }: { collection: SpacedCollection; data: Snapshot }) {
  const enrolled = data.spacedEnrollments.find((e) => e.collectionId === collection.id && e.memberId === data.me?.id);
  const cards = spacedCardsForCollection(data, collection.id, true).filter((c) => !c.archived);
  return <li><Link to={`${BASE}/colecciones/${collection.id}`} className="work-card">
    <span className="work-card__context">{data.subjects.find((s) => s.id === collection.subjectId)?.name} · {data.terms.find((t) => t.id === collection.termId)?.name ?? 'Sin parcial'}</span>
    <strong className="work-card__title">{collection.title}</strong>
    <span className="badges"><span className="badge">{collection.visibility === 'personal' ? 'Personal' : 'Del grupo'}</span>
      {collection.archived ? <span className="badge">Archivada</span> : <span className="badge">{enrolled?.active ? 'En tu repaso' : enrolled ? 'Repaso pausado' : 'Sin añadir'}</span>}</span>
    <span className="muted">{cards.length} {cards.length === 1 ? 'tarjeta' : 'tarjetas'} · versión {collection.version}</span>
    <span className="work-card__footer"><span className="work-card__date">{formatTime(collection.updatedAt)}</span></span>
  </Link></li>;
}

function ScheduleNote() {
  return <details className="panel spaced-rules"><summary>Cómo se programan tus revisiones</summary>
    <p>«Lo recordé»: {SPACED_INTERVAL_DAYS.join(', ')} días; después se mantienen 120 días. «Necesité una pista»: 1 día sin avanzar. «Debo repasarlo»: 10 minutos y vuelve a empezar.</p>
    <p className="muted">Un día equivale a 24 horas. Las fechas se calculan al guardar en el servidor y se muestran en tu hora local. Las tarjetas reprogramadas entran en una sesión posterior.</p>
  </details>;
}

export function SpacedCollectionFormPage() {
  const data = useSnapshot();
  const { collectionId } = useParams();
  const collection = availableCollections(data).find((c) => c.id === collectionId);
  if (collectionId && (!collection || collection.archived)) return <NotFound />;
  return <CollectionForm key={`${data.me?.id}:${collectionId ?? 'new'}`} data={data} collection={collection} />;
}

function CollectionForm({ data, collection }: { data: Snapshot; collection?: SpacedCollection }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [title, setTitle] = useState(collection?.title ?? '');
  const [subjectId, setSubjectId] = useState(collection?.subjectId ?? data.subjects.find((s) => s.id === params.get('materia'))?.id ?? data.subjects[0]?.id ?? '');
  const [termId, setTermId] = useState(collection?.termId ?? '');
  const [visibility, setVisibility] = useState<'personal' | 'group'>(collection?.visibility ?? 'personal');
  const [expectedVersion, setExpectedVersion] = useState(collection?.version);
  const { error, pending, run } = useAction();
  const busy = useRef(false);
  const stale = !!collection && collection.version !== expectedVersion;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy.current || stale) return;
    busy.current = true;
    const id = await run(() => source.saveSpacedCollection({ id: collection?.id, title, subjectId, termId: termId || undefined,
      visibility: collection?.visibility ?? visibility, expectedVersion }));
    busy.current = false;
    if (id) void navigate(`${BASE}/colecciones/${id}`);
  };
  return <><Link to={collection ? `${BASE}/colecciones/${collection.id}` : BASE} className="back">← Repaso espaciado</Link>
    <header className="page-header"><div><h1>{collection ? 'Editar colección' : 'Nueva colección'}</h1><p className="muted">Agrupa tarjetas de una misma materia. Añadirla al repaso será tu decisión.</p></div></header>
    {!data.subjects.length ? <Empty icon="folder" title="Primero necesitas una materia">Agrega una materia desde Tareas y Actividades.</Empty>
      : <form className="form panel" onSubmit={submit} aria-busy={pending}><fieldset className="spaced-fields" disabled={pending}>
        <label className="field">Título de la colección<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_SPACED_TITLE_LENGTH} required /></label>
        {collection ? <p>Materia: {data.subjects.find((s) => s.id === collection.subjectId)?.name}</p> : <SubjectSelect subjects={data.subjects} value={subjectId} onChange={(id) => { setSubjectId(id); setTermId(''); }} />}
        <label className="field">Parcial<select value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">Sin parcial</option>{data.terms.filter((t) => t.subjectId === subjectId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        {!collection && <label className="field">Visibilidad<select value={visibility} onChange={(e) => setVisibility(e.target.value as 'personal' | 'group')}><option value="personal">Personal (solo tú)</option><option value="group">Compartida con el grupo</option></select><span className="field__hint">Las tarjetas de una colección compartida solo pueden usar fuentes del grupo.</span></label>}
        {collection?.visibility === 'personal' && <p className="field__hint">Para compartirla, usa «Publicar en el grupo» desde la colección.</p>}
        {stale && <div className="spaced-notice" role="alert"><p>La colección cambió mientras la editabas. Carga la versión actual antes de guardar.</p><button type="button" className="secondary" onClick={() => { setTitle(collection!.title); setSubjectId(collection!.subjectId); setTermId(collection!.termId ?? ''); setExpectedVersion(collection!.version); }}>Cargar versión actual</button></div>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form__actions"><Link to={collection ? `${BASE}/colecciones/${collection.id}` : BASE} className="button secondary">Cancelar</Link><button type="submit" disabled={pending || stale || !subjectId}>{pending ? 'Guardando…' : 'Guardar colección'}</button></div>
      </fieldset></form>}
  </>;
}

export function SpacedCollectionPage() {
  const data = useSnapshot();
  const { collectionId } = useParams();
  const collection = availableCollections(data).find((c) => c.id === collectionId);
  if (!collection) return <NotFound />;
  return <CollectionDetail key={`${data.me?.id}:${collection.id}`} data={data} collection={collection} />;
}

function CollectionDetail({ data, collection }: { data: Snapshot; collection: SpacedCollection }) {
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const cards = spacedCardsForCollection(data, collection.id, true);
  const enrolled = data.spacedEnrollments.find((e) => e.memberId === data.me?.id && e.collectionId === collection.id);
  const mine = collection.ownerId === data.me?.id;
  const visibleCards = cards.filter((card) => !card.archived);
  const archived = cards.filter((card) => card.archived);
  const unavailable = data.spacedUnavailableCards.filter((card) => card.collectionId === collection.id);
  const collectionCardIds = new Set([...data.spacedCards, ...data.spacedUnavailableCards].filter((c) => c.collectionId === collection.id).map((c) => c.id));
  const reviews = data.spacedReviews.filter((r) => r.memberId === data.me?.id && collectionCardIds.has(r.cardId)).sort((a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime());
  const hasPrivateSource = data.spacedCards.some((c) => c.collectionId === collection.id && cardSource(data, c)?.personal);
  const queueParams = new URLSearchParams({ coleccion: collection.id });
  const due = queueFor(data, queueParams, Date.now()).length;
  return <><Link to={BASE} className="back">← Repaso espaciado</Link>
    <header className="page-header"><div><p className="eyebrow">{data.subjects.find((s) => s.id === collection.subjectId)?.name} · {data.terms.find((t) => t.id === collection.termId)?.name ?? 'Sin parcial'}</p><h1>{collection.title}</h1>
      <p className="muted">{collection.visibility === 'personal' ? 'Personal' : 'Compartida con el grupo'} · versión {collection.version} · {memberName(data.members, collection.updatedBy)} · {formatTime(collection.updatedAt)}</p></div>
      {!collection.archived && <div className="row"><Link to={`${BASE}/colecciones/${collection.id}/editar`} className="button secondary">Editar colección</Link><Link to={`${BASE}/tarjetas/nueva?coleccion=${encodeURIComponent(collection.id)}`} className="button">Crear tarjeta</Link></div>}</header>
    <PrivacyNote />
    <div className="panel spaced-today"><div><h2>{collection.archived ? 'Colección archivada' : enrolled?.active ? 'Esta colección está en tu repaso' : enrolled ? 'Tu repaso está pausado' : 'Elige si quieres repasar esta colección'}</h2><p className="muted">Las tarjetas nuevas entran automáticamente mientras tu repaso esté activo. Pausarlo conserva tu progreso.</p></div>
      {!collection.archived && <div className="row"><button type="button" disabled={pending} onClick={() => void run(() => source.setSpacedEnrollment(collection.id, !enrolled?.active))}>{enrolled?.active ? 'Pausar repaso' : enrolled ? 'Reanudar repaso' : 'Añadir a mi repaso'}</button>{due > 0 && <Link to={`${BASE}/sesion?${queueParams}`} className="button secondary">Repasar {due} tarjetas</Link>}</div>}
      {mine && <button type="button" className="secondary" disabled={pending} onClick={() => void run(() => source.archiveSpacedCollection(collection.id, !collection.archived, collection.version))}>{collection.archived ? 'Restaurar colección' : 'Archivar colección'}</button>}
    </div>
    {mine && !collection.archived && collection.visibility === 'personal' && <section className="panel spaced-section"><h2>Compartir con el grupo</h2><p>Al publicar, los integrantes activos podrán consultar y editar las tarjetas. Tu historial seguirá siendo privado.</p>
      {(hasPrivateSource || unavailable.length > 0) && <p className="spaced-notice">Primero cambia las referencias a notas personales o fuentes no disponibles por fuentes del grupo, incluidas las tarjetas archivadas.</p>}
      <button type="button" className="secondary" disabled={pending || hasPrivateSource || unavailable.length > 0} onClick={() => void run(() => source.publishSpacedCollection(collection.id, collection.version))}>Publicar en el grupo</button></section>}
    {error && <p className="error" role="alert">{error}</p>}
    {!collection.archived && <section className="spaced-section"><h2>Tarjetas ({visibleCards.length})</h2>
      {visibleCards.length ? <ul className="spaced-card-list">{visibleCards.map((card) => <CardDetail key={card.id} data={data} card={card} pending={pending} archive={() => void run(() => source.archiveSpacedCard(card.id, true, card.version))} />)}</ul>
        : <Empty icon="file" title="Todavía no hay tarjetas disponibles">Crea una pregunta a partir de una nota o guía de esta materia.</Empty>}
      {archived.length > 0 && <details className="spaced-section"><summary>Tarjetas archivadas ({archived.length})</summary><ul className="spaced-card-list">{archived.map((card) => <CardDetail key={card.id} data={data} card={card} pending={pending} archive={() => void run(() => source.archiveSpacedCard(card.id, false, card.version))} />)}</ul></details>}
      {unavailable.length > 0 && <section className="spaced-section"><h3>Referencias por corregir</h3><ul className="spaced-card-list">{unavailable.map((card) => <SourceRepair key={`${card.id}:${card.version}`} data={data} collection={collection} card={card} />)}</ul></section>}
    </section>}
    {!collection.archived && <AiStudyModulePanel collection={collection} />}
    <section className="spaced-section"><h2>Tu historial de esta colección</h2>{reviews.length ? <ul className="spaced-history">{reviews.map((review) => <li key={review.id}><span className="spaced-history-question">{cards.find((c) => c.id === review.cardId)?.question ?? 'Tarjeta con fuente no disponible'}</span><strong>{SPACED_RATING_LABEL[review.rating]}</strong><span>Versión {review.cardVersion} · {formatTime(review.reviewedAt)}</span><span className="muted">Programada para {dueLabel(review.dueAt)}</span></li>)}</ul> : <p className="muted">Tus revisiones aparecerán aquí después de estudiar.</p>}</section>
  </>;
}

function SourceRepair({ data, collection, card }: {
  data: Snapshot; collection: SpacedCollection; card: Snapshot['spacedUnavailableCards'][number];
}) {
  const source = useDataSource();
  const { error, pending, run } = useAction();
  const [selected, setSelected] = useState('');
  const busy = useRef(false);
  const notes = data.notes.filter((n) => n.subjectId === collection.subjectId && (n.visibility === 'group' || n.authorId === data.me?.id)
    && (collection.visibility === 'personal' || n.visibility === 'group'));
  const guides = data.guides.filter((g) => g.subjectId === collection.subjectId);
  const accessible = notes.some((n) => selected === `note:${n.id}`) || guides.some((g) => selected === `guide:${g.id}`);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || !accessible) return;
    busy.current = true;
    await run(() => source.replaceSpacedCardSource(card.id, card.version, selected.startsWith('note:') ? 'note' : 'guide', selected.slice(selected.indexOf(':') + 1)));
    busy.current = false;
  };
  return <li className="panel spaced-card"><h3>Tarjeta con fuente no disponible</h3>
    <p className="muted">Su contenido permanece oculto hasta vincular una referencia accesible de la misma materia. El progreso se conserva.{card.archived ? ' Esta tarjeta está archivada.' : ''}</p>
    <form className="form" onSubmit={submit} aria-busy={pending}><label className="field">Nueva referencia<select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={pending} required>
      <option value="">Elige una nota o guía</option><optgroup label="Notas">{notes.map((note) => <option key={note.id} value={`note:${note.id}`}>{note.title}{note.visibility === 'personal' ? ' (personal)' : ''}</option>)}</optgroup>
      <optgroup label="Guías">{guides.map((guide) => <option key={guide.id} value={`guide:${guide.id}`}>{guide.title}</option>)}</optgroup>
    </select></label>{error && <p className="error" role="alert">{error}</p>}<div className="row"><button type="submit" disabled={pending || !accessible}>{pending ? 'Guardando…' : 'Corregir referencia'}</button>
      {!collection.archived && <button type="button" className="secondary" disabled={pending} onClick={() => void run(() => source.archiveSpacedCard(card.id, !card.archived, card.version))}>{card.archived ? 'Restaurar tarjeta' : 'Archivar tarjeta'}</button>}
    </div></form>
  </li>;
}

function CardDetail({ data, card, pending, archive }: { data: Snapshot; card: SpacedCard; pending: boolean; archive: () => void }) {
  const source = cardSource(data, card);
  return <li className="panel spaced-card"><div className="row row--between"><h3>{card.question}</h3><span className="badge">v{card.version}</span></div>
    <SourceNote data={data} card={card} />
    <details><summary>Ver explicación</summary><RichText text={card.explanation} />{card.hint && <p><strong>Pista:</strong> {card.hint}</p>}</details>
    <p className="muted spaced-card-meta">{memberName(data.members, card.updatedBy)} · {formatTime(card.updatedAt)}{source && ` · fuente v${card.sourceVersion}`}</p>
    <div className="row">{!card.archived && <Link to={`${BASE}/tarjetas/${card.id}/editar`} className="button secondary">Editar tarjeta</Link>}<button type="button" className="secondary" disabled={pending} onClick={archive}>{card.archived ? 'Restaurar tarjeta' : 'Archivar tarjeta'}</button></div>
  </li>;
}

function SourceNote({ data, card }: { data: Snapshot; card: SpacedCard }) {
  const source = cardSource(data, card);
  if (!source) return null;
  return <div className="spaced-source"><p className="muted">Referencia: <Link to={source.href}>{source.title}</Link> · versión de origen {card.sourceVersion}</p>
    {source.version !== card.sourceVersion && <p className="spaced-notice" role="status">La fuente cambió a la versión {source.version}. La tarjeta conserva su contenido; edítala para revisar y actualizar su referencia.</p>}</div>;
}

export function SpacedCardFormPage() {
  const data = useSnapshot();
  const { cardId } = useParams();
  const [params] = useSearchParams();
  const card = availableCards(data).find((c) => c.id === cardId);
  if (cardId && (!card || card.archived)) return <NotFound />;
  const sourceKey = params.get('nota') ? `note:${params.get('nota')}` : params.get('guia') ? `guide:${params.get('guia')}` : '';
  return <CardForm key={`${data.me?.id}:${cardId ?? 'new'}:${sourceKey}:${params.get('coleccion') ?? ''}`} data={data} card={card} sourceKey={sourceKey} collectionId={params.get('coleccion') ?? ''} />;
}

function CardForm({ data, card, sourceKey, collectionId: askedCollection }: { data: Snapshot; card?: SpacedCard; sourceKey: string; collectionId: string }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const sourceValue = card ? `${card.sourceKind}:${card.sourceId}` : sourceKey;
  const sourceInfo = sourceValue ? cardSource(data, { sourceKind: sourceValue.startsWith('note:') ? 'note' : 'guide', sourceId: sourceValue.slice(sourceValue.indexOf(':') + 1) }) : undefined;
  const collections = availableCollections(data).filter((c) => !c.archived);
  const asked = collections.find((c) => c.id === (card?.collectionId || askedCollection));
  const candidates = collections.filter((c) => (!sourceInfo || c.subjectId === sourceInfo.subjectId) && !(sourceInfo?.personal && c.visibility === 'group'));
  const [subjectId, setSubjectId] = useState(asked?.subjectId ?? sourceInfo?.subjectId ?? data.subjects[0]?.id ?? '');
  const [collectionId, setCollectionId] = useState(asked?.id ?? candidates.find((c) => c.subjectId === sourceInfo?.subjectId)?.id ?? '');
  const [newTitle, setNewTitle] = useState('');
  const [termId, setTermId] = useState(sourceInfo && 'termId' in sourceInfo ? sourceInfo.termId ?? '' : '');
  const [selectedSource, setSelectedSource] = useState(sourceValue);
  const [question, setQuestion] = useState(card?.question ?? '');
  const [explanation, setExplanation] = useState(card?.explanation ?? '');
  const [hint, setHint] = useState(card?.hint ?? '');
  const [expectedVersion, setExpectedVersion] = useState(card?.version);
  const { error, pending, run } = useAction();
  const busy = useRef(false);
  const stale = !!card && card.version !== expectedVersion;
  const createdCollection = useRef<string | undefined>(undefined);
  const selectedCollection = collections.find((c) => c.id === collectionId);
  const effectiveSubject = selectedCollection?.subjectId ?? subjectId;
  const selectedKind = selectedSource.startsWith('note:') ? 'note' : 'guide';
  const selectedId = selectedSource.slice(selectedSource.indexOf(':') + 1);
  const selectedInfo = selectedSource ? cardSource(data, { sourceKind: selectedKind, sourceId: selectedId }) : undefined;
  const accessible = !!selectedInfo && selectedInfo.subjectId === effectiveSubject && !(selectedCollection?.visibility === 'group' && selectedInfo.personal);
  const allowedNotes = data.notes.filter((n) => n.subjectId === effectiveSubject && (n.visibility === 'group' || n.authorId === data.me?.id)
    && !(selectedCollection?.visibility === 'group' && n.visibility === 'personal'));
  const allowedGuides = data.guides.filter((g) => g.subjectId === effectiveSubject);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || !accessible || stale) return;
    busy.current = true;
    const result = await run(async () => {
      const target = collectionId || createdCollection.current || await source.saveSpacedCollection({ subjectId: effectiveSubject,
        title: newTitle, visibility: 'personal', ...(termId ? { termId } : {}) });
      if (!collectionId) createdCollection.current = target;
      const id = await source.saveSpacedCard({ id: card?.id, collectionId: target, question, explanation, hint,
        sourceKind: selectedKind as SpacedSourceKind, sourceId: selectedId, expectedVersion });
      return { id, collectionId: target };
    });
    busy.current = false;
    if (result) void navigate(`${BASE}/colecciones/${result.collectionId}`);
  };
  return <><Link to={card ? `${BASE}/colecciones/${card.collectionId}` : BASE} className="back">← Repaso espaciado</Link>
    <header className="page-header"><div><h1>{card ? 'Editar tarjeta' : 'Crear tarjeta'}</h1><p className="muted">Escribe una pregunta breve y una explicación que puedas comprobar en la fuente.</p></div></header>
    {!data.subjects.length ? <Empty icon="folder" title="Primero necesitas una materia">Agrega una materia desde Tareas y Actividades.</Empty>
      : <form className="form form--wide panel" onSubmit={submit} aria-busy={pending}><fieldset className="spaced-fields" disabled={pending}>
        {!card && <label className="field">Colección<select value={collectionId} onChange={(e) => { createdCollection.current = undefined; setCollectionId(e.target.value); const next = collections.find((c) => c.id === e.target.value); if (next) setSubjectId(next.subjectId); }}>
          <option value="">Crear una colección personal</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.title} · {c.visibility === 'personal' ? 'Personal' : 'Del grupo'}</option>)}
        </select></label>}
        {!collectionId && <><label className="field">Título de la nueva colección<input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={MAX_SPACED_TITLE_LENGTH} required /></label>
          <SubjectSelect subjects={data.subjects} value={subjectId} onChange={(id) => { setSubjectId(id); setTermId(''); setSelectedSource(''); createdCollection.current = undefined; }} />
          <label className="field">Parcial<select value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">Sin parcial</option>{data.terms.filter((t) => t.subjectId === subjectId).map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label></>}
        {selectedCollection && <p className="muted">{selectedCollection.title} · {data.subjects.find((s) => s.id === selectedCollection.subjectId)?.name}</p>}
        <label className="field">Nota o guía de referencia<select required value={selectedSource} onChange={(e) => setSelectedSource(e.target.value)}>
          <option value="">Elige una fuente de la misma materia</option>{selectedSource && !accessible && <option value={selectedSource}>Fuente no disponible para esta colección</option>}
          <optgroup label="Notas">{allowedNotes.map((n) => <option key={n.id} value={`note:${n.id}`}>{n.title}{n.visibility === 'personal' ? ' (personal)' : ''}</option>)}</optgroup>
          <optgroup label="Guías">{allowedGuides.map((g) => <option key={g.id} value={`guide:${g.id}`}>{g.title}</option>)}</optgroup>
        </select><span className="field__hint">La referencia es obligatoria. Las notas personales solo pueden usarse en colecciones personales.</span></label>
        {selectedSource && !accessible && <p className="error" role="alert">Ya no puedes usar esta fuente en la colección. Elige otra referencia accesible de la misma materia.</p>}
        {card && selectedInfo && card.sourceVersion !== selectedInfo.version && <p className="spaced-notice">La fuente cambió. Al guardar confirmarás la referencia a su versión actual ({selectedInfo.version}).</p>}
        <label className="field">Pregunta<textarea required value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={MAX_SPACED_QUESTION_LENGTH} rows={3} /></label>
        <label className="field">Explicación<textarea required value={explanation} onChange={(e) => setExplanation(e.target.value)} maxLength={MAX_SPACED_EXPLANATION_LENGTH} rows={7} /></label>
        <label className="field">Pista <span className="field__optional">opcional</span><textarea value={hint} onChange={(e) => setHint(e.target.value)} maxLength={MAX_SPACED_HINT_LENGTH} rows={2} /></label>
        {card && <p className="field__hint">Cambiar la pregunta, explicación o pista reinicia el aprendizaje; el historial anterior se conserva.</p>}
        {stale && <div className="spaced-notice" role="alert"><p>La tarjeta cambió mientras la editabas. Carga la versión actual antes de guardar.</p><button type="button" className="secondary" onClick={() => { setQuestion(card!.question); setExplanation(card!.explanation); setHint(card!.hint); setSelectedSource(`${card!.sourceKind}:${card!.sourceId}`); setExpectedVersion(card!.version); }}>Cargar versión actual</button></div>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form__actions"><Link to={card ? `${BASE}/colecciones/${card.collectionId}` : BASE} className="button secondary">Cancelar</Link><button type="submit" disabled={pending || stale || !accessible || !question.trim() || !explanation.trim() || (!collectionId && !newTitle.trim())}>{pending ? 'Guardando…' : card ? 'Guardar tarjeta' : 'Crear tarjeta'}</button></div>
      </fieldset></form>}
  </>;
}

/** The component key discards every draft and receipt when the account or session changes. */
export function SpacedSessionPage() {
  const data = useSnapshot();
  const [params] = useSearchParams();
  if (data.me?.status !== 'active') return <NotFound />;
  return <Session key={`${data.me.id}:${params.toString()}`} data={data} params={params} />;
}

function Session({ data, params }: { data: Snapshot; params: URLSearchParams }) {
  const source = useDataSource();
  const [cache] = useState<SessionCache>(() => {
    const previous = sessionCaches.get(source);
    if (previous?.memberId === data.me!.id && previous.routeKey === params.toString()) return previous;
    previous?.stopNavigationWatch?.();
    return { memberId: data.me!.id, routeKey: params.toString(), index: 0,
      queue: queueFor(data, params, Date.now()).map((item) => ({ cardId: item.card.id,
        cardVersion: item.card.version, revision: item.progress?.revision ?? 0 })) };
  });
  const [index, setIndex] = useState(cache.index);
  const queue = cache.queue;
  useEffect(() => {
    cache.stopNavigationWatch?.();
    cache.stopNavigationWatch = undefined;
    sessionCaches.set(source, cache);
    return () => {
      if (sessionCaches.get(source) !== cache) return;
      if (source.getSnapshot().connection === 'ready') sessionCaches.delete(source);
      else cache.stopNavigationWatch = watchCachedNavigation(new WeakRef(source), new WeakRef(cache), window.location.hash);
    };
  }, [cache, source]);
  const entry = queue[index];
  const card = entry && availableCards(data).find((c) => c.id === entry.cardId && !c.archived);
  const enrolled = card && data.spacedEnrollments.some((e) => e.collectionId === card.collectionId && e.memberId === data.me?.id && e.active);
  const next = () => {
    cache.index = index + 1;
    cache.draft = undefined;
    if (cache.index >= queue.length) sessionCaches.delete(source);
    setIndex(cache.index);
  };
  return <><Link to={BASE} className="back">← Salir del repaso</Link>
    <header className="page-header"><div><h1>Tu sesión de repaso</h1><p className="muted">Responde mentalmente o escribe para ayudarte a recordar.</p></div></header><PrivacyNote />
    {queue.length > 0 && <div className="spaced-session-progress"><span>{Math.min(index + 1, queue.length)} de {queue.length} tarjetas</span><progress max={queue.length} value={index} aria-label="Tarjetas terminadas" /></div>}
    {!entry ? <Empty icon="check" title={queue.length ? 'Terminaste esta sesión' : 'No tienes tarjetas pendientes'} action={<Link to={BASE} className="button">Volver a Repaso</Link>}>{queue.length ? 'Tus revisiones quedaron guardadas. Las nuevas tarjetas y las que vuelvan a vencer aparecerán en otra sesión.' : 'Añade una colección a tu repaso o espera a su próxima revisión.'}</Empty>
      : !card || !enrolled ? <Empty icon="lock" title="Esta tarjeta dejó de estar disponible" action={<button type="button" onClick={next}>Continuar</button>}>La colección, la tarjeta o su fuente cambiaron. No se guardó ninguna revisión.</Empty>
        : <ReviewStep key={`${card.id}:${card.version}`} data={data} card={card} cache={cache}
          queuedRevision={card.version === entry.cardVersion ? entry.revision : progressFor(data, card)?.revision ?? 0}
          changed={card.version !== entry.cardVersion} next={next} last={index === queue.length - 1} />}
    <ScheduleNote />
  </>;
}

function ReviewStep({ data, card, cache, queuedRevision, changed, next, last }: {
  data: Snapshot; card: SpacedCard; cache: SessionCache; queuedRevision: number; changed: boolean; next: () => void; last: boolean;
}) {
  const source = useDataSource();
  const [draft] = useState<SessionDraft>(() => {
    if (cache.draft?.cardId === card.id && cache.draft.cardVersion === card.version) return cache.draft;
    const value = { cardId: card.id, cardVersion: card.version, expectedRevision: queuedRevision,
      answer: '', revealed: false, showHint: false, requestId: crypto.randomUUID(), saved: false };
    cache.draft = value;
    return value;
  });
  const [answer, setAnswer] = useState(draft.answer);
  const [revealed, setRevealed] = useState(draft.revealed);
  const [showHint, setShowHint] = useState(draft.showHint);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(draft.saved);
  const [attemptedRating, setAttemptedRating] = useState<SpacedRating | undefined>(draft.attemptedRating);
  const expectedRevision = draft.expectedRevision;
  const requestId = draft.requestId;
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const receipt = data.spacedReviews.find((review) => review.requestId === requestId && review.memberId === data.me?.id);
  const currentProgress = progressFor(data, card);
  const notDue = currentProgress?.cardVersion === card.version && currentProgress.dueAt.getTime() > Date.now();
  const changedProgress = ((currentProgress?.revision ?? 0) !== expectedRevision || notDue) && !saved && !pending && !receipt;
  const grade = async (rating: SpacedRating) => {
    if (busy.current || saved || !revealed || changedProgress || data.connection !== 'ready') return;
    busy.current = true;
    setPending(true);
    setError('');
    setAttemptedRating(rating);
    draft.attemptedRating = rating;
    try {
      await source.reviewSpacedCard({ cardId: card.id, cardVersion: card.version, expectedRevision, rating, requestId });
      if (mounted.current) { draft.saved = true; draft.answer = ''; setSaved(true); setAnswer(''); }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'No se pudo guardar. Vuelve a intentarlo.');
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const progressStep = currentProgress?.cardVersion === card.version ? currentProgress.step : 0;
  const nextDays = SPACED_INTERVAL_DAYS[Math.min(progressStep, SPACED_INTERVAL_DAYS.length - 1)];
  return <article className="panel spaced-review" aria-busy={pending}>
    {changed && <p className="spaced-notice" role="status">La tarjeta cambió durante la sesión. Vuelve a responder su versión actual antes de evaluar.</p>}
    <p className="eyebrow">{data.spacedCollections.find((c) => c.id === card.collectionId)?.title} · versión {card.version}</p>
    <h2>{card.question}</h2><SourceNote data={data} card={card} />
    {saved || receipt ? <div className="spaced-saved" role="status"><h3>Revisión guardada</h3>{receipt ? <p>Próxima revisión: <time dateTime={receipt.dueAt.toISOString()}>{dueLabel(receipt.dueAt)}</time></p> : <p>Esperando la fecha confirmada por el servidor…</p>}<button type="button" onClick={next}>{last ? 'Terminar sesión' : 'Siguiente tarjeta'}</button></div>
      : <>
        {changedProgress ? <p className="spaced-notice" role="alert">Ya revisaste esta tarjeta desde otra sesión. Continúa para evitar guardar el avance dos veces.</p> : <>
          <label className="field spaced-answer">Tu respuesta <span className="field__optional">opcional</span><textarea value={answer} disabled={pending} onChange={(e) => { draft.answer = e.target.value; setAnswer(e.target.value); }} rows={4} placeholder="También puedes responder mentalmente" /><span className="field__hint">Este texto no se guarda y desaparece al cambiar de tarjeta.</span></label>
          {card.hint && !revealed && <><button type="button" className="secondary" onClick={() => { draft.showHint = true; setShowHint(true); }} disabled={showHint}>Ver pista</button>{showHint && <p className="spaced-hint">{card.hint}</p>}</>}
          {!revealed ? <div className="spaced-reveal"><button type="button" onClick={() => { draft.revealed = true; setRevealed(true); }}>Revelar explicación</button></div>
            : <><section className="spaced-explanation"><h3>Explicación</h3><RichText text={card.explanation} /></section>
              <div className="spaced-ratings" role="group" aria-label="¿Cómo te fue?">
                {(Object.keys(SPACED_RATING_LABEL) as SpacedRating[]).map((rating) => <button key={rating} type="button" className={rating === 'remembered' ? '' : 'secondary'} disabled={pending || data.connection !== 'ready' || (!!attemptedRating && attemptedRating !== rating)} onClick={() => void grade(rating)}>{SPACED_RATING_LABEL[rating]}<span>{rating === 'again' ? '10 minutos · reiniciar' : rating === 'hint' ? '1 día · sin avanzar' : `${nextDays} ${nextDays === 1 ? 'día' : 'días'}`}</span></button>)}
              </div></>}
        </>}
        {data.connection !== 'ready' && <p className="error" role="alert">Se perdió la conexión. Tu respuesta sigue aquí; podrás guardar al reconectar.</p>}
        {error && <p className="error" role="alert">{error} Tu tarjeta se conserva para reintentar.</p>}
        {changedProgress && <button type="button" onClick={next}>Continuar</button>}
        {pending && <p role="status" className="muted">Guardando revisión…</p>}
      </>}
  </article>;
}
