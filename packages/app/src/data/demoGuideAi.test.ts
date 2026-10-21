import { describe, expect, it } from 'vitest';
import { createDemoState, DemoDataSource } from './demo';
import type { GuideAiPrepareInput } from '@b20/core';
import { guideStatus } from '../lib/guides';

function setup() {
  const source = new DemoDataSource(createDemoState(), 'demo-1');
  const subjectId = source.getSnapshot().subjects[0]!.id;
  const noteId = source.saveNote({ subjectId, title: 'Material compartido', topic: 'Tema', body: 'Contenido académico', tags: [], visibility: 'group', source: 'student' });
  const input: GuideAiPrepareInput = { purpose: 'study_guide', subjectId, title: 'Guía privada', topics: ['Tema'], sources: [{ kind: 'note', refId: noteId, topics: ['Tema'], includeUnplaced: true }], maxOutputTokens: 1500 };
  return { source, input };
}
describe('borradores privados de Guías en la simulación', () => {
  it('aísla listas, transcripciones y contenido entre tres identidades sin puntos por generar', async () => {
    const { source, input } = setup(); const before = source.getSnapshot().guides.length;
    const draft = await source.prepareGuideAiDraft({ id: crypto.randomUUID(), input });
    expect(draft.preparation.model).toBe('simulado'); expect(draft.preparation.fragments[0]!.text).toContain('Material ficticio');
    source.setViewer('demo-2'); expect(await source.listGuideAiDrafts()).toEqual([]); await expect(source.getGuideAiDraft(draft.id)).rejects.toThrow('acceso');
    source.setViewer('demo-3'); expect(await source.listGuideAiDrafts()).toEqual([]); await expect(source.getGuideAiDraft(draft.id)).rejects.toThrow('acceso');
    source.setViewer('demo-1'); const loaded = await source.getGuideAiDraft(draft.id);
    const ready = await source.runGuideAiStep(loaded.id, { expectedRevision: loaded.revision, fingerprint: loaded.preparation.fingerprint, generationId: crypto.randomUUID(), confirmed: true });
    expect(ready.result?.sections).toHaveLength(8); expect(source.getSnapshot().guides).toHaveLength(before);
    expect('preparation' in (await source.listGuideAiDrafts())[0]!).toBe(false); source.dispose();
  });

  it('publica de forma idempotente y detecta borradores y fuentes cambiados', async () => {
    const { source, input } = setup(); const initial = await source.prepareGuideAiDraft({ id: crypto.randomUUID(), input });
    const ready = await source.runGuideAiStep(initial.id, { expectedRevision: initial.revision, fingerprint: initial.preparation.fingerprint, generationId: crypto.randomUUID(), confirmed: true });
    await expect(source.updateGuideAiDraft(ready.id, { expectedRevision: initial.revision, result: ready.result! })).rejects.toThrow('cambió');
    const request = { id: ready.id, expectedRevision: ready.revision, requestId: crypto.randomUUID() };
    const before = source.getSnapshot().guides.length;
    const published = await source.publishGuideAiDraft(request); const retry = await source.publishGuideAiDraft(request);
    expect(retry.publishedGuideId).toBe(published.publishedGuideId); expect(source.getSnapshot().guides).toHaveLength(before + 1);
    const provenance = await source.getGuideAiProvenance(published.publishedGuideId!, 1); expect(provenance).toMatchObject({ model: 'simulado' }); expect(provenance).not.toHaveProperty('draftId');
    const next = await source.prepareGuideAiDraft({ id: crypto.randomUUID(), input });
    const note = source.getSnapshot().notes.find((row) => row.id === input.sources[0]!.refId)!;
    source.saveNote({ ...note, body: 'Cambió el material', expectedVersion: note.version });
    await expect(source.runGuideAiStep(next.id, { expectedRevision: next.revision, fingerprint: next.preparation.fingerprint, generationId: crypto.randomUUID(), confirmed: true })).rejects.toThrow('fuente cambió'); source.dispose();
  });

  it('conserva el avance después de cancelar e impide generar o publicar pasos pendientes', async () => {
    const { source, input } = setup(); const initial = await source.prepareGuideAiDraft({ id: crypto.randomUUID(), input });
    const cancelled = await source.cancelGuideAiDraft(initial.id, initial.revision);
    expect(cancelled.state).toBe('cancelled'); expect(cancelled.steps[0]!.state).toBe('cancelled');
    await expect(source.runGuideAiStep(cancelled.id, { expectedRevision: cancelled.revision, fingerprint: cancelled.preparation.fingerprint, generationId: crypto.randomUUID(), confirmed: true })).rejects.toThrow('no admite');
    expect((await source.getGuideAiDraft(cancelled.id)).preparation.fragments).toHaveLength(initial.preparation.fragments.length); source.dispose();
  });

  it('separa cobertura citada de cambios posteriores y retira fragmentos cuando una fuente deja de estar disponible', async () => {
    const { source, input } = setup(); const draft = await source.prepareGuideAiDraft({ id: crypto.randomUUID(), input });
    const ready = await source.runGuideAiStep(draft.id, { expectedRevision: draft.revision, fingerprint: draft.preparation.fingerprint, generationId: crypto.randomUUID(), confirmed: true });
    const published = await source.publishGuideAiDraft({ id: ready.id, expectedRevision: ready.revision, requestId: crypto.randomUUID() });
    let data = source.getSnapshot(); let guide = data.guides.find((row) => row.id === published.publishedGuideId)!;
    expect(guideStatus(guide, data).covered).toBe(1);
    const note = data.notes.find((row) => row.id === input.sources[0]!.refId)!; source.saveNote({ ...note, body: 'Contenido actualizado', expectedVersion: note.version });
    data = source.getSnapshot(); expect(data.guideAiSourceAvailability?.find((row) => row.guideId === guide.id)).toMatchObject({ available: true, outdated: true }); expect(guideStatus(guide, data).covered).toBe(1);
    const changed = data.notes.find((row) => row.id === note.id)!; source.withdrawContent('note', note.id, true, changed.version);
    data = source.getSnapshot(); guide = data.guides.find((row) => row.id === guide.id)!;
    expect(guideStatus(guide, data).covered).toBe(0); expect(data.guideAiSourceAvailability?.find((row) => row.guideId === guide.id)?.available).toBe(false);
    expect((await source.getGuideAiProvenance(guide.id, 1))?.fragments).toEqual([]); expect(data.guideVersions.some((row) => row.guideId === guide.id)).toBe(true); source.dispose();
  });

  it('mantiene la procedencia original al editar y restaura la correspondiente a la versión elegida', async () => {
    const { source, input } = setup(); const draft = await source.prepareGuideAiDraft({ id: crypto.randomUUID(), input });
    const ready = await source.runGuideAiStep(draft.id, { expectedRevision: draft.revision, fingerprint: draft.preparation.fingerprint, generationId: crypto.randomUUID(), confirmed: true });
    const published = await source.publishGuideAiDraft({ id: ready.id, expectedRevision: ready.revision, requestId: crypto.randomUUID() });
    const guide = source.getSnapshot().guides.find((row) => row.id === published.publishedGuideId)!;
    source.updateGuide(guide.id, { subjectId: guide.subjectId, title: 'Edición manual posterior', topicsText: guide.topics.join('\n'), sections: guide.sections.map((text, i) => i ? text : 'Objetivos actualizados por el grupo') }, 1);
    expect(await source.getGuideAiProvenance(guide.id, 2)).toMatchObject({ editedAfterGeneration: true });
    expect((await source.getGuideAiProvenance(guide.id, 2))?.citations[0]!.content).toBe('Objetivos actualizados por el grupo');
    source.restoreGuideVersion(guide.id, 1, 2); const restored = await source.getGuideAiProvenance(guide.id, 3);
    expect(restored?.editedAfterGeneration).not.toBe(true); expect(restored?.citations[0]!.content).toBe(guide.sections[0]); source.dispose();
  });

  it('actualiza la preparación sin generar de nuevo, conserva las ediciones e invalida citas antiguas de forma idempotente', async () => {
    const { source, input } = setup(); const draft = await source.prepareGuideAiDraft({ id: crypto.randomUUID(), input });
    const ready = await source.runGuideAiStep(draft.id, { expectedRevision: draft.revision, fingerprint: draft.preparation.fingerprint, generationId: crypto.randomUUID(), confirmed: true });
    const edited = await source.updateGuideAiDraft(ready.id, { expectedRevision: ready.revision, result: { ...ready.result!, sections: ready.result!.sections.map((section, i) => i ? section : { ...section, content: 'Mi explicación personal conservada.' }) } });
    const nextInput = { ...input, topics: ['Tema actualizado'], sources: input.sources.map((ref) => ({ ...ref, topics: ['Tema actualizado'], transcriptionIds: [] })) };
    const request = { id: edited.id, expectedRevision: edited.revision, requestId: crypto.randomUUID(), input: nextInput };
    const refreshed = await source.refreshGuideAiDraft(request); const retry = await source.refreshGuideAiDraft(request);
    expect(retry.revision).toBe(refreshed.revision); expect(refreshed.id).toBe(edited.id); expect((await source.listGuideAiDrafts()).length).toBe(1);
    expect(refreshed.result!.sections[0]!.content).toBe('Mi explicación personal conservada.'); expect(refreshed.result!.sections.every((section) => !section.citations.length)).toBe(true);
    expect(refreshed.needsCitationReview).toBe(true); expect(refreshed.steps).toEqual(edited.steps); expect(source.getSnapshot().guides.some((guide) => guide.title === input.title)).toBe(false);
    await expect(source.publishGuideAiDraft({ id: refreshed.id, expectedRevision: refreshed.revision, requestId: crypto.randomUUID() })).rejects.toThrow('citas');
    await expect(source.updateGuideAiDraft(refreshed.id, { expectedRevision: refreshed.revision, result: refreshed.result! })).rejects.toThrow('citas');
    const cited = await source.updateGuideAiDraft(refreshed.id, { expectedRevision: refreshed.revision, result: { ...refreshed.result!, sections: refreshed.result!.sections.map((section) => ({ ...section, citations: [refreshed.preparation.fragments[0]!.id] })) } });
    expect(cited.needsCitationReview).toBe(false); expect(cited.result!.sections[0]!.content).toBe('Mi explicación personal conservada.'); source.dispose();
  });

  it('no recupera texto inaccesible eliminando su fuente al actualizar y permite cancelar con una respuesta sin fragmentos', async () => {
    const { source, input } = setup(); const initial = await source.prepareGuideAiDraft({ id: crypto.randomUUID(), input });
    const ready = await source.runGuideAiStep(initial.id, { expectedRevision: initial.revision, fingerprint: initial.preparation.fingerprint, generationId: crypto.randomUUID(), confirmed: true });
    const note = source.getSnapshot().notes.find((row) => row.id === input.sources[0]!.refId)!; source.withdrawContent('note', note.id, true, note.version);
    const other = source.saveNote({ subjectId: input.subjectId, title: 'Otra fuente', topic: 'Tema', body: 'Material disponible', tags: [], visibility: 'group', source: 'student' });
    await expect(source.refreshGuideAiDraft({ id: ready.id, expectedRevision: ready.revision, requestId: crypto.randomUUID(), input: { ...input, sources: [{ kind: 'note', refId: other, topics: ['Tema'], includeUnplaced: true }] } })).rejects.toThrow('anterior');
    await expect(source.getGuideAiDraft(ready.id)).rejects.toThrow('no está disponible');
    const summary = (await source.listGuideAiDrafts())[0]!; const cancelled = await source.cancelGuideAiDraft(summary.id, summary.revision);
    expect(cancelled.result).toBeUndefined(); expect(cancelled.preparation.fragments).toEqual([]); expect(cancelled.steps.every((step) => step.result === undefined)).toBe(true); source.dispose();
  });
});
