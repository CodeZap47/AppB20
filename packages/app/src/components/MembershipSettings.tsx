import { useState, type FormEvent } from 'react';
import { CURRICULUM } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { formatMediumDate } from '../lib/format';
import { Avatar } from './Avatar';
import { useAction } from './useAction';
import { DemoDataSource } from '../data/demo';
import type { Invitation, InviteLink } from '../data/types';

const RESEND_INTERVAL_MS = 10 * 60_000;

/** Altas, bajas, invitaciones y plan de estudios. Solo lo ven los creadores de la app. */
export function MembershipSettings() {
  const { me } = useSnapshot();
  if (me?.status !== 'active' || !me.isCreator) return null;
  return (
    <>
      <AdminSummary />
      <InvitationsSection />
      <InviteLinksSection />
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
          : 'Su cuenta queda activada: al escribir su correo en B20 recibe un código y crea su contraseña. Solo entran los correos de esta lista.'}
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
                <span className="field__hint">
                  Invitado el {formatMediumDate(i.createdAt)}
                  {emailStatusText(i) && ` · ${emailStatusText(i)}`}
                </span>
              </span>
              <span className="row">
                {canResend(i) && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => run(() => source.resendInvitationEmail(i.email))}
                  >
                    Reenviar
                  </button>
                )}
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
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field__hint">No hay invitaciones pendientes.</p>
      )}
    </section>
  );
}

/** Un enlace que cualquiera puede usar con su propio correo; el código solo se muestra al crearlo. */
function InviteLinksSection() {
  const source = useDataSource();
  const simulated = source instanceof DemoDataSource;
  const { inviteLinks } = useSnapshot();
  const { error, pending, run } = useAction();
  const [days, setDays] = useState(7);
  const [uses, setUses] = useState(30);
  const [created, setCreated] = useState('');
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const url = await run(() => source.createInviteLink(days, uses));
    if (url) { setCreated(url); setCopied(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(created); setCopied(true); } catch { setCopied(false); }
  };

  const sorted = [...inviteLinks].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return (
    <section className="panel settings" aria-labelledby="settings-invite-links-title">
      <h2 id="settings-invite-links-title">{simulated ? 'Enlaces de invitación simulados' : 'Enlace de invitación'}</h2>
      <p className="muted">
        {simulated
          ? 'En la simulación el enlace se muestra, pero nadie puede entrar con él.'
          : 'Quien abra el enlace entra con cualquier correo: recibe un código en ese correo, crea su contraseña y se une como integrante. Compártelo solo con el grupo.'}
      </p>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Vence en</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>1 día</option>
            <option value={7}>7 días</option>
            <option value={30}>30 días</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Número de usos</span>
          <input type="number" min={1} max={100} required value={uses} onChange={(e) => setUses(Number(e.target.value))} />
          <span className="field__hint">Cada correo distinto gasta un uso. Máximo 100.</span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form__actions">
          <button type="submit" disabled={pending}>
            Crear enlace
          </button>
        </div>
      </form>
      {created && (
        <div className="notice" role="status">
          <p>Copia el enlace ahora: por seguridad no se vuelve a mostrar.</p>
          <input readOnly value={created} aria-label="Enlace de invitación" onFocus={(e) => e.target.select()} />
          <div className="form__actions">
            <button type="button" onClick={() => void copy()}>{copied ? 'Enlace copiado' : 'Copiar enlace'}</button>
          </div>
        </div>
      )}
      {sorted.length > 0 ? (
        <ul className="plain-list">
          {sorted.map((link) => (
            <li key={link.id} className="row row--between">
              <span className="settings-person">
                <span className="settings-person__name">{link.uses} de {link.maxUses} usos</span>
                <span className="field__hint">Creado el {formatMediumDate(link.createdAt)} · {inviteLinkStatus(link)}</span>
              </span>
              {!link.revokedAt && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    window.confirm('¿Revocar este enlace? Dejará de servir y se retirarán las invitaciones que nadie haya aceptado.') &&
                    run(() => source.revokeInviteLink(link.id))
                  }
                >
                  Revocar
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="field__hint">No hay enlaces creados.</p>
      )}
    </section>
  );
}

function inviteLinkStatus(link: InviteLink, now = Date.now()): string {
  if (link.revokedAt) return `Revocado el ${formatMediumDate(link.revokedAt)}`;
  if (link.expiresAt.getTime() <= now) return `Venció el ${formatMediumDate(link.expiresAt)}`;
  if (link.uses >= link.maxUses) return 'Sin usos disponibles';
  return `Vigente hasta el ${formatMediumDate(link.expiresAt)}`;
}

function emailStatusText(invitation: Invitation): string | undefined {
  switch (invitation.emailStatus) {
    case 'pending': return 'Enviando correo…';
    case 'sent': return invitation.emailSentAt ? `Correo enviado el ${formatMediumDate(invitation.emailSentAt)}` : 'Correo enviado';
    case 'failed': return 'No se pudo enviar el correo';
    default: return undefined;
  }
}

/** Igual que el servidor: un envío fallido se reintenta ya; uno exitoso, tras 10 minutos. */
function canResend(invitation: Invitation): boolean {
  if (invitation.emailStatus === 'failed') return true;
  return invitation.emailStatus === 'sent' && !!invitation.emailRequestedAt
    && Date.now() - invitation.emailRequestedAt.getTime() >= RESEND_INTERVAL_MS;
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
