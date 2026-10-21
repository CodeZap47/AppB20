// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_CONSENT_VERSION, AI_LIMITS, buildAiPreparation, type AiGeneration, type AiStatus } from '@b20/core';
import { AiClientError, type AiClient } from '../data/aiClient';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, SpacedCollection, TeachingPractice } from '../data/types';
import { AiStudyDraftReview, AiStudyModulePanel } from './AiStudyModulePanel';
vi.mock('../auth/AuthContext', () => ({ useSession: () => ({ status: 'signedIn', token: 'session-token',
  expiresAt: Date.now() + 60_000, profile: { subject: 'self', email: 'alumno@example.test', name: 'Alumno' } }) }));
vi.mock('../config', () => ({ config: { apiUrl: 'https://files.example', aiApiUrl: 'https://gemini-worker.example' } }));
let root: Root; let container: HTMLDivElement;
const collection = (visibility: 'personal' | 'group' = 'personal'): SpacedCollection => ({ id: '80', subjectId: '1', title: 'Ciclos', visibility, ownerId: 'self', version: 1, archived: false, createdAt: new Date(), updatedAt: new Date(), updatedBy: 'self' });
function generation(purpose: 'teaching_questions' | 'spaced_cards', personal = true): AiGeneration {
  const kind = purpose === 'teaching_questions' ? 'teaching' as const : 'note' as const;
  const prep = buildAiPreparation({ subjectId: '1', topics: ['Ciclos'], sources: [{ kind, refId: '5', topics: ['Ciclos'], includeUnplaced: true }], config: { purpose, questionCount: 3, types: ['single'], difficulty: 'basic' } },
    [{ kind, refId: '5', subjectId: '1', title: 'Ciclos', version: 3, visibility: personal ? 'personal' : 'group', fields: [{ name: 'Texto', text: 'Un ciclo repite instrucciones.' }] }], { id: crypto.randomUUID(), model: 'fake', now: Date.now() });
  return { id: crypto.randomUUID(), preparationId: prep.id, preparation: prep, state: 'succeeded', createdAt: Date.now(), result: purpose === 'teaching_questions'
    ? { purpose, questions: [{ text: '¿Por qué funciona el ejemplo?', citations: [prep.fragments[0]!.id] }] }
    : { purpose, title: 'Ciclos', cards: [{ question: '¿Qué repite un ciclo?', explanation: 'Instrucciones.', hint: 'Repite.', citations: [prep.fragments[0]!.id] }] } };
}
const button = () => container.querySelector<HTMLButtonElement>('button')!;
async function review() { await act(async () => [...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].at(-1)!.click()); }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe('dirección independiente del servicio Gemini en los módulos de estudio', () => {
  it.each(['teaching_questions', 'spaced_cards'] as const)('consulta estado e historial de %s solamente en el Worker de IA', async (purpose) => {
    const saved = generation(purpose);
    const status: AiStatus = { actor: 'self', enabled: true, configured: true, consented: true,
      model: 'gemini-test', limits: AI_LIMITS, consentVersion: AI_CONSENT_VERSION };
    const network = vi.fn(async (url: string, _options?: RequestInit) => {
      if (url === 'https://gemini-worker.example/ai/status') return Response.json(status);
      if (url === 'https://gemini-worker.example/ai/generations') return Response.json([saved]);
      return Response.json({ code: 'unavailable' }, { status: 404 });
    });
    vi.stubGlobal('fetch', network);
    const snapshot = emptySnapshot('ready');
    snapshot.me = { id: 'self', displayName: 'Alumno', status: 'active', isCreator: false, joinedAt: new Date() };
    snapshot.members = [snapshot.me];
    const source = { label: 'Grupo B20', getSnapshot: () => snapshot, subscribe: (_listener: () => void) => () => {} } as DataSource;
    const explanation = { concept: 'Un ciclo repite instrucciones.', example: 'Repetir tres veces.', limits: 'Con una condición de salida.' };
    const practice: TeachingPractice = { id: '5', ownerId: 'self', subjectId: '1', topic: 'Ciclos', initial: explanation,
      revised: explanation, status: 'draft', version: 1, createdAt: new Date(), updatedAt: new Date() };
    await act(async () => root.render(<MemoryRouter><DataProvider source={source}>
      {purpose === 'teaching_questions' ? <AiStudyModulePanel practice={practice} /> : <AiStudyModulePanel collection={collection()} />}
    </DataProvider></MemoryRouter>));
    expect(network.mock.calls.map(([url]) => url).sort()).toEqual([
      'https://gemini-worker.example/ai/generations', 'https://gemini-worker.example/ai/status',
    ]);
    expect(network.mock.calls.every(([, options]) => (options?.headers as Record<string, string>).Authorization === 'Bearer session-token')).toBe(true);
    expect(container.textContent).toContain('Mis borradores privados (1)');
    expect(container.querySelector('[role=alert]')).toBeNull();
  });
});
describe('revisión explícita de preguntas y tarjetas privadas Gemini', () => {
  it('no incorpora preguntas hasta revisar y confirmar, mostrando su versión y citas', async () => {
    const saved = generation('teaching_questions'); const request = vi.fn(async () => ({}));
    await act(async () => root.render(<AiStudyDraftReview client={{ request } as unknown as AiClient} generation={saved} />));
    expect(container.textContent).toContain('teaching:5 v3'); expect(button().disabled).toBe(true); expect(request).not.toHaveBeenCalled();
    await review(); await act(async () => button().click());
    expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0]).toEqual([`/ai/generations/${saved.id}/publish`, 'POST', { reviewed: true, selection: [{ index: 0, text: '¿Por qué funciona el ejemplo?' }] }, undefined]);
    expect(button().disabled).toBe(true); expect(container.textContent).toContain('Incorporación confirmada');
  });
  it('reintenta exactamente la misma incorporación si se pierde la confirmación', async () => {
    const saved = generation('spaced_cards'); const request = vi.fn().mockRejectedValueOnce(new Error('Respuesta perdida')).mockResolvedValue({});
    await act(async () => root.render(<AiStudyDraftReview client={{ request } as unknown as AiClient} generation={saved} collection={collection()} />));
    await review(); await act(async () => button().click());
    expect(container.textContent).toContain('Respuesta perdida'); expect(container.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true);
    await act(async () => button().click());
    expect(request.mock.calls[0]![2]).toBe(request.mock.calls[1]![2]);
    expect(request.mock.calls[0]![2]).toMatchObject({ reviewed: true, collectionId: '80', expectedCollectionVersion: 1,
      selection: [{ index: 0, question: '¿Qué repite un ciclo?', explanation: 'Instrucciones.', hint: 'Repite.' }] });
  });
  it('permite corregir la selección después de un rechazo definitivo del servidor', async () => {
    const saved = generation('spaced_cards'); const request = vi.fn().mockRejectedValue(new AiClientError('invalid', 'Reduce el texto.'));
    await act(async () => root.render(<AiStudyDraftReview client={{ request } as unknown as AiClient} generation={saved} collection={collection()} />));
    await review(); await act(async () => button().click());
    expect(container.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(false);
    expect(container.textContent).toContain('Puedes corregir la selección'); expect(button().textContent).toBe('Incorporar selección revisada');
  });
  it('mantiene privado un borrador con fuentes personales ante una colección grupal', async () => {
    const saved = generation('spaced_cards'); const request = vi.fn(async () => ({}));
    await act(async () => root.render(<AiStudyDraftReview client={{ request } as unknown as AiClient} generation={saved} collection={collection('group')} />));
    await review(); expect(button().disabled).toBe(true); expect(container.textContent).toContain('fuentes personales'); expect(request).not.toHaveBeenCalled();
  });
  it('recupera una incorporación ya confirmada sin ofrecer volver a insertarla', async () => {
    const saved = generation('spaced_cards'); saved.acceptance = { targetKind: 'spaced_collection', targetId: '80', acceptedIds: ['99'] };
    const request = vi.fn(async () => ({}));
    await act(async () => root.render(<AiStudyDraftReview client={{ request } as unknown as AiClient} generation={saved} collection={collection()} />));
    expect(button().disabled).toBe(true); expect(container.textContent).toContain('Incorporación confirmada'); expect(request).not.toHaveBeenCalled();
  });
  it('no permite aceptar una selección vacía ni un resultado con citas inexistentes', async () => {
    const saved = generation('teaching_questions'); const request = vi.fn(async () => ({}));
    await act(async () => root.render(<AiStudyDraftReview client={{ request } as unknown as AiClient} generation={saved} />));
    await review(); await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click()); expect(button().disabled).toBe(true);
    saved.result = { purpose: 'teaching_questions', questions: [{ text: 'Pregunta', citations: ['inexistente'] }] };
    await act(async () => root.render(<AiStudyDraftReview key="invalid" client={{ request } as unknown as AiClient} generation={saved} />));
    expect(container.textContent).toContain('estructura válida'); expect(container.querySelector('button')).toBeNull(); expect(request).not.toHaveBeenCalled();
  });
});
