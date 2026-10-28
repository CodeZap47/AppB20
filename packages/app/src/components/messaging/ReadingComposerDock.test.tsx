// @vitest-environment jsdom
import { act, useLayoutEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadingComposerDock, ReadingComposerProvider, useReadingComposer, useReadingComposerDock, type ReadingComposerDockState } from './ReadingComposerDock';

let host: HTMLDivElement;
let root: Root;
let state: ReadingComposerDockState;
const hidden = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function Fields() {
  const control = useReadingComposer();
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { control?.registerInput(input.current); return () => control?.registerInput(null); }, [control?.registerInput]);
  return <form><textarea ref={input} aria-label="Borrador" defaultValue="Texto que estoy preparando" /><button>Adjuntar archivo</button><span>Referencia seleccionada</span></form>;
}
function Harness({ conversation = 'group:general' }: { conversation?: string }) {
  state = useReadingComposerDock(conversation, hidden);
  return <ReadingComposerProvider state={state}>
    <div role="log" tabIndex={0} aria-label="Historial" />
    <p role="alert">Aviso operativo visible</p>
    <ReadingComposerDock state={state}><div>Otra persona escribe</div><Fields /></ReadingComposerDock>
  </ReadingComposerProvider>;
}
async function mount(conversation?: string) { await act(async () => root.render(<Harness conversation={conversation} />)); }
async function frame() { await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)); }); }
const dock = () => host.querySelector<HTMLElement>('.reading-composer-dock')!;
const history = () => host.querySelector<HTMLElement>('[role="log"]')!;
const input = () => host.querySelector<HTMLTextAreaElement>('textarea')!;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  hidden.mockClear(); nextFrame = 0; frames.clear();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++nextFrame, fn); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('bloque de escritura al leer el historial', () => {
  it('conserva el mismo campo, borrador y selección al plegarse, y retira el foco al historial', async () => {
    await mount(); const field = input(); field.focus(); field.setSelectionRange(5, 9);
    await act(async () => { expect(state.onVisibilityChange(true, false, history())).toBe(true); });
    expect(input()).toBe(field); expect(field.value).toBe('Texto que estoy preparando'); expect(field.selectionStart).toBe(5);
    expect(dock().hasAttribute('inert')).toBe(true); expect(dock().getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(history()); expect(hidden).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')?.closest('.reading-composer-dock')).toBeNull();
    await act(async () => state.onVisibilityChange(false)); await frame();
    expect(dock().hasAttribute('inert')).toBe(false); expect(document.activeElement).toBe(history());
    expect(host.textContent).toContain('Referencia seleccionada'); expect(host.textContent).toContain('Otra persona escribe');
  });

  it('no abre el campo al mostrar por desplazamiento, pero lo enfoca tras una recuperación explícita', async () => {
    await mount(); history().focus();
    await act(async () => state.onVisibilityChange(true));
    await act(async () => state.onVisibilityChange(false)); await frame();
    expect(document.activeElement).toBe(history());
    await act(async () => state.onVisibilityChange(true));
    await act(async () => state.control.reveal(true)); await frame();
    expect(document.activeElement).toBe(input()); expect(dock().hasAttribute('aria-hidden')).toBe(false);
  });

  it('mantiene el área visible hasta liberar todos los bloqueos de composición y herramientas', async () => {
    await mount();
    await act(async () => { state.control.setLocked('ime', true); state.control.setLocked('tools', true); });
    await act(async () => { expect(state.onVisibilityChange(true, false, history())).toBe(false); });
    expect(dock().hasAttribute('aria-hidden')).toBe(false); expect(hidden).not.toHaveBeenCalled();
    await act(async () => state.control.setLocked('ime', false));
    await act(async () => { expect(state.onVisibilityChange(true)).toBe(false); });
    await act(async () => state.control.setLocked('tools', false));
    await act(async () => { expect(state.onVisibilityChange(true)).toBe(true); });
    expect(dock().hasAttribute('aria-hidden')).toBe(true);
  });

  it('recupera un control operativo si el campo sigue deshabilitado por una transferencia', async () => {
    await mount(); input().disabled = true;
    await act(async () => state.onVisibilityChange(true, false, history()));
    await act(async () => state.control.reveal(true)); await frame();
    expect(document.activeElement).toBe(host.querySelector('form button'));
    expect(state.hidden).toBe(false);
  });

  it('una conversación nueva comienza visible y no admite callbacks de la anterior', async () => {
    await mount('group:general'); const previous = state;
    await act(async () => previous.onVisibilityChange(true)); expect(dock().hasAttribute('aria-hidden')).toBe(true);
    await mount('direct:second'); expect(state.hidden).toBe(false); expect(state.locked).toBe(false);
    await act(async () => { expect(previous.onVisibilityChange(true)).toBe(false); previous.control.setLocked('old', true); });
    expect(state.hidden).toBe(false); expect(state.locked).toBe(false);
    await act(async () => state.onVisibilityChange(true)); expect(state.hidden).toBe(true);
  });
});
