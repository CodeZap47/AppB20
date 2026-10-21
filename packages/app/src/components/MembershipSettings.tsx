import { useState, type FormEvent } from 'react';
import { CURRICULUM } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { formatMediumDate } from '../lib/format';
import { useAction } from './useAction';
import { DemoDataSource } from '../data/demo';

/** Altas, bajas, invitaciones y plan de estudios. Solo lo ven los creadores de la app. */
export function MembershipSettings() {
  const { me } = useSnapshot();
  if (me?.status !== 'active' || !me.isCreator) return null;
  return (
    <>
      <InvitationsSection />
      <MembersSection />
      <CurriculumSection />
    </>
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
    <section>
      <h2>{simulated ? 'Invitaciones simuladas' : 'Invitaciones'}</h2>
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
        <label className="row">
          <input
            type="checkbox"
            checked={isCreator}
            onChange={(e) => setIsCreator(e.target.checked)}
          />
          Como creador (podrá invitar, dar de baja y cambiar el calendario)
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" disabled={pending || !email.trim()}>
            Invitar
          </button>
        </div>
      </form>
      {sorted.length > 0 && (
        <ul className="plain-list">
          {sorted.map((i) => (
            <li key={i.email} className="row row--between">
              <span>
                {i.email}
                {i.isCreator && ' · creador'}{' '}
                <span className="muted">desde el {formatMediumDate(i.createdAt)}</span>
              </span>
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  window.confirm(`¿Retirar la invitación de ${i.email}?`) &&
                  run(() => source.revokeInvitation(i.email))
                }
              >
                Retirar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MembersSection() {
  const source = useDataSource();
  const simulated = source instanceof DemoDataSource;
  const { me, members } = useSnapshot();
  const { error, run } = useAction();
  const active = members
    .filter((m) => m.status === 'active')
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <section>
      <h2>{simulated ? 'Integrantes simulados' : 'Integrantes'}</h2>
      <p className="muted">
        {simulated
          ? 'Dar de baja solo cambia este perfil de prueba; no afecta ninguna cuenta real.'
          : 'Dar de baja quita el acceso; lo que la persona publicó se conserva con su nombre.'}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="plain-list">
        {active.map((m) => (
          <li key={m.id} className="row row--between">
            <span>
              {m.displayName}
              {m.isCreator && <span className="muted"> · creador</span>}
            </span>
            {m.id !== me?.id && (
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  window.confirm(simulated
                    ? `¿Dar de baja a ${m.displayName} en esta simulación?`
                    : `¿Dar de baja a ${m.displayName}? Ya no podrá entrar.`) &&
                  run(() => source.removeMember(m.id))
                }
              >
                Dar de baja
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CurriculumSection() {
  const source = useDataSource();
  const { subjects } = useSnapshot();
  const { error, pending, run } = useAction();
  const codes = new Set(subjects.map((s) => s.code));
  const missing = CURRICULUM.filter((c) => !codes.has(c.code)).length;

  return (
    <section>
      <h2>Plan de estudios</h2>
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
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => source.importCurriculum())}
        >
          Cargar plan de estudios
        </button>
      )}
    </section>
  );
}
