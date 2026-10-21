import { useState, type FormEvent } from 'react';
import { CURRICULUM } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { formatMediumDate } from '../lib/format';
import { Avatar } from './Avatar';
import { useAction } from './useAction';
import { DemoDataSource } from '../data/demo';

/** Altas, bajas, invitaciones y plan de estudios. Solo lo ven los creadores de la app. */
export function MembershipSettings() {
  const { me } = useSnapshot();
  if (me?.status !== 'active' || !me.isCreator) return null;
  return (
    <>
      <AdminSummary />
      <InvitationsSection />
      <MembersSection />
      <CurriculumSection />
    </>
  );
}

function AdminSummary() {
  const { members, invitations, subjects } = useSnapshot();
  const active = members.filter((m) => m.status === 'active');
  const codes = new Set(subjects.map((s) => s.code));
  const loaded = CURRICULUM.filter((c) => codes.has(c.code)).length;
  return (
    <section className="panel settings" aria-label="Resumen del grupo">
      <dl className="facts settings-summary">
        <div><dt>Integrantes activos</dt><dd>{active.length}</dd></div>
        <div><dt>Administradores</dt><dd>{active.filter((m) => m.isCreator).length}</dd></div>
        <div><dt>Invitaciones pendientes</dt><dd>{invitations.length}</dd></div>
        <div><dt>Materias cargadas</dt><dd>{loaded} de {CURRICULUM.length}</dd></div>
      </dl>
    </section>
  );
}

function InvitationsSection() {
  const source = useDataSource();
  const simulated = source instanceof DemoDataSource;
  const { invitations } = useSnapshot();
  const { error, pending, run } = useAction();
  const [email, setEmail] = useState('');
  const [isCreator, setIsCreator] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => (await source.inviteMember(email, isCreator), true));
    if (ok) {
      setEmail('');
      setIsCreator(false);
    }
  };

  const sorted = [...invitations].sort((a, b) => a.email.localeCompare(b.email));
  return (
    <section className="panel settings" aria-labelledby="settings-invitations-title">
      <h2 id="settings-invitations-title">
        {simulated ? 'Invitaciones simuladas' : 'Invitaciones'}
        {sorted.length > 0 && <span className="chip__count">{sorted.length}</span>}
      </h2>
      <p className="muted">
        {simulated
          ? 'Este formulario modifica datos de prueba: no envía invitaciones ni controla quién puede iniciar sesión.'
          : 'Solo entran los correos de esta lista, verificados por SpacetimeAuth.'}
      </p>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Correo</span>
          <input
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alumno@ejemplo.mx"
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={isCreator}
            onChange={(e) => setIsCreator(e.target.checked)}
          />
          Invitar como administrador (podrá invitar, dar de baja y cambiar el calendario)
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form__actions">
          <button type="submit" disabled={pending || !email.trim()}>
            Invitar
          </button>
        </div>
      </form>
      {sorted.length > 0 ? (
        <ul className="plain-list">
          {sorted.map((i) => (
            <li key={i.email} className="row row--between">
              <span className="settings-person">
                <span className="settings-person__name">{i.email}</span>
                {i.isCreator && <span className="badge badge--admin">Administración</span>}
                <span className="field__hint">Invitado el {formatMediumDate(i.createdAt)}</span>
              </span>
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  window.confirm(`¿Retirar la invitación de ${i.email}? Ya no podrá unirse con ese correo.`) &&
                  run(() => source.revokeInvitation(i.email))
                }
              >
                Retirar
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field__hint">No hay invitaciones pendientes.</p>
      )}
    </section>
  );
}

function MembersSection() {
  const source = useDataSource();
  const simulated = source instanceof DemoDataSource;
  const { me, members } = useSnapshot();
  const { error, run } = useAction();
  const [query, setQuery] = useState('');
  const active = members
    .filter((m) => m.status === 'active')
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const needle = query.trim().toLocaleLowerCase('es-MX');
  const shown = needle ? active.filter((m) => m.displayName.toLocaleLowerCase('es-MX').includes(needle)) : active;

  return (
    <section className="panel settings" aria-labelledby="settings-members-title">
      <h2 id="settings-members-title">
        {simulated ? 'Integrantes simulados' : 'Integrantes'}
        <span className="chip__count">{active.length}</span>
      </h2>
      <p className="muted">
        {simulated
          ? 'Dar de baja solo cambia este perfil de prueba; no afecta ninguna cuenta real.'
          : 'Dar de baja quita el acceso; lo que la persona publicó se conserva con su nombre.'}
      </p>
      {active.length > 6 && (
        <label className="field">
          <span className="field__label">Buscar integrante</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre" />
        </label>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {shown.length ? (
        <ul className="plain-list">
          {shown.map((m) => (
            <li key={m.id} className="row row--between">
              <span className="settings-person">
                <Avatar member={m} size={28} />
                <span className="settings-person__name">{m.displayName}</span>
                {m.isCreator && <span className="badge badge--admin">Administración</span>}
                {m.id === me?.id && <span className="badge">Tú</span>}
              </span>
              {m.id !== me?.id && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    window.confirm(simulated
                      ? `¿Dar de baja a ${m.displayName} en esta simulación?`
                      : `¿Dar de baja a ${m.displayName}? Ya no podrá entrar; lo que publicó se conserva.`) &&
                    run(() => source.removeMember(m.id))
                  }
                >
                  Dar de baja
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="field__hint">Nadie coincide con «{query.trim()}».</p>
      )}
    </section>
  );
}

function CurriculumSection() {
  const source = useDataSource();
  const { subjects } = useSnapshot();
  const { error, pending, run } = useAction();
  const codes = new Set(subjects.map((s) => s.code));
  const loaded = CURRICULUM.filter((c) => codes.has(c.code)).length;
  const missing = CURRICULUM.length - loaded;

  return (
    <section className="panel settings" aria-labelledby="settings-curriculum-title">
      <h2 id="settings-curriculum-title">Plan de estudios</h2>
      <progress className="settings-progress" max={CURRICULUM.length} value={loaded} aria-label="Materias cargadas" />
      <p className="muted">
        {missing
          ? `Faltan ${missing} de las ${CURRICULUM.length} materias del plan. Cárgalas para que aparezcan en los formularios, cada una con sus tres parciales.`
          : `Las ${CURRICULUM.length} materias del plan ya están cargadas.`}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {missing > 0 && (
        <div className="form__actions">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => source.importCurriculum())}
          >
            Cargar plan de estudios
          </button>
        </div>
      )}
    </section>
  );
}
