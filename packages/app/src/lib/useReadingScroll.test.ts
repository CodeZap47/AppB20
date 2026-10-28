// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadingScrollController } from './useReadingScroll';

interface Options { hidden: boolean; locked: boolean; changeVisibility: ReturnType<typeof vi.fn<(hidden: boolean, focus?: boolean, history?: HTMLElement) => boolean>> }
const controllers: ReadingScrollController[] = [];
const roots: HTMLElement[] = [];
let resizeCallbacks: (() => void)[];
beforeEach(() => {
  resizeCallbacks = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallbacks.push(callback); }
    observe() {} unobserve() {} disconnect() {}
  });
});
afterEach(() => { controllers.forEach(controller => controller.dispose()); controllers.length = 0; roots.forEach(root => root.remove()); roots.length = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  const root = document.createElement('div'); document.body.append(root); roots.push(root);
  const spacer = document.createElement('div');
  let height = 500, content = 2000, top = 0;
  const nodes = Array.from({ length: 20 }, (_, index) => {
    const node = document.createElement('div'); node.dataset.messageId = String(index + 1);
    node.getBoundingClientRect = () => {
      // The existing history aligns a short first flex child with margin-top:auto.
      const y = Math.max(0, height - content - Number.parseFloat(spacer.style.height || '0')) + index * 100 - top;
      return { top: y, bottom: y + 95, left: 0, right: 300, height: 95, width: 300, x: 0, y, toJSON() {} };
    };
    node.scrollIntoView = vi.fn(() => { root.scrollTop = index * 100 - height / 2; root.dispatchEvent(new Event('scroll')); });
    root.append(node); return node;
  });
  root.append(spacer);
  root.getBoundingClientRect = () => ({ top: 0, bottom: height, left: 0, right: 300, height, width: 300, x: 0, y: 0, toJSON() {} });
  Object.defineProperties(root, {
    clientHeight: { get: () => height }, clientWidth: { get: () => 300 }, offsetWidth: { get: () => 316 },
    scrollHeight: { get: () => Math.max(height, content + Number.parseFloat(spacer.style.height || '0')) },
    scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, root.scrollHeight - height)); } },
  });
  root.scrollTo = vi.fn((input?: ScrollToOptions | number, y?: number) => { if (typeof input === 'object') root.scrollTop = input.top ?? top; else if (y !== undefined) root.scrollTop = y; root.dispatchEvent(new Event('scroll')); });
  const state = { away: false, unseen: 0 };
  const options: Options = { hidden: false, locked: false, changeVisibility: vi.fn((hidden: boolean) => { if (hidden && options.locked) return false; options.hidden = hidden; return true; }) };
  const controller = new ReadingScrollController(root, spacer, () => options, next => Object.assign(state, next), 20, '20'); controllers.push(controller);
  const scroll = (value: number) => { root.scrollTop = value; root.dispatchEvent(new Event('scroll')); };
  const wheel = (value: number) => { root.dispatchEvent(new WheelEvent('wheel', { deltaY: value - top })); scroll(value); };
  const resize = (value: number) => { height = value; top = Math.min(top, Math.max(0, root.scrollHeight - height)); resizeCallbacks.forEach(callback => callback()); root.dispatchEvent(new Event('scroll')); };
  return { root, spacer, nodes, controller, options, state, scroll, wheel, resize, setContent(value: number) { content = value; } };
}

describe('lectura del historial y visibilidad del compositor', () => {
  it('acumula 12 px de movimiento real, ignora jitter y muestra al invertir hacia recientes', () => {
    const s = setup(); s.options.locked = true; s.wheel(1300); // Establish older reading without hiding an open tool.
    s.options.locked = false; s.options.changeVisibility.mockClear();
    s.wheel(1295); s.wheel(1289); expect(s.options.hidden).toBe(false);
    s.wheel(1288); expect(s.options.hidden).toBe(true);
    s.wheel(1292); s.wheel(1289); s.wheel(1296); expect(s.options.hidden).toBe(true);
    s.wheel(1301); expect(s.options.hidden).toBe(false);
    expect(s.options.changeVisibility).toHaveBeenLastCalledWith(false, false, s.root);
  });
  it('mantiene visible el extremo de 80 px y no cambia por scroll asignado o citas programáticas', () => {
    const s = setup(); s.wheel(1420); expect(s.options.hidden).toBe(false); expect(s.state.away).toBe(false);
    s.controller.quote(s.nodes[5]!); s.scroll(100); expect(s.options.hidden).toBe(false);
    s.wheel(88); expect(s.options.hidden).toBe(true); // A fresh user gesture interrupts a programmatic jump.
    s.scroll(800); expect(s.options.hidden).toBe(false); // Actual user momentum is still classified.
    s.controller.quote(s.nodes[3]!); s.options.changeVisibility.mockClear();
    s.scroll(200); s.scroll(600); expect(s.options.changeVisibility).not.toHaveBeenCalled();
  });
  it('conserva el primer mensaje visible al crecer el historial aunque el navegador limite scrollTop', () => {
    const s = setup(); s.wheel(1400); expect(s.options.hidden).toBe(true);
    const before = s.nodes[14]!.getBoundingClientRect().top;
    s.resize(700);
    expect(s.root.scrollTop).toBe(1400); expect(s.nodes[14]!.getBoundingClientRect().top).toBe(before);
    expect(Number.parseFloat(s.spacer.style.height)).toBe(112);
    expect(s.options.hidden).toBe(true); expect(s.state.away).toBe(true);
    s.controller.showComposer(); expect(s.options.changeVisibility).toHaveBeenLastCalledWith(false, true, s.root);
    s.resize(500); expect(s.root.scrollTop).toBe(1400); expect(s.nodes[14]!.getBoundingClientRect().top).toBe(before);
    expect(Number.parseFloat(s.spacer.style.height)).toBe(0);
  });
  it('no sigue mensajes nuevos ni salta al quitar mensajes mientras se leen anteriores', () => {
    const s = setup(); s.wheel(1000); const original = s.root.scrollTop;
    s.setContent(2100); s.controller.messagesChanged(21, '21', false);
    expect(s.state).toEqual({ away: true, unseen: 1 }); expect(s.root.scrollTop).toBe(original); expect(s.options.hidden).toBe(true);
    s.setContent(2000); s.controller.messagesChanged(20, '21', false);
    expect(s.root.scrollTop).toBe(original); expect(s.state.away).toBe(true);
    s.controller.latest(true); expect(s.options.hidden).toBe(false); expect(s.state).toEqual({ away: false, unseen: 0 }); expect(s.root.scrollTop).toBe(1500);
    s.resize(400); expect(s.root.scrollTop).toBe(1600);
  });
  it('una referencia nueva por arriba conserva el anclaje y no se cuenta como mensaje reciente', () => {
    const s = setup(); s.wheel(900);
    s.controller.messagesChanged(21, '20', false); expect(s.state.unseen).toBe(0); expect(s.root.scrollTop).toBe(900);
  });
  it('una confirmación propia tardía respeta la lectura iniciada después de enviar', async () => {
    const s = setup(); let confirm!: () => void;
    const pendingSend = new Promise<void>(resolve => { confirm = resolve; }).then(() => {
      s.setContent(2100); s.controller.messagesChanged(21, 'own-confirmed', true);
    });
    s.wheel(900); s.resize(700);
    const anchor = s.nodes[9]!.getBoundingClientRect().top;
    const position = s.root.scrollTop;
    confirm(); await pendingSend;
    expect(s.root.scrollTop).toBe(position); expect(s.nodes[9]!.getBoundingClientRect().top).toBe(anchor);
    expect(s.options.hidden).toBe(true); expect(s.state).toEqual({ away: true, unseen: 1 });
    s.controller.latest(); s.resize(500);
    s.setContent(2200); s.controller.messagesChanged(22, 'own-at-bottom', true);
    expect(s.state).toEqual({ away: false, unseen: 0 }); expect(s.options.hidden).toBe(false); expect(s.root.scrollTop).toBe(1700);
  });
  it('admite tacto, teclado y barra, y no trata el zoom o movimiento horizontal como desplazamiento de lectura', () => {
    const s = setup();
    const touch = (type: string, y: number) => { const event = new Event(type); Object.defineProperty(event, 'touches', { value: [{ clientX: 150, clientY: y }] }); s.root.dispatchEvent(event); };
    touch('touchstart', 100); touch('touchmove', 150); s.scroll(1300); expect(s.options.hidden).toBe(true);
    touch('touchend', 150); s.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' })); s.scroll(1320); expect(s.options.hidden).toBe(false);
    s.controller.quote(s.nodes[10]!); s.root.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true })); s.scroll(100); expect(s.options.hidden).toBe(false);
    s.root.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, deltaX: 100 })); s.scroll(50); expect(s.options.hidden).toBe(false);
    const pointer = new MouseEvent('pointerdown', { clientX: 299, button: 0 }); Object.defineProperty(pointer, 'pointerType', { value: 'mouse' });
    s.root.dispatchEvent(pointer); s.scroll(0); expect(s.options.hidden).toBe(true);
  });
  it('respeta bloqueo de herramientas, extremos sin recorrido y desmontaje sin listeners persistentes', () => {
    const s = setup(); s.options.locked = true; s.wheel(1000); expect(s.options.hidden).toBe(false);
    s.options.locked = false; s.setContent(300); s.resize(500); s.options.changeVisibility.mockClear(); s.wheel(-50); expect(s.options.changeVisibility).not.toHaveBeenCalled();
    s.controller.dispose(); s.setContent(2000); s.wheel(500); expect(s.options.changeVisibility).not.toHaveBeenCalled(); expect(s.root.style.overflowAnchor).toBe('');
  });
  it('conserva recorrido para invertir un historial que deja de desbordar al ocultar la escritura', () => {
    const s = setup(); s.setContent(600); s.controller.latest(); s.wheel(0);
    expect(s.options.hidden).toBe(true);
    // Real message nodes beyond the shortened history are no longer rendered.
    s.nodes.slice(6).forEach(node => node.remove());
    s.resize(700);
    expect(s.root.scrollHeight - s.root.clientHeight - s.root.scrollTop).toBeGreaterThanOrEqual(12);
    s.wheel(s.root.scrollTop + 12); expect(s.options.hidden).toBe(false);
  });
});
