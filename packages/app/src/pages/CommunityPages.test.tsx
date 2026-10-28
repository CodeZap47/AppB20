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
    saveMemberProfile: vi.fn<DataSource['saveMemberProfile']>(async (input) => {
      snapshot.memberProfiles = snapshot.memberProfiles.map((entry) => entry.memberId === member.id
        ? { ...entry, ...input, version: input.expectedVersion + 1 } : entry);
      return 'profile-1';
    }), downloadResourceFile: vi.fn().mockResolvedValue(new Blob(['photo'], { type: 'image/png' })),
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

  it('abre en Todo con lo publicado del más reciente al más antiguo y lo filtra con el buscador', async () => {
    const note = (id: string, title: string, createdAt: Date) => ({ id, authorId: 'me', subjectId: 'subject', topic: 'Vectores', title, body: '', visibility: 'group' as const, source: 'student' as const, tags: [], version: 1, createdAt, updatedAt: createdAt });
    snapshot.notes = [
      note('old', 'Apunte de septiembre', new Date('2026-09-02T12:00:00Z')),
      note('new', 'Apunte de octubre', new Date('2026-10-20T12:00:00Z')),
    ];
    await mount('/perfil/me');
    const pressed = container.querySelector('.profile-tabs button[aria-pressed="true"]');
    expect(pressed?.textContent).toContain('Todo');
    expect(pressed?.textContent).toContain('2');
    const titles = [...container.querySelectorAll('.feed .work-card__title')].map((el) => el.textContent);
    expect(titles).toEqual(['Apunte de octubre', 'Apunte de septiembre']);
    for (const label of ['Editar nombre', 'Personalizar perfil', 'Agregar cumpleaños']) {
      expect(container.textContent).toContain(label);
    }

    await act(async () => root.unmount()); root = createRoot(container);
    await mount('/perfil/me?q=septiembre');
    expect([...container.querySelectorAll('.feed .work-card__title')].map((el) => el.textContent)).toEqual(['Apunte de septiembre']);
  });

  it('los enlaces con solo ?materia= abren la pestaña de Trabajos', async () => {
    await mount('/perfil/me?materia=subject');
    expect(container.querySelector('.profile-tabs button[aria-pressed="true"]')?.textContent).toContain('Trabajos');
  });

  it('guarda campos opcionales y la versión sin solicitar datos de nacimiento o calificaciones', async () => {
    await mount('/perfil/me'); await click('Personalizar perfil');
    const form = container.querySelector('form')!;
    expect(form.textContent).not.toContain('Año de nacimiento');
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(source.saveMemberProfile).toHaveBeenCalledWith({ preferredName: profile.preferredName, bio: profile.bio, interests: profile.interests, learningGoals: profile.learningGoals, skills: profile.skills, helpTopics: profile.helpTopics, portfolioLinks: profile.portfolioLinks, subjectIds: [], photoFileId: 'private-photo', expectedVersion: 1 });
  });

  it('el editor cambia la portada por un degradado y la guarda aparte del perfil', async () => {
    source.saveProfileCover = vi.fn<DataSource['saveProfileCover']>(async (input) => {
      expect(input.expectedVersion).toBe(snapshot.memberProfiles[0]!.version);
      snapshot.memberProfiles = snapshot.memberProfiles.map((entry) => ({ ...entry, cover: input, version: input.expectedVersion + 1 }));
    });
    await mount('/perfil/me'); await click('Personalizar perfil');
    const dialog = container.querySelector('dialog.profile-editor')!;
    expect(dialog.textContent).toContain('Portada');
    const oceano = dialog.querySelector<HTMLInputElement>('input[name="cover-preset"][value="oceano"]')!;
    await act(async () => oceano.click());
    expect(dialog.querySelector<HTMLElement>('.profile-editor__preview-cover')?.style.backgroundImage).toContain('rgb(127, 179, 245)');
    await act(async () => dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(source.saveMemberProfile).toHaveBeenCalled();
    expect(source.saveProfileCover).toHaveBeenCalledWith({ preset: 'oceano', fileId: undefined, expectedVersion: 2 });
  });

  it('muestra la portada guardada en el perfil y rechaza imágenes de portada no permitidas', async () => {
    snapshot.memberProfiles = [{ ...profile, cover: { preset: 'atardecer' } }];
    await mount('/perfil/me');
    expect(container.querySelector<HTMLElement>('.profile-hero .profile-cover')?.style.backgroundImage).toContain('rgb(247, 169, 120)');
    await click('Personalizar perfil');
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Imagen de portada"]')!;
    const svg = new File(['<svg/>'], 'portada.svg', { type: 'image/svg+xml' });
    Object.defineProperty(input, 'files', { value: [svg] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.querySelector('dialog [role="alert"]')?.textContent).toContain('PNG, JPEG o WebP');
  });

  it('agrega y quita etiquetas, y pide confirmar antes de descartar cambios', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await mount('/perfil/me'); await click('Personalizar perfil');
    const input = container.querySelector<HTMLInputElement>('.tag-field input')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setValue.call(input, 'Música'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect([...container.querySelectorAll('.tag-field')][0]!.textContent).toContain('Música');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Quitar Robótica"]')!.click());
    expect([...container.querySelectorAll('.tag-field')][0]!.textContent).not.toContain('Robótica');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click());
    expect(confirm).toHaveBeenCalled();
    expect(container.querySelector('dialog.profile-editor')).not.toBeNull();
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
