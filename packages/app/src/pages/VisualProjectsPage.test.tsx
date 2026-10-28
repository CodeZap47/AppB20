// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { buildNavigation, resolveActiveUrl } from '../components/navigation';
import { RelatedVisualProjects } from '../components/RelatedVisualProjects';
import { VisualProjectFormPage, VisualProjectPage, VisualProjectsPage } from './VisualProjectsPage';

const BASE = '/m/laboratorio-visual';
let container: HTMLDivElement;
let root: Root;
let source: DemoDataSource;
let state: ReturnType<typeof createDemoState>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:visual-cover');
    static revokeObjectURL = vi.fn();
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  state = createDemoState(); source = new DemoDataSource(state, 'demo-1');
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function Location() { const location = useLocation(); return <output data-location>{location.pathname}{location.search}</output>; }
async function show(path = BASE) {
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter key={path} initialEntries={[path]}><Routes>
    <Route path={BASE} element={<VisualProjectsPage />} /><Route path={`${BASE}/nuevo`} element={<VisualProjectFormPage />} />
    <Route path={`${BASE}/:projectId/editar`} element={<VisualProjectFormPage />} /><Route path={`${BASE}/:projectId`} element={<VisualProjectPage />} />
  </Routes><Location /></MemoryRouter></DataProvider>));
}
function field(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const aria = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
  if (aria) return aria;
  const node = [...container.querySelectorAll<HTMLLabelElement>('label')].find(row => row.querySelector('.field__label')?.textContent === label);
  const control = node?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select');
  if (!control) throw new Error(`Falta el campo ${label}`); return control;
}
async function change(label: string, value: string) {
  const control = field(label);
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
function button(label: string) { const node = [...container.querySelectorAll<HTMLButtonElement>('button')].find(row => row.textContent?.trim() === label); if (!node) throw new Error(`Falta el botón ${label}`); return node; }
async function click(label: string) { await act(async () => button(label).click()); }
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
const listed = () => [...container.querySelectorAll<HTMLAnchorElement>('.visual-card-main')].map(link => link.getAttribute('href')!.split('/').at(-1));
const location = () => container.querySelector('[data-location]')?.textContent;
const png = () => { const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]); const file = new File([bytes], 'portada.png', { type: 'image/png' }); Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer }); return file; };
async function selectFile(file: File) { const input = field('Imagen de portada'); Object.defineProperty(input, 'files', { value: [file], configurable: true }); await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); }

describe('Laboratorio visual', () => {
  it('abre como acceso directo después de Estudio y conserva la selección en fichas y formularios', () => {
    const { items, footerItems } = buildNavigation();
    const study = items.findIndex(item => item.label === 'Estudio');
    expect(items[study + 1]).toMatchObject({ label: 'Laboratorio visual', href: BASE });
    expect(items[study + 1]?.items).toBeUndefined();
    expect(resolveActiveUrl(`${BASE}/proyecto/editar`, items, footerItems)).toBe(BASE);
  });

  it('combina filtros de texto, materia, parcial, tipo y relación, y los conserva en la URL', async () => {
    const assignment = state.assignments[0]!;
    const id = await source.saveVisualProject({ title: 'Hardware y memoria', kind: '3d', subjectIds: [assignment.subjectId], termId: assignment.termId, links: [{ kind: 'assignment', id: assignment.id }] });
    await source.saveVisualProject({ title: 'Hardware dibujado', kind: 'graphic', subjectIds: [assignment.subjectId] });
    await source.saveVisualProject({ title: 'Otro tema', kind: '3d' });
    const params = new URLSearchParams({ q: 'hardware', materia: assignment.subjectId, tipo: '3d', recurso: `assignment:${assignment.id}` });
    if (assignment.termId) params.set('parcial', assignment.termId);
    await show(`${BASE}?${params}`);
    expect(listed()).toEqual([id]);
    expect(field('Filtrar por materia').value).toBe(assignment.subjectId);
    await change('Mostrar proyectos', 'mios');
    expect(location()).toContain('vista=mios'); expect(location()).toContain('q=hardware'); expect(listed()).toEqual([id]);
    await click('Limpiar filtros'); expect(listed()).toHaveLength(3); expect(location()).toBe(BASE);
  });

  it('conserva la escritura rápida y sincroniza la búsqueda en la URL sin navegar por cada letra', async () => {
    await source.saveVisualProject({ title: 'Memoria RAM', kind: '3d' });
    await source.saveVisualProject({ title: 'Procesador', kind: '3d' });
    await show();
    vi.useFakeTimers();
    for (const value of ['M', 'Me', 'Mem', 'Memo', 'Memor', 'Memori', 'Memoria']) await change('Buscar proyectos', value);
    expect(field('Buscar proyectos').value).toBe('Memoria');
    expect(listed()).toHaveLength(1);
    expect(location()).toBe(BASE);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(location()).toBe(`${BASE}?q=Memoria`);
    expect(field('Buscar proyectos').value).toBe('Memoria');
    await change('Buscar proyectos', 'Nuevo texto pendiente');
    await click('Limpiar filtros');
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(field('Buscar proyectos').value).toBe(''); expect(location()).toBe(BASE); expect(listed()).toHaveLength(2);
  });

  it('sincroniza atrás y adelante y cancela una búsqueda pendiente al recorrer el historial', async () => {
    function HistoryControls() { const navigate = useNavigate(); return <><button type="button" onClick={() => void navigate(-1)}>Atrás en historial</button><button type="button" onClick={() => void navigate(1)}>Adelante en historial</button></>; }
    await act(async () => root.render(<DataProvider source={source}><MemoryRouter initialEntries={[`${BASE}?q=RAM`, `${BASE}?q=CPU`]}><VisualProjectsPage /><HistoryControls /><Location /></MemoryRouter></DataProvider>));
    vi.useFakeTimers();
    await change('Buscar proyectos', 'Texto pendiente');
    await click('Atrás en historial');
    expect(field('Buscar proyectos').value).toBe('RAM');
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(location()).toBe(`${BASE}?q=RAM`);
    await click('Adelante en historial'); expect(field('Buscar proyectos').value).toBe('CPU'); expect(location()).toBe(`${BASE}?q=CPU`);
  });

  it('precarga el contexto académico y crea una ficha privada con enlaces reales', async () => {
    const assignment = state.assignments.find(row => row.termId)!;
    await show(`${BASE}/nuevo?origen=assignment:${assignment.id}`);
    expect((field('Parcial') as HTMLSelectElement).value).toBe(assignment.termId);
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter(input => input.checked)).toHaveLength(2);
    await change('Título del proyecto', 'Un recorrido por la RAM');
    await change('Descripción', 'La CPU intercambia datos con la memoria.');
    await change('Etiquetas', 'hardware, memoria');
    await submit();
    const project = source.getSnapshot().visualProjects[0]!;
    expect(project).toMatchObject({ title: 'Un recorrido por la RAM', visibility: 'personal', subjectIds: [assignment.subjectId], termId: assignment.termId, links: [{ kind: 'assignment', id: assignment.id }], tags: ['hardware', 'memoria'] });
    expect(location()).toBe(`${BASE}/${project.id}`); expect(container.textContent).toContain('Publicar para el grupo');
  });

  it('publica explícitamente, vuelve a privado y permite archivar y restaurar', async () => {
    const id = await source.saveVisualProject({ title: 'Arquitectura de redes', kind: 'simulation' });
    await show(`${BASE}/${id}`);
    await click('Publicar para el grupo'); expect(source.getSnapshot().visualProjects[0]?.visibility).toBe('group');
    await click('Volver a privado'); expect(source.getSnapshot().visualProjects[0]?.visibility).toBe('personal');
    await click('Archivar proyecto'); expect(source.getSnapshot().visualProjects[0]?.archived).toBe(true);
    expect(container.querySelector(`a[href="${BASE}/${id}/editar"]`)).toBeNull();
    await click('Restaurar proyecto'); expect(source.getSnapshot().visualProjects[0]?.archived).toBe(false);
  });

  it('explica por qué no puede publicar una nota personal y conserva la ficha', async () => {
    const noteId = source.saveNote({ title: 'Mi nota', body: 'Solo yo', subjectId: state.subjects[0]!.id, topic: '', source: 'student', visibility: 'personal', tags: [] });
    const id = await source.saveVisualProject({ title: 'Mi explicación', kind: '3d', links: [{ kind: 'note', id: noteId }] });
    await show(`${BASE}/${id}`); await click('Publicar para el grupo');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('grupo');
    expect(source.getSnapshot().visualProjects[0]?.visibility).toBe('personal');
    expect(container.textContent).toContain('Mi explicación');
  });

  it('conserva el borrador y detecta una edición simultánea sin sobrescribirla', async () => {
    const id = await source.saveVisualProject({ title: 'Primera idea', kind: 'mixed' });
    await show(`${BASE}/${id}/editar`); await change('Título del proyecto', 'Mi borrador');
    await act(async () => { await source.saveVisualProject({ id, title: 'Cambio ya guardado', kind: 'mixed', expectedVersion: 1 }); });
    expect(field('Título del proyecto').value).toBe('Mi borrador');
    expect(container.textContent).toContain('La ficha cambió');
    expect(button('Guardar cambios').disabled).toBe(true);
    expect(source.getSnapshot().visualProjects[0]?.title).toBe('Cambio ya guardado');
  });

  it('rechaza una portada inválida y conserva los campos para corregirla', async () => {
    const upload = vi.spyOn(source, 'attachResourceFile');
    await show(`${BASE}/nuevo`); await change('Título del proyecto', 'CPU por capas');
    await selectFile(new File(['texto'], 'documento.pdf', { type: 'application/pdf' }));
    await submit();
    expect(container.textContent).toContain('PNG, JPEG o WebP');
    expect(field('Título del proyecto').value).toBe('CPU por capas'); expect(upload).not.toHaveBeenCalled(); expect(source.getSnapshot().visualProjects).toHaveLength(0);
    await selectFile(png());
    expect(container.querySelector('.visual-cover-editor [role="alert"]')).toBeNull();
  });

  it('reintenta la portada sin crear una segunda ficha ni alterar su versión de subida', async () => {
    const save = vi.spyOn(source, 'saveVisualProject');
    const original = source.attachResourceFile.bind(source);
    const upload = vi.spyOn(source, 'attachResourceFile').mockRejectedValueOnce(new Error('Conexión interrumpida')).mockImplementation(original);
    await show(`${BASE}/nuevo`); await change('Título del proyecto', 'Una placa base'); await selectFile(png()); await submit();
    expect(source.getSnapshot().visualProjects).toHaveLength(1);
    expect(container.textContent).toContain('La ficha está guardada'); expect(save).toHaveBeenCalledTimes(1);
    await submit();
    // FileReader completion occurs outside React's submit event in jsdom.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(save).toHaveBeenCalledTimes(1); expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls.map(call => [call[0], call[1], call[3]])).toEqual([['visual_project', source.getSnapshot().visualProjects[0]!.id, 1], ['visual_project', source.getSnapshot().visualProjects[0]!.id, 1]]);
    expect(source.getSnapshot().visualProjects[0]?.coverFileId).toBeDefined();
    expect(location()).toBe(`${BASE}/${source.getSnapshot().visualProjects[0]!.id}`);
  });

  it('no cambia de pantalla cuando termina un guardado después de cancelar', async () => {
    let complete!: (id: string) => void;
    vi.spyOn(source, 'saveVisualProject').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await show(`${BASE}/nuevo`); await change('Título del proyecto', 'Idea pendiente'); await submit();
    const cancel = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(link => link.textContent?.trim() === 'Cancelar')!;
    await act(async () => cancel.click()); expect(location()).toBe(BASE);
    await act(async () => complete('guardado-tarde')); expect(location()).toBe(BASE);
  });

  it('consulta ocho proveedores y diferencia CAD de formatos web sin ofrecer simulaciones activas', async () => {
    await show(`${BASE}?pestana=proveedores`);
    expect(container.querySelectorAll('.visual-provider-card')).toHaveLength(8);
    expect(container.textContent).toContain('Los archivos CAD requieren conversión');
    for (const link of container.querySelectorAll<HTMLAnchorElement>('.visual-provider-links a')) {
      expect(link.href.startsWith('https://')).toBe(true); expect(link.rel).toContain('noopener');
    }
    await change('Filtrar proveedores', 'Web');
    expect(container.querySelectorAll('.visual-provider-card')).toHaveLength(1);
    expect(container.textContent).toContain('Sketchfab');
    expect([...container.querySelectorAll('button')].some(row => /simular|narrar|abrir visor/i.test(row.textContent ?? ''))).toBe(false);
  });

  it('muestra proyectos relacionados accesibles y un enlace para crearlos desde su origen', async () => {
    const assignment = state.assignments[0]!;
    const linked = await source.saveVisualProject({ title: 'Relacionado', kind: 'graphic', links: [{ kind: 'assignment', id: assignment.id }] });
    await source.saveVisualProject({ title: 'No relacionado', kind: '3d' });
    await act(async () => root.render(<DataProvider source={source}><MemoryRouter><RelatedVisualProjects kind="assignment" id={assignment.id} subjectId={assignment.subjectId} /></MemoryRouter></DataProvider>));
    expect(container.querySelector(`a[href="${BASE}/${linked}"]`)).not.toBeNull(); expect(container.textContent).not.toContain('No relacionado');
    expect(container.querySelector('a[href*="origen=assignment%3A"]')).not.toBeNull();
    // A subject must also discover a project whose subject comes from a linked assignment.
    await act(async () => root.render(<DataProvider source={source}><MemoryRouter><RelatedVisualProjects subjectId={assignment.subjectId} /></MemoryRouter></DataProvider>));
    expect(container.querySelector(`a[href="${BASE}/${linked}"]`)).not.toBeNull();
    expect(container.textContent).not.toContain('No relacionado');
  });
  it('expone el recorrido con el editor disponible y distingue las simulaciones futuras', async () => {
    await source.saveVisualProject({ title: 'Una idea visual', kind: '3d' });
    await show();
    expect([...container.querySelectorAll('.visual-journey li h2')].map(node => node.textContent)).toEqual(['Crear', 'Explorar', 'Comprender', 'Practicar']);
    expect(container.querySelectorAll('.visual-journey-future')).toHaveLength(1);
    expect(container.querySelectorAll('.visual-journey-future a, .visual-journey-future button')).toHaveLength(0);
    expect(container.querySelector('.visual-card-main')?.textContent).toContain('Ficha en preparación');
    expect(container.querySelector('.visual-journey')?.textContent).toContain('El audio llegará después');
    expect(container.querySelector('.visual-journey')?.textContent).toContain('selecciona sus piezas');
  });

  it('limpia el recurso incompatible al cambiar de materia y permite quitar filtros individuales', async () => {
    const assignment = state.assignments.find(row => row.termId)!;
    const otherSubject = state.subjects.find(row => row.id !== assignment.subjectId)!;
    await show(`${BASE}?${new URLSearchParams({ materia: assignment.subjectId, parcial: assignment.termId!, recurso: `assignment:${assignment.id}`, tipo: '3d', q: 'memoria' })}`);
    await change('Filtrar por materia', otherSubject.id);
    expect(field('Filtrar por recurso').value).toBe(''); expect(field('Filtrar por parcial').value).toBe('');
    expect(location()).not.toContain('recurso='); expect(location()).not.toContain('parcial=');
    expect(location()).toContain('tipo=3d'); expect(location()).toContain('q=memoria');
    const chip = container.querySelector<HTMLButtonElement>('[aria-label="Quitar filtro Contenido: 3D"]')!;
    await act(async () => chip.click());
    expect(location()).not.toContain('tipo='); expect(location()).toContain('q=memoria');
    expect(container.querySelector('[aria-label="Filtros activos"]')?.textContent).toContain(otherSubject.name);
  });

  it('normaliza una URL con filtros inexistentes al cargar los datos sin perder la búsqueda', async () => {
    await show(`${BASE}?q=RAM&materia=inexistente&parcial=otro&tipo=invalido&recurso=note%3Ano-existe&vista=incorrecta`);
    expect(location()).toBe(`${BASE}?q=RAM`);
    expect(field('Buscar proyectos').value).toBe('RAM');
  });

  it('mantiene la relación no disponible al editar el título y permite quitarla expresamente', async () => {
    const noteId = source.saveNote({ title: 'Fuente que ya no está', body: 'Contenido de referencia', subjectId: state.subjects[0]!.id, topic: '', source: 'student', visibility: 'group', tags: [] });
    const id = await source.saveVisualProject({ title: 'Mi explicación', kind: '3d', links: [{ kind: 'note', id: noteId }] });
    source.withdrawContent('note', noteId, true, 1);
    await show(`${BASE}/${id}/editar`);
    expect(container.textContent).toContain('Recurso relacionado no disponible');
    expect(container.textContent).not.toContain('Fuente que ya no está');
    expect(container.querySelector(`a[href="/m/notas/${noteId}"]`)).toBeNull();
    await change('Título del proyecto', 'Título revisado'); await submit();
    expect(state.visualProjects.find(project => project.id === id)?.links).toEqual([{ kind: 'note', id: noteId }]);
    expect(container.textContent).toContain('Recurso relacionado no disponible');
    await click('Quitar relación');
    expect(state.visualProjects.find(project => project.id === id)?.links).toEqual([]);
  });

  it('restaura una referencia mientras se edita sin perder la selección del borrador', async () => {
    const noteId = source.saveNote({ title: 'Fuente recuperada', body: 'Contenido', subjectId: state.subjects[0]!.id, topic: '', source: 'student', visibility: 'group', tags: [] });
    const id = await source.saveVisualProject({ title: 'Explicación', kind: 'graphic', links: [{ kind: 'note', id: noteId }] });
    source.withdrawContent('note', noteId, true, 1);
    await show(`${BASE}/${id}/editar`);
    await act(async () => source.withdrawContent('note', noteId, false, 2));
    const checkbox = [...container.querySelectorAll<HTMLLabelElement>('.visual-check')].find(label => label.textContent?.includes('Fuente recuperada'))?.querySelector<HTMLInputElement>('input');
    expect(checkbox?.checked).toBe(true);
    await change('Título del proyecto', 'Explicación revisada'); await submit();
    expect(state.visualProjects.find(project => project.id === id)?.links).toEqual([{ kind: 'note', id: noteId }]);
  });

  it('reemplaza una referencia no disponible de manera expresa al guardar', async () => {
    const noteId = source.saveNote({ title: 'Vieja fuente', body: 'Contenido', subjectId: state.subjects[0]!.id, topic: '', source: 'student', visibility: 'group', tags: [] });
    const id = await source.saveVisualProject({ title: 'Explicación', kind: '3d', links: [{ kind: 'note', id: noteId }] });
    source.withdrawContent('note', noteId, true, 1);
    await show(`${BASE}/${id}/editar`); await click('Reemplazar');
    const assignment = state.assignments[0]!;
    await change('Reemplazar recurso no disponible', `assignment:${assignment.id}`); await submit();
    expect(state.visualProjects.find(project => project.id === id)?.links).toEqual([{ kind: 'assignment', id: assignment.id }]);
  });

  it('conserva la intención de quitar una relación si su fuente se retira antes de guardar', async () => {
    const noteId = source.saveNote({ title: 'Fuente visible', body: 'Contenido', subjectId: state.subjects[0]!.id, topic: '', source: 'student', visibility: 'group', tags: [] });
    const id = await source.saveVisualProject({ title: 'Explicación', kind: '3d', links: [{ kind: 'note', id: noteId }] });
    await show(`${BASE}/${id}/editar`);
    const checkbox = [...container.querySelectorAll<HTMLLabelElement>('.visual-check')].find(label => label.textContent?.includes('Fuente visible'))!.querySelector<HTMLInputElement>('input')!;
    await act(async () => checkbox.click());
    await act(async () => source.withdrawContent('note', noteId, true, 1));
    await submit();
    expect(state.visualProjects.find(project => project.id === id)?.links).toEqual([]);
  });

  it('separa bibliotecas y condiciones y añade una referencia al proyecto de origen sin duplicarla', async () => {
    const id = await source.saveVisualProject({ title: 'Hardware', kind: '3d' });
    const save = vi.spyOn(source, 'saveVisualProject');
    await show(`${BASE}?pestana=proveedores&proyecto=${id}`);
    const card = container.querySelector<HTMLElement>('article[aria-label="Adafruit CAD Parts"]')!;
    expect(card.querySelector('a')?.href).toBe('https://github.com/adafruit/Adafruit_CAD_Parts');
    expect(card.querySelectorAll('a')).toHaveLength(2);
    await act(async () => card.querySelector<HTMLButtonElement>('button')!.click());
    expect(field('Proyecto de destino').value).toBe(id);
    expect(field('Autor del modelo').value).toBe(''); expect(field('Formato del modelo').value).toBe(''); expect(field('Licencia del modelo').value).toBe('');
    await submit();
    expect(container.textContent).toContain('Referencia guardada en el proyecto');
    expect(source.getSnapshot().visualProjects[0]?.resources).toMatchObject([{ provider: 'Adafruit CAD Parts', label: 'Biblioteca de modelos · Adafruit CAD Parts' }]);
    const version = source.getSnapshot().visualProjects[0]!.version;
    await click('Cerrar');
    await act(async () => card.querySelector<HTMLButtonElement>('button')!.click());
    await change('Enlace HTTPS de la referencia', 'https://GITHUB.COM:443/adafruit/Adafruit_CAD_Parts');
    await submit();
    expect(container.textContent).toContain('Esta referencia ya está guardada'); expect(save).toHaveBeenCalledTimes(1);
    expect(source.getSnapshot().visualProjects[0]?.version).toBe(version);
  });

  it('precarga una referencia personalizada en una nueva ficha y solo guarda al crearla', async () => {
    const save = vi.spyOn(source, 'saveVisualProject');
    await show(`${BASE}?pestana=proveedores`);
    const card = container.querySelector<HTMLElement>('article[aria-label="Adafruit CAD Parts"]')!;
    await act(async () => card.querySelector<HTMLButtonElement>('button')!.click());
    await change('Proyecto de destino', 'new');
    await change('Nombre de la referencia', 'Modelo de una placa');
    await change('Enlace HTTPS de la referencia', 'https://example.com/placa.glb');
    await change('Autor del modelo', 'Autora del modelo');
    await change('Licencia del modelo', 'CC BY');
    await submit();
    expect(location()).toBe(`${BASE}/nuevo?proveedor=adafruit`); expect(save).not.toHaveBeenCalled();
    expect(field('Nombre del recurso').value).toBe('Modelo de una placa');
    expect(field('Enlace HTTPS').value).toBe('https://example.com/placa.glb');
    await change('Título del proyecto', 'Explicar una placa'); await submit();
    expect(save).toHaveBeenCalledTimes(1);
    expect(source.getSnapshot().visualProjects[0]?.resources[0]).toMatchObject({ label: 'Modelo de una placa', url: 'https://example.com/placa.glb', author: 'Autora del modelo', license: 'CC BY' });
  });

  it('conserva los campos del proveedor al entrar en conflicto con otra edición', async () => {
    const id = await source.saveVisualProject({ title: 'Primera ficha', kind: '3d' });
    await show(`${BASE}?pestana=proveedores&proyecto=${id}`);
    await act(async () => container.querySelector<HTMLElement>('article[aria-label="Adafruit CAD Parts"]')!.querySelector<HTMLButtonElement>('button')!.click());
    await change('Nombre de la referencia', 'Mi recurso preparado');
    await act(async () => { await source.saveVisualProject({ id, title: 'Edición de otra sesión', kind: '3d', expectedVersion: 1 }); });
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('cambió');
    expect(field('Nombre de la referencia').value).toBe('Mi recurso preparado');
    expect(source.getSnapshot().visualProjects[0]?.resources).toHaveLength(0);
    await click('Usar la versión actual del proyecto'); await submit();
    expect(source.getSnapshot().visualProjects[0]).toMatchObject({ title: 'Edición de otra sesión', resources: [{ label: 'Mi recurso preparado' }] });
  });

  it('añade un proveedor sin borrar una fuente restaurada después de abrir el diálogo', async () => {
    const noteId = source.saveNote({ title: 'Fuente temporalmente retirada', body: 'Contenido', subjectId: state.subjects[0]!.id, topic: '', source: 'student', visibility: 'group', tags: [] });
    const id = await source.saveVisualProject({ title: 'Hardware', kind: '3d', links: [{ kind: 'note', id: noteId }] });
    source.withdrawContent('note', noteId, true, 1);
    await show(`${BASE}?pestana=proveedores&proyecto=${id}`);
    await act(async () => container.querySelector<HTMLElement>('article[aria-label="Adafruit CAD Parts"]')!.querySelector<HTMLButtonElement>('button')!.click());
    await act(async () => source.withdrawContent('note', noteId, false, 2)); await submit();
    expect(state.visualProjects.find(project => project.id === id)?.links).toEqual([{ kind: 'note', id: noteId }]);
    expect(state.visualProjects.find(project => project.id === id)?.resources).toHaveLength(1);
  });

  it('muestra un error recuperable de URL sin perder los campos del proveedor', async () => {
    const id = await source.saveVisualProject({ title: 'Hardware', kind: '3d' });
    await show(`${BASE}?pestana=proveedores&proyecto=${id}`);
    await act(async () => container.querySelector<HTMLElement>('article[aria-label="Adafruit CAD Parts"]')!.querySelector<HTMLButtonElement>('button')!.click());
    await change('Enlace HTTPS de la referencia', 'https://[::::]/'); await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('HTTPS');
    expect(field('Enlace HTTPS de la referencia').value).toBe('https://[::::]/');
    expect(source.getSnapshot().visualProjects[0]?.resources).toEqual([]);
  });

  it('retira una referencia desde el detalle sin perder otra que se restaura durante el envío', async () => {
    const note = (title: string) => source.saveNote({ title, body: 'Contenido', subjectId: state.subjects[0]!.id, topic: '', source: 'student', visibility: 'group', tags: [] });
    const first = note('Primera referencia'); const second = note('Segunda referencia');
    const id = await source.saveVisualProject({ title: 'Explicación', kind: '3d', links: [{ kind: 'note', id: first }, { kind: 'note', id: second }] });
    source.withdrawContent('note', first, true, 1); source.withdrawContent('note', second, true, 1);
    await show(`${BASE}/${id}`);
    const save = source.saveVisualProject.bind(source);
    vi.spyOn(source, 'saveVisualProject').mockImplementation(async input => {
      source.withdrawContent('note', second, false, 2);
      return save(input);
    });
    await click('Quitar relación');
    expect(state.visualProjects.find(project => project.id === id)?.links).toEqual([{ kind: 'note', id: second }]);
  });

});
