import { useState, type FormEvent } from 'react';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { WorkArchive } from '../components/WorkArchive';
import { useAction } from '../components/useAction';

const NEW = '__nueva__';

function PublishWorkForm({ onDone }: { onDone: () => void }) {
  const source = useDataSource();
  const { me, members, subjects, terms } = useSnapshot();
  const { error, run } = useAction();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? NEW);
  const [newSubject, setNewSubject] = useState('');
  const [termId, setTermId] = useState('');
  const [title, setTitle] = useState('');
  const [assignment, setAssignment] = useState('');
  const [description, setDescription] = useState('');
  const [coauthorIds, setCoauthorIds] = useState<string[]>([]);

  const subjectTerms = terms.filter((t) => t.subjectId === subjectId);
  const others = members.filter((m) => m.id !== me?.id && m.status === 'active');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ok = run(() => {
      const sid = subjectId === NEW ? source.createSubject(newSubject) : subjectId;
      source.publishWork({
        subjectId: sid,
        termId: termId || undefined,
        title,
        assignment,
        description,
        coauthorIds,
      });
      return true;
    });
    if (ok) onDone();
  };

  return (
    <form className="form card-surface" onSubmit={submit}>
      <h2>Publicar trabajo</h2>
      <label className="field">
        Materia
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
          <option value={NEW}>+ Nueva materia</option>
        </select>
      </label>
      {subjectId === NEW && (
        <label className="field">
          Nombre de la materia
          <input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} maxLength={120} />
        </label>
      )}
      {subjectId !== NEW && (
        <label className="field">
          Parcial o unidad
          <select value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="">Sin parcial</option>
            {subjectTerms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Título
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </label>
      <label className="field">
        Consigna
        <textarea value={assignment} onChange={(e) => setAssignment(e.target.value)} rows={2} />
      </label>
      <label className="field">
        Descripción
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </label>
      {others.length > 0 && (
        <fieldset className="field">
          <legend>Coautores</legend>
          {others.map((m) => (
            <label key={m.id} className="check">
              <input
                type="checkbox"
                checked={coauthorIds.includes(m.id)}
                onChange={(e) =>
                  setCoauthorIds((ids) =>
                    e.target.checked ? [...ids, m.id] : ids.filter((id) => id !== m.id),
                  )
                }
              />
              {m.displayName}
            </label>
          ))}
        </fieldset>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit">Publicar</button>
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function WorksPage() {
  const { works, subjects, terms, members } = useSnapshot();
  const [publishing, setPublishing] = useState(false);

  return (
    <>
      <div className="row row--between">
        <h1>Tareas y trabajos</h1>
        {!publishing && (
          <button type="button" onClick={() => setPublishing(true)}>
            Publicar trabajo
          </button>
        )}
      </div>
      <p className="muted">
        Trabajos del grupo por materia y parcial, con su consigna y sus autores.
      </p>
      {publishing && <PublishWorkForm onDone={() => setPublishing(false)} />}
      <WorkArchive
        works={works}
        subjects={subjects}
        terms={terms}
        members={members}
        empty="Todavía no hay trabajos publicados."
      />
    </>
  );
}
