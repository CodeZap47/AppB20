// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { vi.stubEnv('VITE_DATA_MODE', 'demo'); });
vi.mock('./auth/AuthContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('./auth/AuthContext')>(),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({ status: 'signedIn', token: 'rooms-integration', expiresAt: Date.now() + 3_600_000,
    profile: { subject: 'rooms-account', email: 'rooms@example.test', name: 'Salas' } }),
  useSessionStore: () => ({ signOut: vi.fn() }),
}));
import { App } from './App';
import { DemoDataSource } from './data/demo';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
let container: HTMLDivElement;
let root: Root;
let source: DemoDataSource;
function field(label: string, within: ParentNode = container): Field {
  const node = [...within.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith(label));
  const control = node?.control ?? node?.querySelector('input,textarea,select');
  if (!control) throw new Error(`Falta campo ${label}`);
  return control as Field;
}
async function change(control: Field, value: string) {
  await act(async () => {
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function button(label: string, within: ParentNode = container) {
  const target = [...within.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
  if (!target) throw new Error(`Falta botón ${label}`);
  expect(target.disabled, label).toBe(false);
  await act(async () => target.click());
}
async function link(label: string, within: ParentNode = container) {
  const target = [...within.querySelectorAll('a')].find((item) => (item.getAttribute('aria-label') ?? item.textContent)?.trim() === label);
  if (!target) throw new Error(`Falta enlace ${label}`);
  await act(async () => target.click());
}
async function navigate(path: string) {
  await act(async () => {
    window.history.replaceState({}, '', `/#${path}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}
function healthy() {
  expect(container.textContent).not.toMatch(/Esta pantalla tuvo un problema|Unexpected Application Error|Pantalla pendiente de implementar/);
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const original = DemoDataSource.prototype.getSnapshot;
  vi.spyOn(DemoDataSource.prototype, 'getSnapshot').mockImplementation(function (this: DemoDataSource) {
    source = this;
    return original.call(this);
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<App platform="web" />));
  await navigate('/m/salas');
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
afterAll(() => vi.unstubAllEnvs());

describe('Salas en la aplicación y proveedor demo reales', () => {
  it.each([
    { path: '/m/notas/n1', kind: 'note', id: 'n1' },
    { path: '/m/guias/gd1', kind: 'guide', id: 'gd1' },
  ] as const)('crea una sala desde $kind y abre una práctica personal sin copiar el contenido', async ({ path, kind, id }) => {
    await navigate(path); await link('Estudiar en una sala');
    expect(window.location.hash).toContain(`/m/salas?${kind === 'note' ? 'nota' : 'guia'}=${id}`);
    await link('Crear sala con este material');
    const title = `Integración de sala desde ${kind}`;
    await change(field('Título'), title); await change(field('Objetivo'), 'Comprender el concepto con ejemplos propios');
    const original = kind === 'note' ? source.getSnapshot().notes.find((row) => row.id === id)!
      : source.getSnapshot().guides.find((row) => row.id === id)!;
    const subjectId = original.subjectId;
    expect(container.textContent).toContain(source.getSnapshot().subjects.find((row) => row.id === subjectId)!.name);
    await button('Crear sala');
    const room = source.getSnapshot().studyRooms.find((row) => row.title === title)!;
    expect(room).toMatchObject({ subjectId, organizerId: 'demo-1', status: 'scheduled', participantCount: 1 });
    expect(window.location.hash).toBe(`#/m/salas/${room.id}`);
    expect(source.getSnapshot().roomMaterials).toContainEqual(expect.objectContaining({ roomId: room.id, kind, sourceId: id }));
    await link('Practicar este material');
    expect(field('Materia').value).toBe(subjectId); expect(field('Tema').value).toBe(room.topic);
    expect(field('Nota o guía').value).toBe(`${kind}:${id}`);
    expect(field('Concepto con tus palabras').value).toBe('');
    expect(field('Un ejemplo').value).toBe('');
    await change(field('Concepto con tus palabras'), 'Explicación personal sin copiar el material');
    await button('Guardar borrador');
    const practice = source.getSnapshot().teachingPractices.find((row) => row.initial.concept === 'Explicación personal sin copiar el material')!;
    expect(practice).toMatchObject({ ownerId: 'demo-1', status: 'draft', topic: room.topic });
    expect(source.getSnapshot().roomEntries.filter((row) => row.roomId === room.id)).toEqual([]);
    healthy();
  });

  it('organiza desde Ayuda, exige aceptar, publica el resumen y retira borradores tras revocar', async () => {
    await change(field('Perfil simulado'), 'demo-2');
    await navigate('/m/ayuda/contactos?pestana=enviados');
    await link('Organizar sesión');
    expect(window.location.hash).toContain('/m/salas/nueva?contacto=hc3');
    expect(field('Visibilidad').value).toBe('private');
    await change(field('Título'), 'Sesión privada desde Ayuda');
    await change(field('Objetivo'), 'Resolver las dudas del contacto');
    await button('Crear sala');
    const room = source.getSnapshot().studyRooms.find((row) => row.title === 'Sesión privada desde Ayuda')!;
    expect(room.participantCount).toBe(1);
    expect(container.textContent).not.toContain('Ejemplo de ayuda acordada por privado.');
    await change(field('Perfil simulado'), 'demo-3');
    expect(container.textContent).toContain('Tienes una invitación');
    expect(container.querySelector('textarea')).toBeNull();
    await button('Aceptar invitación');
    await change(field('Mensaje'), 'Duda privada de la sesión');
    await button('Enviar aporte');
    await change(field('Resumen de la sesión'), 'Explicación que acordamos compartir.');
    await button('Guardar resumen');
    await change(field('Perfil simulado'), 'demo-2');
    await button('Comenzar sesión');
    await button('Finalizar sesión'); await button('Confirmar');
    await button('Vista previa para publicar');
    const preview = container.querySelector('.rooms-preview')!;
    expect(preview.textContent).toContain('Explicación que acordamos compartir.');
    expect(preview.textContent).not.toContain('Duda privada de la sesión');
    await button('Publicar resumen como nota');
    const publishedId = source.getSnapshot().roomSummaries.find((row) => row.roomId === room.id)!.publishedNoteId!;
    expect(window.location.hash).toBe(`#/m/notas/${publishedId}`);
    expect(source.getSnapshot().notes.find((row) => row.id === publishedId)).toMatchObject({
      authorId: 'demo-2', source: 'student', visibility: 'group', body: 'Explicación que acordamos compartir.',
    });
    expect(container.textContent).not.toContain('Duda privada de la sesión');

    // An independent active room remains open on the participant's screen during a real owner command.
    let privateId = '';
    await act(async () => {
      privateId = source.createStudyRoom({ requestId: 'live-access-ui', title: 'Sala para comprobar revocación',
        subjectId: room.subjectId, topic: 'Conversiones', objective: 'Comprobar privacidad', startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000), visibility: 'private' });
      source.inviteStudyRoomMember(privateId, 'demo-3');
    });
    await change(field('Perfil simulado'), 'demo-3');
    await navigate(`/m/salas/${privateId}`); await button('Aceptar invitación');
    await change(field('Mensaje'), 'Borrador privado que debe desaparecer');
    await change(field('Resumen de la sesión'), 'Otro borrador privado que debe desaparecer');
    await act(async () => { source.setViewer('demo-2'); source.removeStudyRoomMember(privateId, 'demo-3'); source.setViewer('demo-3'); });
    expect(container.textContent).toContain('Esta sala no está disponible');
    expect(container.querySelector('textarea')).toBeNull();
    expect(source.getSnapshot().roomEntries.some((row) => row.roomId === privateId)).toBe(false);
    expect(source.getSnapshot().roomSummaries.some((row) => row.roomId === privateId)).toBe(false);
    healthy();
  });
});
