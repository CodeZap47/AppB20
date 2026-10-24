// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_LIMITS, AI_CONSENT_VERSION, buildAiPreparation, type AiStatus, type AiPrepareInput } from '@b20/core';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import type { DataSource } from '../data/types';
import type { SessionState } from '../auth/session';
import { ByokSettings } from './ByokSettings';

const auth = vi.hoisted(() => ({ session: null as SessionState | null }));
vi.mock('../auth/AuthContext', () => ({ useSession: () => auth.session }));
vi.mock('../config', () => ({ config: { apiUrl: 'https://legacy-api.example', aiApiUrl: 'https://api.example' } }));
let root: Root; let container: HTMLDivElement; let source: DemoDataSource;
const status: AiStatus = { actor: 'member-one', enabled: false, configured: false, model: 'gemini-test', limits: AI_LIMITS, consentVersion: AI_CONSENT_VERSION, consented: false, serviceConfigured: true };
const signedIn = (token: string): SessionState => ({ status: 'signedIn', token, expiresAt: Date.now() + 60_000, profile: { subject: token, email: 'alumno@example.test', name: 'Alumno' } });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  auth.session = null; container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  source = new DemoDataSource(createDemoState(), 'demo-1');
});
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); vi.unstubAllGlobals(); });
async function show(simulated = true, strict = false) {
  const liveSource = { getSnapshot: () => source.getSnapshot(), subscribe: (listener: () => void) => source.subscribe(listener) } as DataSource;
  const content = <DataProvider source={simulated ? source : liveSource}><ByokSettings /></DataProvider>;
  await act(async () => root.render(strict ? <StrictMode>{content}</StrictMode> : content));
}
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function click(label: string) { const button = [...container.querySelectorAll('button')].find((entry) => entry.textContent === label)!; expect(button).toBeTruthy(); await act(async () => button.click()); }
function visibilityButton(action: 'Mostrar' | 'Ocultar') { return container.querySelector<HTMLButtonElement>(`button[aria-label="${action} clave de Gemini"]`)!; }
async function revealKey() { const button = visibilityButton('Mostrar'); expect(button).toBeTruthy(); await act(async () => button.click()); }
async function subjectWithMaterial() {
  const subjectId = source.getSnapshot().notes[0]!.subjectId;
  const select = container.querySelector<HTMLSelectElement>('section[aria-label="Preparar material para IA"] .ai-scope select')!;
  await act(async () => { select.value = subjectId; select.dispatchEvent(new Event('change', { bubbles: true })); });
}

describe('Ajustes de BYOK y preparación de fuentes', () => {
  it('la simulación no ofrece entrada de claves reales ni hace peticiones de red', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    await show(); expect(container.querySelector('input[type=password]')).toBeNull();
    await click('Usar clave simulada'); expect(container.textContent).toContain('Clave ficticia configurada');
    await subjectWithMaterial(); await input(container.querySelector('textarea')!, 'Tema de prueba');
    const boxes = container.querySelectorAll<HTMLInputElement>('.ai-source__choice input'); expect(boxes.length).toBeGreaterThan(0);
    expect([...boxes].every((box) => !box.checked)).toBe(true);
    await act(async () => boxes[0]!.click());
    const topicBox = container.querySelector<HTMLInputElement>('.ai-source__topics input')!; await act(async () => topicBox.click());
    await click('Preparar vista previa');
    expect(container.textContent).toContain('Texto exacto preparado'); expect(container.textContent).toContain('Material ficticio de demostración');
    expect(container.textContent).toContain('Modelo previsto'); expect(network).not.toHaveBeenCalled();
    expect([...container.querySelectorAll('button')].some((button) => /Generar examen|Crear examen/.test(button.textContent ?? ''))).toBe(false);
    await input(container.querySelector('textarea')!, 'Otro tema');
    expect(container.textContent).not.toContain('Texto exacto preparado'); expect(container.textContent).toContain('Prepara el material nuevamente');
  });

  it('consulta BYOK y sus borradores en el Worker de IA aunque el API heredado tenga otra dirección', async () => {
    auth.session = signedIn('one');
    const network = vi.fn(async (url: string) => {
      if (url.endsWith('/ai/status')) return Response.json(status);
      if (url.endsWith('/ai/generations')) return Response.json([]);
      return Response.json({ configured: false });
    });
    vi.stubGlobal('fetch', network);
    await show(false);
    const requests = network.mock.calls.map(([url]) => url);
    expect(requests).toContain('https://api.example/ai/status');
    expect(requests).toContain('https://api.example/ai/key');
    expect(requests).toContain('https://api.example/ai/generations');
    expect(requests.every((url) => url.startsWith('https://api.example/'))).toBe(true);
  });

  it('limpia el secreto al enviar, cancelar y cambiar la sesión; sigue operativo en StrictMode', async () => {
    auth.session = signedIn('one');
    let resolveSave!: (response: Response) => void;
    const network = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/ai/status')) return Response.json({ ...status, consented: true });
      if (options?.method === 'PUT') return new Promise<Response>((resolve) => { resolveSave = resolve; });
      return Response.json({ configured: false });
    }); vi.stubGlobal('fetch', network);
    await show(false, true);
    const password = container.querySelector<HTMLInputElement>('input[type=password]')!;
    expect(password.disabled).toBe(false);
    expect(password.autocomplete).toBe('new-password'); expect(password.minLength).toBe(20); expect(password.maxLength).toBe(256);
    await input(password, 'secret-is-only-transient-12345'); await revealKey();
    expect(password.type).toBe('text'); expect(password.value).toBe('secret-is-only-transient-12345');
    expect(network.mock.calls.some((call) => call[1]?.method === 'PUT')).toBe(false);
    await act(async () => password.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(password.value).toBe(''); expect(password.type).toBe('password');
    expect(password.disabled).toBe(true); expect(visibilityButton('Mostrar').disabled).toBe(true);
    await act(async () => visibilityButton('Mostrar').click()); expect(password.type).toBe('password');
    const put = network.mock.calls.find((call) => call[1]?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]?.body))).toEqual({ apiKey: 'secret-is-only-transient-12345' });
    expect(container.textContent).not.toContain('secret-is-only-transient');
    await act(async () => resolveSave(Response.json({ configured: true })));
    expect(visibilityButton('Mostrar').disabled).toBe(false);
    await input(password, 'cancel-this-secret-12345'); await revealKey();
    expect(password.type).toBe('text'); await click('Cancelar'); expect(password.value).toBe(''); expect(password.type).toBe('password');
    await input(password, 'clear-on-session-change-12345'); await revealKey();
    expect(password.type).toBe('text'); auth.session = signedIn('two'); await show(false, true);
    const nextPassword = container.querySelector<HTMLInputElement>('input[type=password]')!;
    expect(nextPassword.value).toBe(''); expect(password.value).toBe(''); expect(visibilityButton('Mostrar')).toBeTruthy();
    await input(nextPassword, 'clear-on-leave-12345'); await revealKey();
    await act(async () => root.render(null)); expect(nextPassword.value).toBe('');
    await show(false, true);
    expect(container.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe(''); expect(visibilityButton('Mostrar')).toBeTruthy();
    expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
  });

  it('prepara sin clave y sin habilitar Gemini y omite la vista previa cuando cambia una fuente', async () => {
    auth.session = signedIn('one');
    let submitted: AiPrepareInput | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/ai/status')) return Response.json(status);
      if (url.endsWith('/ai/key')) return Response.json({ configured: false });
      if (url.endsWith('/ai/generations')) return Response.json([]);
      submitted = JSON.parse(String(options?.body)) as AiPrepareInput;
      // Server fixture uses decimal IDs; demo IDs are presentation-only in this test.
      const sample = { ...submitted, subjectId: '1', sources: submitted.sources.map((ref, index) => ({ ...ref, refId: String(index + 1) })) };
      return Response.json(buildAiPreparation(sample, sample.sources.map((ref) => ({ kind: ref.kind, refId: ref.refId, version: 1, subjectId: '1', title: 'Fuente autorizada', visibility: 'group', fields: [{ name: 'Texto', text: 'Fragmento exacto del servidor.' }] })), { id: crypto.randomUUID(), model: status.model, now: Date.now() }));
    }));
    const subjectId = source.getSnapshot().notes[0]!.subjectId;
    source.saveNote({ subjectId, title: 'Nota propia para preparar', topic: 'Tema', body: 'Texto inicial', tags: [], visibility: 'personal', source: 'student' });
    await show(false); await subjectWithMaterial(); await input(container.querySelector('textarea')!, 'Tema');
    const chosen = [...container.querySelectorAll<HTMLLabelElement>('.ai-source__choice')].find((label) => label.textContent?.includes('Nota propia para preparar'))!.querySelector<HTMLInputElement>('input')!;
    await act(async () => chosen.click());
    expect(container.querySelector<HTMLInputElement>('.ai-source__topics input')!.checked).toBe(true);
    await click('Preparar vista previa'); expect(submitted?.sources).toHaveLength(1);
    expect(container.textContent).toContain('Fragmento exacto del servidor.');
    expect(container.textContent).toContain('Sin configurar');
    const ref = submitted!.sources[0]!;
    if (ref.kind === 'note') {
      const note = source.getSnapshot().notes.find((entry) => entry.id === ref.refId)!;
      await act(async () => source.saveNote({ ...note, body: 'Texto nuevo', expectedVersion: note.version }));
    } else {
      await input(container.querySelector('textarea')!, 'Contenido nuevo');
    }
    expect(container.textContent).not.toContain('Fragmento exacto del servidor.');
  });
});
