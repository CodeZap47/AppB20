// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Snapshot } from '../data/types';
import { ProfilePage, ProfilesPage } from './ProfilesPage';
import { BirthdaysPage } from './BirthdaysPage';

let container: HTMLDivElement; let root: Root; let snapshot: Snapshot; let source: DataSource;
const now = new Date('2026-10-21T12:00:00Z');
const member = { id: 'me', displayName: 'Luis', status: 'active' as const, isCreator: false, joinedAt: now };
const profile = { id: 'profile-1', memberId: 'me', preferredName: 'Luis B20', bio: 'Estudio programación', interests: ['Robótica'], learningGoals: 'Aprender Rust', skills: ['Bases de datos'], helpTopics: ['Álgebra'], portfolioLinks: ['https://example.com/'], subjectIds: [], photoFileId: 'private-photo', version: 1, updatedAt: now };
async function mount(url: string) {
  const router = createMemoryRouter([
    { path: '/m/perfiles', element: <ProfilesPage /> },
    { path: '/perfil/:memberId', element: <ProfilePage /> },
    { path: '/m/cumpleanos', element: <BirthdaysPage /> },
  ], { initialEntries: [url] });
  await act(async () => root.render(<DataProvider source={source}><RouterProvider router={router} /></DataProvider>));
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((element) => element.textContent?.includes(text));
  expect(button).toBeDefined(); await act(async () => button!.click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  snapshot = { ...emptySnapshot('ready'), me: member, members: [member], memberProfiles: [profile] };
  source = { label: 'Prueba', getSnapshot: () => snapshot, subscribe: () => () => {},
    saveMemberProfile: vi.fn().mockResolvedValue('profile-1'), downloadResourceFile: vi.fn().mockResolvedValue(new Blob(['photo'], { type: 'image/png' })),
  } as unknown as DataSource;
  vi.stubGlobal('URL', URL);
  URL.createObjectURL = vi.fn().mockReturnValue('blob:private-photo');
  URL.revokeObjectURL = vi.fn();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('perfiles y cumpleaños', () => {
  it('muestra solo contenido compartido en las pestañas y descarga la foto al solicitarla', async () => {
    snapshot.notes = [{ id: 'private-note', authorId: 'me', subjectId: 'subject', topic: '', title: 'Apunte privado secreto', body: 'Privado', visibility: 'personal', source: 'student', tags: [], version: 1, createdAt: now, updatedAt: now }];
    await mount('/perfil/me?pestana=notas');
    expect(container.textContent).toContain('Luis B20');
    expect(container.textContent).toContain('Aprender Rust');
    expect(container.textContent).not.toContain('Apunte privado secreto');
    expect(source.downloadResourceFile).not.toHaveBeenCalled();
    await click('Ver foto');
    expect(source.downloadResourceFile).toHaveBeenCalledWith('private-photo');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:private-photo');
    await click('Contribuciones');
    expect(container.textContent).toContain('Ver cada aporte y las reglas de puntuación');
  });

  it('guarda campos opcionales y la versión sin solicitar datos de nacimiento o calificaciones', async () => {
    await mount('/perfil/me'); await click('Editar presentación y foto');
    const form = container.querySelector('form')!;
    expect(form.textContent).not.toContain('Año de nacimiento');
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(source.saveMemberProfile).toHaveBeenCalledWith({ preferredName: profile.preferredName, bio: profile.bio, interests: profile.interests, learningGoals: profile.learningGoals, skills: profile.skills, helpTopics: profile.helpTopics, portfolioLinks: profile.portfolioLinks, subjectIds: [], photoFileId: 'private-photo', expectedVersion: 1 });
  });

  it('la vista anual muestra doce meses y conserva el 29 de febrero sin publicar edad', async () => {
    snapshot.birthdays = [{ memberId: 'me', day: 29, month: 2, remind: false }];
    await mount('/m/cumpleanos?mes=2027-02&vista=ano');
    expect(container.querySelectorAll('section.bday-cal')).toHaveLength(12);
    expect(container.textContent).toContain('29 de febrero');
    expect(container.querySelector('button[aria-label="domingo, 28 de febrero, cumple Luis"]')).not.toBeNull();
    expect(container.textContent).toContain('sin guardar el año de nacimiento ni la edad');
  });
});
