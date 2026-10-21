// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, HelpContactRequest, HelpPost, HelpPostInput, Member, Snapshot } from '../data/types';
import { HelpContactsPage, HelpFormPage, HelpPage, HelpPostPage } from './HelpPage';

const at = new Date('2026-10-21T12:00:00Z');
const member = (id: string, isCreator = false): Member => ({ id, displayName: id, status: 'active', isCreator, joinedAt: at });
const post = (id: string, overrides: Partial<HelpPost> = {}): HelpPost => ({
  id, authorId: 'owner', kind: 'offer', subjectId: 'code', topic: 'Ciclos', title: `Publicación ${id}`,
  description: 'Podemos repasar los ciclos for.', level: 'initial', modality: 'messages',
  availability: '', status: 'open', createdAt: at, updatedAt: at, ...overrides,
});
const contact = (id: string, overrides: Partial<HelpContactRequest> = {}): HelpContactRequest => ({
  id, postId: 'offer', senderId: 'viewer', recipientId: 'owner', subjectId: 'code',
  postTitle: 'Título conservado', postTopic: 'Tema conservado', postKind: 'offer', message: '',
  status: 'pending', createdAt: at, updatedAt: at, ...overrides,
});

let root: Root;
let container: HTMLDivElement;
let snapshot: Snapshot;
let listeners: Set<() => void>;
let source: DataSource;
const actions = {
  saveHelpPost: vi.fn(async (_input: HelpPostInput) => 'saved'),
  setHelpPostStatus: vi.fn(async (_id: string, _status: 'open' | 'closed') => {}),
  withdrawHelpPost: vi.fn(async (_id: string, _reason?: string) => {}),
  sendHelpContact: vi.fn(async (_id: string, _message?: string) => 'sent'),
  respondHelpContact: vi.fn(async (_id: string, _decision: 'accepted' | 'rejected') => {}),
  cancelHelpContact: vi.fn(async (_id: string) => {}),
  closeHelpContact: vi.fn(async (_id: string) => {}),
};

function Location() { return <output data-location>{useLocation().pathname}{useLocation().search}</output>; }
function publish(changes: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...changes };
  listeners.forEach((listener) => listener());
}
async function render(path: string) {
  await act(async () => root.render(
    <DataProvider source={source}><MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/m/ayuda" element={<HelpPage />} />
      <Route path="/m/ayuda/nueva" element={<HelpFormPage />} />
      <Route path="/m/ayuda/contactos" element={<HelpContactsPage />} />
      <Route path="/m/ayuda/:postId" element={<HelpPostPage />} />
      <Route path="/m/ayuda/:postId/editar" element={<HelpFormPage />} />
    </Routes><Location /></MemoryRouter></DataProvider>,
  ));
}
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === text);
  if (!found) throw new Error(`No se encontró el botón ${text}`);
  return found;
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function fill(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function submit(form: HTMLFormElement) { await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  listeners = new Set();
  snapshot = {
    ...emptySnapshot('ready'), me: member('viewer'),
    members: [member('viewer'), member('owner'), member('third'), member('admin', true)],
    subjects: [{ id: 'code', name: 'Programación', period: 1 }, { id: 'db', name: 'Bases de datos', period: 2 }],
    helpPosts: [post('offer'), post('request', { kind: 'request', title: 'Repasar normalización', subjectId: 'db', topic: 'Normalización' }), post('mine', { authorId: 'viewer', status: 'closed' })],
  };
  source = { ...actions, getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } } as unknown as DataSource;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('pantallas de ayuda', () => {
  it('muestra solo abiertas en el tablón y combina búsqueda, materia, tipo y modalidad desde la URL', async () => {
    await render('/m/ayuda?q=normalizacion&materia=db&tipo=request&modalidad=messages');
    expect(container.querySelectorAll('.help-card')).toHaveLength(1);
    expect(container.querySelector('.help-card')?.textContent).toContain('Repasar normalización');
    await click(button('Limpiar filtros'));
    expect(container.querySelectorAll('.help-card')).toHaveLength(2);
    expect(container.querySelector('[data-location]')?.textContent).toBe('/m/ayuda');
  });

  it('incluye cerradas y retiradas propias en Mis publicaciones sin mostrar las retiradas ajenas', async () => {
    snapshot.helpPosts.push(post('retirada propia', { authorId: 'viewer', status: 'withdrawn' }), post('retirada ajena', { status: 'withdrawn' }));
    await render('/m/ayuda?vista=mias');
    expect(container.querySelectorAll('.help-card')).toHaveLength(2);
    expect(container.textContent).toContain('Publicación retirada propia');
    expect(container.textContent).not.toContain('retirada ajena');
    expect(container.textContent).not.toContain('Publicación offer');
  });

  it('limita listas y conteos privados a los participantes aunque el visor sea administrador', async () => {
    snapshot.me = member('admin', true);
    snapshot.helpContacts = [
      contact('foreign', { message: 'MENSAJE AJENO SECRETO' }),
      contact('received', { senderId: 'owner', recipientId: 'admin', message: 'Solo administrador y autor' }),
      contact('sent', { senderId: 'admin', recipientId: 'third' }),
    ];
    await render('/m/ayuda/contactos');
    expect(container.querySelectorAll('.help-contact')).toHaveLength(1);
    expect(container.textContent).not.toContain('MENSAJE AJENO SECRETO');
    expect(button('Recibidos 1')).toBeDefined();
    await click(button('Enviados 1'));
    expect(container.querySelectorAll('.help-contact')).toHaveLength(1);
    expect(container.textContent).not.toContain('Solo administrador y autor');
  });

  it('conserva título, tema y mensaje de un contacto cuando la publicación ya se retiró', async () => {
    snapshot.helpPosts = [];
    snapshot.helpContacts = [contact('old', { status: 'closed', message: 'Contexto privado anterior' })];
    await render('/m/ayuda/contactos?pestana=enviados');
    expect(container.textContent).toContain('Título conservado');
    expect(container.textContent).toContain('Tema conservado');
    expect(container.textContent).toContain('Contexto privado anterior');
    expect(container.querySelector('a[href="/m/ayuda/offer"]')).toBeNull();
  });

  it('solicita contacto con un mensaje opcional y evita volver a solicitar si ya existe', async () => {
    actions.sendHelpContact.mockImplementationOnce(async (id, message) => {
      publish({ helpContacts: [contact('sent', { postId: id, message })] });
      return 'sent';
    });
    await render('/m/ayuda/offer');
    expect(container.querySelector('a[href="/perfil/owner"]')).not.toBeNull();
    await click(button('Pedir ayuda'));
    await fill(container.querySelector('textarea')!, '  Quiero repasar estos ciclos.  ');
    await submit(container.querySelector('form')!);
    expect(actions.sendHelpContact).toHaveBeenCalledWith('offer', 'Quiero repasar estos ciclos.');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Solicitud enviada');
    expect([...container.querySelectorAll('button')].some((element) => element.textContent === 'Pedir ayuda')).toBe(false);
    expect(container.textContent).toContain('Tu solicitud de contacto');
  });

  it('acepta un contacto sin navegar ni enviar mensajes y ofrece el chat enlazado', async () => {
    snapshot.me = member('owner');
    snapshot.helpContacts = [contact('received')];
    actions.respondHelpContact.mockImplementationOnce(async () => { publish({ helpContacts: [contact('received', { status: 'accepted', conversationId: 'existing-dm' })] }); });
    await render('/m/ayuda/contactos');
    await click(button('Aceptar contacto'));
    expect(actions.respondHelpContact).toHaveBeenCalledWith('received', 'accepted');
    expect(container.querySelector('[data-location]')?.textContent).toBe('/m/ayuda/contactos');
    expect(container.querySelector('a[href="/m/mensajes/directos/existing-dm"]')?.textContent).toContain('Abrir conversación');
    expect(button('Cerrar contacto')).toBeDefined();
  });

  it('no permite aceptar solicitudes de integrantes dados de baja', async () => {
    snapshot.me = member('owner');
    snapshot.members = snapshot.members.map((entry) => entry.id === 'viewer' ? { ...entry, status: 'removed' } : entry);
    snapshot.helpContacts = [contact('received')];
    await render('/m/ayuda/contactos');
    expect(button('Aceptar contacto').disabled).toBe(true);
    expect(container.textContent).toContain('ya no es un integrante activo');
  });

  it('exige motivo al retirar como administrador y mantiene el formulario cuando falla la acción', async () => {
    snapshot.me = member('admin', true);
    actions.withdrawHelpPost.mockRejectedValueOnce(new Error('No se pudo retirar.'));
    await render('/m/ayuda/offer');
    await click(button('Retirar publicación como administrador'));
    expect(button('Confirmar retirada').disabled).toBe(true);
    await fill(container.querySelector('textarea')!, 'Contenido duplicado');
    expect(button('Confirmar retirada').disabled).toBe(false);
    await submit(container.querySelector('form')!);
    expect(actions.withdrawHelpPost).toHaveBeenCalledWith('offer', 'Contenido duplicado');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No se pudo retirar.');
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.textContent).not.toContain('La publicación fue retirada.');
  });

  it('confirma el cierre aunque la acción no devuelva ningún valor y permite reabrir', async () => {
    snapshot.me = member('owner');
    actions.setHelpPostStatus.mockImplementationOnce(async (id, status) => { publish({ helpPosts: snapshot.helpPosts.map((entry) => entry.id === id ? { ...entry, status } : entry) }); });
    await render('/m/ayuda/offer');
    await click(button('Cerrar publicación'));
    expect(actions.setHelpPostStatus).toHaveBeenCalledWith('offer', 'closed');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Publicación cerrada');
    expect(button('Reabrir publicación')).toBeDefined();
  });

  it('mantiene fijo el tipo al editar e informa que la disponibilidad es pública y opcional', async () => {
    await render('/m/ayuda/mine/editar');
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(container.textContent).toContain('El tipo se conserva al editar');
    expect(container.textContent).toContain('Describe el tema que quieres trabajar');
    expect(container.textContent).toContain('Si la incluyes, la verá todo el grupo');
    expect(container.querySelector('textarea[aria-describedby="help-availability-privacy"]')?.hasAttribute('required')).toBe(false);
  });

  it('bloquea el módulo completo a miembros dados de baja', async () => {
    snapshot.me = { ...member('viewer'), status: 'removed' };
    await render('/m/ayuda/contactos');
    expect(container.textContent).toContain('Necesitas una membresía activa');
    expect(container.querySelectorAll('.help-contact')).toHaveLength(0);
  });
});
