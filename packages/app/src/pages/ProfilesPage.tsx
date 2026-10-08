import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { Avatar } from '../components/Avatar';
import { WorkArchive } from '../components/WorkArchive';
import { useAction } from '../components/useAction';
import { formatDayMonth } from '../lib/format';

export function ProfilesPage() {
  const { me, members, works } = useSnapshot();
  const active = members.filter((m) => m.status === 'active');

  return (
    <>
      <h1>Perfiles</h1>
      <ul className="cards">
        {active.map((m) => (
          <li key={m.id} className="card">
            <Link to={`/perfil/${m.id}`} className="profile-card">
              <Avatar member={m} size={48} />
              <span>
                <strong>{m.displayName}</strong>
                {m.id === me?.id && <span className="muted"> (tú)</span>}
                <br />
                <span className="muted">
                  {works.filter((w) => w.authorIds.includes(m.id)).length} trabajos
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function EditName({ current, onDone }: { current: string; onDone: () => void }) {
  const source = useDataSource();
  const [name, setName] = useState(current);
  const { error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => (source.updateProfile(name), true))) onDone();
  };
  return (
    <form className="row" onSubmit={submit}>
      <input aria-label="Nombre" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      <button type="submit">Guardar</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export function ProfilePage() {
  const { memberId = '' } = useParams();
  const source = useDataSource();
  const navigate = useNavigate();
  const { me, members, works, workFiles, subjects, terms, birthdays } = useSnapshot();
  const { error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const member = members.find((m) => m.id === memberId);

  if (!member) return <h1>Perfil no encontrado</h1>;

  const isMe = member.id === me?.id;
  const birthday = birthdays.find((b) => b.memberId === member.id);
  const ownWorks = works.filter((w) => w.authorIds.includes(member.id));

  return (
    <>
      <div className="profile-header">
        <Avatar member={member} size={72} />
        <div>
          {editing ? (
            <EditName current={member.displayName} onDone={() => setEditing(false)} />
          ) : (
            <h1>{member.displayName}</h1>
          )}
          <p className="muted">
            {member.isCreator ? 'Creador de la app · ' : ''}
            {birthday ? `Cumpleaños: ${formatDayMonth(birthday.day, birthday.month)}` : 'Sin cumpleaños compartido'}
          </p>
          <div className="row">
            {isMe && !editing && (
              <button type="button" className="secondary" onClick={() => setEditing(true)}>
                Editar nombre
              </button>
            )}
            {!isMe && (
              <button
                type="button"
                onClick={() => {
                  const id = run(() => source.openDirectConversation(member.id));
                  if (id) void navigate(`/m/mensajes/directos/${id}`);
                }}
              >
                Enviar mensaje
              </button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
      <h2>Trabajos</h2>
      <WorkArchive
        works={ownWorks}
        subjects={subjects}
        terms={terms}
        members={members}
        files={workFiles}
        meId={me?.id}
        empty="Sin trabajos publicados."
      />
    </>
  );
}
