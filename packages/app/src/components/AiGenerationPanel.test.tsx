// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_CONSENT_VERSION, AI_LIMITS, buildAiPreparation, type AiGeneration, type AiPreparation, type AiStatus } from '@b20/core';
import type { AiClient } from '../data/aiClient';
import { AiGenerationPanel } from './AiGenerationPanel';

let root: Root; let container: HTMLDivElement;
const status: AiStatus = { actor: 'self', enabled: true, configured: true, model: 'gemini-test', limits: AI_LIMITS, consented: true, consentVersion: AI_CONSENT_VERSION };
const prepare = (visibility: 'personal' | 'group' = 'group') => buildAiPreparation({ subjectId: '1', topics: ['Ciclos'], config: { purpose: 'explanation', questionCount: 1, types: ['single'], difficulty: 'basic' }, sources: [{ kind: 'note', refId: '5', topics: ['Ciclos'], includeUnplaced: true }] }, [{ kind: 'note', refId: '5', version: 4, subjectId: '1', visibility, title: 'Ciclos', fields: [{ name: 'Texto', text: 'Un ciclo repite instrucciones.' }] }], { id: crypto.randomUUID(), model: 'gemini-test', now: Date.now() });
const draft = (preparation: AiPreparation): AiGeneration => ({ id: crypto.randomUUID(), state: 'succeeded', preparationId: preparation.id, preparation, createdAt: Date.now(), result: { purpose: 'explanation', title: 'Ciclos con ejemplos', sections: [{ heading: 'Concepto', text: 'Repite instrucciones.', citations: [preparation.fragments[0]!.id] }] } });
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const button = (label: string) => [...container.querySelectorAll('button')].find((entry) => entry.textContent === label)!;
async function click(label: string) { expect(button(label)).toBeTruthy(); await act(async () => button(label).click()); }

describe('confirmación, persistencia y publicación de borradores Gemini', () => {
  it('recupera un borrador con sus referencias al abrir ajustes sin preparar de nuevo', async () => {
    const preparation = prepare(); const saved = draft(preparation);
    const request = vi.fn(async (path: string) => path === '/ai/generations' ? [saved] : saved);
    await act(async () => root.render(<AiGenerationPanel client={{ request } as unknown as AiClient} status={status} simulated={false} />));
    expect(container.textContent).toContain('Mis borradores guardados (1)');
    await act(async () => container.querySelector('details button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('Ciclos con ejemplos'); expect(container.textContent).toContain('note:5 v4');
    expect(request.mock.calls).toHaveLength(2);
  });
  it('requiere confirmación, conserva el UUID ante respuesta perdida y publica sólo con acción expresa', async () => {
    const preparation = prepare(); const saved = draft(preparation); let postCount = 0;
    const request = vi.fn(async (path: string, method?: string, body?: unknown) => {
      if (method === 'GET') return [];
      if (path.endsWith('/publish')) return { targetKind: 'note', targetId: '29' };
      postCount++;
      if (postCount === 1) throw new Error('Respuesta perdida');
      return { ...saved, id: (body as { id: string }).id };
    });
    await act(async () => root.render(<AiGenerationPanel client={{ request } as unknown as AiClient} status={status} preparation={preparation} simulated={false} />));
    expect(button('Generar borrador privado').disabled).toBe(true);
    await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
    await click('Generar borrador privado'); expect(container.textContent).toContain('Respuesta perdida');
    await click('Consultar o reintentar la misma operación');
    const generationCalls = request.mock.calls.filter((entry) => entry[0] === '/ai/generations' && entry[1] === 'POST');
    expect((generationCalls[0]![2] as { id: string }).id).toBe((generationCalls[1]![2] as { id: string }).id);
    expect(request.mock.calls.some((entry) => entry[0].endsWith('/publish'))).toBe(false);
    await click('Revisé el borrador: publicar para el grupo');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('#/m/notas/29');
    expect(button('Revisé el borrador: publicar para el grupo').disabled).toBe(true);
  });
  it('mantiene privado el resultado con fuentes personales aunque esté terminado', async () => {
    const preparation = prepare('personal'); const saved = draft(preparation);
    const request = vi.fn(async (path: string, method?: string) => method === 'GET' && path === '/ai/generations' ? [saved] : saved);
    await act(async () => root.render(<AiGenerationPanel client={{ request } as unknown as AiClient} status={status} preparation={preparation} simulated={false} />));
    await act(async () => container.querySelector('details button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(button('Revisé el borrador: publicar para el grupo').disabled).toBe(true);
    expect(request.mock.calls.some((entry) => entry[0].endsWith('/publish'))).toBe(false);
  });
});
