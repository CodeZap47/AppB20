import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { AdminContentEntry, AdminMember, AdminMembershipSnapshot, InvitationLink, InvitationLinkInput, LegacyInvitationLink } from '../data/membershipTypes';
import { CONTENT_KIND_LABELS, contentImpactSignature } from '../data/membershipTypes';
import { formatTime, initials } from '../lib/format';
import { Icon } from './Icon';
import { useAction } from './useAction';
import './membership.css';
import { clearAdminAccessDraft, readAdminAccessDraft, writeAdminAccessDraft, type AdminAccessDraft } from '../data/adminAccessDraft';

const at = (value: number | null) => value === null ? 'Sin vencimiento' : formatTime(new Date(value));
const linkState = (link: Pick<InvitationLink, 'status' | 'expiresAt'>) => link.status === 'active' && link.expiresAt !== null && link.expiresAt <= Date.now() ? 'expired' : link.status;
const stateName = (status: string) => ({ active: 'Activo', inactive: 'Desactivado', disabled: 'Desactivado', revoked: 'Desactivado', expired: 'Vencido', exhausted: 'Cupo agotado', removed: 'Dado de baja', blocked: 'Bloqueado' })[status] ?? status;
const originName = (origin: string) => origin === 'link' || origin === 'invitation_link' ? 'Enlace de invitación' : ['direct', 'email', 'individual'].includes(origin) ? 'Invitación individual' : 'Origen desconocido';
const localDate = (value: number) => { const date = new Date(value); return new Date(value - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
type DialogState = { type: 'create' } | { type: 'configure' | 'revoke' | 'people'; link: InvitationLink } | { type: 'legacy-revoke'; link: LegacyInvitationLink } | { type: 'member' | 'history' | 'content'; member: AdminMember } | { type: 'block' } | { type: 'resume'; draft: AdminAccessDraft };

function AdminModal({ title, children, close, busy = false }: { title: string; children: ReactNode; close(): void; busy?: boolean }) {
  return <ModalOverlay isOpen isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) close(); }} className="membership-overlay settings-admin-modal">
    <Modal className="membership-modal"><Dialog aria-label={title} className="membership-dialog">
      <div className="row row--between admin-dialog-heading"><h2>{title}</h2><button type="button" className="secondary" disabled={busy} aria-label="Cerrar diálogo" onClick={close}><Icon name="close" size={16} />Cerrar</button></div>
      {children}
    </Dialog></Modal>
  </ModalOverlay>;
}

/** El estado administrativo se solicita expresamente; nunca se mezcla con perfiles públicos. */
export function MembershipManagement() {
  const source = useDataSource();
  const snapshot = useSnapshot();
  const [data, setData] = useState<AdminMembershipSnapshot>();
  const [loadError, setLoadError] = useState('');
  const [dialog, setDialog] = useState<DialogState>();
  const [tab, setTab] = useState('active');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState('');
  const [resume, setResume] = useState(() => snapshot.me ? readAdminAccessDraft(snapshot.me.id) : undefined);
  const { error, pending, run } = useAction();
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const value = await source.getAdminMembership();
    if (mounted.current) { setData(value); setLoadError(''); }
  }, [source]);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((failure: unknown) => { if (mounted.current) setLoadError(failure instanceof Error ? failure.message : 'No se pudo cargar Administración.'); });
    return () => { mounted.current = false; };
  }, [refresh, snapshot.members, snapshot.invitations]);
  const close = () => { setDialog(undefined); setResume(snapshot.me ? readAdminAccessDraft(snapshot.me.id) : undefined); };
  const changed = async () => { await refresh(); };
  const copy = async (link: InvitationLink) => {
    const url = await run(() => source.copyInvitationLink(link.id));
    if (!url) return;
    setCopied(url);
    // El permiso del portapapeles puede quedar pendiente en una pestaña sin foco.
    // El campo seleccionable sigue disponible sin bloquear otras acciones administrativas.
    if (navigator.clipboard) void navigator.clipboard.writeText(url).catch(() => {});
  };
  if (!data) return <section className="panel settings admin-surface admin-loading" aria-label="Gestión de accesos"><p role="status">{loadError || 'Cargando enlaces e integrantes…'}</p>{loadError && <button onClick={() => void run(refresh)}>Reintentar</button>}</section>;
  const needle = query.trim().toLocaleLowerCase('es-MX');
  const matches = (member: AdminMember) => `${member.displayName} ${member.email ?? ''} ${member.emails.join(' ')}`.toLocaleLowerCase('es-MX').includes(needle);
  const blocked = new Set(data.blockedEmails.map((row) => row.email));
  const members = data.members.filter((member) => matches(member) && (tab === 'blocked' ? member.status === 'blocked' || member.emails.some((email) => blocked.has(email)) : tab === 'removed' ? member.status === 'removed' && !member.emails.some((email) => blocked.has(email)) : member.status === 'active'));
  return <>
    {resume && <section className="panel settings admin-surface admin-resume" aria-label="Operación pendiente"><p>Hay una operación administrativa pendiente en esta pestaña. Los cambios ya confirmados se conservan.</p><div className="row"><button type="button" onClick={() => setDialog({ type: 'resume', draft: resume })}>Retomar operación pendiente</button><button type="button" className="secondary" onClick={() => { if (snapshot.me) clearAdminAccessDraft(snapshot.me.id); setResume(undefined); }}>Descartar seguimiento</button></div></section>}
    <section className="panel settings admin-surface admin-links" aria-labelledby="admin-links-title">
      <div className="row row--between admin-panel-header"><div className="admin-panel-heading"><span className="settings-card-icon"><Icon name="copy" size={21} /></span><h2 id="admin-links-title">Enlaces de invitación</h2></div><button type="button" onClick={() => setDialog({ type: 'create' })}><Icon name="plus" size={16} />Crear enlace</button></div>
      <p className="muted">Cualquier persona con un correo verificado podrá entrar como integrante mientras el enlace esté vigente. Desactivarlo conserva los accesos existentes.</p>
      {!data.links.length && <div className="admin-empty"><Icon name="copy" size={25} /><p>No hay enlaces de invitación.</p><span>Crea uno para que tus compañeros puedan incorporarse al grupo.</span></div>}
      <ul className="plain-list">{data.links.map((link) => <li key={link.id} className="membership-link">
        <div><strong>{link.name}</strong> <span className={`badge admin-link-state admin-link-state--${linkState(link)}`}>{stateName(linkState(link))}</span><p className="field__hint">Creado {at(link.createdAt)} · {link.expiresAt === null ? 'Sin vencimiento' : `Vence ${at(link.expiresAt)}`} · {link.uses}{link.maxUses === null ? ' incorporaciones, sin límite' : ` de ${link.maxUses} incorporaciones`}</p></div>
        <div className="row membership-actions">
          <button type="button" className="secondary" disabled={pending || linkState(link) !== 'active'} onClick={() => void copy(link)}>Copiar</button>
          <button type="button" className="secondary" onClick={() => setDialog({ type: 'people', link })}>Ver integrantes</button>
          <button type="button" className="secondary" disabled={linkState(link) !== 'active'} onClick={() => setDialog({ type: 'configure', link })}>Configurar</button>
          <button type="button" className="secondary" disabled={linkState(link) !== 'active'} onClick={() => setDialog({ type: 'revoke', link })}>Revocar</button>
        </div>
      </li>)}</ul>
      {copied && <label className="field">Enlace listo para copiar<input readOnly aria-label="Enlace listo para copiar" value={copied} onFocus={(event) => event.target.select()} /></label>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    {Boolean(data.legacyLinks?.length) && <section className="panel settings admin-surface admin-legacy" aria-labelledby="admin-legacy-links-title">
      <div className="row row--between admin-panel-header"><div className="admin-panel-heading"><span className="settings-card-icon"><Icon name="file" size={21} /></span><h2 id="admin-legacy-links-title">Enlaces anteriores</h2></div><button type="button" onClick={() => setDialog({ type: 'create' })}>Crear enlace nuevo</button></div>
      <p className="muted">Estos enlaces conservan su estado y sus usos. El sistema anterior solo guardaba una huella del enlace: su copia no está disponible. Para compartir otro, crea uno nuevo y desactiva el anterior si ya no debe admitir incorporaciones.</p>
      <p className="field__hint">Las incorporaciones anteriores sin una relación comprobable conservan «Origen desconocido».</p>
      <ul className="plain-list">{data.legacyLinks?.map((link) => <li key={link.id} className="membership-link">
        <div><strong>{link.name}</strong> <span className={`badge admin-link-state admin-link-state--${linkState(link)}`}>{stateName(linkState(link))}</span><p className="field__hint">ID {link.id} · Creado {at(link.createdAt)} · Vence {at(link.expiresAt)} · {link.usedCount} de {link.maxUses} usos</p></div>
        <button type="button" className="secondary" disabled={pending || linkState(link) !== 'active'} aria-label={`Desactivar ${link.name}`} onClick={() => setDialog({ type: 'legacy-revoke', link })}>Desactivar</button>
      </li>)}</ul>
    </section>}
    <section className="panel settings admin-surface admin-people" aria-labelledby="admin-people-title">
      <div className="row row--between admin-panel-header"><div className="admin-panel-heading"><span className="settings-card-icon"><Icon name="users" size={21} /></span><h2 id="admin-people-title">Integrantes y correos</h2></div><button type="button" className="secondary" onClick={() => setDialog({ type: 'block' })}>Bloquear correo</button></div>
      <div className="segmented membership-tabs" role="group" aria-label="Estado de integrantes">{[['active', 'Activos'], ['pending', 'Invitaciones pendientes'], ['removed', 'Dados de baja'], ['blocked', 'Correos bloqueados']].map(([value, label]) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value!)}>{label}</button>)}</div>
      <label className="field">Buscar por nombre o correo<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {tab === 'pending' ? <ul className="plain-list">{snapshot.invitations.filter((row) => row.email.includes(needle)).map((row) => <li key={row.email} className="membership-link"><span>{row.email} {row.isCreator && <span className="badge">Administración</span>}</span><button className="secondary" disabled={pending} onClick={() => void run(async () => { await source.revokeInvitation(row.email); await changed(); })}>Cancelar invitación</button></li>)}</ul> : <>
        <ul className="plain-list">{members.map((member) => <li key={member.identity} className="membership-link">
          <div className="admin-member-identity"><span className="admin-member-initials" aria-hidden="true">{initials(member.displayName)}</span><div><strong>{member.displayName}</strong> {member.isCreator && <span className="badge">Administración</span>}<p className="field__hint">{member.email ?? 'Correo pendiente de vincular'} · {originName(member.origin)}</p></div></div>
          <div className="row membership-actions"><button type="button" className="secondary" onClick={() => setDialog({ type: 'history', member })}>Historial</button>
            <button type="button" className="secondary" onClick={() => setDialog({ type: 'content', member })}>Gestionar aportes</button>
            {member.status === 'active' && member.identity !== snapshot.me?.id && <button type="button" className="secondary" onClick={() => setDialog({ type: 'member', member })}>Gestionar acceso</button>}
            {member.status === 'removed' && member.email && !blocked.has(member.email) && <button type="button" className="secondary" disabled={pending} onClick={() => void run(async () => { await source.inviteMember(member.email!, false); await changed(); })}>Reinvitar</button>}
          </div>
        </li>)}</ul>
        {tab === 'blocked' && <ul className="plain-list">{data.blockedEmails.filter((row) => row.email.includes(needle)).map((row) => <li key={row.email} className="membership-link"><div><strong>{row.email}</strong><p className="field__hint">Bloqueado {at(row.blockedAt)} · {row.reason}</p></div><button type="button" className="secondary" disabled={pending} onClick={() => void run(async () => { await source.unblockEmail(row.email, crypto.randomUUID()); await changed(); })}>Desbloquear</button></li>)}</ul>}
        {!members.length && tab !== 'blocked' && <div className="admin-empty admin-empty--compact"><Icon name="search" size={24} /><p>No hay integrantes con estos filtros.</p><span>Prueba otro nombre, correo o estado.</span></div>}
      </>}
      <p className="field__hint">La baja permite regresar mediante una nueva invitación individual. Desbloquear un correo permite reinvitarlo, sin restaurar el acceso ni sus autorizaciones anteriores.</p>
    </section>
    {dialog?.type === 'create' && <LinkEditor close={close} changed={changed} />}
    {dialog?.type === 'configure' && <LinkEditor link={dialog.link} close={close} changed={changed} />}
    {dialog?.type === 'revoke' && <AccessWizard link={dialog.link} data={data} close={close} changed={changed} />}
    {dialog?.type === 'legacy-revoke' && <LegacyLinkRevokeDialog link={dialog.link} close={close} changed={changed} />}
    {dialog?.type === 'member' && <AccessWizard member={dialog.member} data={data} close={close} changed={changed} />}
    {dialog?.type === 'content' && <AccessWizard member={dialog.member} contentOnly data={data} close={close} changed={changed} />}
    {dialog?.type === 'resume' && <AccessWizard draft={dialog.draft} data={data} close={close} changed={changed} />}
    {dialog?.type === 'block' && <BlockEmailDialog close={close} changed={changed} />}
    {dialog?.type === 'people' && <AdminModal title={`Integrantes de ${dialog.link.name}`} close={close}>
      <p>El historial no cambia si una persona vuelve mediante otra invitación.</p>
      <ul className="plain-list">{data.admissions.filter((row) => row.sourceId === dialog.link.id).map((row) => { const person = data.members.find((item) => item.identity === row.memberIdentity); return <li key={row.id}>{person?.displayName ?? 'Integrante'} · {at(row.joinedAt)} · {person?.invitationLinkId === dialog.link.id && person.generation === row.generation ? stateName(person.status) : 'Acceso histórico'}</li>; })}</ul>
    </AdminModal>}
    {dialog?.type === 'history' && <AdminModal title={`Historial de ${dialog.member.displayName}`} close={close}>
      <p>{dialog.member.email ?? 'Correo pendiente de vincular'} · {stateName(dialog.member.status)} · {originName(dialog.member.origin)}</p>
      <ul className="plain-list">{data.events.filter((row) => row.memberIdentity === dialog.member.identity || row.email && dialog.member.emails.includes(row.email)).map((row) => <li key={row.id}>{at(row.at)} · {({ join: 'Ingreso', remove: 'Baja', block: 'Bloqueo', unblock: 'Desbloqueo', invite: 'Invitación' })[row.action] ?? row.action}{row.reason && ` · ${row.reason}`}</li>)}</ul>
      <p className="field__hint">Los registros anteriores sin origen comprobable se conservan como desconocidos.</p>
    </AdminModal>}
  </>;
}

function LegacyLinkRevokeDialog({ link, close, changed }: { link: LegacyInvitationLink; close(): void; changed(): Promise<void> }) {
  const source = useDataSource();
  const { error, pending, run } = useAction();
  return <AdminModal title="Desactivar enlace anterior" close={close} busy={pending}>
    <p>Se desactivará <strong>{link.name}</strong> (ID {link.id}) para impedir nuevas incorporaciones.</p>
    <p>Quienes ya ingresaron conservarán el acceso y todos sus aportes. Puedes gestionar a cada persona desde «Integrantes y correos».</p>
    <button type="button" disabled={pending} onClick={() => void run(async () => { await source.revokeLegacyInvitationLink(link.id); await changed(); close(); })}>Desactivar este enlace</button>
    {error && <p className="error" role="alert">{error}</p>}
  </AdminModal>;
}

function LinkEditor({ link, close, changed }: { link?: InvitationLink; close(): void; changed(): Promise<void> }) {
  const source = useDataSource();
  const [name, setName] = useState(link?.name ?? 'Invitación al grupo');
  const [never, setNever] = useState(link?.expiresAt === null);
  const [expiry, setExpiry] = useState(localDate(link?.expiresAt ?? Date.now() + 7 * 86_400_000));
  const [max, setMax] = useState(link?.maxUses?.toString() ?? '');
  const [requestId] = useState(() => crypto.randomUUID());
  const [attempt, setAttempt] = useState<InvitationLinkInput & { expiresAt: number | null; maxUses: number | null }>();
  const [url, setUrl] = useState('');
  const { error, pending, run } = useAction();
  return <AdminModal title={link ? 'Configurar enlace' : 'Crear enlace de invitación'} close={close} busy={pending}>
    {url ? <><p role="status">Enlace creado. Podrás volver a copiarlo desde Administración.</p><label className="field">Enlace<input readOnly value={url} onFocus={(event) => event.target.select()} /></label><button onClick={close}>Terminar</button></> : <form className="form" onSubmit={(event) => { event.preventDefault(); if (pending) return; void run(async () => {
      const input = attempt ?? { requestId, name: name.trim(), expiresAt: never ? null : new Date(expiry).getTime(), maxUses: max ? Number(max) : null };
      if (input.expiresAt !== null && (typeof input.expiresAt !== 'number' || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now())) throw new Error('Elige una fecha de vencimiento futura.');
      if (input.maxUses !== null && (!Number.isInteger(input.maxUses) || input.maxUses! < 1 || input.maxUses! > 1_000_000)) throw new Error('El cupo debe ser un entero entre 1 y 1 000 000.');
      setAttempt(input);
      if (link) { await source.configureInvitationLink({ ...input, id: link.id, expectedVersion: link.version }); await changed(); close(); }
      else { const result = await source.createInvitationLink(input); setUrl(result.url); await changed(); }
    }); }}>
      <label className="field">Nombre<input required disabled={pending || Boolean(attempt)} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="check"><input type="checkbox" disabled={pending || Boolean(attempt)} checked={never} onChange={(event) => setNever(event.target.checked)} />Sin vencimiento</label>
      {!never && <label className="field">Fecha y hora de vencimiento<input type="datetime-local" disabled={pending || Boolean(attempt)} required value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label>}
      <label className="field">Máximo de incorporaciones (opcional)<input type="number" disabled={pending || Boolean(attempt)} min={Math.max(1, link?.uses ?? 1)} max={1000000} step="1" value={max} onChange={(event) => setMax(event.target.value)} placeholder="Sin límite" /></label>
      {attempt && <p className="field__hint">Se conservan los datos de este intento para que un reintento no duplique el enlace. Puedes consultar la lista antes de iniciar otra operación.</p>}
      <p>El enlace concede acceso de integrante a cualquier correo verificado. Las bajas y bloqueos existentes siguen aplicándose.</p>
      <button type="submit" disabled={pending || !name.trim()}>{pending ? 'Guardando…' : link ? 'Guardar configuración' : 'Crear enlace'}</button>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </AdminModal>;
}

function BlockEmailDialog({ close, changed }: { close(): void; changed(): Promise<void> }) {
  const source = useDataSource();
  const [email, setEmail] = useState(''); const [reason, setReason] = useState(''); const [operationId] = useState(() => crypto.randomUUID());
  const [attempt, setAttempt] = useState<{ email: string; reason: string }>();
  const { error, pending, run } = useAction();
  return <AdminModal title="Bloquear correo" close={close} busy={pending}><form className="form" onSubmit={(event) => { event.preventDefault(); if (!pending) void run(async () => { const input = attempt ?? { email: email.trim(), reason: reason.trim() }; setAttempt(input); await source.blockEmail(input.email, input.reason, operationId); await changed(); close(); }); }}>
    <p>Impedirá el acceso y nuevas invitaciones. Sus aportes compartidos y datos privados se conservarán.</p>
    <label className="field">Correo<input type="email" disabled={pending || Boolean(attempt)} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label className="field">Motivo<textarea required disabled={pending || Boolean(attempt)} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    <button disabled={pending || !email.trim() || !reason.trim()}>Confirmar bloqueo</button>{error && <p role="alert" className="error">{error}</p>}
  </form></AdminModal>;
}

function AccessWizard({ link: suppliedLink, member, draft, contentOnly: suppliedContentOnly, data, close, changed }: { link?: InvitationLink; member?: AdminMember; draft?: AdminAccessDraft; contentOnly?: boolean; data: AdminMembershipSnapshot; close(): void; changed(): Promise<void> }) {
  const source = useDataSource(); const snapshot = useSnapshot();
  const link = suppliedLink ?? draft?.link;
  const contentOnly = suppliedContentOnly || draft?.mode === 'content';
  const [mode, setMode] = useState(draft?.mode ?? (contentOnly ? 'content' : 'link')); const [step, setStep] = useState(draft ? 3 : contentOnly ? 2 : link ? 0 : 1);
  const [people, setPeople] = useState<string[]>(draft?.subjects ?? draft?.people.map((row) => row.identity) ?? (member ? [member.identity] : [])); const [query, setQuery] = useState('');
  const [access, setAccess] = useState<'remove' | 'block'>(draft?.action ?? 'remove'); const [reason, setReason] = useState(draft?.reason ?? '');
  const [policy, setPolicy] = useState(draft?.policy ?? 'keep'); const [content, setContent] = useState<string[]>(draft?.content.map((row) => `${row.kind}:${row.targetId}`) ?? []); const [ack, setAck] = useState<string[]>(draft?.acknowledge ?? []);
  const [operationId] = useState(() => draft?.operationId ?? crypto.randomUUID()); const [contentOperationId, setContentOperationId] = useState(draft?.contentOperationId ?? operationId); const [revoked, setRevoked] = useState(draft?.revoked ?? false); const [newUrl, setNewUrl] = useState('');
  const accessOperations = useRef(new Map<string, string>(Object.entries(draft?.accessOperations ?? {})));
  const [review, setReview] = useState<{ selected: AdminMember[]; picked: AdminContentEntry[] } | undefined>(() => draft ? {
    selected: draft.people.map((row) => ({ ...(data.members.find((item) => item.identity === row.identity) ?? { identity: row.identity, displayName: 'Integrante', status: 'removed', isCreator: false, email: null, emails: [], origin: 'unknown', invitationLinkId: null, joinedAt: 0, removedAt: null }), generation: row.generation })),
    picked: draft.content.map((row) => ({ ...(snapshot.adminContentEntries?.find((item) => item.kind === row.kind && item.targetId === row.targetId) ?? { ownerIds: draft.people.map((item) => item.identity), title: 'Aporte seleccionado', withdrawn: true }), ...row })),
  } : undefined);
  const [results, setResults] = useState<Record<string, { ok: boolean; skipped: boolean; text: string }>>({}); const [executed, setExecuted] = useState(false);
  const { error, pending, run } = useAction(); const running = useRef(false);
  const candidates = member ? [member] : !link && draft ? data.members.filter((row) => people.includes(row.identity)) : data.members.filter((row) => row.status === 'active' && row.invitationLinkId === link?.id && !row.isCreator && row.identity !== snapshot.me?.id);
  const selected = candidates.filter((row) => people.includes(row.identity));
  const entries = (snapshot.adminContentEntries ?? []).filter((row) => !row.withdrawn && row.ownerIds.some((id) => people.includes(id)));
  const keyOf = (entry: AdminContentEntry) => `${entry.kind}:${entry.targetId}`;
  const picked = policy === 'withdraw' ? entries.filter((row) => content.includes(keyOf(row))) : [];
  const toggle = (list: string[], value: string) => list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  const impact = (entry: AdminContentEntry) => [entry.collaborative && 'Tiene coautores', entry.foreignDependencies > 0 && `${entry.foreignDependencies} aportes dependientes de otras personas`, entry.sharedFiles > 0 && `${entry.sharedFiles} archivos reutilizados`, entry.reportReferences > 0 && `${entry.reportReferences} referencias en reportes`].filter(Boolean).join(' · ');
  const process = async () => {
    if (running.current) return;
    running.current = true;
    try { await run(async () => {
      const selectedPeople = review?.selected ?? selected; const selectedContent = review?.picked ?? picked;
      for (const person of selectedPeople) if (!accessOperations.current.has(person.identity)) accessOperations.current.set(person.identity, crypto.randomUUID());
      const saveDraft = (linkRevoked: boolean) => {
        if (!snapshot.me) return;
        writeAdminAccessDraft({ actor: snapshot.me.id, operationId, contentOperationId, expiresAt: Date.now() + 86_400_000, mode, link, revoked: linkRevoked, action: access, reason, policy,
          people: selectedPeople.map(({ identity, generation }) => ({ identity, generation })), subjects: people, content: selectedContent.map(({ kind, targetId, version, collaborative, foreignDependencies, sharedFiles, reportReferences, safeForBulk }) => ({ kind, targetId, version, collaborative, foreignDependencies, sharedFiles, reportReferences, safeForBulk })), acknowledge: ack, accessOperations: Object.fromEntries(accessOperations.current) });
      };
      saveDraft(revoked);
      const currentTargets = new Set([...(link ? ['link'] : []), ...selectedPeople.map((row) => `person:${row.identity}`), ...selectedContent.map(keyOf)]);
      // Conservar recibos confirmados; una revisión nueva puede descartar decisiones fallidas.
      const outcomes = Object.fromEntries(Object.entries(results).filter(([key, result]) => result.ok || result.skipped || currentTargets.has(key)));
      setResults(outcomes);
      const mark = (id: string, ok: boolean, text: string, skipped = false) => { outcomes[id] = { ok, skipped, text }; setResults({ ...outcomes }); };
      if (link && !revoked) {
        if (mode === 'replace') {
          const input: InvitationLinkInput = { requestId: operationId, name: link.name, expiresAt: link.expiresAt === null ? null : undefined, maxUses: link.maxUses };
          const replacement = await source.replaceInvitationLink(link.id, input); setNewUrl(replacement.url);
        } else await source.revokeInvitationLink(link.id, link.version);
        setRevoked(true); mark('link', true, mode === 'replace' ? 'Enlace anterior desactivado y nuevo enlace creado.' : 'Enlace desactivado.');
        saveDraft(true);
      }
      if (!link || mode === 'manage') {
        for (const person of selectedPeople) {
          const key = `person:${person.identity}`; if (outcomes[key]?.ok || outcomes[key]?.skipped) continue;
          let accessOperationId = accessOperations.current.get(person.identity);
          if (!accessOperationId) { accessOperationId = crypto.randomUUID(); accessOperations.current.set(person.identity, accessOperationId); }
          try { const result = await source.manageMemberAccess({ operationId: accessOperationId, identity: person.identity, generation: person.generation, action: access, reason, bulk: Boolean(link), invitationLinkId: link?.id }); mark(key, result.status === 'applied', `${person.displayName}: ${result.message || (access === 'block' ? 'correo bloqueado' : 'acceso dado de baja')}`, result.status === 'skipped'); }
          catch (failure) { mark(key, false, `${person.displayName}: ${failure instanceof Error ? failure.message : 'No se pudo gestionar el acceso.'}`); }
        }
        for (const entry of selectedContent) {
          const key = keyOf(entry); if (outcomes[key]?.ok || outcomes[key]?.skipped) continue;
          const skippedOwner = entry.ownerIds.some((id) => people.includes(id) && outcomes[`person:${id}`]?.skipped);
          if (!contentOnly && entry.ownerIds.some((id) => people.includes(id) && !outcomes[`person:${id}`]?.ok)) { mark(key, false, `${entry.title}: primero debe confirmarse la baja o bloqueo seleccionado.`, skippedOwner); continue; }
          try { await source.moderateContentItem({ operationId: contentOperationId, kind: entry.kind, targetId: entry.targetId, expectedVersion: entry.version, withdrawn: true, reason, acknowledgeImpact: ack.includes(key), expectedImpact: contentImpactSignature(entry) }); mark(key, true, `${entry.title}: enviado a Papelera.`); }
          catch (failure) { mark(key, false, `${entry.title}: ${failure instanceof Error ? failure.message : 'No se pudo retirar.'}`); }
        }
      }
      if (snapshot.me && Object.values(outcomes).every((row) => row.ok || row.skipped)) clearAdminAccessDraft(snapshot.me.id);
      setExecuted(true); await changed();
    }); } finally { running.current = false; }
  };
  const next = () => { const nextStep = step === 0 && mode !== 'manage' ? 3 : step + 1; if (nextStep === 3) setReview({ selected: !contentOnly && (mode === 'manage' || !link) ? selected : [], picked: mode === 'manage' || !link ? picked : [] }); setStep(nextStep); };
  return <AdminModal title={link ? `Revocar: ${link.name}` : `${contentOnly ? 'Aportes de' : 'Gestionar a'} ${member?.displayName ?? review?.selected[0]?.displayName ?? 'integrantes'}`} close={close} busy={pending}>
    {!executed && <p className="field__hint">{['Acción sobre el enlace', 'Integrantes y acceso', 'Destino del contenido', 'Revisión final'][step]}</p>}
    {step === 0 && <div className="form">{[['link', 'Desactivar solo este enlace', 'Las personas que ya entraron conservarán su acceso y sus aportes.'], ['replace', 'Desactivar y generar otro enlace', 'El anterior dejará de funcionar. El nuevo conservará el cupo configurado y tendrá una nueva vigencia.'], ['manage', 'Desactivar y gestionar integrantes', 'Elige a quién dar de baja o bloquear y qué hacer con sus aportes.']].map(([value, label, detail]) => <label className="membership-choice" key={value}><input type="radio" name="revoke-mode" checked={mode === value} onChange={() => setMode(value!)} /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div>}
    {step === 1 && <div className="form">
      {link && <><p>Solo se pueden seleccionar accesos actuales concedidos por este enlace. Los administradores y tu cuenta están excluidos.</p><label className="field">Buscar integrante<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button type="button" className="secondary" onClick={() => setPeople(candidates.map((row) => row.identity))}>Seleccionar todos ({candidates.length})</button><button type="button" className="secondary" onClick={() => setPeople([])}>Quitar selección</button><div className="membership-scroll">{candidates.filter((row) => `${row.displayName} ${row.email ?? ''}`.toLowerCase().includes(query.toLowerCase())).map((row) => <label className="check" key={row.identity}><input type="checkbox" checked={people.includes(row.identity)} onChange={() => setPeople(toggle(people, row.identity))} />{row.displayName} · {row.email ?? 'Correo pendiente de vincular'}</label>)}</div></>}
      <label className="membership-choice"><input type="radio" name="access-action" checked={access === 'remove'} onChange={() => setAccess('remove')} /><span><strong>Dar de baja</strong><small>Necesitará una invitación individual nueva para regresar.</small></span></label>
      <label className="membership-choice"><input type="radio" name="access-action" checked={access === 'block'} onChange={() => setAccess('block')} /><span><strong>Bloquear correo y acceso</strong><small>Primero será necesario desbloquear el correo y después reinvitar.</small></span></label>
      {access === 'block' && selected.some((row) => !row.email) && <p role="alert">Hay cuentas cuyo correo aún no está vinculado. Vincúlalo antes de bloquearlo; puedes dar de baja su identidad.</p>}
      <label className="field">Motivo obligatorio<textarea required rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    </div>}
    {step === 2 && <div className="form">
      {contentOnly && <p>Esta revisión gestiona sus aportes compartidos. Su estado de acceso seguirá siendo {member ? stateName(member.status).toLocaleLowerCase('es-MX') : 'el actual'}.</p>}
      <label className="membership-choice"><input type="radio" name="content-policy" checked={policy === 'keep'} onChange={() => setPolicy('keep')} /><span><strong>Conservar aportes compartidos</strong><small>Se conservarán las publicaciones, su autoría y sus archivos.</small></span></label>
      <label className="membership-choice"><input type="radio" name="content-policy" checked={policy === 'withdraw'} onChange={() => setPolicy('withdraw')} /><span><strong>Retirar contenido seleccionado</strong><small>Podrá recuperarse de la Papelera durante 30 días.</small></span></label>
      {policy === 'withdraw' && <>{contentOnly && <label className="field">Motivo obligatorio<textarea required maxLength={1000} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}<p>Los datos privados no aparecen en este listado. Las dependencias y trabajos colaborativos requieren revisión individual.</p><button type="button" className="secondary" onClick={() => setContent(entries.filter((row) => row.safeForBulk).map(keyOf))}>Seleccionar aportes propios sin dependencias</button><div className="membership-scroll">{entries.map((entry) => { const key = keyOf(entry); return <div className="membership-content" key={key}>
        <label className="check"><input type="checkbox" checked={content.includes(key)} disabled={!entry.safeForBulk && !ack.includes(key)} onChange={() => setContent(toggle(content, key))} /><span>{CONTENT_KIND_LABELS[entry.kind]}: {entry.title}</span></label>
        {impact(entry) && <p className="field__hint">{impact(entry)}</p>}
        {!entry.safeForBulk && <label className="check"><input type="checkbox" checked={ack.includes(key)} onChange={() => { setAck(toggle(ack, key)); if (ack.includes(key)) setContent(content.filter((item) => item !== key)); }} />He revisado y acepto el impacto de retirar este elemento.</label>}
      </div>; })}{!entries.length && <p>No hay aportes compartidos disponibles para retirar.</p>}</div></>}
    </div>}
    {step === 3 && <div className="form">
      <dl className="facts"><div><dt>Enlaces que dejarán de funcionar</dt><dd>{link ? 1 : 0}</dd></div><div><dt>Personas dadas de baja</dt><dd>{access === 'remove' ? review?.selected.length ?? 0 : 0}</dd></div><div><dt>Personas bloqueadas</dt><dd>{access === 'block' ? review?.selected.length ?? 0 : 0}</dd></div><div><dt>Integrantes de este enlace que conservan acceso</dt><dd>{link ? Math.max(0, data.members.filter((row) => row.invitationLinkId === link.id && row.status === 'active').length - (executed ? 0 : review?.selected.length ?? 0)) : 0}</dd></div><div><dt>Aportes enviados a Papelera</dt><dd>{review?.picked.length ?? 0}</dd></div></dl>
      {!contentOnly && selected.length > 0 && (!link || mode === 'manage') && <><p>{selected.map((row) => row.displayName).join(', ')}</p><p>Se retirarán sus accesos a salas y se cancelarán las salas activas que organicen. Sus datos privados se conservarán. Los permisos antiguos y el contenido moderado no se restaurarán al reinvitar.</p><p>Motivo: {reason}</p></>}
      {mode === 'replace' && link && <p>Se creará un enlace {link.maxUses === null ? 'sin límite de incorporaciones' : `con un cupo de ${link.maxUses} incorporaciones`} y {link.expiresAt === null ? 'sin vencimiento' : '7 días de vigencia'}.</p>}
      {picked.length > 0 && <p>Recuperación durante 30 días. Las copias y archivos utilizados por otros aportes o reportes se conservarán mientras sigan referenciados.</p>}
      {contentOnly && (review?.picked.length ?? 0) > 0 && <p>Motivo: {reason}</p>}
      {Object.keys(results).length > 0 && <ul className="plain-list" aria-live="polite">{Object.entries(results).map(([key, result]) => <li key={key} className={result.ok || result.skipped ? '' : 'error'}>{result.ok ? '✓ ' : result.skipped ? 'Omitido: ' : 'Pendiente: '}{result.text}</li>)}</ul>}
      {newUrl && <label className="field">Nuevo enlace<input readOnly value={newUrl} onFocus={(event) => event.target.select()} /></label>}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="row membership-footer">
      {!executed && step > (contentOnly ? 2 : link ? 0 : 1) && <button type="button" className="secondary" disabled={pending || revoked} onClick={() => setStep(step === 3 && link && mode !== 'manage' ? 0 : step - 1)}>Atrás</button>}
      {step < 3 ? <button type="button" onClick={next} disabled={step === 1 && (!selected.length || !reason.trim() || access === 'block' && selected.some((row) => !row.email)) || step === 2 && policy === 'withdraw' && (!picked.length || !reason.trim())}>Continuar</button> : <>
        {(!executed || Object.values(results).some((row) => !row.ok && !row.skipped)) && <button type="button" disabled={pending} onClick={() => void process()}>{pending ? 'Aplicando cambios…' : executed ? 'Reintentar pendientes' : 'Confirmar cambios'}</button>}
        {executed && Object.values(results).some((row) => !row.ok && !row.skipped) && <button type="button" className="secondary" disabled={pending} onClick={() => {
          setContentOperationId(crypto.randomUUID()); accessOperations.current.clear(); setExecuted(false); setAck([]);
          setContent(content.filter((key) => entries.some((entry) => keyOf(entry) === key && entry.safeForBulk)));
          setStep(Object.entries(results).some(([key, result]) => key.startsWith('person:') && !result.ok && !result.skipped) ? 1 : 2);
        }}>Revisar pendientes</button>}
        {executed && <button type="button" className="secondary" disabled={pending} onClick={close}>Terminar</button>}
      </>}
    </div>
  </AdminModal>;
}
