import { describe, expect, it } from 'vitest';
import type { ResourceFile, WorkFile } from '../data/types';
import { buildProfileUploadStats } from './profileUploads';

const createdAt = new Date('2026-10-26T15:00:00Z');
const resource = (input: Partial<ResourceFile> = {}): ResourceFile => ({
  id: 'resource-1', targetKind: 'note', targetId: 'note-1', name: 'apunte.pdf', size: 1024,
  contentType: 'application/pdf', uploadedBy: 'uploader', createdAt, ...input,
});
const workFile = (input: Partial<WorkFile> = {}): WorkFile => ({
  id: '7', workId: 'work-1', name: 'apunte.pdf', size: 2048,
  contentType: 'application/pdf', uploadedBy: 'uploader', createdAt, ...input,
});

describe('estadísticas de archivos de los perfiles', () => {
  it('suma los bytes y archivos por quien subió cada adjunto, en todos los módulos visibles', () => {
    const stats = buildProfileUploadStats({ workFiles: [], resourceFiles: [
      resource(),
      resource({ id: 'resource-2', targetKind: 'profile', uploadedBy: 'uploader', size: 512 }),
      resource({ id: 'resource-3', targetKind: 'direct_message', uploadedBy: 'other', size: 4096 }),
      resource({ id: 'resource-4', targetKind: 'work', targetId: 'work-1', uploadedBy: 'other', size: 3072 }),
    ] });

    expect([...stats]).toEqual([
      ['uploader', { bytes: 1536, fileCount: 2 }],
      ['other', { bytes: 7168, fileCount: 2 }],
    ]);
    expect(stats.has('coauthor')).toBe(false);
  });

  it('deduplica las proyecciones heredadas y actuales de WorkFile, conservando la autoridad del recurso', () => {
    const legacy = resource({ id: 'legacy:7', targetKind: 'work', targetId: 'work-1', size: 2048 });
    const modern = resource({ id: 'new-work-file', targetKind: 'work', targetId: 'work-1', size: 4096 });
    const stats = buildProfileUploadStats({
      resourceFiles: [legacy, modern, modern],
      workFiles: [workFile({ uploadedBy: 'stale-uploader' }), workFile({ id: modern.id, size: modern.size }), workFile({ id: '8', size: 512 }), workFile({ id: '8', size: 512 })],
    });

    expect([...stats]).toEqual([['uploader', { bytes: 6656, fileCount: 3 }]]);
    expect(legacy.removedAt).toBeUndefined();
  });

  it('excluye los recursos retirados aunque todavía exista su proyección antigua', () => {
    const stats = buildProfileUploadStats({
      resourceFiles: [
        resource({ id: 'legacy:7', targetKind: 'work', removedAt: createdAt }),
        resource({ id: 'native', targetKind: 'work', removedAt: createdAt }),
        resource({ id: 'old-note', removedAt: createdAt }),
      ],
      workFiles: [workFile(), workFile({ id: 'native' })],
    });

    expect(stats.size).toBe(0);
  });

  it('funciona con snapshots antiguos que solo traen WorkFile o que están vacíos', () => {
    expect([...buildProfileUploadStats({ resourceFiles: [], workFiles: [workFile()] })])
      .toEqual([['uploader', { bytes: 2048, fileCount: 1 }]]);
    expect(buildProfileUploadStats({ resourceFiles: [], workFiles: [] }).size).toBe(0);
  });

  it('prioriza el total del servidor aunque el observador solo vea parte de los archivos', () => {
    const stats = buildProfileUploadStats({
      memberUploadStats: [{ memberId: 'uploader', bytes: 20_000_000, fileCount: 12 }, { memberId: 'other', bytes: 500, fileCount: 1 }],
      resourceFiles: [resource()], workFiles: [workFile()],
    });

    expect([...stats]).toEqual([
      ['uploader', { bytes: 20_000_000, fileCount: 12 }],
      ['other', { bytes: 500, fileCount: 1 }],
    ]);
  });

  it('distingue un agregado vacío disponible de un agregado todavía no soportado', () => {
    const files = { resourceFiles: [resource()], workFiles: [] };
    expect(buildProfileUploadStats({ ...files, memberUploadStats: [] }).size).toBe(0);
    expect(buildProfileUploadStats({ ...files, memberUploadStats: undefined }).get('uploader'))
      .toEqual({ bytes: 1024, fileCount: 1 });
  });
});
