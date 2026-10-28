// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Member, Note, Snapshot } from '../data/types';
import { ProfilePage, ProfilesPage } from './ProfilesPage';

const now = new Date('2026-10-26T12:00:00Z');
const person = (id: string, displayName: string, status: Member['status'] = 'active'): Member => ({
  id, displayName, status, isCreator: false, joinedAt: now,
});
const me = person('me', 'Zoe');
const ana = person('ana', 'Ana');
const bruno = person('bruno', 'Bruno');
const carla = person('carla', 'Carla');
const removed = person('removed', 'Alberto', 'removed');

let container: HTMLDivElement;
let root: Root;
let snapshot: Snapshot;
let source: DataSource;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  snapshot = {
    ...emptySnapshot('ready'),
    me,
    members: [bruno, removed, me, carla, ana],
    memberUploadStats: [
      { memberId: me.id, bytes: 840 * 1024, fileCount: 1 },
      { memberId: ana.id, bytes: 12.44 * 1024 * 1024, fileCount: 4 },
      { memberId: bruno.id, bytes: 1.5 * 1024 ** 3, fileCount: 31 },
      { memberId: removed.id, bytes: 9 * 1024 ** 3, fileCount: 90 },
    ],
  };
  source = {
    label: 'Prueba', getSnapshot: () => snapshot, subscribe: () => () => {},
    downloadResourceFile: vi.fn().mockResolvedValue(new Blob()),
  } as unknown as DataSource;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mount(url = '/m/perfiles') {
  const router = createMemoryRouter([
    { path: '/m/perfiles', element: <ProfilesPage /> },
    { path: '/perfil/:memberId', element: <ProfilePage /> },
  ], { initialEntries: [url] });
  await act(async () => root.render(<DataProvider source={source}><RouterProvider router={router} /></DataProvider>));
  return router;
}

function cards() {
  return [...container.querySelectorAll<HTMLElement>('.people-grid .person-card')];
}

function cardIds() {
  return cards().map((card) => card.querySelector('a[href^="/perfil/"]')?.getAttribute('href')?.slice('/perfil/'.length));
}

function cardFor(memberId: string) {
  const card = cards().find((candidate) => candidate.querySelector(`a[href="/perfil/${memberId}"]`));
  expect(card, `Tarjeta de ${memberId}`).toBeDefined();
  return card!;
}

function uploadSummary(memberId: string) {
  return cardFor(memberId).querySelector('.person-card__uploads')?.textContent?.replace(/\s+/g, ' ').trim();
}

async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Buscar integrantes"]');
  expect(input).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function sort(value: string) {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Ordenar integrantes"]');
  expect(select).not.toBeNull();
  await act(async () => {
    select!.value = value;
    select!.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function filter(label: string) {
  const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim().startsWith(label));
  expect(button, `Filtro ${label}`).toBeDefined();
  await act(async () => button!.click());
  return button!;
}

function note(id: string, authorId: string): Note {
  return {
    id, authorId, subjectId: 'subject', topic: '', title: `Apunte ${id}`, body: '', tags: [],
    visibility: 'group', source: 'student', version: 1, createdAt: now, updatedAt: now,
  };
}

describe('directorio de perfiles y archivos subidos', () => {
  it('explica la personalización y conserva el acceso al perfil propio al buscar a otra persona', async () => {
    await mount();
    const hint = container.querySelector('.profile-customization')!;
    expect(hint.textContent).toContain('portada y tu foto');
    expect(hint.textContent).toContain('Así te verá el grupo en Perfiles');
    expect(hint.querySelector('a')?.getAttribute('href')).toBe('/perfil/me?personalizar=1');
    expect(cardFor(me.id).querySelector('a[aria-label="Personalizar mi perfil"]')?.getAttribute('href')).toBe('/perfil/me?personalizar=1');
    await search('Ana');
    expect(cardIds()).toEqual(['ana']);
    expect(hint.querySelector('a')?.getAttribute('href')).toBe('/perfil/me?personalizar=1');
    expect(source.downloadResourceFile).not.toHaveBeenCalled();
  });

  it('abre la personalización desde el directorio y retira la indicación al cerrar el editor', async () => {
    const router = await mount();
    await act(async () => container.querySelector<HTMLAnchorElement>('.profile-customization a')!.click());
    expect(container.querySelector('dialog.profile-editor h2')?.textContent).toBe('Personaliza tu perfil');
    expect(router.state.location.search).toBe('?personalizar=1');
    await act(async () => container.querySelector<HTMLButtonElement>('dialog button[aria-label="Cerrar"]')!.click());
    expect(container.querySelector('dialog.profile-editor')).toBeNull();
    expect(router.state.location.search).toBe('');
    await act(async () => router.navigate('/perfil/me?q=apuntes'));
    expect(container.querySelector('dialog.profile-editor')).toBeNull();
  });

  it('solo abre el editor por enlace en el perfil propio y conserva los demás parámetros al cerrar', async () => {
    const router = await mount('/perfil/ana?personalizar=1');
    expect(container.querySelector('dialog.profile-editor')).toBeNull();
    expect(container.textContent).not.toContain('Personalizar perfil');
    await act(async () => router.navigate('/perfil/me?personalizar=1&q=apuntes&pestana=notas'));
    expect(container.querySelector('dialog.profile-editor')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('dialog button[aria-label="Cerrar"]')!.click());
    const query = new URLSearchParams(router.state.location.search);
    expect(query.has('personalizar')).toBe(false);
    expect(query.get('q')).toBe('apuntes');
    expect(query.get('pestana')).toBe('notas');
  });

  it('muestra tamaños legibles en KB, MB y GB, y cero para quien no ha subido archivos', async () => {
    // El agregado del servidor es la autoridad, aunque el snapshot visible sea parcial.
    snapshot.resourceFiles = [{
      id: 'visible', targetKind: 'note', targetId: 'note', name: 'apunte.pdf', size: 1024,
      contentType: 'application/pdf', uploadedBy: bruno.id, createdAt: now,
    }];
    await mount();
    expect(container.querySelector('h1')?.textContent).toBe('Conoce a tu grupo');
    expect(uploadSummary(me.id)).toContain('840 KB');
    expect(uploadSummary(me.id)).toContain('1 archivo');
    expect(uploadSummary(ana.id)).toContain('12.4 MB');
    expect(uploadSummary(ana.id)).toContain('4 archivos');
    expect(uploadSummary(bruno.id)).toContain('1.5 GB');
    expect(uploadSummary(bruno.id)).toContain('31 archivos');
    expect(uploadSummary(carla.id)).toContain('0 B');
    expect(uploadSummary(carla.id)).toContain('0 archivos');
    expect(cardIds()).not.toContain(removed.id);
    expect(container.textContent).not.toContain(removed.displayName);
    const myProfile = [...container.querySelectorAll('a')].find((link) => link.textContent?.trim() === 'Mi perfil');
    expect(myProfile?.getAttribute('href')).toBe('/perfil/me');
  });

  it('usa archivos visibles cuando falta el agregado y conserva ese alcance en el detalle', async () => {
    delete snapshot.memberUploadStats;
    snapshot.resourceFiles = [{
      id: 'legacy:work-file', targetKind: 'work', targetId: 'work', name: 'trabajo.pdf', size: 1.5 * 1024 ** 2,
      contentType: 'application/pdf', uploadedBy: me.id, createdAt: now,
    }, {
      id: 'photo', targetKind: 'profile', targetId: 'profile-ana', name: 'foto.png', size: 512 * 1024,
      contentType: 'image/png', uploadedBy: ana.id, createdAt: now,
    }, {
      id: 'removed-file', targetKind: 'note', targetId: 'note', name: 'retirado.pdf', size: 8 * 1024 ** 2,
      contentType: 'application/pdf', uploadedBy: bruno.id, createdAt: now, removedAt: now,
    }];
    snapshot.workFiles = [{
      id: 'work-file', workId: 'work', name: 'trabajo.pdf', size: 1.5 * 1024 ** 2,
      contentType: 'application/pdf', uploadedBy: me.id, createdAt: now,
    }];
    const router = await mount();
    expect(uploadSummary(me.id)).toContain('1.5 MB');
    expect(uploadSummary(me.id)).toContain('1 archivo');
    expect(uploadSummary(ana.id)).toContain('512 KB');
    expect(uploadSummary(bruno.id)).toContain('0 B');
    expect(container.textContent?.toLowerCase()).toContain('archivos visibles');
    await act(async () => router.navigate('/perfil/me'));
    const detail = container.querySelector('.profile-upload-summary');
    expect(detail?.textContent).toContain('1.5 MB');
    expect(detail?.textContent).toContain('1 archivo');
    expect(detail?.textContent?.toLowerCase()).toContain('visibles');
  });

  it('conserva fotos anteriores e identifica las fotos privadas sin descargarlas automáticamente', async () => {
    snapshot.members = snapshot.members.map((member) => member.id === ana.id || member.id === bruno.id
      ? { ...member, photoUrl: `https://example.com/${member.id}.jpg` } : member);
    snapshot.memberProfiles = [{
      id: 'profile-bruno', memberId: bruno.id, preferredName: '', bio: '',
      interests: [], skills: [], learningGoals: '', helpTopics: [], portfolioLinks: [],
      subjectIds: [], photoFileId: 'private-photo', version: 1, updatedAt: now,
    }];
    await mount();
    expect(cardFor(ana.id).querySelector('img')?.getAttribute('src')).toBe('https://example.com/ana.jpg');
    expect(cardFor(bruno.id).querySelector('img')).toBeNull();
    expect(cardFor(bruno.id).querySelector('button[aria-label="Ver foto de Bruno"]')).not.toBeNull();
    expect(source.downloadResourceFile).not.toHaveBeenCalled();
  });

  it('abre el perfil con el mismo total y número de archivos de la tarjeta', async () => {
    const router = await mount();
    const link = cardFor(bruno.id).querySelector<HTMLAnchorElement>('a[href="/perfil/bruno"]');
    await act(async () => link!.click());
    expect(router.state.location.pathname).toBe('/perfil/bruno');
    const detail = container.querySelector('.profile-upload-summary');
    expect(detail?.textContent).toContain('1.5 GB');
    expect(detail?.textContent).toContain('31 archivos');
    expect(detail?.textContent?.toLowerCase()).not.toContain('visibles');
  });

  it('combina búsqueda y filtro de archivos sin perder el orden seleccionado', async () => {
    const router = await mount();
    await sort('archivos');
    const withFiles = await filter('Con archivos');
    expect(withFiles.getAttribute('aria-pressed')).toBe('true');
    expect(cardIds()).toEqual([bruno.id, ana.id, me.id]);
    await search('Ana');
    expect(cardIds()).toEqual([ana.id]);
    expect(new URLSearchParams(router.state.location.search).get('filtro')).toBe('con-archivos');
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Ordenar integrantes"]')?.value).toBe('archivos');
    await search('Carla');
    expect(cardIds()).toEqual([]);
    await filter('Todos');
    expect(cardIds()).toEqual([carla.id]);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Buscar integrantes"]')?.value).toBe('Carla');
  });

  it.each(['NANA', 'ACCESIBLES', 'ASTRONOMIA', 'CALCULO'])('encuentra %s en nombre preferido, presentación, intereses o conocimientos', async (query) => {
    snapshot.memberProfiles = [{
      id: 'profile-ana', memberId: ana.id, preferredName: 'Naná', bio: 'Construye prototipos accesibles',
      interests: ['Astronomía'], skills: ['Cálculo integral'], learningGoals: '', helpTopics: [],
      portfolioLinks: [], subjectIds: [], version: 1, updatedAt: now,
    }];
    await mount();
    await search(query);
    expect(cardIds()).toEqual([ana.id]);
  });

  it('pone tu perfil primero solo al ordenar por nombre y permite ordenar por volumen o aportes', async () => {
    snapshot.notes = [note('ana-1', ana.id), note('bruno-1', bruno.id), note('bruno-2', bruno.id)];
    await mount();
    expect(cardIds()).toEqual([me.id, ana.id, bruno.id, carla.id]);
    await sort('archivos');
    expect(cardIds()).toEqual([bruno.id, ana.id, me.id, carla.id]);
    await sort('aportes');
    expect(cardIds()).toEqual([bruno.id, ana.id, carla.id, me.id]);
    await sort('nombre');
    expect(cardIds()).toEqual([me.id, ana.id, bruno.id, carla.id]);
  });

  it('incluye guías y evidencias al ordenar por aportes, además de trabajos, notas y respuestas', async () => {
    snapshot.notes = [note('ana-1', ana.id)];
    snapshot.guides = [{
      id: 'guide', subjectId: 'subject', title: 'Guía compartida', topics: [], sections: [],
      version: 1, createdBy: bruno.id, createdAt: now, updatedBy: bruno.id, updatedAt: now,
    }];
    snapshot.evidences = [{
      id: 'evidence', activityId: 'activity', authorId: bruno.id, participantIds: [],
      content: 'Evidencia de clase', createdAt: now,
    }];
    await mount();
    await sort('aportes');
    expect(cardIds()).toEqual([bruno.id, ana.id, carla.id, me.id]);
  });
});
