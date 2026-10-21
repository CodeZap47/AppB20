// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { GuideAiProvenance } from './GuideAiProvenance';
import { GUIDE_SECTIONS, type GuideAiProvenance as Provenance } from '@b20/core';

it('oculta inmediatamente una transcripción citada al retirar su fuente antes de terminar la consulta nueva', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const source = new DemoDataSource(createDemoState(), 'demo-1'); const subjectId = source.getSnapshot().subjects[0]!.id;
  const noteId = source.saveNote({ subjectId, title: 'Nota compartida', topic: 'Tema', body: 'Material', tags: [], visibility: 'group', source: 'student' });
  const guideId = source.createGuide({ subjectId, title: 'Guía', topicsText: 'Tema', sections: ['Objetivo'] }, []);
  const provenance: Provenance = { purpose: 'study_guide', model: 'simulado', preparationFingerprint: 'f', sources: [], generatedAt: 1,
    fragments: [{ id: 'fragmento-original', text: 'TRANSCRIPCIÓN QUE DEBE OCULTARSE', origins: [{ kind: 'note', refId: noteId, version: 1, field: 'texto', startLine: 1, endLine: 1 }] }],
    citations: [{ id: GUIDE_SECTIONS[0]!.id, content: 'Objetivo', citations: ['fragmento-original'] }] };
  let resolve!: (value: Provenance | null) => void;
  const get = vi.spyOn(source, 'getGuideAiProvenance').mockResolvedValueOnce(provenance).mockImplementation(() => new Promise((done) => { resolve = done; }));
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<DataProvider source={source}><GuideAiProvenance guideId={guideId} version={1} /></DataProvider>));
    expect(container.textContent).toContain('TRANSCRIPCIÓN QUE DEBE OCULTARSE');
    await act(async () => source.withdrawContent('note', noteId, true, 1));
    expect(get).toHaveBeenCalledTimes(2); expect(container.textContent).not.toContain('TRANSCRIPCIÓN QUE DEBE OCULTARSE');
    await act(async () => resolve({ ...provenance, fragments: [], citations: [] }));
    expect(container.textContent).not.toContain('TRANSCRIPCIÓN QUE DEBE OCULTARSE');
  } finally { await act(async () => root.unmount()); source.dispose(); container.remove(); }
});
