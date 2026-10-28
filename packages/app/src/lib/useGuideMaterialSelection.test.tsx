// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { useGuideMaterialSelection, type GuideSelectionValue } from './useGuideMaterialSelection';

let container: HTMLDivElement, root: Root, source: DemoDataSource, initial: GuideSelectionValue;
function Composer() {
  const [value, setValue] = useState(initial);
  const draft = useGuideMaterialSelection(value, (record) => setValue({ subjectId: record.subjectId, guideType: record.guideType,
    termId: record.termId, title: record.title, topicsText: record.topicsText, sources: record.sources, chosenFileIds: record.chosenFileIds,
    ...(record.manualSections ? { manualSections: record.manualSections } : {}) }));
  return <><output>{draft.ready ? 'Listo' : 'Cargando'} · {value.title} · {value.sources.length} materiales</output>
    <button onClick={() => setValue((current) => ({ ...current, title: 'Mi guía conservada', sources: [{ kind: 'note', refId: source.getSnapshot().notes.find((note) => note.title === 'Mi nota')!.id, topics: [], includeUnplaced: true }] }))}>Agregar</button>
    <button disabled={!draft.ready} onClick={() => void draft.flush().catch(() => {})}>Guardar</button>
    {draft.error && <p role="alert">{draft.error}</p>}</>;
}
async function show(id?: string) { await act(async () => root.render(<MemoryRouter initialEntries={[`/m/guias/nueva${id ? `?materialDraft=${id}` : ''}`]}><DataProvider source={source}><Composer /></DataProvider></MemoryRouter>)); }
async function click(text: string) { const button = [...container.querySelectorAll('button')].find((entry) => entry.textContent === text)!; await act(async () => button.click()); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1'); const subjectId = source.getSnapshot().subjects[0]!.id;
  source.saveNote({ subjectId, title: 'Mi nota', topic: 'Tema', body: 'Apunte personal', tags: [], visibility: 'personal', source: 'student' });
  initial = { subjectId, guideType: 'quarter', title: '', topicsText: 'Tema', sources: [], chosenFileIds: [], manualSections: Array.from({ length: 8 }, () => '') };
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.restoreAllMocks(); });

describe('persistencia de materiales en la creación de guías', () => {
  it('recupera materiales personales, alcance y texto al recargar el borrador', async () => {
    await show(); await click('Agregar'); await click('Guardar');
    const summary = (await source.listGuideMaterialSelections())[0]!; expect(summary.materialCount).toBe(1);
    await act(async () => root.unmount()); root = createRoot(container); await show(summary.id);
    expect(container.textContent).toContain('Mi guía conservada · 1 materiales');
    expect((await source.getGuideMaterialSelection(summary.id))?.sources[0]?.kind).toBe('note');
  });
  it('recupera un guardado confirmado en servidor aunque se pierda su respuesta, sin duplicar selecciones', async () => {
    const original = source.saveGuideMaterialSelection.bind(source); let loseResponse = true;
    const save = vi.spyOn(source, 'saveGuideMaterialSelection').mockImplementation(async (input) => { const result = await original(input); if (loseResponse) { loseResponse = false; throw new Error('Respuesta perdida'); } return result; });
    await show(); await click('Agregar'); await click('Guardar');
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(await source.listGuideMaterialSelections()).toHaveLength(1);
    await click('Guardar'); expect(save).toHaveBeenCalledTimes(1);
  });
  it('no muestra ni sobrescribe la selección de otra cuenta usando su identificador', async () => {
    await show(); await click('Agregar'); await click('Guardar'); const summary = (await source.listGuideMaterialSelections())[0]!;
    await act(async () => root.unmount()); root = createRoot(container); source.setViewer('demo-2'); await show(summary.id);
    expect(container.textContent).not.toContain('Mi guía conservada'); expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(await source.listGuideMaterialSelections()).toHaveLength(0);
  });
});
