// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresentationAiPanel, PresentationMediaPanel } from './PresentationFeatures';
import type { PresentationFeatureActions } from '../data/presentationFeatureClient';
import type { PresentationAiDraft } from '@b20/core';
import type { PresentationAttempt, PresentationPractice } from '../data/presentationTypes';
let container: HTMLDivElement; let root: Root; let actions: PresentationFeatureActions;
const attempt: PresentationAttempt = { id: '1', practiceId: '1', subjectId: '1', title: 'Ciclos', topic: 'Ciclos', audience: 'Clase', targetMinutes: 5, keyPoints: ['Condición'], number: 1, status: 'draft', body: '', version: 1, createdAt: new Date(), updatedAt: new Date() };
const practice: PresentationPractice = { ...attempt, id: '1', ownerId: 'owner', archived: false };
const draft: PresentationAiDraft = { id: 'draft', actor: 'owner', purpose: 'outline', state: 'prepared', revision: 1, fingerprint: 'hash', model: 'gemini-test', estimatedTokens: 1200, createdAt: Date.now(), expiresAt: Date.now() + 60000, context: { ...attempt, attemptId: '1', attemptVersion: 1 } };
const click = async (label: string) => { const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label); if (!button) throw new Error(label); await act(async () => { button.click(); }); };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  actions = { listDrafts: vi.fn().mockResolvedValue([]), prepare: vi.fn().mockResolvedValue(draft), get: vi.fn().mockResolvedValue(draft), generate: vi.fn().mockResolvedValue({ ...draft, state: 'succeeded', result: { outline: 'Esquema', orientative: true } }), accept: vi.fn(), cancel: vi.fn(), listAudio: vi.fn().mockResolvedValue([]), upload: vi.fn(), audioBlob: vi.fn(), shareAudio: vi.fn(), deleteAudio: vi.fn(), cancelAudio: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('Controles de Exposiciones', () => {
  it('muestra vista previa y exige consentimiento antes de una llamada a Gemini', async () => {
    await act(async () => root.render(<MemoryRouter><PresentationAiPanel actions={actions} attempt={attempt} archived={false} /></MemoryRouter>));
    expect(actions.generate).not.toHaveBeenCalled(); await click('Preparar esquema inicial'); expect(actions.generate).not.toHaveBeenCalled();
    const send = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Enviar a Gemini')!; expect(send.disabled).toBe(true);
    await act(async () => { (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); }); await click('Enviar a Gemini');
    expect(actions.generate).toHaveBeenCalledTimes(1); expect(actions.accept).not.toHaveBeenCalled(); expect(container.textContent).toContain('Aplicar reemplazará');
  });
  it('un envío guardado se consulta al reintentar y no se vuelve a generar', async () => {
    actions.get = vi.fn().mockResolvedValue({ ...draft, generationId: 'existing', state: 'running' });
    await act(async () => root.render(<MemoryRouter><PresentationAiPanel actions={actions} attempt={attempt} archived={false} /></MemoryRouter>));
    await click('Preparar esquema inicial'); await act(async () => { (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); }); await click('Enviar a Gemini');
    expect(actions.generate).not.toHaveBeenCalled(); expect(container.textContent).toContain('El envío está en curso.');
  });
  it('si deniegan el micrófono conserva la carga de archivos', async () => {
    const media = { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Micrófono denegado', 'NotAllowedError')) };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media }); vi.stubGlobal('MediaRecorder', class { static isTypeSupported() { return true; } });
    await act(async () => root.render(<PresentationMediaPanel actions={actions} attempt={attempt} practice={practice} owner onReady={() => {}} />)); await click('Grabar audio');
    expect(container.textContent).toContain('micrófono fue denegado'); expect(container.querySelector('input[type="file"]')).not.toBeNull(); expect(actions.upload).not.toHaveBeenCalled();
  });
  it('libera micrófono y grabador al salir del intento', async () => {
    const stopTrack = vi.fn(); const stopRecorder = vi.fn(); const stream = { getTracks: () => [{ stop: stopTrack }] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
    vi.stubGlobal('MediaRecorder', class { static isTypeSupported() { return true; } state = 'inactive'; start() { this.state = 'recording'; } stop() { this.state = 'inactive'; stopRecorder(); } });
    await act(async () => root.render(<PresentationMediaPanel actions={actions} attempt={attempt} practice={practice} owner onReady={() => {}} />)); await click('Grabar audio');
    await act(async () => root.unmount()); expect(stopTrack).toHaveBeenCalled(); expect(stopRecorder).toHaveBeenCalledTimes(1); root = createRoot(container);
  });
});
