// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { emptySnapshot } from '../data/spacetimeSnapshot';
import type { DataSource, Member, Snapshot } from '../data/types';
import type { MemberProfile } from '../data/communityTypes';
import { ProfileEditor } from './ProfilePresentation';

const now = new Date('2026-10-24T12:00:00Z');
const member: Member = { id: 'me', displayName: 'Ana', status: 'active', isCreator: false, joinedAt: now };
const profile: MemberProfile = { id: 'profile-1', memberId: member.id, preferredName: '', bio: '', interests: [],
  learningGoals: '', skills: [], helpTopics: [], portfolioLinks: [], subjectIds: [], version: 1, updatedAt: now };
let container: HTMLDivElement;
let root: Root;
let snapshot: Snapshot;
let source: DataSource;
const onDone = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:preview');
    static revokeObjectURL = vi.fn();
  });
  snapshot = { ...emptySnapshot('ready'), me: member, members: [member], memberProfiles: [{ ...profile }] };
  source = {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    saveMemberProfile: vi.fn<DataSource['saveMemberProfile']>(async (input) => {
      snapshot.memberProfiles = [{ ...profile, ...input, version: input.expectedVersion + 1 }];
      return profile.id;
    }),
    attachResourceFile: vi.fn<DataSource['attachResourceFile']>(async (kind, _id, file, version, options) => {
      options?.onProgress?.(file.size, file.size);
      snapshot.memberProfiles[0] = { ...snapshot.memberProfiles[0]!, version: version! + 1,
        ...(kind === 'profile' ? { photoFileId: 'photo-file' } : { cover: { preset: 'lavanda', fileId: 'cover-file' } }) };
      return kind === 'profile' ? 'photo-file' : 'cover-file';
    }),
    saveProfileCover: vi.fn<DataSource['saveProfileCover']>(async (input) => {
      snapshot.memberProfiles[0] = { ...snapshot.memberProfiles[0]!, cover: input, version: input.expectedVersion + 1 };
    }),
    discardResourceUpload: vi.fn<DataSource['discardResourceUpload']>().mockResolvedValue(undefined),
    downloadResourceFile: vi.fn(async () => new Blob()),
  } as unknown as DataSource;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function show() {
  await act(async () => root.render(<DataProvider source={source}><ProfileEditor member={member} profile={profile} onDone={onDone} /></DataProvider>));
}
async function pick(label: string, file: File, drop = false) {
  const input = container.querySelector<HTMLInputElement>(`input[type="file"][aria-label="${label}"]`)!;
  if (drop) {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    await act(async () => input.closest('[data-dropzone]')!.dispatchEvent(event));
  } else {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  }
}
async function save() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

describe('imágenes del perfil con el cargador compartido', () => {
  it('selecciona una foto y suelta una portada sin subirlas antes de guardar', async () => {
    await show();
    const photo = new File(['foto'], 'foto.png', { type: 'image/png' });
    const cover = new File(['portada'], 'portada.webp', { type: 'image/webp' });
    await pick('Foto de perfil', photo);
    await pick('Imagen de portada', cover, true);
    expect(container.querySelectorAll('[data-upload-state="selected"]')).toHaveLength(2);
    expect(source.saveMemberProfile).not.toHaveBeenCalled();
    expect(source.attachResourceFile).not.toHaveBeenCalled();
    expect(container.querySelector('input[aria-label="Foto de perfil"]')?.hasAttribute('multiple')).toBe(false);
    await save();
    expect(vi.mocked(source.attachResourceFile).mock.calls.map((call) => call.slice(0, 4))).toEqual([
      ['profile', profile.id, photo, 2], ['profile_cover', profile.id, cover, 3],
    ]);
    expect(source.saveProfileCover).toHaveBeenCalledWith({ preset: 'lavanda', fileId: 'cover-file', expectedVersion: 4 });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('rechaza formato y tamaño inválidos por selección y arrastre', async () => {
    await show();
    await pick('Foto de perfil', new File(['svg'], 'foto.svg', { type: 'image/svg+xml' }));
    const large = new File(['png'], 'grande.png', { type: 'image/png' });
    Object.defineProperty(large, 'size', { value: 5 * 1024 * 1024 + 1 });
    await pick('Imagen de portada', large, true);
    expect(container.textContent).toContain('PNG, JPEG o WebP');
    expect(container.textContent).toContain('5 MiB');
    expect(container.querySelector('[data-upload-state]')).toBeNull();
    expect(source.attachResourceFile).not.toHaveBeenCalled();
  });

  it('reintenta la portada sin volver a guardar el padre ni subir la foto confirmada', async () => {
    const original = source.attachResourceFile;
    source.attachResourceFile = vi.fn<DataSource['attachResourceFile']>()
      .mockImplementationOnce(original).mockRejectedValueOnce(new Error('Sin conexión')).mockImplementationOnce(original);
    await show();
    const photo = new File(['foto'], 'foto.png', { type: 'image/png' });
    const cover = new File(['portada'], 'portada.png', { type: 'image/png' });
    await pick('Foto de perfil', photo);
    await pick('Imagen de portada', cover);
    await save();
    expect(onDone).not.toHaveBeenCalled();
    expect(container.querySelector('[data-upload-state="failed"]')?.textContent).toContain('portada.png');
    await save();
    expect(source.saveMemberProfile).toHaveBeenCalledOnce();
    expect(vi.mocked(source.attachResourceFile).mock.calls.map((call) => call.slice(0, 4))).toEqual([
      ['profile', profile.id, photo, 2], ['profile_cover', profile.id, cover, 3], ['profile_cover', profile.id, cover, 3],
    ]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('recupera una foto confirmada con respuesta perdida sin incrementar dos veces su versión', async () => {
    const original = source.attachResourceFile;
    source.attachResourceFile = vi.fn<DataSource['attachResourceFile']>()
      .mockImplementationOnce(async (...args) => { await original(...args); throw new Error('Respuesta perdida'); })
      .mockResolvedValueOnce('photo-file').mockImplementationOnce(original);
    await show();
    const photo = new File(['foto'], 'foto.png', { type: 'image/png' });
    const cover = new File(['portada'], 'portada.png', { type: 'image/png' });
    await pick('Foto de perfil', photo);
    await pick('Imagen de portada', cover);
    await save();
    expect(snapshot.memberProfiles[0]?.version).toBe(3);
    await save();
    expect(vi.mocked(source.attachResourceFile).mock.calls.map((call) => call.slice(0, 4))).toEqual([
      ['profile', profile.id, photo, 2], ['profile', profile.id, photo, 2], ['profile_cover', profile.id, cover, 3],
    ]);
    expect(source.saveMemberProfile).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('mantiene la foto y el recibo si no se pudo confirmar el descarte', async () => {
    source.attachResourceFile = vi.fn<DataSource['attachResourceFile']>().mockRejectedValue(new Error('Respuesta perdida'));
    source.discardResourceUpload = vi.fn<DataSource['discardResourceUpload']>().mockRejectedValueOnce(new Error('No pudimos cancelar')).mockResolvedValueOnce(undefined);
    await show();
    const photo = new File(['foto'], 'foto.png', { type: 'image/png' });
    await pick('Foto de perfil', photo);
    await save();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Quitar foto.png"]')!.click());
    expect(source.discardResourceUpload).toHaveBeenCalledWith('profile', profile.id, photo);
    expect(container.querySelector('[data-upload-state="failed"]')).not.toBeNull();
    expect(container.textContent).toContain('No pudimos cancelar');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Quitar foto.png"]')!.click());
    expect(container.querySelector('[data-upload-state]')).toBeNull();
  });

  it('resuelve primero el intento pendiente antes de guardar cambios nuevos de presentación', async () => {
    const original = source.attachResourceFile;
    source.attachResourceFile = vi.fn<DataSource['attachResourceFile']>()
      .mockImplementationOnce(async (...args) => { await original(...args); throw new Error('Respuesta perdida'); })
      .mockResolvedValueOnce('photo-file');
    await show();
    const photo = new File(['foto'], 'foto.png', { type: 'image/png' });
    await pick('Foto de perfil', photo);
    await save();
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Ana"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Anita');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await save();
    expect(vi.mocked(source.attachResourceFile).mock.calls.map((call) => call[3])).toEqual([2, 2]);
    expect(source.saveMemberProfile).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedVersion: 3, preferredName: 'Anita', photoFileId: 'photo-file',
    }));
    expect(onDone).toHaveBeenCalledOnce();
  });
});
