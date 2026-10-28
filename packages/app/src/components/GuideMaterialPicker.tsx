import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { GUIDE_AI_LIMITS, type GuideAiSourceRef, type GuideAiTranscription } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { ResourceFile } from '../data/types';
import { filterGuideMaterials, guideAiAttachments, guideAiCandidateKey, guideAiCandidates, guideAiCandidateText, GUIDE_AI_MODULE_LABELS, GUIDE_AI_SOURCE_LABELS, GUIDE_MATERIAL_PRIMARY_TYPES, GUIDE_UNPLACED_TERM, type GuideAiCandidate, type GuideExamMaterialLike, type GuideMaterialFilters } from '../lib/guideAiSources';
import { extractGuideDocument, supportsGuideExtraction, type GuideDocumentExtraction } from '../lib/guideExtraction';
import { StructuredText } from './StructuredText';
import { Icon } from './Icon';
import './GuideMaterialPicker.css';

export type GuideMaterialTranscriptionInfo = Pick<GuideAiTranscription, 'id' | 'fileId' | 'targetId' | 'targetVersion'> & { targetKind: string };
interface Props {
  subjectId: string; termId?: string; topics: string[]; selected: GuideAiSourceRef[];
  onChange(next: GuideAiSourceRef[]): void; disabled?: boolean; onPendingFilesChange?(count: number): void;
  chosenFileIds?: string[]; onChosenFileIdsChange?(ids: string[]): void; restoredTranscriptions?: GuideMaterialTranscriptionInfo[];
  onCandidatesChange?(candidates: GuideAiCandidate[]): void;
}
interface PreparedFile { transcription: GuideMaterialTranscriptionInfo; sourceRevision: string }
const message = (failure: unknown) => failure instanceof Error ? failure.message : 'No pudimos abrir el material. Vuelve a intentarlo.';
const locatorLabel = (locator: { kind: string; start: number; end: number }) => `${locator.kind === 'page' ? 'Página' : locator.kind === 'paragraph' ? 'Párrafo' : 'Líneas'} ${locator.start}${locator.end > locator.start ? `–${locator.end}` : ''}`;
const fileSize = (size: number) => size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const PAGE_SIZE = 25;
function MixedCheck({ checked, mixed, label, disabled, onChange }: { checked: boolean; mixed?: boolean; label: string; disabled?: boolean; onChange(): void }) {
  return <input type="checkbox" aria-label={label} checked={checked} aria-checked={mixed ? 'mixed' : checked} disabled={disabled} ref={(element) => { if (element) element.indeterminate = Boolean(mixed); }} onChange={onChange} />;
}
/** Source references and file choices are controlled by the persisted parent draft. Filters never remove them. */
export function GuideMaterialPicker(props: Props) {
  const { me } = useSnapshot();
  return <GuideMaterialPickerSession key={`${me?.id}:${props.subjectId}`} {...props} />;
}
function GuideMaterialPickerSession({ subjectId, termId, topics, selected, onChange, disabled = false, onPendingFilesChange, chosenFileIds, onChosenFileIdsChange, restoredTranscriptions = [], onCandidatesChange }: Props) {
  const source = useDataSource(), data = useSnapshot();
  const [filters, setFilters] = useState<GuideMaterialFilters>({ origin: 'all', personIds: [], types: GUIDE_MATERIAL_PRIMARY_TYPES, allTerms: !termId, termIds: termId ? [termId, GUIDE_UNPLACED_TERM] : [], search: '', privacy: 'all' });
  const filterScopeTerm = useRef(termId);
  useEffect(() => { if (filterScopeTerm.current !== termId) { filterScopeTerm.current = termId; setFilters((current) => ({ ...current, allTerms: !termId, termIds: termId ? [termId, GUIDE_UNPLACED_TERM] : [] })); setPage(1); } }, [termId]);
  const [personSearch, setPersonSearch] = useState(''), [groupBy, setGroupBy] = useState<'person' | 'type' | 'term'>('person'), [page, setPage] = useState(1);
  const [staged, setStaged] = useState<Set<string>>(new Set()), [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ candidate: GuideAiCandidate; file?: ResourceFile }>();
  const [localChosenFiles, setLocalChosenFiles] = useState<string[]>([]), [prepared, setPrepared] = useState<Record<string, PreparedFile>>({});
  const [extractions, setExtractions] = useState<Record<string, { value: GuideDocumentExtraction; sourceRevision: string }>>({});
  const [exams, setExams] = useState<GuideExamMaterialLike[]>([]), [catalogueError, setCatalogueError] = useState(''), [loadingExams, setLoadingExams] = useState(false);
  const latest = useRef({ selected, onChange }); latest.current = { selected, onChange };
  useEffect(() => {
    let current = true; setExams([]); setCatalogueError(''); if (!subjectId) return;
    setLoadingExams(true);
    void source.listGuideExamMaterials(subjectId).then((value) => { if (current) setExams(value); }).catch((failure: unknown) => { if (current) setCatalogueError(message(failure)); }).finally(() => { if (current) setLoadingExams(false); });
    return () => { current = false; };
  }, [source, subjectId]);
  const candidates = useMemo(() => guideAiCandidates(data, subjectId, undefined, exams), [data, subjectId, exams]);
  const [selectedExams, setSelectedExams] = useState<GuideExamMaterialLike[]>([]);
  const selectedExamSignature = JSON.stringify(selected.filter((ref) => ref.kind === 'exam').map((ref) => ({ refId: ref.refId, examVersion: ref.examVersion, includeSolutions: ref.includeSolutions === true })));
  useEffect(() => {
    let active = true; setSelectedExams([]);
    const refs = JSON.parse(selectedExamSignature) as { refId: string; examVersion?: number; includeSolutions: boolean }[];
    void Promise.allSettled(refs.map((ref) => source.getGuideExamMaterial(ref.refId, ref.examVersion ?? 1, ref.includeSolutions))).then((results) => { if (active) setSelectedExams(results.flatMap((result, index) => result.status === 'fulfilled' && result.value.id === refs[index]?.refId && result.value.version === (refs[index]?.examVersion ?? 1) ? [result.value] : [])); });
    return () => { active = false; };
  }, [source, subjectId, selectedExamSignature]);
  const effectiveCandidates = useMemo(() => {
    const ids = new Set((JSON.parse(selectedExamSignature) as { refId: string }[]).map((ref) => ref.refId));
    return [...candidates.filter((candidate) => candidate.kind !== 'exam' || !ids.has(candidate.refId)), ...guideAiCandidates(data, subjectId, undefined, selectedExams, true).filter((candidate) => candidate.kind === 'exam')];
  }, [candidates, data, subjectId, selectedExams, selectedExamSignature]);
  useEffect(() => { onCandidatesChange?.(effectiveCandidates); }, [effectiveCandidates, onCandidatesChange]);
  const chosenFiles = useMemo(() => new Set(chosenFileIds ?? localChosenFiles), [chosenFileIds, localChosenFiles]);
  const changeChosen = (next: Set<string>) => { const value = [...next]; setLocalChosenFiles(value); onChosenFileIdsChange?.(value); };
  const refFor = (candidate: GuideAiCandidate) => selected.find((ref) => guideAiCandidateKey(ref) === guideAiCandidateKey(candidate));
  const preparedFor = (candidate: GuideAiCandidate, file: ResourceFile): GuideMaterialTranscriptionInfo | undefined => {
    const local = prepared[file.id];
    if (local?.sourceRevision === candidate.revision) return local.transcription;
    return restoredTranscriptions.find((entry) => entry.fileId === file.id && entry.targetKind === candidate.kind && entry.targetId === candidate.refId && entry.targetVersion === candidate.version);
  };
  const includedFile = (candidate: GuideAiCandidate, file: ResourceFile) => { const cached = preparedFor(candidate, file); return Boolean(cached && refFor(candidate)?.transcriptionIds?.includes(cached.id)); };
  const pendingFiles = candidates.flatMap((candidate) => refFor(candidate) ? guideAiAttachments(data, candidate).filter((file) => chosenFiles.has(file.id) && !includedFile(candidate, file)).map((file) => ({ candidate, file })) : []);
  const currentSelectedFileIds = new Set(candidates.filter((candidate) => refFor(candidate)).flatMap((candidate) => guideAiAttachments(data, candidate).map((file) => file.id)));
  const missingChosenFiles = [...chosenFiles].filter((id) => !currentSelectedFileIds.has(id));
  const pendingFileCount = pendingFiles.length + missingChosenFiles.length;
  useEffect(() => { onPendingFilesChange?.(pendingFileCount); }, [pendingFileCount, onPendingFilesChange]);
  useEffect(() => () => { onPendingFilesChange?.(0); }, [onPendingFilesChange]);
  const authorName = (candidate: GuideAiCandidate) => (candidate.authorIds ?? []).map((id) => data.members.find((member) => member.id === id)?.displayName ?? 'Integrante del grupo').join(', ');
  const termName = (id: string | undefined) => data.terms.find((entry) => entry.id === id)?.name ?? 'Sin parcial';
  const visible = filterGuideMaterials(candidates, filters, data).sort((a, b) => a.title.localeCompare(b.title, 'es') || guideAiCandidateKey(a).localeCompare(guideAiCandidateKey(b)));
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE)), currentPage = Math.min(page, pages);
  const pageItems = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const availablePeople = [...new Set(candidates.flatMap((candidate) => candidate.authorIds ?? []))].map((id) => ({ id, name: id === data.me?.id ? `${data.me.displayName} (yo)` : data.members.find((member) => member.id === id)?.displayName ?? 'Integrante del grupo' })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const termOptions = [...data.terms.filter((term) => term.subjectId === subjectId).sort((a, b) => a.position - b.position).map((term) => ({ id: term.id, name: term.name })), { id: GUIDE_UNPLACED_TERM, name: 'Sin parcial' }];
  const setFilter = (patch: Partial<GuideMaterialFilters>) => { setFilters((current) => ({ ...current, ...patch })); setPage(1); };
  const toggleList = <T extends string,>(values: T[], value: T) => values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
  const newRef = (candidate: GuideAiCandidate): GuideAiSourceRef => ({ kind: candidate.kind, refId: candidate.refId, topics: topics.filter((topic) => candidate.topics.some((entry) => entry.toLocaleLowerCase('es') === topic.toLocaleLowerCase('es'))), includeUnplaced: !candidate.termId,
    ...(candidate.termId && termId && candidate.termId !== termId ? { includeOutsideTerm: true } : {}), ...(candidate.kind === 'exam' ? { examVersion: candidate.version, includeSolutions: false } : {}) });
  const toggleStaged = (items: GuideAiCandidate[]) => {
    if (disabled) return; const additions = items.filter((candidate) => !refFor(candidate)); const all = additions.length > 0 && additions.every((candidate) => staged.has(guideAiCandidateKey(candidate)));
    setStaged((current) => { const next = new Set(current); for (const candidate of additions) { if (all) next.delete(guideAiCandidateKey(candidate)); else next.add(guideAiCandidateKey(candidate)); } return next; });
  };
  const addCandidates = (items: GuideAiCandidate[]) => {
    if (disabled) return; const additions = items.filter((candidate) => !refFor(candidate));
    if (selected.length + additions.length > GUIDE_AI_LIMITS.maxSources) { setNotice(`Esta selección supera el máximo de ${GUIDE_AI_LIMITS.maxSources} materiales por borrador. No se agregó ningún subconjunto.`); return; }
    onChange([...selected, ...additions.map(newRef)]);
    changeChosen(new Set([...chosenFiles, ...additions.flatMap((candidate) => guideAiAttachments(data, candidate).map((file) => file.id))]));
    setStaged((current) => new Set([...current].filter((key) => !additions.some((candidate) => guideAiCandidateKey(candidate) === key))));
    setNotice(`${additions.length} ${additions.length === 1 ? 'material agregado' : 'materiales agregados'} a la guía. Los archivos elegidos se revisan antes de continuar.`);
  };
  const addStaged = () => {
    const items = candidates.filter((candidate) => staged.has(guideAiCandidateKey(candidate)) && !refFor(candidate));
    if ([...staged].some((key) => !candidates.some((candidate) => guideAiCandidateKey(candidate) === key))) { setNotice('Un material marcado cambió o dejó de estar disponible. Revisa la selección antes de agregarla.'); return; }
    addCandidates(items);
  };
  const removeRef = (ref: GuideAiSourceRef) => {
    onChange(selected.filter((entry) => guideAiCandidateKey(entry) !== guideAiCandidateKey(ref)));
    const candidate = candidates.find((entry) => guideAiCandidateKey(entry) === guideAiCandidateKey(ref));
    if (candidate) { const ids = new Set(guideAiAttachments(data, candidate).map((file) => file.id)); changeChosen(new Set([...chosenFiles].filter((id) => !ids.has(id)))); }
  };
  const removeUnavailableFile = (fileId: string) => {
    changeChosen(new Set([...chosenFiles].filter((id) => id !== fileId)));
    const metadata = [...restoredTranscriptions, ...Object.values(prepared).map((entry) => entry.transcription)];
    const byId = new Map(metadata.map((entry) => [entry.id, entry.fileId]));
    onChange(selected.map((ref) => ({ ...ref, transcriptionIds: ref.transcriptionIds?.filter((id) => byId.has(id) && byId.get(id) !== fileId) })));
    setNotice('Archivo no disponible quitado de la selección. Los demás archivos elegidos se conservan.');
  };
  const changeRef = (candidate: GuideAiCandidate, next: GuideAiSourceRef) => onChange(selected.map((ref) => guideAiCandidateKey(ref) === guideAiCandidateKey(candidate) ? next : ref));
  const savedFile = (candidate: GuideAiCandidate, transcription: GuideAiTranscription) => {
    setPrepared((current) => ({ ...current, [transcription.fileId]: { transcription, sourceRevision: candidate.revision } }));
    const refs = latest.current.selected, key = guideAiCandidateKey(candidate), ref = refs.find((entry) => guideAiCandidateKey(entry) === key); if (!ref) return;
    const prior = prepared[transcription.fileId]?.transcription.id ?? restoredTranscriptions.find((entry) => entry.fileId === transcription.fileId)?.id;
    latest.current.onChange(refs.map((entry) => guideAiCandidateKey(entry) === key ? { ...entry, transcriptionIds: [...new Set([...(entry.transcriptionIds ?? []).filter((id) => id !== prior), transcription.id])] } : entry));
    changeChosen(new Set([...chosenFiles, transcription.fileId]));
    setNotice(`Archivo «${transcription.label || transcription.fileId}» revisado e incluido.`);
  };
  const groupAction = (items: GuideAiCandidate[], label: string) => {
    const eligible = items.filter((candidate) => !refFor(candidate)), marked = eligible.filter((candidate) => staged.has(guideAiCandidateKey(candidate))).length;
    return <button type="button" className="guide-materials__bulk" disabled={disabled || !eligible.length} onClick={() => toggleStaged(items)} aria-label={`${marked === eligible.length && marked ? 'Quitar selección' : 'Elegir todo'} ${label}`}>{marked === eligible.length && marked ? 'Quitar selección' : 'Elegir todo'} <span>{marked}/{eligible.length}</span></button>;
  };
  const renderResult = (candidate: GuideAiCandidate, group: string) => { const key = guideAiCandidateKey(candidate), ref = refFor(candidate), files = guideAiAttachments(data, candidate);
    return <article className={`guide-materials__card${ref ? ' is-selected' : ''}`} key={`${group}:${key}`}>
      <div className="guide-materials__card-head"><label className="ai-source__choice"><input type="checkbox" aria-label={`Seleccionar ${candidate.title}`} disabled={disabled || Boolean(ref)} checked={Boolean(ref) || staged.has(key)} onChange={() => toggleStaged([candidate])} /><span><strong>{candidate.title}</strong><small>{GUIDE_AI_MODULE_LABELS[candidate.module ?? 'tasks']} · {GUIDE_AI_SOURCE_LABELS[candidate.kind]} · {termName(candidate.termId)} · {candidate.visibility === 'personal' ? 'Personal' : 'Compartido'}{files.length ? ` · ${files.length} archivos` : ''}</small></span></label><button type="button" className="guide-materials__preview" aria-label={`Vista previa de ${candidate.title}`} onClick={() => setPreview({ candidate })}><Icon name="search" size={15} />Ver</button></div>
      <p className="guide-materials__team">{authorName(candidate) || 'Material del grupo'}{ref ? ' · Ya agregado' : ''}</p>
    </article>;
  };
  const groups: { id: string; name: string; items: GuideAiCandidate[]; all: GuideAiCandidate[] }[] = groupBy === 'person'
    ? [...new Set(pageItems.flatMap((candidate) => candidate.authorIds?.length ? candidate.authorIds : ['group']))].sort((a, b) => a === data.me?.id ? -1 : b === data.me?.id ? 1 : a.localeCompare(b)).map((id) => ({ id, name: id === data.me?.id ? 'Mis materiales' : data.members.find((member) => member.id === id)?.displayName ?? 'Material del grupo', items: pageItems.filter((candidate) => id === 'group' ? !candidate.authorIds?.length : candidate.authorIds?.includes(id)), all: visible.filter((candidate) => id === 'group' ? !candidate.authorIds?.length : candidate.authorIds?.includes(id)) }))
    : groupBy === 'type' ? [...new Set(pageItems.map((candidate) => candidate.module ?? 'tasks'))].map((id) => ({ id, name: GUIDE_AI_MODULE_LABELS[id], items: pageItems.filter((candidate) => (candidate.module ?? 'tasks') === id), all: visible.filter((candidate) => (candidate.module ?? 'tasks') === id) }))
      : [...new Set(pageItems.map((candidate) => candidate.termId ?? GUIDE_UNPLACED_TERM))].map((id) => ({ id, name: termName(id === GUIDE_UNPLACED_TERM ? undefined : id), items: pageItems.filter((candidate) => (candidate.termId ?? GUIDE_UNPLACED_TERM) === id), all: visible.filter((candidate) => (candidate.termId ?? GUIDE_UNPLACED_TERM) === id) }));
  const addedCandidates = selected.map((ref) => ({ ref, candidate: effectiveCandidates.find((entry) => guideAiCandidateKey(entry) === guideAiCandidateKey(ref)) }));
  const currentPreview = preview && (preview.candidate.kind === 'exam' && refFor(preview.candidate) ? effectiveCandidates.find((candidate) => guideAiCandidateKey(candidate) === guideAiCandidateKey(preview.candidate)) : candidates.find((candidate) => guideAiCandidateKey(candidate) === guideAiCandidateKey(preview.candidate) && candidate.revision === preview.candidate.revision));
  const stagedCount = [...staged].filter((key) => !selected.some((ref) => guideAiCandidateKey(ref) === key)).length;
  return <div className="guide-materials guide-materials--complete" aria-label="Seleccionar materiales para la guía">
    <header className="guide-materials__intro"><div><span>REÚNE TU CONTENIDO</span><h3>Explorar materiales</h3><p>Combina filtros, marca lo que necesites y agrégalo a tu guía. La lista agregada se conserva al cambiar los filtros.</p></div><strong>{selected.length} agregados</strong></header>
    <fieldset className="guide-materials__filters" disabled={disabled}><legend>Filtrar materiales</legend>
      <div className="guide-materials__filter-grid"><label className="field"><span>Procedencia</span><select value={filters.origin} onChange={(event) => setFilter({ origin: event.target.value as GuideMaterialFilters['origin'] })}><option value="all">Propios y de compañeros</option><option value="own">Mis materiales</option><option value="peers">De compañeros</option></select></label><label className="field"><span>Disponibilidad</span><select value={filters.privacy} onChange={(event) => setFilter({ privacy: event.target.value as GuideMaterialFilters['privacy'] })}><option value="all">Todo lo que puedo consultar</option><option value="group">Compartido con el grupo</option><option value="personal">Personal propio</option></select></label><label className="field"><span>Buscar materiales o compañeros</span><input type="search" value={filters.search} placeholder="Título, tema, persona o archivo" onChange={(event) => setFilter({ search: event.target.value })} /></label></div>
      <div className="guide-materials__filter-sets"><fieldset><legend>Tipo de material</legend>{[...GUIDE_MATERIAL_PRIMARY_TYPES, ...(candidates.some((candidate) => candidate.module === 'questions') ? ['questions' as const] : [])].map((type) => <label key={type}><input type="checkbox" checked={filters.types.includes(type)} onChange={() => setFilter({ types: toggleList(filters.types, type) })} />{GUIDE_AI_MODULE_LABELS[type]}</label>)}<button type="button" className="link-button" onClick={() => setFilter({ types: [...GUIDE_MATERIAL_PRIMARY_TYPES] })}>Todos los tipos principales</button></fieldset>
      <fieldset><legend>Parciales del material</legend><label><input type="checkbox" checked={filters.allTerms} onChange={(event) => setFilter({ allTerms: event.target.checked, termIds: event.target.checked ? [] : termId ? [termId, GUIDE_UNPLACED_TERM] : [] })} />Todos los parciales</label>{termOptions.map((term) => <label key={term.id}><input type="checkbox" checked={filters.allTerms || filters.termIds.includes(term.id)} onChange={() => setFilter({ allTerms: false, termIds: filters.allTerms ? termOptions.filter((entry) => entry.id !== term.id).map((entry) => entry.id) : toggleList(filters.termIds, term.id) })} />{term.name}</label>)}</fieldset>
      <fieldset><legend>Personas</legend><label className="field"><span>Buscar personas</span><input type="search" value={personSearch} onChange={(event) => setPersonSearch(event.target.value)} placeholder="Nombre del compañero" /></label><div className="guide-materials__people">{availablePeople.filter((person) => person.name.toLocaleLowerCase('es').includes(personSearch.toLocaleLowerCase('es'))).map((person) => <label key={person.id}><input type="checkbox" checked={filters.personIds.includes(person.id)} onChange={() => setFilter({ personIds: toggleList(filters.personIds, person.id) })} />{person.name}</label>)}</div>{filters.personIds.length > 0 && <button type="button" className="link-button" onClick={() => setFilter({ personIds: [] })}>Todas las personas</button>}</fieldset></div>
      <div className="guide-materials__filter-summary" aria-label="Filtros aplicados">{filters.origin !== 'all' && <button type="button" onClick={() => setFilter({ origin: 'all' })}>{filters.origin === 'own' ? 'Mis materiales' : 'De compañeros'} ×</button>}{filters.personIds.map((id) => <button type="button" key={id} onClick={() => setFilter({ personIds: filters.personIds.filter((entry) => entry !== id) })}>{availablePeople.find((person) => person.id === id)?.name ?? 'Persona'} ×</button>)}{!filters.allTerms && filters.termIds.map((id) => <button type="button" key={`term:${id}`} onClick={() => setFilter({ termIds: filters.termIds.filter((entry) => entry !== id) })}>{termName(id === GUIDE_UNPLACED_TERM ? undefined : id)} ×</button>)}{filters.types.length !== GUIDE_MATERIAL_PRIMARY_TYPES.length && filters.types.map((type) => <button type="button" key={`type:${type}`} onClick={() => setFilter({ types: filters.types.filter((entry) => entry !== type) })}>{GUIDE_AI_MODULE_LABELS[type]} ×</button>)}{filters.privacy !== 'all' && <button type="button" onClick={() => setFilter({ privacy: 'all' })}>{filters.privacy === 'personal' ? 'Personal propio' : 'Compartido'} ×</button>}{filters.search && <button type="button" onClick={() => setFilter({ search: '' })}>{filters.search} ×</button>}<button type="button" className="link-button" onClick={() => { setFilter({ origin: 'all', personIds: [], types: GUIDE_MATERIAL_PRIMARY_TYPES, allTerms: true, termIds: [], search: '', privacy: 'all' }); setPersonSearch(''); }}>Limpiar filtros</button></div>
    </fieldset>
    {loadingExams && <p role="status">Consultando exámenes disponibles…</p>}{catalogueError && <p role="alert" className="guide-materials__notice">No pudimos cargar los exámenes: {catalogueError}. Los demás materiales siguen disponibles.</p>}
    <div className="guide-materials__results-head"><div><h4>Resultados <span>{visible.length}</span></h4><p>La selección global incluye todas las páginas que coinciden con estos filtros.</p></div><label className="field"><span>Agrupar por</span><select value={groupBy} onChange={(event) => setGroupBy(event.target.value as typeof groupBy)}><option value="person">Persona</option><option value="type">Tipo de material</option><option value="term">Parcial</option></select></label><label className="guide-materials__select-all"><MixedCheck label="Seleccionar todos los resultados filtrados" checked={visible.filter((candidate) => !refFor(candidate)).length > 0 && visible.filter((candidate) => !refFor(candidate)).every((candidate) => staged.has(guideAiCandidateKey(candidate)))} mixed={visible.some((candidate) => staged.has(guideAiCandidateKey(candidate))) && visible.some((candidate) => !staged.has(guideAiCandidateKey(candidate)) && !refFor(candidate))} disabled={disabled || !visible.some((candidate) => !refFor(candidate))} onChange={() => toggleStaged(visible)} />Seleccionar todos los resultados filtrados ({visible.length})</label></div>
    <div className="guide-materials__global" aria-label="Elegir por tipo o parcial">{[...GUIDE_MATERIAL_PRIMARY_TYPES, ...(filters.types.includes('questions') ? ['questions' as const] : [])].map((module) => { const items = visible.filter((candidate) => candidate.module === module); return items.length > 0 && <div key={module}><span>{GUIDE_AI_MODULE_LABELS[module]}</span>{groupAction(items, `en ${GUIDE_AI_MODULE_LABELS[module]}`)}</div>; })}{termOptions.map((term) => { const items = visible.filter((candidate) => (candidate.termId ?? GUIDE_UNPLACED_TERM) === term.id); return items.length > 0 && <div key={term.id}><span>{term.name}</span>{groupAction(items, `del ${term.name}`)}</div>; })}</div>
    {!subjectId ? <p className="guide-materials__empty">Elige una materia para explorar sus materiales.</p> : !visible.length ? <p className="guide-materials__empty">No hay materiales que coincidan con estos filtros. Los materiales ya agregados siguen en tu lista.</p> : <div className="guide-materials__results">{groups.map((group) => <section className="guide-materials__person" key={group.id} aria-label={`Materiales de ${group.name}`}><header className="guide-materials__person-head"><div><span className="guide-materials__avatar" aria-hidden="true">{group.name.slice(0, 1)}</span><h4>{group.name}</h4></div>{groupAction(group.all, `de ${group.name}`)}</header><div className="guide-materials__module">{group.items.map((candidate) => renderResult(candidate, group.id))}</div></section>)}</div>}
    {pages > 1 && <nav className="guide-materials__pagination" aria-label="Páginas de materiales"><button type="button" className="secondary" disabled={currentPage === 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {currentPage} de {pages}</span><button type="button" className="secondary" disabled={currentPage === pages} onClick={() => setPage((value) => value + 1)}>Siguiente</button></nav>}
    <div className="guide-materials__addbar"><span><strong>{stagedCount}</strong> materiales seleccionados{stagedCount ? ' · se conservan al cambiar filtros' : ''}</span><button type="button" disabled={disabled || !stagedCount} onClick={addStaged}>Agregar {stagedCount || ''} materiales a la guía</button>{stagedCount > 0 && <button type="button" className="link-button" disabled={disabled} onClick={() => setStaged(new Set())}>Limpiar selección pendiente</button>}</div>
    {notice && <p className="guide-materials__notice" role="status">{notice}</p>}
    <section className="guide-materials__added" aria-label="Materiales agregados a la guía"><header><div><span>DATOS PARA TU GUÍA</span><h3>Materiales agregados <strong>{selected.length}</strong></h3><p>Esta lista se guarda en el borrador y es independiente de los filtros de búsqueda.</p></div></header>
      <div className="guide-materials__added-summary">{GUIDE_MATERIAL_PRIMARY_TYPES.map((type) => { const count = addedCandidates.filter(({ candidate }) => candidate?.module === type).length; return <span key={type}>{GUIDE_AI_MODULE_LABELS[type]} <strong>{count}</strong></span>; })}<span>Personales <strong>{addedCandidates.filter(({ candidate, ref }) => candidate?.visibility === 'personal' || candidate?.kind === 'exam' && ref.includeSolutions).length}</strong></span></div>
      {selected.length > 0 && <details className="guide-materials__breakdown"><summary>Ver cantidades por persona y parcial</summary><div>{availablePeople.map((person) => { const count = addedCandidates.filter(({ candidate }) => candidate?.authorIds?.includes(person.id)).length; return count > 0 && <span key={person.id}>{person.name}: <strong>{count}</strong></span>; })}{termOptions.map((term) => { const count = addedCandidates.filter(({ candidate }) => candidate && (candidate.termId ?? GUIDE_UNPLACED_TERM) === term.id).length; return count > 0 && <span key={term.id}>{term.name}: <strong>{count}</strong></span>; })}</div></details>}
      {!selected.length && <p className="guide-materials__empty">Todavía no agregaste materiales. Selecciónalos arriba y pulsa Agregar.</p>}
      {addedCandidates.map(({ ref, candidate }) => {
        if (!candidate) return <article className="guide-materials__card" key={guideAiCandidateKey(ref)}><p>Material no disponible o pendiente de comprobar: {GUIDE_AI_SOURCE_LABELS[ref.kind]}</p><button type="button" className="link-button" disabled={disabled} onClick={() => removeRef(ref)}>Quitar material no disponible</button></article>;
        const files = guideAiAttachments(data, candidate);
        const latestExamVersion = candidate.kind === 'exam' ? candidates.find((entry) => guideAiCandidateKey(entry) === guideAiCandidateKey(candidate))?.version : undefined;
        const personal = candidate.visibility === 'personal' || candidate.kind === 'exam' && Boolean(ref.includeSolutions);
        return <article className="guide-materials__card is-selected" key={guideAiCandidateKey(ref)}><div className="guide-materials__card-head"><div><strong>{candidate.title}</strong><p className="guide-materials__team">{GUIDE_AI_MODULE_LABELS[candidate.module ?? 'tasks']} · {authorName(candidate)} · {termName(candidate.termId)} · {personal ? candidate.kind === 'exam' && ref.includeSolutions ? 'Incluye soluciones de permiso personal: la guía seguirá privada' : 'Personal: la guía seguirá privada' : 'Compartido'}{termId && candidate.termId && candidate.termId !== termId ? ' · Otro parcial, agregado expresamente' : ''}</p></div><div className="guide-materials__added-actions"><button type="button" className="link-button" aria-label={`Ver material agregado ${candidate.title}`} onClick={() => setPreview({ candidate })}>Ver</button><button type="button" className="link-button" aria-label={`Quitar material ${candidate.title}`} disabled={disabled} onClick={() => removeRef(ref)}>Quitar</button></div></div>
          {candidate.kind === 'exam' && <p className="guide-materials__exam-version">Versión elegida: {ref.examVersion ?? candidate.version}{ref.examVersion !== undefined && ref.examVersion !== latestExamVersion && latestExamVersion !== undefined && <span role="status"> · La versión disponible ahora es {latestExamVersion}. Se conserva tu versión elegida; quita y vuelve a agregar el examen si quieres usar la nueva.</span>}</p>}
          {candidate.kind === 'exam' && candidate.canIncludeSolutions && <label className="guide-materials__solution-check"><input type="checkbox" checked={Boolean(ref.includeSolutions)} disabled={disabled} onChange={(event) => changeRef(candidate, { ...ref, includeSolutions: event.target.checked })} />Incluir soluciones que tengo permiso para consultar</label>}
          <details className="guide-materials__details"><summary>Temas y archivos <span>{ref.transcriptionIds?.length ?? 0} archivos incluidos</span></summary>
            {topics.length > 0 && <fieldset className="guide-materials__topics" disabled={disabled}><legend>Temas relacionados</legend>{topics.map((topic) => <label key={topic}><input type="checkbox" checked={ref.topics.includes(topic)} onChange={(event) => changeRef(candidate, { ...ref, topics: event.target.checked ? [...ref.topics, topic] : ref.topics.filter((entry) => entry !== topic) })} />{topic}</label>)}</fieldset>}
            {files.length > 0 ? <ul className="guide-materials__files">{files.map((file) => { const cached = preparedFor(candidate, file), included = includedFile(candidate, file); return <li key={file.id}><div><Icon name="file" size={17} /><span><strong>{file.name}</strong><small>{fileSize(file.size)} · {included ? 'Incluido' : chosenFiles.has(file.id) ? 'Elegido, pendiente de revisar' : 'Sin elegir'}</small></span></div><div><label className="guide-materials__file-check"><input type="checkbox" aria-label={`Usar ${file.name}`} checked={included || chosenFiles.has(file.id)} disabled={disabled} onChange={(event) => { const checked = event.target.checked, next = new Set(chosenFiles); if (checked) next.add(file.id); else next.delete(file.id); changeChosen(next); if (cached) changeRef(candidate, { ...ref, transcriptionIds: checked ? [...new Set([...(ref.transcriptionIds ?? []), cached.id])] : (ref.transcriptionIds ?? []).filter((id) => id !== cached.id) }); }} />Usar</label><button type="button" className="link-button" aria-label={`Ver y revisar ${file.name}`} onClick={() => setPreview({ candidate, file })}>Ver y revisar</button></div></li>; })}</ul> : <p className="field__hint">Este material no tiene archivos adjuntos.</p>}
            {Boolean(ref.transcriptionIds?.length) && <button type="button" className="link-button" disabled={disabled} onClick={() => { changeRef(candidate, { ...ref, transcriptionIds: [] }); const ids = new Set(files.map((file) => file.id)); changeChosen(new Set([...chosenFiles].filter((id) => !ids.has(id)))); }}>Quitar archivos incluidos de este material</button>}
          </details>
        </article>;
      })}
      {missingChosenFiles.length > 0 && <section className="guide-materials__missing-files" aria-label="Archivos elegidos no disponibles"><h4>Archivos elegidos no disponibles</h4><p>Estos archivos se retiraron, dejaron de estar accesibles o ya no pertenecen a un material agregado. Retíralos expresamente para continuar; sus nombres y contenido permanecen ocultos.</p><ul>{missingChosenFiles.map((id, index) => <li key={id}><span>Archivo elegido no disponible {index + 1}</span><button type="button" className="link-button" disabled={disabled} onClick={() => removeUnavailableFile(id)}>Quitar archivo no disponible</button></li>)}</ul></section>}
      {pendingFiles.length > 0 && <div className="guide-materials__queue" role="status"><div><strong>{pendingFiles.length} {pendingFiles.length === 1 ? 'archivo elegido pendiente' : 'archivos elegidos pendientes'}</strong><span>Revisa sus textos o quita los archivos que no quieras usar para continuar.</span></div><button type="button" disabled={disabled} onClick={() => setPreview(pendingFiles[0])}>Revisar archivos elegidos</button></div>}
      {addedCandidates.some(({ candidate, ref }) => candidate?.visibility === 'personal' || candidate?.kind === 'exam' && ref.includeSolutions) && <p className="guide-materials__notice">Incluiste materiales personales propios. Puedes trabajar en privado; para publicar la guía tendrás que resolver esas fuentes.</p>}
    </section>
    {preview && (currentPreview ? currentPreview.kind === 'exam' ? <ExamMaterialPreview candidate={currentPreview} version={refFor(currentPreview)?.examVersion ?? currentPreview.version} currentVersion={candidates.find((entry) => guideAiCandidateKey(entry) === guideAiCandidateKey(currentPreview))?.version} includeSolutions={Boolean(refFor(currentPreview)?.includeSolutions)} selected={Boolean(refFor(currentPreview))} disabled={disabled} onAdd={() => addCandidates([currentPreview])} onRemove={() => removeRef(refFor(currentPreview)!)} onClose={() => setPreview(undefined)} /> : <MaterialPreview key={`${guideAiCandidateKey(preview.candidate)}:${preview.file?.id ?? ''}`} candidate={currentPreview} initialFile={preview.file} selected={Boolean(refFor(currentPreview))} disabled={disabled} cachedExtractions={Object.fromEntries(Object.entries(extractions).filter(([, entry]) => entry.sourceRevision === currentPreview.revision).map(([id, entry]) => [id, entry.value]))} onExtracted={(fileId, value) => setExtractions((current) => ({ ...current, [fileId]: { value, sourceRevision: currentPreview.revision } }))} onSaved={(transcription) => savedFile(currentPreview, transcription)} onChooseFile={(file) => setPreview({ candidate: currentPreview, file })} onSkipFile={(fileId) => { changeChosen(new Set([...chosenFiles].filter((id) => id !== fileId))); const skippedFile = guideAiAttachments(data, currentPreview).find((file) => file.id === fileId); const cached = skippedFile ? preparedFor(currentPreview, skippedFile) : undefined; const ref = refFor(currentPreview); if (ref && cached) changeRef(currentPreview, { ...ref, transcriptionIds: (ref.transcriptionIds ?? []).filter((id) => id !== cached.id) }); setPreview(pendingFiles.find((entry) => entry.file.id !== fileId)); }} remainingFiles={pendingFiles.filter((entry) => entry.file.id !== preview.file?.id).length} onNext={() => setPreview(pendingFiles.find((entry) => entry.file.id !== preview.file?.id))} onAdd={() => addCandidates([currentPreview])} onRemove={() => removeRef(refFor(currentPreview)!)} onClose={() => setPreview(undefined)} /> : <PreviewShell title="Material actualizado" onClose={() => setPreview(undefined)}><p role="alert">Este material cambió o dejó de estar disponible. Cierra la vista previa y revisa la selección vigente.</p></PreviewShell>)}
  </div>;
}

function ExamMaterialPreview({ candidate, version, currentVersion, includeSolutions, selected, disabled, onAdd, onRemove, onClose }: { candidate: GuideAiCandidate; version: number; currentVersion?: number; includeSolutions: boolean; selected: boolean; disabled: boolean; onAdd(): void; onRemove(): void; onClose(): void }) {
  const source = useDataSource(); const [content, setContent] = useState(''), [previewTitle, setPreviewTitle] = useState(candidate.title), [previewVisibility, setPreviewVisibility] = useState(candidate.visibility), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => { let current = true; setLoading(true); setError(''); setContent(''); void source.getGuideExamMaterial(candidate.refId, version, includeSolutions).then((value) => { if (current) { setContent(value.text); setPreviewTitle(value.title); setPreviewVisibility(value.visibility); } }).catch((failure: unknown) => { if (current) setError(message(failure)); }).finally(() => { if (current) setLoading(false); }); return () => { current = false; }; }, [source, candidate.refId, version, includeSolutions]);
  return <PreviewShell title={previewTitle} onClose={onClose}><p className="guide-preview__context">Examen · versión elegida {version} · {previewVisibility === 'personal' ? 'Personal propio' : 'Compartido'}</p>{currentVersion !== undefined && version !== currentVersion && <p className="guide-materials__notice">Estás consultando la versión elegida {version}. La versión actual disponible es {currentVersion}; tu selección no se ha actualizado automáticamente.</p>}{loading ? <p role="status">Consultando el contenido permitido del examen…</p> : error ? <p role="alert" className="error">{error}</p> : <StructuredText text={content} />}<p className="field__hint">Esta vista no inicia intentos ni consulta respuestas o calificaciones de otras personas.</p><footer><button type="button" disabled={disabled || !selected && (loading || Boolean(error))} onClick={selected ? onRemove : onAdd}>{selected ? 'Quitar material' : 'Agregar material'}</button><button type="button" className="secondary" onClick={onClose}>Volver a los materiales</button></footer></PreviewShell>;
}

function PreviewShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose(): void }) {
  const titleId = useId(); const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])].filter((element) => !element.closest('[hidden]'));
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return createPortal(<div className="guide-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="guide-preview" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} onKeyDown={keyDown}>
    <header><div><span>Vista previa del material</span><h2 id={titleId}>{title}</h2></div><button type="button" className="icon-button" aria-label="Cerrar vista previa" onClick={onClose}><Icon name="close" size={21} /></button></header>{children}
  </div></div>, document.body);
}
function MaterialPreview({ candidate, initialFile, selected, disabled, cachedExtractions, onExtracted, onSaved, onChooseFile, onSkipFile, remainingFiles, onNext, onAdd, onRemove, onClose }: {
  candidate: GuideAiCandidate; initialFile?: ResourceFile; selected: boolean; disabled: boolean; cachedExtractions: Record<string, GuideDocumentExtraction>;
  onExtracted(fileId: string, value: GuideDocumentExtraction): void; onSaved(value: GuideAiTranscription): void; remainingFiles: number; onChooseFile(file?: ResourceFile): void; onSkipFile(fileId: string): void; onNext(): void; onAdd(): void; onRemove(): void; onClose(): void;
}) {
  const source = useDataSource(), data = useSnapshot(), actor = data.me?.id;
  const files = guideAiAttachments(data, candidate); const [file, setFile] = useState(initialFile);
  const [url, setUrl] = useState(''); const [image, setImage] = useState(false);
  const [extracted, setExtracted] = useState<GuideDocumentExtraction | undefined>(initialFile ? cachedExtractions[initialFile.id] : undefined);
  const [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState('');
  const operation = useRef(0), abort = useRef<AbortController | undefined>(undefined), objectUrl = useRef<string | undefined>(undefined), alive = useRef(true);
  const current = () => alive.current && source.getSnapshot().me?.id === actor && source.getSnapshot().me?.status === 'active';
  const clearUrl = () => { if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = undefined; } setUrl(''); };
  const openFile = async (next: ResourceFile) => {
    const request = ++operation.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setFile(next); setExtracted(cachedExtractions[next.id]); setReviewed(false); setError(''); setSaved(''); setBusy(true); clearUrl();
    try {
      if (next.size > GUIDE_AI_LIMITS.maxDocumentBytes) throw new Error('Este archivo supera los 10 MiB admitidos para la vista previa y extracción. Elige otro archivo o divídelo.');
      const metadata = await source.getGuideAiFile(next.id); if (!current() || request !== operation.current) return;
      const blob = await source.downloadResourceFile(next.id, { signal: controller.signal }); if (!current() || request !== operation.current || controller.signal.aborted) return;
      if (/^image\/(png|jpeg|gif|webp|avif)$/.test(blob.type) || blob.type === 'application/pdf') {
        const nextUrl = URL.createObjectURL(blob); objectUrl.current = nextUrl; setUrl(nextUrl); setImage(blob.type.startsWith('image/'));
      }
      if (supportsGuideExtraction(metadata.name, metadata.contentType) && !cachedExtractions[next.id]) {
        const value = await extractGuideDocument({ fileId: next.id, fileHash: metadata.fileHash, fileVersion: metadata.targetVersion, fileName: metadata.name, mimeType: metadata.contentType, blob, signal: controller.signal });
        if (current() && request === operation.current && !controller.signal.aborted) { setExtracted(value); onExtracted(next.id, value); }
      }
    } catch (failure) { if (current() && request === operation.current && !controller.signal.aborted) setError(message(failure)); }
    finally { if (current() && request === operation.current) setBusy(false); }
  };
  useEffect(() => { alive.current = true; if (initialFile) void openFile(initialFile); return () => { alive.current = false; operation.current++; abort.current?.abort(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }; }, []);
  const save = async () => {
    if (!file || !extracted || extracted.status !== 'ready' || !reviewed || !selected || disabled || busy) return;
    const request = ++operation.current; setBusy(true); setError('');
    try {
      const transcription = await source.saveGuideAiTranscription({ id: crypto.randomUUID(), fileId: file.id, fileHash: extracted.fileHash, targetKind: candidate.kind, targetId: candidate.refId,
        targetVersion: extracted.fileVersion, text: extracted.segments.map((segment) => segment.text).join('\n'), segments: extracted.segments, omissions: extracted.omissions.map((omission) => omission.reason), reviewed: true });
      if (current() && request === operation.current) { onSaved(transcription); setSaved(`«${file.name}» incluido en tu selección.`); setReviewed(false); }
    } catch (failure) { if (current() && request === operation.current) setError(message(failure)); }
    finally { if (current() && request === operation.current) setBusy(false); }
  };
  return <PreviewShell title={file?.name ?? candidate.title} onClose={onClose}>
    <p className="guide-preview__context">{GUIDE_AI_SOURCE_LABELS[candidate.kind]} · {candidate.title} · versión {candidate.version}</p>
    <nav className="guide-preview__tabs" aria-label="Contenido de la vista previa"><button type="button" className="secondary" aria-pressed={!file} onClick={() => onChooseFile()}>Texto del material</button>{files.map((entry) => <button type="button" className="secondary" key={entry.id} aria-pressed={entry.id === file?.id} disabled={busy} onClick={() => onChooseFile(entry)}>{entry.name}</button>)}</nav>
    {!file ? <div className="guide-preview__source"><StructuredText text={guideAiCandidateText(data, candidate) || 'Este material no tiene texto escrito. Revisa sus archivos adjuntos.'} /></div> : <>
      <p className="field__hint">{fileSize(file.size)} · {file.contentType || 'Documento'}</p>
      {busy && <p role="status">Preparando vista previa…</p>}
      {url && (image ? <img className="guide-preview__image" src={url} alt={file.name} /> : <iframe className="guide-preview__document" src={url} title={`Documento original: ${file.name}`} sandbox="" tabIndex={-1} />)}
      {extracted && <section className="guide-preview__transcription"><h3>Texto que se incluirá en la guía</h3><p>Revisa el texto y corrige cualquier error de lectura antes de incluirlo.</p>
        {extracted.omissions.length > 0 && <ul className="guide-materials__notice">{extracted.omissions.map((omission, index) => <li key={index}>{omission.reason}</li>)}</ul>}
        {extracted.segments.map((segment, index) => <label className="field" key={segment.id}><span>{locatorLabel(segment.locator)}</span><textarea rows={4} value={segment.text} disabled={disabled || busy} onChange={(event) => { const segments = extracted.segments.map((entry, position) => position === index ? { ...entry, text: event.target.value } : entry); const next = { ...extracted, segments, text: segments.map((entry) => entry.text).join('\n') }; setExtracted(next); setReviewed(false); setSaved(''); onExtracted(file.id, next); }} /></label>)}
        {extracted.status === 'ready' && <><label className="guide-preview__review"><input type="checkbox" checked={reviewed} disabled={disabled || busy || !selected} onChange={(event) => setReviewed(event.target.checked)} />Revisé el texto y sus páginas, párrafos o líneas.</label><button type="button" disabled={disabled || busy || !selected || !reviewed || !extracted.text.trim()} onClick={() => void save()}>Incluir archivo revisado</button></>}
      </section>}
      {!busy && !extracted && !error && <p className="guide-materials__notice">Puedes consultar este archivo, pero su formato requiere una transcripción en texto para usarlo en la guía. Las imágenes y los escaneos no se leen automáticamente.</p>}
    </>}
    {!selected && <p className="guide-materials__notice">Puedes consultar el contenido antes de agregarlo. Usa Agregar material para incluirlo en tu guía y elegir sus archivos.</p>}
    {file && selected && <button type="button" className="link-button" disabled={busy || disabled} onClick={() => onSkipFile(file.id)}>No usar este archivo</button>}
    {saved && <div className="guide-preview__saved"><p role="status">{saved}</p>{remainingFiles > 0 && <button type="button" onClick={onNext}>Revisar siguiente archivo ({remainingFiles})</button>}</div>}{error && <p role="alert" className="error">{error}</p>}
    <footer><span>Solo el contenido agregado y los archivos revisados se usarán en la guía.</span><button type="button" disabled={disabled || busy} onClick={selected ? onRemove : onAdd}>{selected ? 'Quitar material' : 'Agregar material'}</button><button type="button" className="secondary" onClick={onClose}>Volver a los materiales</button></footer>
  </PreviewShell>;
}
