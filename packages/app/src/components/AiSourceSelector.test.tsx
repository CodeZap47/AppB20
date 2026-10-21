// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AiSourceRef } from '@b20/core';
import { AiSourceSelector } from './AiSourceSelector';
import type { AiCandidate } from '../lib/aiSources';

let root: Root; let container: HTMLDivElement;
const candidates: AiCandidate[] = [
  { kind: 'note', refId: '1', subjectId: '1', title: 'Mi apunte personal', topics: ['Bucles'], personal: true, version: 1, revision: 'one' },
  { kind: 'assignment', refId: '2', subjectId: '1', termId: '1', title: 'Ejercicio', topics: ['Bucles'], personal: false, version: 1, revision: 'two' },
];
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('selección expresa de fuentes', () => {
  it('no preselecciona datos personales ni sin parcial y registra la elección manual', async () => {
    let changed: AiSourceRef[] = [];
    await act(async () => root.render(<AiSourceSelector candidates={candidates} topics={['Bucles']} value={[]} maxSources={10} onChange={(refs) => { changed = refs; }} />));
    expect([...container.querySelectorAll<HTMLInputElement>('.ai-source__choice input')].every((input) => !input.checked)).toBe(true);
    expect(container.textContent).toContain('Personal propia'); expect(container.textContent).toContain('Sin parcial · inclusión manual');
    await act(async () => container.querySelector<HTMLInputElement>('.ai-source__choice input')!.click());
    expect(changed).toEqual([{ kind: 'note', refId: '1', topics: ['Bucles'], includeUnplaced: true }]);
  });
  it('permite quitar una selección al alcanzar el límite y bloquea agregar otra', async () => {
    const current: AiSourceRef[] = [{ kind: 'note', refId: '1', topics: ['Bucles'], includeUnplaced: true }];
    let changed: AiSourceRef[] = current;
    await act(async () => root.render(<AiSourceSelector candidates={candidates} topics={['Bucles']} value={current} maxSources={1} onChange={(refs) => { changed = refs; }} />));
    const boxes = container.querySelectorAll<HTMLInputElement>('.ai-source__choice input');
    expect(boxes[0]!.disabled).toBe(false); expect(boxes[1]!.disabled).toBe(true);
    await act(async () => boxes[0]!.click()); expect(changed).toEqual([]);
  });
});
