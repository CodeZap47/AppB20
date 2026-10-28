// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLiveDraft } from './useLiveDraft';

const publish = vi.fn();
const source = { liveDrafts: { publish } };
let snapshot = { me: { status: 'active' }, connection: 'ready', liveDraftSharingEnabled: true };
vi.mock('../data/DataContext', () => ({ useDataSource: () => source, useSnapshot: () => snapshot }));
let change: (text: string) => void;
function Harness({ id = 'general' }: { id?: string }) { change = useLiveDraft('group', id); return null; }
let root: Root; let host: HTMLDivElement;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T20:00:00Z'));
  publish.mockReset(); snapshot = { me: { status: 'active' }, connection: 'ready', liveDraftSharingEnabled: true };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it('publica primero de inmediato y después a 200 ms con el último texto pendiente', async () => {
  change('a'); change('ab');
  expect(publish).toHaveBeenCalledExactlyOnceWith('group', 'general', 'a');
  await act(async () => vi.advanceTimersByTime(100)); change('abc');
  await act(async () => vi.advanceTimersByTime(99)); expect(publish).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(1)); expect(publish).toHaveBeenLastCalledWith('group', 'general', 'abc');
  expect(publish).toHaveBeenCalledTimes(2);
});
it('retira el texto al pasar 3,5 segundos sin escribir y al vaciar', async () => {
  change('Texto temporal'); await act(async () => vi.advanceTimersByTime(3499)); expect(publish).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(1)); expect(publish).toHaveBeenLastCalledWith('group', 'general', '');
  change('Nuevo'); change(''); expect(publish).toHaveBeenLastCalledWith('group', 'general', '');
});
it('cancela cambios pendientes al perder foco o cambiar de conversación', async () => {
  change('Uno'); change('No debe publicarse');
  await act(async () => window.dispatchEvent(new Event('blur')));
  expect(publish).toHaveBeenLastCalledWith('group', 'general', '');
  await act(async () => vi.advanceTimersByTime(4000)); expect(publish).toHaveBeenCalledTimes(2);
  change('Activo'); await act(async () => root.render(<Harness id="otra" />));
  expect(publish).toHaveBeenLastCalledWith('group', 'general', '');
  change('Nueva conversación'); expect(publish).toHaveBeenLastCalledWith('group', 'otra', 'Nueva conversación');
});
it('la preferencia de cuenta detiene el texto y nunca impide componer sin conexión', async () => {
  change('Provisional'); snapshot = { ...snapshot, liveDraftSharingEnabled: false };
  await act(async () => root.render(<Harness />)); expect(publish).toHaveBeenLastCalledWith('group', 'general', '');
  publish.mockClear(); change('Privado'); expect(publish).not.toHaveBeenCalled();
  snapshot = { ...snapshot, liveDraftSharingEnabled: true, connection: 'offline' };
  await act(async () => root.render(<Harness />)); change('Sin red'); expect(publish).not.toHaveBeenCalled();
});
