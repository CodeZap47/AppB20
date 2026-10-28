// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { GuideCompendiumPage, GuideFormPage, GuidePage, GuidesPage } from './GuidesPage';

let root: Root;
let container: HTMLDivElement;
let source: DemoDataSource;
let state: ReturnType<typeof createDemoState>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  state = createDemoState();
  state.guides = [];
  state.guideSources = [];
  state.guideReviews = [];
  source = new DemoDataSource(state, 'demo-1');
});
afterEach(async () => {
  await act(async () => root.unmount());
  source.dispose();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Location() {
  const location = useLocation();
  return <output data-location>{location.pathname}{location.search}</output>;
}
async function show(path = '/m/guias') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><DataProvider source={source}>
    <Routes>
      <Route path="/m/guias" element={<GuidesPage />} />
      <Route path="/m/guias/nueva" element={<GuideFormPage />} />
      <Route path="/m/guias/compendio" element={<GuideCompendiumPage />} />
      <Route path="/m/guias/:guideId/editar" element={<GuideFormPage />} />
      <Route path="/m/guias/:guideId" element={<GuidePage />} />
    </Routes><Location />
  </DataProvider></MemoryRouter>));
}
function createGuide(subjectId: string, title: string) {
  return source.createGuide({ subjectId, title, topicsText: 'Primer tema\nSegundo tema', sections: ['Objetivo del grupo'] }, []);
}
function field(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const match = [...container.querySelectorAll<HTMLLabelElement>('label')].find((node) =>
    node.querySelector('.field__label')?.textContent?.trim() === label || node.textContent?.trim() === label);
  const control = match?.control ?? match?.querySelector('input,textarea,select');
  if (!control) throw new Error(`Falta el campo ${label}`);
  return control as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}
async function change(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
function button(label: string, within: ParentNode = container) {
  const match = [...within.querySelectorAll<HTMLButtonElement>('button')].find((node) => {
    const text = node.textContent?.replace(/\s+/g, ' ').trim();
    return text === label || text?.startsWith(`${label} `);
  });
  expect(match, label).toBeTruthy();
  return match!;
}
async function click(label: string, within: ParentNode = container) {
  await act(async () => button(label, within).click());
}
async function selectMaterial(title: string) {
  const label = [...container.querySelectorAll<HTMLLabelElement>('.ai-source__choice')].find((entry) => entry.textContent?.includes(title));
  expect(label, `Material: ${title}`).toBeTruthy();
  await act(async () => label!.querySelector<HTMLInputElement>('input')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('.guide-materials__addbar button')!.click());
}
function listedIds() {
  return [...container.querySelectorAll<HTMLAnchorElement>('.guides-grid a')].map((link) => link.getAttribute('href')!.split('/').at(-1));
}

describe('biblioteca y lectura de guías', () => {
  it('distingue el alcance parcial y cuatrimestral y conserva materia y cuatrimestre al filtrarlo', async () => {
    const subject = state.subjects[0]!;
    const term = state.terms.find((entry) => entry.subjectId === subject.id)!;
    const quarter = createGuide(subject.id, 'Guía integral');
    const partial = source.createGuide({ subjectId: subject.id, termId: term.id, title: 'Guía de la primera evaluación', topicsText: 'Tema', sections: [] }, []);
    await show(`/m/guias?cuatri=${subject.period}&materia=${subject.id}&tipo=partial`);
    expect(listedIds()).toEqual([partial]);
    expect(container.querySelector('.guides-scope-badge')?.textContent).toBe('Guía de parcial');
    await change(container.querySelector<HTMLSelectElement>('select[aria-label="Tipo de guía"]')!, 'quarter');
    expect(listedIds()).toEqual([quarter]);
    expect(container.querySelector('.guides-card__context')?.textContent).toContain('Cuatrimestre completo');
    expect(container.querySelector('.guides-scope-badge')?.textContent).toBe('Alcance cuatrimestral');
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/guias?cuatri=${subject.period}&materia=${subject.id}&tipo=quarter`);
  });

  it('combina materia y cuatrimestre, conserva sus rutas y separa las guías retiradas', async () => {
    const first = state.subjects.find((subject) => subject.period === 1)!;
    const second = state.subjects.find((subject) => subject.period === 1 && subject.id !== first.id)!;
    const other = state.subjects.find((subject) => subject.period === 2)!;
    const firstId = createGuide(first.id, 'Repaso de matrices');
    createGuide(second.id, 'Repaso de código');
    const otherId = createGuide(other.id, 'Repaso del siguiente cuatrimestre');
    const retiredId = createGuide(first.id, 'Guía retirada');
    source.withdrawContent('guide', retiredId, true, 1);
    await show(`/m/guias?cuatri=1&materia=${encodeURIComponent(first.id)}`);
    expect(listedIds()).toEqual([firstId]);
    expect(container.querySelector('a[href="/m/guias/compendio?cuatri=1"]')).not.toBeNull();
    const selected = [...container.querySelectorAll('[aria-label="Materia"] button')]
      .find((node) => node.textContent?.includes(first.name))!;
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    const period = container.querySelector<HTMLSelectElement>('select[aria-label="Cuatrimestre"]')!;
    await change(period, '2');
    expect(listedIds()).toEqual([otherId]);
    expect(container.querySelector('[data-location]')?.textContent).toBe('/m/guias?cuatri=2');
    await change(period, '1');
    const withdrawn = container.querySelector<HTMLInputElement>('.guides-withdrawn input')!;
    await act(async () => withdrawn.click());
    expect(listedIds()).toEqual([retiredId]);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('retiradas');
  });

  it('ofrece creación manual e IA desde el vacío sin generar ni publicar al abrir el panel', async () => {
    const generate = vi.spyOn(source, 'runGuideAiStep');
    const create = vi.spyOn(source, 'createGuide');
    await show();
    expect(container.textContent).toContain('Todavía no hay guías');
    expect([...container.querySelectorAll('a')].find((link) => link.textContent === 'Crear la primera')?.getAttribute('href')).toBe('/m/guias/nueva');
    const prepare = button('Preparar guía con IA');
    expect(prepare.getAttribute('aria-expanded')).toBe('false');
    await click('Preparar guía con IA');
    expect(prepare.getAttribute('aria-expanded')).toBe('true');
    const panel = container.querySelector('#guides-ai-workspace')!;
    expect(panel.textContent).toContain('Configurar mi clave y consentimiento en Ajustes');
    expect(panel.textContent).toContain('borrador privado');
    expect(generate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(source.getSnapshot().guides).toHaveLength(0);
    await click('Preparar guía con IA');
    expect(container.querySelector('#guides-ai-workspace')).toBeNull();
  });

  it('mantiene lectura, descargas y acciones de estudio y respeta una retirada recibida', async () => {
    const id = createGuide(state.subjects[0]!.id, 'Guía para compartir');
    await source.attachResourceFile('guide', id, new File(['documento'], 'material.txt'), 1);
    source.setViewer('demo-4');
    await show(`/m/guias/${id}`);
    expect(container.querySelector('article[aria-label="Contenido de la guía"]')?.textContent).toContain('Objetivo del grupo');
    expect(container.querySelector('.academic-file-name')?.textContent).toBe('material.txt');
    expect(container.querySelector('.academic-file-name')?.closest('details')).toBeNull();
    expect(container.querySelector<HTMLDetailsElement>('.academic-resources__upload')?.open).toBe(false);
    expect(container.querySelector(`a[href="/m/salas?guia=${id}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="/m/guias/${id}/editar"]`)).not.toBeNull();
    expect([...container.querySelectorAll('button')].some((node) => node.textContent === 'Retirar publicación')).toBe(false);
    await act(async () => {
      source.setViewer('demo-1');
      source.withdrawContent('guide', id, true, 2);
    });
    expect(container.querySelector(`a[href="/m/guias/${id}/editar"]`)).toBeNull();
    expect(container.querySelector(`a[href="/m/salas?guia=${id}"]`)).toBeNull();
    expect(container.querySelector('.academic-resources__upload')).toBeNull();
    await click('Fuentes');
    expect(button('Agregar fuentes').matches(':disabled')).toBe(true);
    await act(async () => source.setViewer('demo-4'));
    expect(container.textContent).toContain('No encontramos esta guía');
  });

  it('conserva el procesamiento de fuentes y actualiza la cobertura desde su pestaña', async () => {
    source.dispose();
    source = new DemoDataSource(createDemoState(), 'demo-1');
    await show('/m/guias/gd1?pestana=fuentes');
    const pending = [...container.querySelectorAll<HTMLLIElement>('.source-list > li')]
      .find((node) => node.textContent?.includes('Todavía no tiene evidencias.'))!;
    expect(pending).toBeTruthy();
    await click('Editar', pending);
    const form = pending.querySelector('form')!;
    await click('Procesada', form);
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(source.getSnapshot().guideSources.find((entry) => entry.id === 'gs4')?.status).toBe('processed');
    await click('Guía', container.querySelector('[aria-label="Sección de la guía"]')!);
    expect(container.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('3');
    expect(container.querySelector('[role="meter"]')?.getAttribute('aria-valuemax')).toBe('3');
  });
});

describe('escritura y compendio de guías', () => {
  it('crea una guía cuatrimestral con fuentes de dos parciales y permite volver al alcance parcial', async () => {
    const subject = state.subjects[0]!;
    const terms = state.terms.filter((term) => term.subjectId === subject.id).sort((a, b) => a.position - b.position);
    const firstNote = source.saveNote({ subjectId: subject.id, termId: terms[0]!.id, title: 'Fuente del primer parcial', topic: 'Tema', body: 'Primer contenido', tags: [], visibility: 'group', source: 'student' });
    const secondNote = source.saveNote({ subjectId: subject.id, termId: terms[1]!.id, title: 'Fuente del segundo parcial', topic: 'Tema', body: 'Segundo contenido', tags: [], visibility: 'group', source: 'student' });
    const create = vi.spyOn(source, 'createGuideFromMaterials');
    await show(`/m/guias/nueva?materia=${subject.id}`);
    await click('Para el cuatrimestre');
    expect(container.querySelector('[aria-label="Tipo de guía"] button[aria-pressed="true"]')?.textContent).toContain('Para el cuatrimestre');
    expect([...container.querySelectorAll('.ai-source__choice')].filter((node) => node.textContent?.includes('Fuente del')).map((node) => node.querySelector<HTMLInputElement>('input')!.checked)).toEqual([false, false]);
    await click('Para un parcial');
    expect((field('Parcial') as HTMLSelectElement).value).toBeTruthy();
    await click('Para el cuatrimestre');
    await change(field('Título de la guía'), 'Todos los parciales');
    await change(field('Temas, uno por renglón'), 'Tema');
    await selectMaterial('Fuente del primer parcial'); await selectMaterial('Fuente del segundo parcial');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ subjectId: subject.id, guideType: 'quarter', sources: expect.arrayContaining([expect.objectContaining({ kind: 'note', refId: firstNote }), expect.objectContaining({ kind: 'note', refId: secondNote })]) }));
    const guide = source.getSnapshot().guides.find((entry) => entry.title === 'Todos los parciales')!;
    expect(guide.termId).toBeUndefined();
    expect(container.querySelector('.guides-eyebrow')?.textContent).toContain('Cuatrimestre completo');
  });

  it('conserva el contenido al plegar una sección y lo guarda con la revisión esperada', async () => {
    const id = createGuide(state.subjects[0]!.id, 'Guía original');
    const update = vi.spyOn(source, 'updateGuide');
    await show(`/m/guias/${id}/editar`);
    const concepts = [...container.querySelectorAll<HTMLDetailsElement>('.guides-editor-disclosure')]
      .find((node) => node.querySelector('summary > span:nth-child(2)')?.textContent === 'Conceptos')!;
    expect(concepts.open).toBe(false);
    await act(async () => concepts.querySelector('summary')!.click());
    await change(field('Conceptos'), 'Conceptos revisados por el grupo.');
    await act(async () => concepts.querySelector('summary')!.click());
    expect(concepts.open).toBe(false);
    expect(field('Conceptos').value).toBe('Conceptos revisados por el grupo.');
    await change(field('Título de la guía'), 'Guía revisada');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(id, expect.objectContaining({ title: 'Guía revisada', sections: expect.arrayContaining(['Conceptos revisados por el grupo.']) }), 1);
    expect(source.getSnapshot().guides.find((guide) => guide.id === id)?.sections[1]).toBe('Conceptos revisados por el grupo.');
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/m/guias/${id}`);
  });

  it('omite retiradas del compendio, conserva la ruta al ir a una materia y respeta movimiento reducido', async () => {
    const subjects = state.subjects.filter((subject) => subject.period === 1);
    const id = createGuide(subjects[0]!.id, 'Guía vigente');
    const retired = createGuide(subjects[1]!.id, 'Guía que se retiró');
    source.withdrawContent('guide', retired, true, 1);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const scroll = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scroll, configurable: true });
    await show('/m/guias/compendio?cuatri=1');
    expect(container.querySelectorAll('.compendium-guide')).toHaveLength(1);
    expect(container.querySelector(`.compendium-guide a[href="/m/guias/${id}"]`)).not.toBeNull();
    expect(container.textContent).not.toContain('Guía que se retiró');
    const anchor = container.querySelector<HTMLAnchorElement>('[aria-label="Materias del compendio"] a')!;
    await act(async () => anchor.click());
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto' });
    expect(container.querySelector('[data-location]')?.textContent).toBe('/m/guias/compendio?cuatri=1');
    await click('Imprimir o guardar PDF');
    expect(print).toHaveBeenCalledTimes(1);
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
  it('guarda notas personales y texto como borrador, restaura al recargar y comparte la selección entre editor manual e IA', async () => {
    const subject = state.subjects[0]!;
    const noteId = source.saveNote({ subjectId: subject.id, title: 'Nota personal para mi guía', topic: 'Tema', body: 'Contenido privado propio', visibility: 'personal', source: 'student', tags: [] });
    await show(`/m/guias/nueva?materia=${subject.id}`);
    await change(field('Título de la guía'), 'Mi guía personal guardada'); await change(field('Temas, uno por renglón'), 'Tema');
    await change(field('Objetivos'), 'Explicar el procedimiento con mis apuntes.'); await selectMaterial('Nota personal para mi guía');
    expect(button('Crear guía').disabled).toBe(true);
    await click('Guardar borrador privado');
    const saved = (await source.listGuideMaterialSelections())[0]!;
    const record = await source.getGuideMaterialSelection(saved.id);
    expect(record?.sources).toMatchObject([{ kind: 'note', refId: noteId }]); expect(record?.manualSections?.[0]).toBe('Explicar el procedimiento con mis apuntes.');
    await act(async () => root.unmount()); root = createRoot(container); await show(`/m/guias/nueva?materialDraft=${saved.id}`);
    expect(field('Título de la guía').value).toBe('Mi guía personal guardada'); expect(field('Objetivos').value).toBe('Explicar el procedimiento con mis apuntes.');
    expect(container.querySelector('[aria-label="Materiales agregados a la guía"]')?.textContent).toContain('Nota personal para mi guía');
    await click('Usar estos materiales con IA');
    expect(container.querySelector('[data-location]')?.textContent).toContain(`materialDraft=${saved.id}&modo=ia`);
    expect(container.querySelector('[aria-label="Materiales agregados a la guía"]')?.textContent).toContain('Nota personal para mi guía');
    expect(field('Título del borrador privado').value).toBe('Mi guía personal guardada');
    await click('Redactar manualmente con estos materiales');
    expect(field('Objetivos').value).toBe('Explicar el procedimiento con mis apuntes.');
    expect(container.querySelector('[aria-label="Materiales agregados a la guía"]')?.textContent).toContain('Nota personal para mi guía');
    expect(button('Crear guía').disabled).toBe(true); expect(source.getSnapshot().guides).toHaveLength(0);
  });

});
