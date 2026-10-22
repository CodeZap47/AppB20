// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { createDemoState, DemoDataSource } from '../data/demo';
import { TypingIndicator } from './TypingIndicator';

let root: Root;
let container: HTMLDivElement;
let source: DemoDataSource;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-22T17:00:00Z'));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  source = new DemoDataSource(createDemoState(), 'demo-1');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  source.dispose();
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('escribiendo en una conversación', () => {
  it('oculta el estado vencido aunque no llegue una actualización del servidor', async () => {
    const snapshot = {
      ...source.getSnapshot(),
      typingPresence: [
        {
          memberId: 'demo-2',
          scope: 'direct' as const,
          conversationId: '1',
          expiresAt: new Date(Date.now() + 7000),
        },
      ],
    };
    vi.spyOn(source, 'getSnapshot').mockReturnValue(snapshot);
    await act(async () =>
      root.render(
        <DataProvider source={source}>
          <TypingIndicator scope="direct" conversationId="1" />
        </DataProvider>,
      ),
    );
    expect(container.textContent).toContain('está escribiendo');
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(container.textContent).toBe('');
  });
  it('no muestra al propio usuario, miembros bloqueados ni otra conversación', async () => {
    const expiresAt = new Date(Date.now() + 7000);
    const snapshot = {
      ...source.getSnapshot(),
      blockedMembers: [{ memberId: 'demo-2' }],
      typingPresence: [
        { memberId: 'demo-1', scope: 'direct' as const, conversationId: '1', expiresAt },
        { memberId: 'demo-2', scope: 'direct' as const, conversationId: '1', expiresAt },
        { memberId: 'demo-3', scope: 'direct' as const, conversationId: '2', expiresAt },
      ],
    };
    vi.spyOn(source, 'getSnapshot').mockReturnValue(snapshot);
    await act(async () =>
      root.render(
        <DataProvider source={source}>
          <TypingIndicator scope="direct" conversationId="1" />
        </DataProvider>,
      ),
    );
    expect(container.textContent).toBe('');
  });
});
