import { ResourceComments } from '../components/whatsNew/ResourceComments';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { OPPORTUNITY_KINDS, OPPORTUNITY_MODALITIES, opportunityExpired, type OpportunityFields } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { Opportunity } from '../data/community4Types';
import { useAction } from '../components/useAction';
const kindLabel: Record<string, string> = { contest: 'Concurso', course: 'Curso', scholarship: 'Beca', event: 'Evento', internship: 'Prácticas', other: 'Otra' };
const modeLabel: Record<string, string> = { online: 'En línea', in_person: 'Presencial', hybrid: 'Híbrida' };
const feedbackLabel: Record<string, string> = { correction: 'Corrección', broken_link: 'Enlace roto', outdated: 'Información desactualizada' };
const blank: OpportunityFields = { kind: 'event', title: '', topic: '', modality: 'online', sourceUrl: '', organizer: '', requirements: '', costKnown: false, cost: '' };
function OpportunityEditor({ entry, done }: { entry?: Opportunity; done(): void }) {
  const source = useDataSource(), base = useSnapshot(), action = useAction(); const [fields, setFields] = useState<OpportunityFields>(entry ?? blank); const [requestId] = useState(() => crypto.randomUUID());
  const saving = useRef(false); const mounted = useRef(false); const onDone = useRef(done);
  useEffect(() => { onDone.current = done; }, [done]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = action.pending || base.connection !== 'ready';
  async function submit(e: FormEvent) { e.preventDefault();
    const current = source.getSnapshot();
    if (saving.current || current.connection !== 'ready' || current.me?.status !== 'active' || current.me.id !== base.me?.id) return;
    saving.current = true;
    const ok = await action.run(async () => { if (entry) await source.updateOpportunity({ opportunityId: entry.id, expectedVersion: entry.version, fields }); else await source.createOpportunity({ fields, requestId }); return true; }); saving.current = false; if (ok && mounted.current && source.getSnapshot().me?.id === base.me?.id && source.getSnapshot().me?.status === 'active') onDone.current(); }
  return <form className="panel form-grid" aria-busy={action.pending} onSubmit={submit}><h2>{entry ? 'Editar oportunidad' : 'Compartir oportunidad'}</h2><label>Tipo<select disabled={locked} value={fields.kind} onChange={(e) => setFields({ ...fields, kind: e.target.value })}>{OPPORTUNITY_KINDS.map((v) => <option key={v} value={v}>{kindLabel[v]}</option>)}</select></label>
    {(['title', 'topic', 'organizer'] as const).map((key) => <label key={key}>{({ title: 'Título', topic: 'Tema', organizer: 'Organizador' })[key]}<input disabled={locked} required maxLength={200} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} /></label>)}
    <label>Modalidad<select disabled={locked} value={fields.modality} onChange={(e) => setFields({ ...fields, modality: e.target.value })}>{OPPORTUNITY_MODALITIES.map((v) => <option key={v} value={v}>{modeLabel[v]}</option>)}</select></label><label>Fuente oficial HTTPS<input disabled={locked} type="url" required value={fields.sourceUrl} onChange={(e) => setFields({ ...fields, sourceUrl: e.target.value })} /></label><label>Requisitos<textarea disabled={locked} required maxLength={4000} value={fields.requirements} onChange={(e) => setFields({ ...fields, requirements: e.target.value })} /></label>
    <label>Fecha límite (vacía si no se conoce)<input disabled={locked} type="datetime-local" value={fields.deadline ? new Date(Date.parse(fields.deadline) - new Date(fields.deadline).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={(e) => setFields({ ...fields, deadline: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></label><label><input disabled={locked} type="checkbox" checked={fields.costKnown} onChange={(e) => setFields({ ...fields, costKnown: e.target.checked })} /> Conozco el costo</label>{fields.costKnown && <label>Costo y moneda (o «Gratis»)<input disabled={locked} required maxLength={300} value={fields.cost} onChange={(e) => setFields({ ...fields, cost: e.target.value })} /></label>}
    <label>Sala abierta para coordinarse (opcional)<select disabled={locked} value={fields.roomId ?? ''} onChange={(e) => setFields({ ...fields, roomId: e.target.value || undefined })}><option value="">Sin sala vinculada</option>{base.studyRooms.filter((r) => r.visibility === 'group' && ['scheduled', 'active'].includes(r.status)).map((r) => <option value={r.id} key={r.id}>{r.title}</option>)}</select></label><p className="muted">Publicación manual. Revisa los requisitos y la fuente; el interés aquí no te inscribe ante el organizador.</p>{base.connection !== 'ready' && <p role="status">Tu borrador sigue aquí. Podrás guardarlo al reconectar.</p>}{action.error && <p role="alert">{action.error}</p>}<div className="actions"><button disabled={locked}>Guardar oportunidad</button><button disabled={action.pending} type="button" onClick={done}>Cancelar</button></div></form>;
}
function OpportunityCard({ row, edit }: { row: Opportunity; edit(): void }) {
  const source = useDataSource(), base = useSnapshot(), action = useAction(); const [team, setTeam] = useState(() => base.opportunityInterests.find((r) => r.opportunityId === row.id && r.memberId === base.me?.id)?.seekingTeam ?? false), [contact, setContact] = useState(() => base.opportunityInterests.find((r) => r.opportunityId === row.id && r.memberId === base.me?.id)?.shareContact ?? false), [feedback, setFeedback] = useState(''), [kind, setKind] = useState<'correction' | 'broken_link' | 'outdated'>('correction'), [resolution, setResolution] = useState(''), [reason, setReason] = useState('');
  const own = base.opportunityInterests.find((r) => r.opportunityId === row.id && r.memberId === base.me?.id); const expired = opportunityExpired(row, new Date()); const canManage = row.authorId === base.me?.id || base.me?.isCreator;
  async function interest(interested: boolean) { await action.run(() => source.setOpportunityInterest({ opportunityId: row.id, expectedVersion: own?.version ?? 0, interested, seekingTeam: team, shareContact: contact })); }
  return <article className="panel" id={`oportunidad-${row.id}`} tabIndex={-1} aria-labelledby={`oportunidad-title-${row.id}`}><h2 id={`oportunidad-title-${row.id}`}>{row.title}</h2><p>{kindLabel[row.kind]} · {row.topic} · {modeLabel[row.modality]} · {row.withdrawn ? 'Retirada' : expired ? 'Vencida' : 'Vigente'}</p><p>Organiza: {row.organizer} · Publicó: {base.members.find((m) => m.id === row.authorId)?.displayName ?? 'Integrante'} · v{row.version}</p><p>{row.requirements}</p><p>Fecha límite: {row.deadline ? new Date(row.deadline).toLocaleString() : 'No conocida'} · Costo: {row.costKnown ? row.cost : 'No conocido'}</p><a href={row.sourceUrl} target="_blank" rel="noreferrer noopener">Consultar fuente</a>
    {row.roomId && base.studyRooms.some((r) => r.id === row.roomId) && <p><Link to={`/m/salas/${row.roomId}`}>Consultar sala de coordinación</Link></p>}
    {row.withdrawn && <p>Motivo de retirada: {row.withdrawalReason || 'Retirada por el autor'}</p>}
    {(!expired && !row.withdrawn) && <fieldset><legend>Mi interés {own?.interested ? '(registrado)' : ''}</legend><label><input type="checkbox" checked={team} onChange={(e) => setTeam(e.target.checked)} /> Busco equipo</label><label><input type="checkbox" checked={contact} onChange={(e) => setContact(e.target.checked)} /> Autorizo que el grupo vea mi nombre y el enlace para contactarme en esta oportunidad</label><p className="muted">El interés sin esta autorización es privado. No se envía ningún mensaje automáticamente.</p><button disabled={action.pending} onClick={() => void interest(true)}>{own?.interested ? 'Actualizar mi interés' : 'Me interesa'}</button></fieldset>}
    {own?.interested && <button disabled={action.pending} onClick={() => void interest(false)}>Cancelar mi interés</button>}
    <ul>{base.opportunityInterests.filter((r) => r.opportunityId === row.id && r.interested && r.seekingTeam && r.shareContact && r.memberId !== base.me?.id).map((r) => <li key={r.memberId}>{base.members.find((m) => m.id === r.memberId)?.displayName ?? 'Integrante'} busca equipo · <Link to={`/perfil/${r.memberId}`}>Ver perfil y contactar voluntariamente</Link></li>)}</ul>
    {!row.withdrawn && <form onSubmit={(e) => { e.preventDefault(); void action.run(async () => { await source.sendOpportunityFeedback({ opportunityId: row.id, kind, text: feedback, requestId: crypto.randomUUID() }); setFeedback(''); }); }}><label>Tipo de aviso<select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{Object.entries(feedbackLabel).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><label>Corrección o reporte<textarea required maxLength={4000} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></label><button disabled={action.pending}>Enviar aviso</button></form>}
    <details><summary>Correcciones y reportes</summary>{base.opportunityFeedback.filter((r) => r.opportunityId === row.id).map((r) => <div key={r.id}><p>{feedbackLabel[r.kind]} · {r.status === 'open' ? 'Pendiente' : 'Resuelto'} · {r.text}</p>{r.resolution && <p>Resolución: {r.resolution}</p>}{canManage && r.status === 'open' && <form onSubmit={(e) => { e.preventDefault(); void action.run(() => source.resolveOpportunityFeedback({ feedbackId: r.id, expectedVersion: r.version, resolution })); }}><label>Resolución<textarea required maxLength={4000} value={resolution} onChange={(e) => setResolution(e.target.value)} /></label><button disabled={action.pending}>Resolver aviso</button></form>}</div>)}</details>
    {canManage && <div>{row.authorId === base.me?.id && !row.withdrawn && <button onClick={edit}>Editar oportunidad</button>}<label>Motivo de retirada<input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></label><button disabled={action.pending} onClick={() => void action.run(() => source.withdrawOpportunity({ opportunityId: row.id, expectedVersion: row.version, withdrawn: !row.withdrawn, reason }))}>{row.withdrawn ? 'Restaurar oportunidad' : 'Retirar oportunidad'}</button></div>}
    {!row.withdrawn && <ResourceComments target={{ kind: 'opportunity', id: row.id }} title="Comentarios de la oportunidad" initiallyOpen={false} />}
    <details><summary>Historial de la oportunidad</summary>{base.opportunityRevisions.filter((r) => r.opportunityId === row.id).sort((a, b) => b.version - a.version).map((r) => <details key={r.id}><summary>v{r.version} · {r.withdrawn ? 'Retirada' : r.fields.title} · {r.createdAt.toLocaleString()}</summary><p>{r.fields.requirements}</p><p>Fuente: {r.fields.sourceUrl}</p><p>Costo: {r.fields.costKnown ? r.fields.cost : 'No conocido'}</p></details>)}</details>{action.error && <p role="alert">{action.error}</p>}
  </article>;
}
export function OpportunitiesPage() {
  const base = useSnapshot();
  return <OpportunitiesAccountPage key={`${base.me?.id ?? 'inactive'}:${base.me?.status ?? 'none'}`} />;
}
function OpportunitiesAccountPage() {
  const [searchParams, setSearchParams] = useSearchParams(); const linkedId = searchParams.get('oportunidad');
  const creating = searchParams.get('crear') === '1';
  const base = useSnapshot(); const linkedOpportunity = base.opportunities.find((entry) => entry.id === linkedId && !entry.withdrawn);
  useEffect(() => { if (!linkedOpportunity) return; const element = document.getElementById(`oportunidad-${linkedOpportunity.id}`); element?.focus({ preventScroll: true }); element?.scrollIntoView?.({ block: 'center' }); }, [linkedId, Boolean(linkedOpportunity)]);
  const [editing, setEditing] = useState<Opportunity>();
  const [creationReady, setCreationReady] = useState(creating && base.connection === 'ready');
  useEffect(() => {
    if (!creating) setCreationReady(false);
    else { setEditing(undefined); if (base.connection === 'ready') setCreationReady(true); }
  }, [creating, base.connection]);
  function finishEditing() {
    setEditing(undefined);
    if (creating) setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('crear'); return next; }, { replace: true });
  }
  function create() { setEditing(undefined); setSearchParams((current) => { const next = new URLSearchParams(current); next.set('crear', '1'); return next; }); }
  function edit(entry: Opportunity) {
    if (creating) setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('crear'); return next; }, { replace: true });
    setEditing(entry);
  }
  const showCreate = creating && (creationReady || base.connection === 'ready'); const [search, setSearch] = useState(''), [kind, setKind] = useState(''), [mode, setMode] = useState(''), [view, setView] = useState('current');
  if (base.me?.status !== 'active') return <p>Necesitas una membresía activa para consultar oportunidades.</p>;
  const shown = base.opportunities.filter((r) => (!kind || r.kind === kind) && (!mode || r.modality === mode) && `${r.title} ${r.topic} ${r.organizer}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (view === 'all' || view === 'mine' ? view !== 'mine' || r.authorId === base.me!.id : !r.withdrawn && (r.id === linkedId || (view === 'expired' ? opportunityExpired(r, new Date()) : !opportunityExpired(r, new Date())))));
  return <div className="page"><header className="page-header"><h1>Radar de oportunidades</h1><p>Convocatorias compartidas manualmente por el grupo, con fuente y plazos visibles.</p><button disabled={base.connection !== 'ready'} onClick={create}>Compartir oportunidad</button></header>{(showCreate || (!creating && editing)) && <OpportunityEditor key={creating ? 'new' : editing!.id} entry={creating ? undefined : editing} done={finishEditing} />}
    {creating && !showCreate && <p role="status">Conectando para abrir una nueva oportunidad…</p>}
    <div className="filters"><label>Buscar por tema, título u organizador<input value={search} onChange={(e) => setSearch(e.target.value)} /></label><label>Tipo<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Todos</option>{OPPORTUNITY_KINDS.map((v) => <option key={v} value={v}>{kindLabel[v]}</option>)}</select></label><label>Modalidad<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="">Todas</option>{OPPORTUNITY_MODALITIES.map((v) => <option key={v} value={v}>{modeLabel[v]}</option>)}</select></label><label>Mostrar<select value={view} onChange={(e) => setView(e.target.value)}><option value="current">Vigentes</option><option value="expired">Vencidas</option><option value="all">Todas las disponibles</option><option value="mine">Mis publicaciones</option></select></label></div>
    {!shown.length && <p>No hay oportunidades para estos filtros.</p>}{shown.map((row) => <OpportunityCard key={row.id} row={row} edit={() => { if (base.connection === 'ready') edit(row); }} />)}
  </div>;
}
