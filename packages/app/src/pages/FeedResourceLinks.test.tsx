// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { Snapshot } from '../data/types';
import { ChallengeDetailPage, CodeReviewDetailPage } from './PracticePage';
import { OpportunitiesPage } from './OpportunitiesPage';

let data: Snapshot; let container: HTMLDivElement; let root: Root;
const at = new Date('2026-10-26T12:00:00Z');
vi.mock('../data/DataContext', () => ({ useSnapshot: () => data, useDataSource: () => ({}) }));
async function mount(path: string) {
  const router = createMemoryRouter([{ path: '/m/retos/:challengeId', element: <ChallengeDetailPage /> }, { path: '/m/revision-codigo/:reviewId', element: <CodeReviewDetailPage /> }, { path: '/m/oportunidades', element: <OpportunitiesPage /> }], { initialEntries: [path] });
  await act(async () => root.render(<RouterProvider router={router} />));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const member = { id: 'me', displayName: 'Luis', status: 'active' as const, isCreator: false, joinedAt: at };
  data = { ...emptySnapshot('ready'), me: member, members: [member], subjects: [{ id: 'subject', name: 'Algoritmos', period: 1 }] };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('enlaces específicos de tarjetas del feed', () => {
  it('mueve el foco a la solución exacta sin usar un fragmento del router', async () => {
    data.codingChallenges = [{ id: 'challenge', authorId: 'me', requestId: 'challenge', subjectId: 'subject', title: 'Sumar', topic: 'Listas', difficulty: 'basic', objective: 'Practicar', instructions: 'Sumar', examples: '1+1', hintCount: 0, closed: true, closure: 'Listo', version: 1, createdAt: at, updatedAt: at }];
    data.challengeSolutions = [{ id: 'solution', challengeId: 'challenge', authorId: 'me', body: 'sum()', explanation: 'Suma', version: 1, requestId: 'solution', createdAt: at, updatedAt: at }];
    await mount('/m/retos/challenge?solucion=solution');
    expect(document.activeElement).toBe(container.querySelector('#solucion-solution'));
    expect(document.activeElement?.getAttribute('aria-labelledby')).toBe('solucion-title-solution');
  });

  it('abre la versión original y enfoca la observación anclada al código antiguo', async () => {
    data.codeReviews = [{ id: 'review', authorId: 'me', requestId: 'review', subjectId: 'subject', title: 'Revisar', language: 'TS', currentVersion: 2, closed: true, version: 2, createdAt: at, updatedAt: at }];
    data.codeReviewVersions = [1, 2].map((number) => ({ reviewId: 'review', number, code: number === 1 ? 'original()' : 'corregido()', repositoryUrl: '', summary: `Versión ${number}`, requestId: `version-${number}`, createdAt: at }));
    data.codeReviewComments = [{ id: 'comment', reviewId: 'review', versionNumber: 1, lineStart: 1, lineEnd: 1, kind: 'error', authorId: 'me', body: 'Observación original', status: 'applied', resolution: 'Corregida', version: 1, requestId: 'comment', createdAt: at, updatedAt: at }];
    await mount('/m/revision-codigo/review?observacion=comment');
    expect(container.querySelector('select')?.value).toBe('1');
    expect(container.querySelector('.practice-code-lines')?.textContent).toContain('original()');
    expect(document.activeElement).toBe(container.querySelector('#observacion-comment'));
  });

  it('incluye y enfoca una oportunidad vencida enlazada desde el feed', async () => {
    data.opportunities = [{ id: 'expired', authorId: 'me', updatedBy: 'me', requestId: 'expired', version: 1, createdAt: at, updatedAt: at, kind: 'event', title: 'Evento con plazo vencido', topic: 'Programación', modality: 'online', sourceUrl: 'https://example.com/event', organizer: 'Universidad', requirements: 'Estudiantes', deadline: '2020-01-01T00:00:00Z', costKnown: true, cost: 'Gratis', withdrawn: false, withdrawalReason: '' }];
    await mount('/m/oportunidades?oportunidad=expired');
    expect(container.textContent).toContain('Evento con plazo vencido');
    expect(document.activeElement).toBe(container.querySelector('#oportunidad-expired'));
  });

  it('un identificador desconocido no revela contenido ni cambia el foco', async () => {
    await mount('/m/oportunidades?oportunidad=missing');
    expect(container.textContent).toContain('No hay oportunidades');
    expect(container.querySelector('article')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
