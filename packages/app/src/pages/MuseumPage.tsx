import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { MuseumFields } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { MuseumEntry } from '../data/community4Types';
import { useAction } from '../components/useAction';
const blank: MuseumFields = { intention: '', symptom: '', cause: '', correction: '', learning: '', minimalCode: '', evidence: '', language: '', topic: '', bugType: '', noteIds: [], questionIds: [] };
const labels: [keyof Omit<MuseumFields, 'noteIds' | 'questionIds'>, string][] = [['intention', 'Qué intentabas hacer'], ['symptom', 'Síntoma observado'], ['cause', 'Causa o hipótesis'], ['correction', 'Corrección (si la conoces)'], ['learning', 'Qué aprendiste'], ['minimalCode', 'Código mínimo reproducible'], ['evidence', 'Evidencia o pasos para reproducir'], ['language', 'Lenguaje'], ['topic', 'Tema'], ['bugType', 'Tipo de error']];
function MuseumEditor({ entry, done }: { entry?: MuseumEntry; done(): void }) {
  const source = useDataSource(); const base = useSnapshot(); const action = useAction();
  const saving = useRef(false); const mounted = useRef(false); const onDone = useRef(done);
  useEffect(() => { onDone.current = done; }, [done]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = action.pending || base.connection !== 'ready';
  const [fields, setFields] = useState<MuseumFields>(entry ?? blank); const [questionId, setQuestionId] = useState(entry?.questionId ?? '');
  const [title, setTitle] = useState(''); const [subjectId, setSubjectId] = useState(base.subjects[0]?.id ?? ''); const [requestId] = useState(() => crypto.randomUUID());
  const mine = base.questions.filter((q) => q.authorId === base.me?.id && !q.withdrawnAt && !base.museumEntries.some((e) => e.questionId === q.id));
  async function submit(event: FormEvent) { event.preventDefault();
    const current = source.getSnapshot();
    if (saving.current || current.connection !== 'ready' || current.me?.status !== 'active' || current.me.id !== base.me?.id) return;
    saving.current = true;
    const success = await action.run(async () => {
    if (questionId) await source.saveMuseum({ questionId, fields, expectedVersion: entry?.version ?? 0, requestId });
    else await source.createMuseum({ subjectId, title, fields, requestId }); return true;
  }); saving.current = false; if (success && mounted.current && source.getSnapshot().me?.id === base.me?.id && source.getSnapshot().me?.status === 'active') onDone.current(); }
  return <form className="panel form-grid" aria-busy={action.pending} onSubmit={submit}>
    <h2>{entry ? 'Editar ficha del museo' : 'Documentar un bug'}</h2>
    {!entry && <><label>Pregunta de origen<select disabled={locked} value={questionId} onChange={(e) => setQuestionId(e.target.value)}><option value="">Crear una pregunta con esta ficha</option>{mine.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}</select></label>
      {!questionId && <><label>Título<input disabled={locked} required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>Materia<select disabled={locked} required value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>{base.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></>}</>}
    {labels.map(([key, label]) => <label key={key}>{label}{['language', 'topic', 'bugType'].includes(key) ? <input disabled={locked} required value={fields[key]} maxLength={key === 'language' ? 80 : key === 'bugType' ? 100 : 200} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} /> : <textarea disabled={locked} required={!['correction', 'minimalCode', 'evidence'].includes(key)} rows={key === 'minimalCode' ? 6 : 3} maxLength={key === 'minimalCode' ? 12000 : ['intention', 'learning'].includes(key) ? 2000 : 4000} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />}</label>)}
    <label>Notas compartidas relacionadas<select disabled={locked} multiple value={fields.noteIds} onChange={(e) => setFields({ ...fields, noteIds: [...e.target.selectedOptions].map((o) => o.value) })}>{base.notes.filter((n) => n.visibility === 'group' && !n.withdrawnAt).map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}</select></label>
    <label>Otras preguntas relacionadas<select disabled={locked} multiple value={fields.questionIds} onChange={(e) => setFields({ ...fields, questionIds: [...e.target.selectedOptions].map((o) => o.value) })}>{base.questions.filter((q) => !q.withdrawnAt && q.id !== questionId).map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}</select></label>
    <p className="muted">No incluyas contraseñas ni datos privados. Las aclaraciones, respuestas y propuestas de corrección se escriben en la pregunta de origen.</p>
    {base.connection !== 'ready' && <p role="status">Tu borrador sigue aquí. Podrás guardarlo al reconectar.</p>}
    {action.error && <p role="alert">{action.error}</p>}<div className="actions"><button disabled={locked} type="submit">Guardar ficha</button><button disabled={action.pending} type="button" className="button secondary" onClick={done}>Cancelar</button></div>
  </form>;
}
export function MuseumPage() {
  const base = useSnapshot();
  return <MuseumAccountPage key={`${base.me?.id ?? 'inactive'}:${base.me?.status ?? 'none'}`} />;
}
function MuseumAccountPage() {
  const base = useSnapshot(); const [searchParams, setSearchParams] = useSearchParams();
  const creating = searchParams.get('crear') === '1';
  const [editing, setEditing] = useState<MuseumEntry>();
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
  function edit(entry: MuseumEntry) {
    if (creating) setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('crear'); return next; }, { replace: true });
    setEditing(entry);
  }
  const showCreate = creating && (creationReady || base.connection === 'ready');
  const [search, setSearch] = useState(''); const [language, setLanguage] = useState(''); const [bugType, setBugType] = useState(''); const [subject, setSubject] = useState('');
  if (base.me?.status !== 'active') return <p>Necesitas una membresía activa para consultar el museo.</p>;
  const shown = base.museumEntries.filter((r) => (!language || r.language === language) && (!bugType || r.bugType === bugType) && (!subject || base.questions.find((q) => q.id === r.questionId)?.subjectId === subject) && `${r.topic} ${r.symptom} ${r.intention} ${base.questions.find((q) => q.id === r.questionId)?.title ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="page"><header className="page-header"><h1>Museo de bugs</h1><p>Una colección de preguntas del grupo: errores, hipótesis y aprendizajes compartidos.</p><button disabled={base.connection !== 'ready'} onClick={create}>Documentar un bug</button></header>
    {(showCreate || (!creating && editing)) && <MuseumEditor key={creating ? 'new' : editing!.questionId} entry={creating ? undefined : editing} done={finishEditing} />}
    {creating && !showCreate && <p role="status">Conectando para abrir una nueva ficha…</p>}
    <div className="filters"><label>Buscar por tema o síntoma<input value={search} onChange={(e) => setSearch(e.target.value)} /></label><label>Materia<select value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">Todas</option>{base.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Lenguaje<select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="">Todos</option>{[...new Set(base.museumEntries.map((r) => r.language))].map((v) => <option key={v}>{v}</option>)}</select></label><label>Tipo de error<select value={bugType} onChange={(e) => setBugType(e.target.value)}><option value="">Todos</option>{[...new Set(base.museumEntries.map((r) => r.bugType))].map((v) => <option key={v}>{v}</option>)}</select></label></div>
    {!shown.length && <p>No hay fichas para estos filtros. Puedes documentar un bug o añadir una pregunta existente.</p>}
    {shown.map((entry) => { const question = base.questions.find((q) => q.id === entry.questionId); return <article className="panel" key={entry.questionId}><h2>{question?.title ?? 'Pregunta'}</h2><p>{entry.language} · {entry.topic} · {entry.bugType} · v{entry.version}</p><p>{entry.symptom}</p>
      <details><summary>Ver ficha y referencias</summary>{labels.filter(([key]) => !['language', 'topic', 'bugType', 'symptom'].includes(key)).map(([key, label]) => entry[key] && <div key={key}><h3>{label}</h3>{key === 'minimalCode' ? <pre><code>{entry[key]}</code></pre> : <p style={{ whiteSpace: 'pre-wrap' }}>{entry[key]}</p>}</div>)}
        {entry.noteIds.filter((id) => base.notes.some((n) => n.id === id && !n.withdrawnAt)).map((id) => <p key={id}><Link to={`/m/notas/${id}`}>{base.notes.find((n) => n.id === id)?.title}</Link></p>)}{entry.questionIds.filter((id) => base.questions.some((q) => q.id === id && !q.withdrawnAt)).map((id) => <p key={id}><Link to={`/m/preguntas/${id}`}>{base.questions.find((q) => q.id === id)?.title}</Link></p>)}
      </details><Link to={`/m/preguntas/${entry.questionId}`}>Aclaraciones, respuestas y correcciones en Preguntas</Link>{entry.authorId === base.me!.id && <button className="button secondary" disabled={base.connection !== 'ready'} onClick={() => edit(entry)}>Editar ficha</button>}
      <details><summary>Historial de la ficha</summary>{base.museumRevisions.filter((r) => r.questionId === entry.questionId).sort((a, b) => b.version - a.version).map((r) => <details key={r.id}><summary>v{r.version} · {base.members.find((m) => m.id === r.updatedBy)?.displayName ?? 'Integrante'} · {r.createdAt.toLocaleString()}</summary><p>{r.fields.symptom}</p><p>{r.fields.cause}</p><p>{r.fields.correction}</p><p>{r.fields.learning}</p></details>)}</details>
    </article>; })}
  </div>;
}
