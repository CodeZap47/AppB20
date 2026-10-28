// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideAiSourceRef } from '@b20/core';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { GuideMaterialPicker, type GuideMaterialTranscriptionInfo } from './GuideMaterialPicker';

vi.mock('../lib/guideExtraction', () => ({
  supportsGuideExtraction: (name: string) => name.endsWith('.txt'),
  extractGuideDocument: vi.fn(async (input: { fileId: string; fileVersion: number; fileHash: string; fileName: string }) => ({ ...input, status: 'ready', format: 'text', byteLength: 12, text: 'Texto del archivo', omissions: [], segments: [{ id: 'line-1', text: 'Texto del archivo', locator: { kind: 'lines', start: 1, end: 1 } }] })),
}));
let root: Root, container: HTMLDivElement, source: DemoDataSource, subjectId: string, ownId: string, peerId: string, privateId: string;
let changes = vi.fn<(next: GuideAiSourceRef[]) => void>(); let pendingChanges = vi.fn<(count: number) => void>(); let catalogueChanges = vi.fn<(items: import('../lib/guideAiSources').GuideAiCandidate[]) => void>();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1'); subjectId = source.getSnapshot().subjects[0]!.id;
  ownId = source.saveNote({ subjectId, title: 'Picker-Nota propia', topic: 'Tema', body: 'Texto propio para la vista previa.', visibility: 'group', source: 'student', tags: [] });
  privateId = source.saveNote({ subjectId, title: 'Picker-Nota privada', topic: 'Tema', body: 'Texto privado', visibility: 'personal', source: 'student', tags: [] });
  source.setViewer('demo-2'); peerId = source.saveNote({ subjectId, title: 'Picker-Nota compañera', topic: 'Tema', body: 'Texto de otra persona.', visibility: 'group', source: 'student', tags: [] });
  source.setViewer('demo-1'); changes = vi.fn(); pendingChanges = vi.fn(); catalogueChanges = vi.fn();
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.restoreAllMocks(); });
interface HarnessProps { initial?: GuideAiSourceRef[]; termId?: string; files?: string[]; transcriptions?: GuideMaterialTranscriptionInfo[] }
function Harness({ initial = [], termId, files = [], transcriptions = [] }: HarnessProps) {
  const [selected, setSelected] = useState(initial), [chosenFileIds, setChosenFileIds] = useState(files);
  return <GuideMaterialPicker subjectId={subjectId} termId={termId} topics={['Tema']} selected={selected} onChange={(next) => { changes(next); setSelected(next); }} chosenFileIds={chosenFileIds} onChosenFileIdsChange={setChosenFileIds} restoredTranscriptions={transcriptions} onPendingFilesChange={pendingChanges} onCandidatesChange={catalogueChanges} />;
}
async function show(props: HarnessProps = {}) { await act(async () => root.render(<DataProvider source={source}><Harness {...props} /></DataProvider>)); }
async function fill(label: string, value: string) {
  const field = [...container.querySelectorAll<HTMLLabelElement>('label')].find((entry) => entry.querySelector('span')?.textContent === label)!;
  const input = field.querySelector<HTMLInputElement | HTMLSelectElement>('input,select')!;
  await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
async function search(value: string) { await fill('Buscar materiales o compañeros', value); }
async function click(button: HTMLButtonElement) { expect(button).toBeTruthy(); await act(async () => button.click()); }
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.getAttribute('aria-label') === name || entry.textContent === name)!;
const added = () => container.querySelector<HTMLElement>('[aria-label="Materiales agregados a la guía"]')!;
const sourceCheckbox = (title: string) => [...container.querySelectorAll<HTMLLabelElement>('.ai-source__choice')].find((label) => label.textContent?.includes(title))!.querySelector<HTMLInputElement>('input')!;
async function addMarked() { await click([...container.querySelectorAll<HTMLButtonElement>('.guide-materials__addbar button')].find((entry) => entry.textContent?.startsWith('Agregar '))!); }

 describe('selector completo de materiales para guías', () => {
  it('marca materiales sin agregarlos hasta confirmar y mantiene lo agregado al combinar filtros', async () => {
    await show(); await search('Picker-');
    expect(container.textContent).toContain('Picker-Nota privada');
    await click(button('Elegir todo de Mis materiales')); expect(changes).not.toHaveBeenCalled();
    await addMarked(); expect(changes.mock.lastCall?.[0]).toHaveLength(2); expect(changes.mock.lastCall?.[0].map((ref) => ref.refId)).toEqual(expect.arrayContaining([ownId, privateId]));
    await fill('Procedencia', 'peers'); await fill('Disponibilidad', 'group'); await search('Picker-Nota compañera');
    expect(container.querySelectorAll('.ai-source__choice')).toHaveLength(1); expect(added().textContent).toContain('Picker-Nota propia'); expect(added().textContent).toContain('Picker-Nota privada');
    await click(button('Elegir todo en Notas')); await addMarked(); expect(changes.mock.lastCall?.[0]).toHaveLength(3);
    await click(button('Quitar material Picker-Nota privada')); expect(changes.mock.lastCall?.[0].some((ref) => ref.refId === privateId)).toBe(false);
  });

  it('incluye equipos por cualquier coautor y agrega la fuente una sola vez', async () => {
    const assignmentId = source.createAssignment({ subjectId, kind: 'tarea', title: 'Tarea del equipo', instructions: 'Resuelve' });
    const workId = source.publishWork({ assignmentId, title: 'Picker-Equipo', description: 'Contenido compartido', coauthorIds: ['demo-2'] });
    const peerName = source.getSnapshot().members.find((member) => member.id === 'demo-2')!.displayName;
    source.setViewer('demo-3'); await show(); await search('Picker-Equipo');
    expect(container.querySelectorAll('.ai-source__choice')).toHaveLength(2);
    await click(button(`Elegir todo de ${peerName}`)); await addMarked();
    expect(changes.mock.lastCall?.[0]).toMatchObject([{ refId: workId, kind: 'work' }]);
    expect([...container.querySelectorAll<HTMLInputElement>('.ai-source__choice input')].every((input) => input.checked)).toBe(true);
  });

  it('selecciona todos los resultados filtrados entre páginas sin limitar la guía a treinta fuentes', async () => {
    for (let index = 0; index < 36; index++) source.saveNote({ subjectId, title: `Paginado ${index}`, topic: 'Tema', body: 'Contenido', visibility: 'group', source: 'student', tags: [] });
    await show(); await search('Paginado'); expect(container.querySelectorAll('.ai-source__choice')).toHaveLength(25);
    const all = container.querySelector<HTMLInputElement>('input[aria-label="Seleccionar todos los resultados filtrados"]')!; await act(async () => all.click());
    await click(button('Siguiente')); expect(container.querySelectorAll('.ai-source__choice')).toHaveLength(11);
    expect([...container.querySelectorAll<HTMLInputElement>('.ai-source__choice input')].every((input) => input.checked)).toBe(true);
    await addMarked(); expect(changes.mock.lastCall?.[0]).toHaveLength(36);
  });

  it('permite elegir otro parcial expresamente sin confundirlo con el parcial objetivo', async () => {
    const terms = source.getSnapshot().terms.filter((term) => term.subjectId === subjectId), first = terms[0]!, second = terms[1]!;
    source.createAssignment({ subjectId, termId: first.id, kind: 'tarea', title: 'Filtro-Tarea primer parcial', instructions: 'Contenido' });
    const other = source.createAssignment({ subjectId, termId: second.id, kind: 'examen', title: 'Filtro-Examen otro parcial', instructions: 'Pregunta' });
    await show({ termId: first.id }); await search('Filtro-'); expect(container.textContent).not.toContain('Filtro-Examen otro parcial');
    const allTerms = [...container.querySelectorAll<HTMLLabelElement>('.guide-materials__filter-sets label')].find((label) => label.textContent === 'Todos los parciales')!.querySelector<HTMLInputElement>('input')!; await act(async () => allTerms.click());
    await act(async () => sourceCheckbox('Filtro-Examen otro parcial').click()); await addMarked();
    expect(changes.mock.lastCall?.[0]).toMatchObject([{ refId: other, includeOutsideTerm: true }]);
    expect(added().textContent).toContain('Otro parcial, agregado expresamente');
  });

  it('filtra por varias personas y muestra solo material personal propio sin revelar notas personales ajenas', async () => {
    source.setViewer('demo-2'); source.saveNote({ subjectId, title: 'Secreto ajeno', body: 'No mostrar', topic: 'Tema', visibility: 'personal', source: 'student', tags: [] }); source.setViewer('demo-1');
    await show(); await search('Picker-'); await fill('Disponibilidad', 'personal');
    expect(container.querySelectorAll('.ai-source__choice')).toHaveLength(1); expect(container.textContent).not.toContain('Secreto ajeno'); expect(sourceCheckbox('Picker-Nota privada')).toBeTruthy();
    await fill('Disponibilidad', 'all'); const peerName = source.getSnapshot().members.find((member) => member.id === 'demo-2')!.displayName;
    await fill('Buscar personas', peerName); const person = [...container.querySelectorAll<HTMLLabelElement>('.guide-materials__people label')].find((label) => label.textContent === peerName)!.querySelector<HTMLInputElement>('input')!; await act(async () => person.click());
    expect(container.querySelectorAll('.ai-source__choice')).toHaveLength(1); expect(sourceCheckbox('Picker-Nota compañera')).toBeTruthy();
  });

  it('abre previews antes de agregar y devuelve el foco al cerrar mediante Escape', async () => {
    await show(); await search('Picker-Nota compañera'); const trigger = button('Vista previa de Picker-Nota compañera'); trigger.focus(); await click(trigger);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Texto de otra persona.'); expect(changes).not.toHaveBeenCalled(); expect(document.activeElement).toBe(button('Cerrar vista previa'));
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))); expect(document.activeElement).toBe(button('Volver a los materiales'));
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
    await click(trigger); await click(button('Agregar material')); expect(changes.mock.lastCall?.[0]).toMatchObject([{ refId: peerId }]);
  });

  it('revisa archivos elegidos en secuencia y conserva su estado restaurado desde el borrador', async () => {
    const snapshot = source.getSnapshot(), files = ['lectura.txt', 'otro.txt'].map((name, index) => ({ id: `file-${index}`, targetKind: 'note' as const, targetId: ownId, name, size: 12, contentType: 'text/plain', uploadedBy: snapshot.me!.id, createdAt: new Date() }));
    vi.spyOn(source, 'getSnapshot').mockReturnValue({ ...snapshot, resourceFiles: files });
    vi.spyOn(source, 'getGuideAiFile').mockImplementation(async (id) => ({ fileId: id, fileHash: 'a'.repeat(64), targetKind: 'note', targetId: ownId, targetVersion: 1, name: files.find((file) => file.id === id)!.name, size: 12, contentType: 'text/plain' }));
    const download = vi.spyOn(source, 'downloadResourceFile').mockResolvedValue(new Blob(['Texto del archivo'], { type: 'text/plain' }));
    const save = vi.spyOn(source, 'saveGuideAiTranscription').mockImplementation(async (input) => ({ ...input, createdAt: Date.now(), label: 'Texto revisado' }));
    await show(); await search('Picker-Nota propia'); await click(button('Elegir todo en Notas')); await addMarked(); expect(pendingChanges.mock.lastCall?.[0]).toBe(2);
    await click(button('Revisar archivos elegidos')); expect(download).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled(); expect(button('Incluir archivo revisado').disabled).toBe(true);
    await act(async () => document.querySelector<HTMLInputElement>('.guide-preview__review input')!.click()); await click(button('Incluir archivo revisado')); expect(pendingChanges.mock.lastCall?.[0]).toBe(1);
    await click(button('Revisar siguiente archivo (1)')); await act(async () => document.querySelector<HTMLInputElement>('.guide-preview__review input')!.click()); await click(button('Incluir archivo revisado')); expect(save).toHaveBeenCalledTimes(2); expect(pendingChanges.mock.lastCall?.[0]).toBe(0);
    await click(button('Volver a los materiales'));
    const refs = changes.mock.lastCall![0], restored = save.mock.calls.map(([input]) => ({ id: input.id, fileId: input.fileId, targetKind: input.targetKind, targetId: input.targetId, targetVersion: input.targetVersion }));
    await act(async () => root.unmount()); root = createRoot(container);
    await show({ initial: refs, files: files.map((file) => file.id), transcriptions: restored }); expect(pendingChanges.mock.lastCall?.[0]).toBe(0);
    expect(added().textContent).toContain('2 archivos incluidos');
    const check = added().querySelector<HTMLInputElement>('input[aria-label="Usar lectura.txt"]')!; expect(check.checked).toBe(true); await act(async () => check.click()); expect(changes.mock.lastCall?.[0][0]!.transcriptionIds).toHaveLength(1);
  });

  it('incluye exámenes del módulo con versión y contenido autorizado en su vista previa', async () => {
    const exam = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Picker-Examen del módulo', subjectId, version: 3, topics: ['Tema'], ownerId: 'demo-1', visibility: 'personal' as const, canIncludeSolutions: true, sourceIssues: [] };
    vi.spyOn(source, 'listGuideExamMaterials').mockResolvedValue([exam]); const preview = vi.spyOn(source, 'getGuideExamMaterial').mockResolvedValue({ ...exam, text: 'Pregunta autorizada', fields: [{ name: 'pregunta:1', text: 'Pregunta autorizada' }], omissions: [] });
    await show(); await search('Picker-Examen'); expect(sourceCheckbox(exam.title)).toBeTruthy(); await click(button(`Vista previa de ${exam.title}`)); expect(preview).toHaveBeenCalledWith(exam.id, 3, false); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Pregunta autorizada');
    await click(button('Agregar material')); expect(changes.mock.lastCall?.[0]).toMatchObject([{ kind: 'exam', refId: exam.id, examVersion: 3, includeSolutions: false }]);
    await click(button('Volver a los materiales')); expect(added().textContent).toContain('Incluir soluciones que tengo permiso para consultar');
    const solutions = added().querySelector<HTMLInputElement>('.guide-materials__solution-check input')!; expect(solutions.checked).toBe(false);
    await act(async () => solutions.click()); expect(changes.mock.lastCall?.[0][0]?.includeSolutions).toBe(true);
  });

  it('revoca la URL temporal de una imagen al cerrar el popup', async () => {
    const snapshot = source.getSnapshot(), image = { id: 'image-1', targetKind: 'note' as const, targetId: ownId, name: 'imagen.png', size: 12, contentType: 'image/png', uploadedBy: snapshot.me!.id, createdAt: new Date() };
    vi.spyOn(source, 'getSnapshot').mockReturnValue({ ...snapshot, resourceFiles: [image] }); vi.spyOn(source, 'getGuideAiFile').mockResolvedValue({ fileId: image.id, fileHash: 'a'.repeat(64), targetKind: 'note', targetId: ownId, targetVersion: 1, name: image.name, size: 12, contentType: image.contentType }); vi.spyOn(source, 'downloadResourceFile').mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    const create = vi.fn(() => 'blob:preview-test'), revoke = vi.fn(); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    await show({ initial: [{ kind: 'note', refId: ownId, topics: ['Tema'], includeUnplaced: true }] }); await click(button(`Ver y revisar ${image.name}`)); expect(document.querySelector<HTMLImageElement>('.guide-preview__image')?.src).toBe('blob:preview-test'); await click(button('Volver a los materiales')); expect(revoke).toHaveBeenCalledWith('blob:preview-test');
  });
  it('bloquea por archivos elegidos retirados sin revelar sus nombres y permite quitarlos expresamente', async () => {
    const snapshot = source.getSnapshot(), transcriptionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const removed = { id: 'removed-private-file', targetKind: 'note' as const, targetId: ownId, name: 'NOMBRE RETIRADO OCULTO.txt', size: 12, contentType: 'text/plain', uploadedBy: snapshot.me!.id, createdAt: new Date(), removedAt: new Date() };
    vi.spyOn(source, 'getSnapshot').mockReturnValue({ ...snapshot, resourceFiles: [removed] });
    await show({ initial: [{ kind: 'note', refId: ownId, topics: ['Tema'], includeUnplaced: true, transcriptionIds: [transcriptionId] }], files: [removed.id], transcriptions: [{ id: transcriptionId, fileId: removed.id, targetKind: 'note', targetId: ownId, targetVersion: 1 }] });
    expect(pendingChanges.mock.lastCall?.[0]).toBe(1);
    expect(container.querySelector('[aria-label="Archivos elegidos no disponibles"]')).not.toBeNull();
    expect(container.textContent).not.toContain(removed.name); expect(container.textContent).not.toContain(removed.id);
    await click(button('Quitar archivo no disponible'));
    expect(pendingChanges.mock.lastCall?.[0]).toBe(0); expect(container.querySelector('[aria-label="Archivos elegidos no disponibles"]')).toBeNull();
    expect(changes.mock.lastCall?.[0][0]?.transcriptionIds).toEqual([]);
  });

  it('conserva y consulta la versión de examen agregada aunque el catálogo ya ofrezca otra versión', async () => {
    const exam = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'Picker-Examen actualizado', subjectId, version: 4, topics: ['Tema'], ownerId: 'demo-1', visibility: 'group' as const, canIncludeSolutions: true, sourceIssues: [] };
    vi.spyOn(source, 'listGuideExamMaterials').mockResolvedValue([exam]);
    const preview = vi.spyOn(source, 'getGuideExamMaterial').mockResolvedValue({ ...exam, version: 2, title: 'Examen que elegí antes', text: 'Pregunta de la versión elegida', fields: [{ name: 'pregunta:1', text: 'Pregunta de la versión elegida' }], omissions: [] });
    await show({ initial: [{ kind: 'exam', refId: exam.id, examVersion: 2, includeSolutions: false, topics: ['Tema'], includeUnplaced: true }] });
    expect(added().textContent).toContain('Versión elegida: 2'); expect(added().textContent).toContain('La versión disponible ahora es 4');
    expect(changes).not.toHaveBeenCalled();
    await click(button('Ver material agregado Examen que elegí antes'));
    expect(preview).toHaveBeenCalledWith(exam.id, 2, false);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Pregunta de la versión elegida');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Examen que elegí antes');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('tu selección no se ha actualizado automáticamente');
    expect(changes).not.toHaveBeenCalled();
  });

  it('usa la privacidad y el título de la versión seleccionada en la cesta y en el catálogo efectivo del padre', async () => {
    const current = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', title: 'Borrador nuevo personal', subjectId, version: 5, topics: ['Tema'], ownerId: 'demo-1', visibility: 'personal' as const, canIncludeSolutions: true, sourceIssues: [] };
    vi.spyOn(source, 'listGuideExamMaterials').mockResolvedValue([current]);
    const projection = vi.spyOn(source, 'getGuideExamMaterial').mockResolvedValue({ ...current, version: 2, title: 'Versión compartida elegida', visibility: 'group', text: 'Texto autorizado compartido', fields: [{ name: 'pregunta:1', text: 'Texto autorizado compartido' }], omissions: [] });
    await show({ initial: [{ kind: 'exam', refId: current.id, examVersion: 2, includeSolutions: false, topics: ['Tema'], includeUnplaced: true }] });
    expect(projection).toHaveBeenCalledWith(current.id, 2, false);
    expect(added().textContent).toContain('Versión compartida elegida'); expect(added().textContent).not.toContain('Borrador nuevo personal');
    expect(added().textContent).not.toContain('Personal: la guía seguirá privada');
    expect(catalogueChanges.mock.lastCall?.[0].find((candidate) => candidate.kind === 'exam' && candidate.refId === current.id)).toMatchObject({ version: 2, title: 'Versión compartida elegida', visibility: 'group' });
    await click(button('Ver material agregado Versión compartida elegida'));
    expect(document.querySelector('[role="dialog"] .guide-preview__context')?.textContent).toContain('Compartido');
  });

  it('excluye del catálogo efectivo un examen seleccionado inaccesible y ofrece retirarlo sin actualizar su versión', async () => {
    const exam = { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', title: 'Versión actual accesible', subjectId, version: 5, topics: ['Tema'], ownerId: 'demo-1', visibility: 'group' as const, canIncludeSolutions: true, sourceIssues: [] };
    vi.spyOn(source, 'listGuideExamMaterials').mockResolvedValue([exam]); vi.spyOn(source, 'getGuideExamMaterial').mockRejectedValue(new Error('La versión elegida ya no está disponible.'));
    await show({ initial: [{ kind: 'exam', refId: exam.id, examVersion: 2, includeSolutions: false, topics: ['Tema'], includeUnplaced: true }] });
    expect(catalogueChanges.mock.lastCall?.[0].some((candidate) => candidate.kind === 'exam' && candidate.refId === exam.id)).toBe(false);
    expect(added().textContent).toContain('Material no disponible o pendiente de comprobar'); expect(changes).not.toHaveBeenCalled();
    await click(button('Quitar material no disponible')); expect(changes.mock.lastCall?.[0]).toEqual([]);
  });

});
