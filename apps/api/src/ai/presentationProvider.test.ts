import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresentationAiDraft } from '@b20/core';
const { generate, clients } = vi.hoisted(() => ({ generate: vi.fn(), clients: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: generate }; constructor(options: unknown) { clients(options); } } }));
import { createPresentationProvider } from './presentationProvider.ts';

const draft: PresentationAiDraft = {
  id: '20000000-0000-4000-8000-000000000001', actor: 'fixture', purpose: 'transcription', state: 'prepared', revision: 1,
  context: { practiceId: '1', attemptId: '1', attemptVersion: 1, title: 'Ciclos', topic: 'Ciclos', audience: 'Clase', targetMinutes: 5, keyPoints: ['Condición'], body: '' },
  fingerprint: 'fixture', model: 'gemini-test', estimatedTokens: 9000, createdAt: 1, expiresAt: 2,
};
beforeEach(() => { generate.mockReset(); clients.mockReset(); generate.mockResolvedValue({ text: '{"segments":[{"startSeconds":0,"endSeconds":1,"text":"Ensayo"}]}', candidates: [{ finishReason: 'STOP' }] }); });
describe('proveedor de Exposiciones', () => {
  it('normaliza el contenedor de Safari para Gemini y respeta el presupuesto reservado', async () => {
    await createPresentationProvider().generate({ apiKey: 'fixture-not-real', draft, audio: { mime: 'audio/mp4', bytes: new Uint8Array([1, 2, 3]) } });
    const request = generate.mock.calls[0]![0];
    expect(request.model).toBe('gemini-test');
    expect(request.contents[0].parts[1].inlineData).toEqual({ mimeType: 'audio/m4a', data: 'AQID' });
    expect(request.config.maxOutputTokens).toBe(8000);
    expect(clients).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'fixture-not-real', httpOptions: expect.objectContaining({ retryOptions: { attempts: 1 } }) }));
  });
  it('rechaza una transcripción incompleta sin presentarla como resultado aceptable', async () => {
    generate.mockResolvedValueOnce({ text: '{"segments":', candidates: [{ finishReason: 'MAX_TOKENS' }] });
    await expect(createPresentationProvider().generate({ apiKey: 'fixture-not-real', draft })).rejects.toMatchObject({ code: 'invalid_output', uncertain: false });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
