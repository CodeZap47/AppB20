import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { SubjectSelect } from '../components/SubjectSelect';
import { useAction } from '../components/useAction';
import { formatTime, memberName } from '../lib/format';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function NewActivityForm({ onDone }: { onDone: () => void }) {
  const source = useDataSource();
  const navigate = useNavigate();
  const { subjects } = useSnapshot();
  const { error, run } = useAction();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '');
  const [topic, setTopic] = useState('');
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [instructions, setInstructions] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = run(() =>
      source.createActivity({ subjectId, topic, date, title, objective, instructions }),
    );
    if (id) {
      onDone();
      void navigate(`/m/actividades/${id}`);
    }
  };

  if (!subjects.length) {
    return <p className="placeholder">Primero crea una materia publicando un trabajo.</p>;
  }

  return (
    <form className="form card-surface" onSubmit={submit}>
      <h2>Registrar actividad</h2>
      <div className="row">
        <SubjectSelect subjects={subjects} value={subjectId} onChange={setSubjectId} />
        <label className="field">
          Fecha
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      </div>
      <label className="field">
        Título
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </label>
      <label className="field">
        Tema
        <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} />
      </label>
      <label className="field">
        Objetivo
        <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} />
      </label>
      <label className="field">
        Instrucciones
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit">Registrar</button>
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function ActivitiesPage() {
  const { activities, subjects, evidences } = useSnapshot();
  const [creating, setCreating] = useState(false);
  const [subjectId, setSubjectId] = useState('');
  const shown = activities
    .filter((a) => !subjectId || a.subjectId === subjectId)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <div className="row row--between">
        <h1>Actividades de clase</h1>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)}>
            Registrar actividad
          </button>
        )}
      </div>
      <p className="muted">
        Lo que se hizo en clase y las evidencias de cada equipo. Las tareas por entregar van en
        Tareas y Actividades.
      </p>
      {creating && <NewActivityForm onDone={() => setCreating(false)} />}
      <SubjectSelect subjects={subjects} value={subjectId} onChange={setSubjectId} allowAll />
      {shown.length ? (
        <ul className="list">
          {shown.map((a) => (
            <li key={a.id}>
              <Link to={`/m/actividades/${a.id}`} className="list__item">
                <strong>{a.title}</strong>
                <span className="muted">
                  {subjects.find((s) => s.id === a.subjectId)?.name} · {a.date}
                  {a.topic ? ` · ${a.topic}` : ''} ·{' '}
                  {evidences.filter((e) => e.activityId === a.id).length} evidencias
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No hay actividades registradas.</p>
      )}
    </>
  );
}

function EvidenceForm({ activityId }: { activityId: string }) {
  const source = useDataSource();
  const { me, members } = useSnapshot();
  const { error, run } = useAction();
  const [content, setContent] = useState('');
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const others = members.filter((m) => m.id !== me?.id && m.status === 'active');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => source.addEvidence(activityId, content, participantIds))) {
      setContent('');
      setParticipantIds([]);
    }
  };

  return (
    <form className="form card-surface" onSubmit={submit}>
      <h2>Agregar evidencia</h2>
      <p className="muted">
        Código, observaciones o resultados. Pide permiso antes de compartir imágenes o datos de
        compañeros.
      </p>
      <textarea
        aria-label="Evidencia"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={5}
        className="mono"
      />
      {others.length > 0 && (
        <fieldset className="field">
          <legend>Equipo</legend>
          {others.map((m) => (
            <label key={m.id} className="check">
              <input
                type="checkbox"
                checked={participantIds.includes(m.id)}
                onChange={(e) =>
                  setParticipantIds((ids) =>
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
        <button type="submit" disabled={!content.trim()}>
          Agregar
        </button>
      </div>
    </form>
  );
}

export function ActivityPage() {
  const { activityId = '' } = useParams();
  const { activities, evidences, members, subjects } = useSnapshot();
  const activity = activities.find((a) => a.id === activityId);
  if (!activity) return <h1>Actividad no encontrada</h1>;
  const own = evidences.filter((e) => e.activityId === activity.id);

  return (
    <>
      <Link to="/m/actividades" className="back">
        ← Actividades
      </Link>
      <h1>{activity.title}</h1>
      <p className="muted">
        {subjects.find((s) => s.id === activity.subjectId)?.name} · {activity.date}
        {activity.topic ? ` · ${activity.topic}` : ''} · registró{' '}
        {memberName(members, activity.createdBy)}
      </p>
      {activity.objective && (
        <>
          <h3>Objetivo</h3>
          <p className="prewrap">{activity.objective}</p>
        </>
      )}
      {activity.instructions && (
        <>
          <h3>Instrucciones</h3>
          <p className="prewrap">{activity.instructions}</p>
        </>
      )}
      <h2>Evidencias ({own.length})</h2>
      {own.length ? (
        <ul className="list">
          {own.map((e) => (
            <li key={e.id} className="list__item">
              <span className="muted">
                {e.participantIds.map((id) => memberName(members, id)).join(', ')} ·{' '}
                {formatTime(e.createdAt)}
              </span>
              <pre className="mono prewrap">{e.content}</pre>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Todavía no hay evidencias.</p>
      )}
      <EvidenceForm activityId={activity.id} />
    </>
  );
}
