import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { canEditWork } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Work } from '../data/types';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { RichText } from '../components/RichText';
import { WorkArchive } from '../components/WorkArchive';
import { useAction } from '../components/useAction';
import { formatMediumDate } from '../lib/format';
import { authorsLabel, filterWorks, NO_TERM, sortRecent, type WorkFilters } from '../lib/works';

/** Opción de los selectores para crear una materia o un parcial al publicar. */
const NEW = '__nuevo__';

const countLabel = (n: number) => `${n} ${n === 1 ? 'trabajo' : 'trabajos'}`;

/** Archivo del grupo. Los filtros viven en la URL para conservarlos al volver de un trabajo. */
export function WorksPage() {
  const { me, works, subjects, terms, members } = useSnapshot();
  const [params, setParams] = useSearchParams();
  const filters: WorkFilters = {
    query: params.get('q') ?? '',
    subjectId: params.get('materia') ?? '',
    termId: params.get('parcial') ?? '',
    authorId: params.get('autor') ?? '',
  };
  const view = params.get('vista') === 'recientes' ? 'recent' : 'grouped';

  const update = (changes: Record<string, string>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  const ctx = { subjects, terms, members };
  const shown = filterWorks(works, filters, ctx);
  // Los conteos de cada materia respetan la búsqueda y el autor elegidos.
  const beforeSubject = filterWorks(works, { ...filters, subjectId: '', termId: '' }, ctx);
  const subjectChips = [...subjects]
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((s) => ({ ...s, count: beforeSubject.filter((w) => w.subjectId === s.id).length }))
    .filter((s) => s.count > 0 || s.id === filters.subjectId);
  const inSubject = beforeSubject.filter((w) => w.subjectId === filters.subjectId);
  const termChips = filters.subjectId
    ? [
        ...terms
          .filter((t) => t.subjectId === filters.subjectId)
          .sort((a, b) => a.position - b.position)
          .map((t) => ({ id: t.id, name: t.name, count: inSubject.filter((w) => w.termId === t.id).length })),
        { id: NO_TERM, name: 'Sin parcial', count: inSubject.filter((w) => !w.termId).length },
      ].filter((t) => t.count > 0 || t.id === filters.termId)
    : [];
  const filtering = Boolean(filters.query || filters.subjectId || filters.termId || filters.authorId);
  const authors = members.filter((m) => m.id !== me?.id && works.some((w) => w.authorIds.includes(m.id)));

  // Publicar desde una materia o un parcial filtrado deja el formulario ya clasificado.
  const publishParams = new URLSearchParams();
  if (filters.subjectId) publishParams.set('materia', filters.subjectId);
  if (filters.termId && filters.termId !== NO_TERM) publishParams.set('parcial', filters.termId);
  const publishTo = `/m/tareas/nuevo${publishParams.size ? `?${publishParams}` : ''}`;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Tareas y trabajos</h1>
          <p className="muted">El archivo del grupo: cada trabajo con su consigna, su materia y sus autores.</p>
        </div>
        <Link to={publishTo} className="button with-icon">
          <Icon name="plus" size={18} /> Publicar trabajo
        </Link>
      </header>

      {works.length === 0 ? (
        <Empty
          icon="folder"
          title="El archivo está vacío"
          action={
            <Link to={publishTo} className="button">
              Publicar el primer trabajo
            </Link>
          }
        >
          Cuando alguien publique un trabajo aparecerá aquí, ordenado por materia y parcial.
        </Empty>
      ) : (
        <>
          <div className="toolbar" role="search">
            <label className="search toolbar__search">
              <Icon name="search" size={18} />
              <input
                type="search"
                placeholder="Buscar por título, consigna o autor"
                aria-label="Buscar trabajos"
                value={filters.query}
                onChange={(e) => update({ q: e.target.value })}
              />
            </label>
            <select
              aria-label="Autor"
              value={filters.authorId}
              onChange={(e) => update({ autor: e.target.value })}
            >
              <option value="">Todos los autores</option>
              {me && <option value={me.id}>Mis trabajos</option>}
              {authors.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
            <div className="segmented" role="group" aria-label="Orden del archivo">
              <button type="button" aria-pressed={view === 'grouped'} onClick={() => update({ vista: '' })}>
                Por materia
              </button>
              <button
                type="button"
                aria-pressed={view === 'recent'}
                onClick={() => update({ vista: 'recientes' })}
              >
                Recientes
              </button>
            </div>
          </div>

          <div className="chips chips--scroll" role="group" aria-label="Materia">
            <button
              type="button"
              className="chip"
              aria-pressed={!filters.subjectId}
              onClick={() => update({ materia: '', parcial: '' })}
            >
              Todas <span className="chip__count">{beforeSubject.length}</span>
            </button>
            {subjectChips.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                aria-pressed={filters.subjectId === s.id}
                onClick={() => update({ materia: s.id, parcial: '' })}
              >
                {s.name} <span className="chip__count">{s.count}</span>
              </button>
            ))}
          </div>

          {termChips.length > 1 && (
            <div className="chips chips--small chips--scroll" role="group" aria-label="Parcial o unidad">
              <button
                type="button"
                className="chip"
                aria-pressed={!filters.termId}
                onClick={() => update({ parcial: '' })}
              >
                Todos los parciales
              </button>
              {termChips.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="chip"
                  aria-pressed={filters.termId === t.id}
                  onClick={() => update({ parcial: t.id })}
                >
                  {t.name} <span className="chip__count">{t.count}</span>
                </button>
              ))}
            </div>
          )}

          <p className="results muted" aria-live="polite">
            {filtering ? `${countLabel(shown.length)} con estos filtros` : countLabel(shown.length)}
            {filtering && (
              <>
                {' · '}
                <button type="button" className="link-button" onClick={() => setParams({}, { replace: true })}>
                  Limpiar filtros
                </button>
              </>
            )}
          </p>

          {shown.length ? (
            <WorkArchive
              works={shown}
              subjects={subjects}
              terms={terms}
              members={members}
              meId={me?.id}
              view={view}
            />
          ) : (
            <Empty icon="search" title="Sin resultados">
              Ningún trabajo coincide con la búsqueda y los filtros elegidos.
            </Empty>
          )}
        </>
      )}
    </>
  );
}

function EditWorkForm({ work, onDone }: { work: Work; onDone: () => void }) {
  const source = useDataSource();
  const { error, run } = useAction();
  const [title, setTitle] = useState(work.title);
  const [description, setDescription] = useState(work.description);
  const changed = title.trim() !== work.title || description.trim() !== work.description;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => (source.updateWork(work.id, title, description), true))) onDone();
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <label className="field">
        <span className="field__label">Título</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
      </label>
      <label className="field">
        <span className="field__label">Descripción</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={8} />
        <span className="field__hint">Para pegar código, enciérralo entre líneas con ```.</span>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form__actions">
        <span className="muted form__note">Se guardará como versión {work.version + 1}.</span>
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" disabled={!changed || !title.trim()}>
          Guardar cambios
        </button>
      </div>
    </form>
  );
}

export function WorkPage() {
  const { workId = '' } = useParams();
  const { me, works, subjects, terms, members } = useSnapshot();
  const [editing, setEditing] = useState(false);
  const work = works.find((w) => w.id === workId);

  if (!work) {
    return (
      <Empty
        icon="folder"
        title="Trabajo no encontrado"
        action={
          <Link to="/m/tareas" className="button">
            Ver el archivo
          </Link>
        }
      >
        Puede que el enlace esté incompleto o que el trabajo ya no exista.
      </Empty>
    );
  }

  const subject = subjects.find((s) => s.id === work.subjectId);
  const term = terms.find((t) => t.id === work.termId);
  const canEdit = Boolean(me && canEditWork(me.id, work.authorIds));
  const subjectLink = `/m/tareas?${new URLSearchParams({ materia: work.subjectId })}`;
  const termLink = `/m/tareas?${new URLSearchParams({ materia: work.subjectId, parcial: work.termId ?? NO_TERM })}`;
  const siblings = sortRecent(
    works.filter((w) => w.id !== work.id && w.subjectId === work.subjectId && w.termId === work.termId),
  ).slice(0, 4);

  return (
    <>
      <Link to="/m/tareas" className="back with-icon">
        <Icon name="back" size={16} /> Tareas y trabajos
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">
            <Link to={subjectLink}>{subject?.name ?? 'Materia desconocida'}</Link>
            {' · '}
            <Link to={termLink}>{term?.name ?? 'Sin parcial'}</Link>
          </p>
          <h1>{work.title}</h1>
          <p className="muted">
            {work.authorIds.length > 1 ? 'Trabajo en equipo' : 'Trabajo individual'} de{' '}
            {authorsLabel(work.authorIds, members)}
          </p>
        </div>
        {canEdit && !editing && (
          <button type="button" className="secondary with-icon" onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} /> Editar
          </button>
        )}
      </header>

      <div className="detail">
        <div className="detail__main">
          <section className="panel">
            <h2 className="label">Consigna</h2>
            {work.assignment ? (
              <RichText text={work.assignment} />
            ) : (
              <p className="muted">No se registró la consigna de este trabajo.</p>
            )}
          </section>
          {editing ? (
            <EditWorkForm work={work} onDone={() => setEditing(false)} />
          ) : (
            <section className="panel">
              <h2 className="label">Descripción</h2>
              {work.description ? (
                <RichText text={work.description} />
              ) : (
                <p className="muted">
                  {canEdit
                    ? 'Todavía no tiene descripción. Usa «Editar» para contar de qué trata.'
                    : 'Sus autores todavía no agregan una descripción.'}
                </p>
              )}
            </section>
          )}
        </div>

        <aside className="detail__side">
          <section className="panel">
            <h2 className="label">{work.authorIds.length > 1 ? 'Autores' : 'Autor'}</h2>
            <ul className="people">
              {work.authorIds.map((id) => {
                const member = members.find((m) => m.id === id);
                return (
                  <li key={id}>
                    <Link to={`/perfil/${id}`}>
                      <Avatar member={member} size={32} />
                      <span>
                        {member?.displayName ?? 'Miembro desconocido'}
                        {id === me?.id && <span className="muted"> (tú)</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel">
            <h2 className="label">Detalles</h2>
            <dl className="facts">
              <dt>Versión</dt>
              <dd>{work.version}</dd>
              <dt>Publicado</dt>
              <dd>{formatMediumDate(work.createdAt)}</dd>
              {work.version > 1 && (
                <>
                  <dt>Actualizado</dt>
                  <dd>{formatMediumDate(work.updatedAt)}</dd>
                </>
              )}
            </dl>
          </section>

          {siblings.length > 0 && (
            <section className="panel">
              <h2 className="label">Más de {term?.name ?? subject?.name ?? 'esta materia'}</h2>
              <ul className="links">
                {siblings.map((w) => (
                  <li key={w.id}>
                    <Link to={`/m/tareas/${w.id}`}>
                      <strong>{w.title}</strong>
                      <span className="muted">{authorsLabel(w.authorIds, members, me?.id)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

export function PublishWorkPage() {
  const source = useDataSource();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { me, members, subjects, terms } = useSnapshot();
  const { error, run } = useAction();

  const [subjectId, setSubjectId] = useState(
    () => subjects.find((s) => s.id === params.get('materia'))?.id ?? subjects[0]?.id ?? NEW,
  );
  const [termId, setTermId] = useState(
    () => terms.find((t) => t.id === params.get('parcial') && t.subjectId === subjectId)?.id ?? '',
  );
  const [newSubject, setNewSubject] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [title, setTitle] = useState('');
  const [assignment, setAssignment] = useState('');
  const [description, setDescription] = useState('');
  const [coauthorIds, setCoauthorIds] = useState<string[]>([]);

  const subjectTerms = terms
    .filter((t) => t.subjectId === subjectId)
    .sort((a, b) => a.position - b.position);
  const others = members.filter((m) => m.id !== me?.id && m.status === 'active');
  const toggleCoauthor = (id: string) =>
    setCoauthorIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = run(() => {
      // Si la materia o el parcial nuevos se crean pero publicar falla, quedan elegidos para
      // que un segundo intento no los duplique.
      let sid = subjectId;
      if (sid === NEW) {
        sid = source.createSubject(newSubject);
        setSubjectId(sid);
        setNewSubject('');
      }
      let tid = termId;
      if (tid === NEW) {
        tid = source.createTerm(sid, newTerm);
        setTermId(tid);
        setNewTerm('');
      }
      return source.publishWork({
        subjectId: sid,
        termId: tid || undefined,
        title,
        assignment,
        description,
        coauthorIds,
      });
    });
    if (id) void navigate(`/m/tareas/${id}`);
  };

  return (
    <>
      <Link to="/m/tareas" className="back with-icon">
        <Icon name="back" size={16} /> Tareas y trabajos
      </Link>
      <header className="page-header">
        <div>
          <h1>Publicar trabajo</h1>
          <p className="muted">Quedará en el archivo del grupo y en el perfil de cada autor.</p>
        </div>
      </header>

      <form className="panel form form--wide" onSubmit={submit}>
        <section className="form__section">
          <h2>Dónde va</h2>
          <div className="form__grid">
            <label className="field">
              <span className="field__label">Materia</span>
              <select
                value={subjectId}
                onChange={(e) => {
                  setSubjectId(e.target.value);
                  setTermId('');
                }}
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value={NEW}>Nueva materia…</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Parcial o unidad</span>
              <select value={termId} onChange={(e) => setTermId(e.target.value)}>
                <option value="">Sin parcial</option>
                {subjectTerms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value={NEW}>Nuevo parcial o unidad…</option>
              </select>
            </label>
            {subjectId === NEW && (
              <label className="field">
                <span className="field__label">Nombre de la materia</span>
                <input
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  maxLength={120}
                  required
                  autoFocus
                />
              </label>
            )}
            {termId === NEW && (
              <label className="field">
                <span className="field__label">Nombre del parcial o unidad</span>
                <input
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                  placeholder="Por ejemplo: Parcial 2"
                  maxLength={120}
                  required
                  autoFocus
                />
              </label>
            )}
          </div>
        </section>

        <section className="form__section">
          <h2>El trabajo</h2>
          <label className="field">
            <span className="field__label">Título</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
          </label>
          <label className="field">
            <span className="field__label">
              Consigna <span className="field__optional">opcional</span>
            </span>
            <textarea value={assignment} onChange={(e) => setAssignment(e.target.value)} rows={3} />
            <span className="field__hint">Lo que se pidió hacer, tal como lo dejó el docente.</span>
          </label>
          <label className="field">
            <span className="field__label">
              Descripción <span className="field__optional">opcional</span>
            </span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} />
            <span className="field__hint">
              De qué trata y cómo lo resolvieron. Para pegar código, enciérralo entre líneas con ```.
            </span>
          </label>
        </section>

        {others.length > 0 && (
          <section className="form__section">
            <h2>Con quién lo hiciste</h2>
            <p className="field__hint">
              Elige a tus coautores. El trabajo será uno solo y aparecerá en el perfil de cada quien.
            </p>
            <div className="chips" role="group" aria-label="Coautores">
              {others.map((m) => {
                const selected = coauthorIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="chip chip--person"
                    aria-pressed={selected}
                    onClick={() => toggleCoauthor(m.id)}
                  >
                    <Avatar member={m} size={22} />
                    {m.displayName}
                    {selected && <Icon name="check" size={16} />}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form__actions">
          <Link to="/m/tareas" className="button secondary">
            Cancelar
          </Link>
          <button type="submit">Publicar</button>
        </div>
      </form>
    </>
  );
}
