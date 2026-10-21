// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { navigableModules } from '@b20/core';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { vi.stubEnv('VITE_DATA_MODE', 'demo'); });

// Authentication is the only substituted application boundary. The App, hash router,
// providers, fixtures and every data action below are their production implementations.
vi.mock('./auth/AuthContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('./auth/AuthContext')>(),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({ status: 'signedIn', token: 'integration-session',
    expiresAt: Date.now() + 3_600_000,
    profile: { subject: 'integration-account', email: 'integration@example.test', name: 'Integración' } }),
  useSessionStore: () => ({ signOut: vi.fn() }),
}));

import { App } from './App';
import { DemoDataSource } from './data/demo';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
let container: HTMLDivElement;
let root: Root;
let source: DemoDataSource;

function field(label: string, within: ParentNode = container): Field {
  const labelNode = [...within.querySelectorAll('label')].find((node) => node.textContent?.includes(label));
  const target = labelNode?.control ?? labelNode?.querySelector('input, textarea, select');
  if (!target) throw new Error(`Falta el campo ${label}`);
  return target as Field;
}

async function change(element: Field, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

async function clickButton(label: string, within: ParentNode = container) {
  const target = [...within.querySelectorAll('button')].find((node) => {
    const copy = node.cloneNode(true) as HTMLButtonElement;
    copy.querySelectorAll('.chip__count').forEach((count) => count.remove());
    return copy.textContent?.trim() === label;
  });
  if (!target) throw new Error(`Falta el botón ${label}`);
  expect(target.disabled, label).toBe(false);
  await act(async () => target.click());
}

async function clickLink(label: string, within: ParentNode = container) {
  const target = [...within.querySelectorAll('a')].find((node) => node.textContent?.trim() === label);
  if (!target) throw new Error(`Falta el enlace ${label}`);
  await act(async () => target.click());
}

async function navigate(path: string) {
  // The real hash router consumes the same history event as browser Back/Forward.
  await act(async () => {
    window.history.replaceState({}, '', `/#${path}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

function expectHealthyPage() {
  expect(container.querySelector('main h1')).not.toBeNull();
  expect(container.textContent).not.toMatch(/Esta pantalla tuvo un problema|Unexpected Application Error|Pantalla pendiente de implementar/);
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // Observe the actual App-owned provider without replacing construction or any action.
  const getSnapshot = DemoDataSource.prototype.getSnapshot;
  vi.spyOn(DemoDataSource.prototype, 'getSnapshot').mockImplementation(function (this: DemoDataSource) {
    source = this;
    return getSnapshot.call(this);
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App platform="web" />));
  await navigate('/');
  expect(source).toBeInstanceOf(DemoDataSource);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllEnvs());

describe('integración real de Aprende enseñando en la aplicación', () => {
  it.each([
    { kind: 'note', path: '/m/notas/n1', id: 'n1', title: 'Tema de prueba' },
    { kind: 'guide', path: '/m/guias/gd1', id: 'gd1', title: 'Guía de prueba del parcial 1' },
  ] as const)('completa y publica desde $kind, manteniendo la nota y la práctica independientes', async ({ kind, path, id, title }) => {
    const before = source.getSnapshot();
    const original = kind === 'note' ? before.notes.find((item) => item.id === id)!
      : before.guides.find((item) => item.id === id)!;
    const initial = { concept: 'Una condición permite elegir una instrucción inicial.',
      example: 'Inicial: si llueve llevo paraguas.', limits: 'Inicial: la condición debe ser booleana.' };
    const revised = { concept: `Explicación revisada desde ${kind}: compara una condición booleana.`,
      example: 'Revisada: si llueve llevo paraguas; si no, lo dejo en casa.',
      limits: 'Revisada: distingue las dos ramas y evita condiciones ambiguas.' };
    const reflection = 'Reflexión privada de integración que nunca se publica.';
    const privateTopics = 'Tema privado para repasar después.';

    await navigate(path);
    expectHealthyPage();
    await clickLink('Practicar explicándolo');
    expect(window.location.hash).toContain(`/m/aprende-ensenando/nueva?${kind === 'note' ? 'nota' : 'guia'}=${id}`);
    expect(field('Materia').value).toBe(original.subjectId);
    expect(field('Tema').value).toBe(title);
    expect(field('Nota o guía').value).toBe(`${kind}:${id}`);
    for (const label of ['Concepto con tus palabras', 'Un ejemplo', 'Dónde aplica y dónde no']) {
      expect(field(label).value).toBe('');
    }
    const explanationFields = ['Concepto con tus palabras', 'Un ejemplo', 'Dónde aplica y dónde no'];
    for (const [index, value] of Object.values(initial).entries()) await change(field(explanationFields[index]!), value);
    await clickButton('Guardar borrador');
    const practice = source.getSnapshot().teachingPractices.find((item) => item.topic === title)!;
    expect(practice).toMatchObject({ ownerId: 'demo-1', status: 'draft', subjectId: original.subjectId, initial });
    expect(source.getSnapshot().teachingPersonal.find((item) => item.practiceId === practice.id))
      .toMatchObject({ sourceKind: kind, sourceId: id });

    await clickButton('Guardar y comenzar práctica');
    expect(source.getSnapshot().teachingQuestions.filter((item) => item.practiceId === practice.id)).toHaveLength(3);
    const questionForm = container.querySelector('.teaching-question-list form')!;
    await change(field('Tu respuesta', questionForm), 'Respuesta privada: funciona porque selecciona una sola rama.');
    await clickButton('Guardar respuesta', questionForm);
    for (const [index, value] of Object.values(revised).entries()) await change(field(explanationFields[index]!), value);
    await change(field('Reflexión personal'), reflection);
    await change(field('Temas para repasar'), privateTopics);
    await clickButton('Guardar y completar práctica');
    expect(source.getSnapshot().teachingPractices.find((item) => item.id === practice.id))
      .toMatchObject({ status: 'completed', initial, revised });
    const preview = container.querySelector('.teaching-preview')!;
    expect(preview.textContent).toContain(revised.concept);
    expect(preview.textContent).not.toMatch(/Reflexión privada de integración|Tema privado para repasar|Respuesta privada|Una condición permite elegir una instrucción inicial/);
    await clickButton('Publicar explicación en Notas de clase');
    const publishedId = source.getSnapshot().teachingPersonal.find((item) => item.practiceId === practice.id)!.publishedNoteId!;
    const published = source.getSnapshot().notes.find((item) => item.id === publishedId)!;
    expect(published).toMatchObject({ title, authorId: 'demo-1', source: 'student', visibility: 'group', subjectId: original.subjectId });
    expect(source.getSnapshot().notes).toHaveLength(before.notes.length + 1);
    expect(published.body).toContain(revised.concept);
    expect(published.body).not.toMatch(/Reflexión privada|Tema privado|Respuesta privada|Inicial:/);
    await clickLink('Abrir nota publicada');
    expect(window.location.hash).toBe(`#/m/notas/${publishedId}`);
    expect(container.querySelector('h1')?.textContent).toBe(title);
    expect(container.textContent).toContain('Apunte de alumno');
    expect(container.textContent).toContain(revised.example);
    expect(container.textContent).not.toContain(reflection);

    // Reopening, improving and publishing again must retain a single independent note.
    await navigate(`/m/aprende-ensenando/${practice.id}`);
    await clickButton('Reabrir práctica');
    await change(field('Concepto con tus palabras'), 'Nueva explicación guardada después de publicar.');
    await clickButton('Guardar y completar práctica');
    expect(container.textContent).not.toContain('Publicar explicación en Notas de clase');
    expect(source.getSnapshot().notes.find((item) => item.id === publishedId)?.body).toBe(published.body);
    await clickLink('Abrir nota publicada');
    await clickLink('Editar');
    await change(field('Contenido'), 'Contenido editado exclusivamente desde Notas.');
    await clickButton('Guardar');
    expect(container.textContent).toContain('Contenido editado exclusivamente desde Notas.');
    expect(source.getSnapshot().teachingPractices.find((item) => item.id === practice.id)?.revised.concept)
      .toBe('Nueva explicación guardada después de publicar.');
    expect(source.getSnapshot().notes.filter((item) => item.id === publishedId)).toHaveLength(1);
    await navigate('/perfil/demo-1');
    await clickButton('Notas y guías');
    const publishedLinks = [...container.querySelectorAll('main a')]
      .filter((link) => link.getAttribute('href') === `#/m/notas/${publishedId}`);
    expect(publishedLinks).toHaveLength(1);
    expect(publishedLinks[0]?.textContent).toContain(title);
    expect(container.textContent).not.toMatch(/Reflexión privada de integración|Respuesta privada|Tema privado para repasar/);
    expectHealthyPage();
  });

  it.each([undefined, 'demo-3'])('retira inmediatamente la pantalla abierta al cambiar el compañero a %s', async (replacement) => {
    await navigate('/m/aprende-ensenando/tp1');
    await change(field('Perfil simulado'), 'demo-2');
    expect(container.textContent).toContain('Una condición permite decidir qué instrucciones ejecutar.');
    expect(container.textContent).not.toContain('Reflexión de prueba, visible solo para mí.');
    await change(field('Haz una pregunta'), 'Pregunta real desde la sesión invitada.');
    await clickButton('Enviar pregunta');
    expect(source.getSnapshot().teachingQuestions.some((item) => item.text === 'Pregunta real desde la sesión invitada.')).toBe(true);
    await change(field('Haz una pregunta'), 'Borrador local que también debe desaparecer.');

    // Simulate the owner's real command arriving while the former reviewer stays on this URL.
    // All mutations execute the same DemoDataSource methods used by the real forms.
    await act(async () => {
      source.setViewer('demo-1');
      source.setTeachingReviewer('tp1', replacement);
      source.setViewer('demo-2');
    });
    expect(window.location.hash).toBe('#/m/aprende-ensenando/tp1');
    expect(container.textContent).toContain('Esta práctica no está disponible');
    expect(container.textContent).not.toMatch(/Una condición permite decidir|Pregunta real desde la sesión|Borrador local/);
    expect(container.querySelector('textarea')).toBeNull();
    expect(source.getSnapshot().teachingPractices).not.toContainEqual(expect.objectContaining({ id: 'tp1' }));
    expect(source.getSnapshot().teachingQuestions).not.toContainEqual(expect.objectContaining({ practiceId: 'tp1' }));
  });

  it('abre cada módulo disponible desde el menú real y conserva el aviso de simulación', async () => {
    const desktop = container.querySelector<HTMLElement>('.b20-slim-desktop')!;
    const nav = desktop.querySelector('nav[aria-label="Módulos"]')!;
    const groups = [...nav.querySelectorAll<HTMLButtonElement>('button[aria-controls]')];
    async function moduleLink(id: string) {
      const selector = `a[href="#/m/${id}"]`;
      let target = nav.querySelector<HTMLAnchorElement>(selector);
      for (const group of groups) {
        if (target) break;
        if (group.getAttribute('aria-expanded') !== 'true') await act(async () => group.click());
        // Exit animations may briefly retain another area's links. Use the open area only.
        const panel = desktop.querySelector(`[data-area="${group.getAttribute('aria-label')}"]`);
        target = panel?.querySelector<HTMLAnchorElement>(selector) ?? null;
      }
      if (!target) throw new Error(`Falta el acceso al módulo ${id}`);
      return target;
    }
    for (const module of navigableModules()) {
      const target = await moduleLink(module.id);
      expect(target.getAttribute('aria-label') ?? target.textContent).toContain(module.id === 'inicio' ? 'Inicio' : module.title);
      await act(async () => target.click());
      expect(window.location.hash).toBe(`#/m/${module.id}`);
      expectHealthyPage();
      expect(container.querySelector('.demo-banner')?.textContent).toContain('los cambios no se guardan ni se comparten');
      expect((await moduleLink(module.id)).getAttribute('aria-current'), module.id).toBe('page');
    }
    expect(desktop.querySelector('.b20-slim-account')?.textContent).toContain('Perfil simulado');
  });

  it('abre Avisos desde el pie y actualiza su contador cuando los avisos se leen', async () => {
    const desktop = container.querySelector<HTMLElement>('.b20-slim-desktop')!;
    const noticesLink = () => desktop.querySelector<HTMLAnchorElement>('nav[aria-label="Cuenta y aplicación"] a[href="#/m/avisos"]')!;
    const unread = () => source.getSnapshot().notifications.filter((notification) => !notification.readAt).length;
    expect(noticesLink().getAttribute('aria-label')).toBe(unread() ? `Avisos (${unread()})` : 'Avisos');
    await act(async () => source.requestNotificationTest());
    expect(unread()).toBeGreaterThan(0);
    expect(noticesLink().getAttribute('aria-label')).toBe(`Avisos (${unread()})`);
    await act(async () => noticesLink().click());
    expect(window.location.hash).toBe('#/m/avisos');
    expect(container.querySelector('main h1')?.textContent).toBe('Mis avisos');
    expect(noticesLink().getAttribute('aria-current')).toBe('page');
    const noticeCount = source.getSnapshot().notifications.length;
    await clickButton('Marcar todos como leídos', container.querySelector('main')!);
    expect(unread()).toBe(0);
    expect(source.getSnapshot().notifications).toHaveLength(noticeCount);
    expect(noticesLink().getAttribute('aria-label')).toBe('Avisos');
    expectHealthyPage();
  });
});
