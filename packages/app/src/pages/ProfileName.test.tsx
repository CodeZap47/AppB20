// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Snapshot } from '../data/types';
import { ProfilePage } from './ProfilesPage';

let container: HTMLDivElement;
let root: Root;
let snapshot: Snapshot;
let source: DataSource;
const now = new Date('2026-10-21T12:00:00Z');
const member = { id: 'me', displayName: 'Luis', photoUrl: 'https://example.com/photo.jpg', status: 'active' as const, isCreator: false, joinedAt: now };
const profile = { id: 'profile-1', memberId: member.id, preferredName: 'Lucho', bio: '', interests: [], learningGoals: '', skills: [], helpTopics: [], portfolioLinks: [], subjectIds: [], version: 1, updatedAt: now };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  snapshot = { ...emptySnapshot('ready'), me: member, members: [member], memberProfiles: [profile] };
  source = {
    label: 'Prueba',
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    updateProfile: vi.fn().mockResolvedValue(undefined),
    saveMemberProfile: vi.fn(),
  } as unknown as DataSource;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function openEditor() {
  const router = createMemoryRouter([{ path: '/perfil/:memberId', element: <ProfilePage /> }], { initialEntries: ['/perfil/me'] });
  await act(async () => root.render(<DataProvider source={source}><RouterProvider router={router} /></DataProvider>));
  const edit = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Editar nombre'))!;
  await act(async () => edit.click());
}

const form = () => container.querySelector<HTMLFormElement>('form.profile-edit')!;
const nameInput = () => form().querySelector<HTMLInputElement>('input')!;
const saveButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
const cancelButton = () => form().querySelector<HTMLButtonElement>('button[type="button"]')!;

async function enterName(name: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(nameInput(), name);
    nameInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function dispatchSubmit() {
  form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('edición del nombre principal', () => {
  it.each(['', '   ', 'luis@ejemplo.mx', 'a'.repeat(81)])('rechaza %j también ante un envío programático', async (name) => {
    await openEditor();
    await enterName(name);
    expect(saveButton().disabled).toBe(true);
    expect(nameInput().getAttribute('aria-invalid')).toBe('true');
    const errorId = nameInput().getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)?.getAttribute('role')).toBe('alert');
    await act(async () => dispatchSubmit());
    expect(source.updateProfile).not.toHaveBeenCalled();
    expect(form()).not.toBeNull();
  });

  it.each(['Ana', ' José Ángel ', ' 李 '])('guarda %j sin espacios exteriores, conserva la foto y no cambia el alias', async (name) => {
    await openEditor();
    expect(nameInput().value).toBe(member.displayName);
    await enterName(name);
    await act(async () => dispatchSubmit());
    expect(source.updateProfile).toHaveBeenCalledWith(name.trim(), member.photoUrl);
    expect(source.saveMemberProfile).not.toHaveBeenCalled();
    expect(container.querySelector('form.profile-edit')).toBeNull();
    expect(container.querySelector('h1')?.textContent).toContain(profile.preferredName);
    expect(snapshot.me).toBe(member);
    expect(snapshot.memberProfiles[0]).toBe(profile);
  });

  it('bloquea controles y envíos simultáneos mientras guarda', async () => {
    let complete!: () => void;
    source.updateProfile = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    await openEditor();
    await enterName('Ana');
    await act(async () => { dispatchSubmit(); dispatchSubmit(); });
    expect(source.updateProfile).toHaveBeenCalledTimes(1);
    expect(form().getAttribute('aria-busy')).toBe('true');
    expect(nameInput().disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
    expect(cancelButton().disabled).toBe(true);
    await act(async () => { dispatchSubmit(); cancelButton().click(); });
    expect(source.updateProfile).toHaveBeenCalledTimes(1);
    expect(form()).not.toBeNull();
    await act(async () => complete());
    expect(container.querySelector('form.profile-edit')).toBeNull();
  });

  it('conserva el nombre capturado tras un fallo y permite reintentar', async () => {
    source.updateProfile = vi.fn().mockRejectedValueOnce(new Error('No se pudo guardar.')).mockResolvedValueOnce(undefined);
    await openEditor();
    await enterName('Ana');
    await act(async () => dispatchSubmit());
    expect(form().querySelector('[role="alert"]')?.textContent).toBe('No se pudo guardar.');
    expect(nameInput().value).toBe('Ana');
    expect(nameInput().disabled).toBe(false);
    expect(cancelButton().disabled).toBe(false);
    expect(saveButton().disabled).toBe(false);
    await act(async () => dispatchSubmit());
    expect(source.updateProfile).toHaveBeenCalledTimes(2);
    expect(container.querySelector('form.profile-edit')).toBeNull();
  });
});
