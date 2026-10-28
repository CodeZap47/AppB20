import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';
import type { Ctx } from './moduleContext';
import type { GuideMaterialSelection } from '../../core/src/guideMaterials';
vi.mock('spacetimedb/server', () => ({ SenderError: class SenderError extends Error {} }));
vi.mock('./moduleContext', () => ({ activeMember: (ctx: { sender: Identity; db: { member: { identity: { find(id: Identity): { status: string } | undefined } } } }) => { if (ctx.db.member.identity.find(ctx.sender)?.status !== 'active') throw new Error('Miembro inactivo'); } }));
vi.mock('./authIdentity', () => ({ memberIdentityFor: (ctx: { sender: Identity }) => ctx.sender }));
vi.mock('./guideAiHandlers', () => ({
  resolveGuideAiSource: (ctx: { sender: Identity; db: { notes: Map<string, { subjectId: string; owner: Identity; personal: boolean; withdrawn?: boolean }> } }, _kind: string, refId: string) => {
    const row = ctx.db.notes.get(refId); if (!row || row.withdrawn || row.personal && !row.owner.isEqual(ctx.sender)) throw new Error('Fuente no disponible'); return { title: 'Fuente', subjectId: row.subjectId, visibility: row.personal ? 'personal' : 'group', fields: [], omissions: [] };
  }, getGuideTranscription: () => { throw new Error('No disponible'); },
}));
import { guideMaterialsResponse } from './guideMaterialsHandlers';
const alice = Identity.fromString('a'.repeat(64)), bob = Identity.fromString('b'.repeat(64));
const id = '10000000-0000-4000-8000-000000000001';
function setup() {
  type Saved = { id: string; actor: Identity; revision: number; json: string; updatedAt: Timestamp };
  const rows = new Map<string, Saved>(), notes = new Map([['1', { subjectId: '1', owner: alice, personal: true, withdrawn: false }]]);
  const ctx = { sender: alice, timestamp: new Timestamp(1_000_000n), db: { notes,
    member: { identity: { find: () => ({ status: 'active' }) } }, subject: { id: { find: (id: bigint) => id === 1n || id === 2n ? { id } : undefined } }, term: { id: { find: () => ({ subjectId: 1n }) } },
    resourceFile: { id: { find: () => undefined } }, studyExam: { iter: () => [] },
    guideMaterialSelection: { id: { find: (key: string) => rows.get(key), update: (row: Saved) => rows.set(row.id, row) }, actor: { filter: (actor: Identity) => [...rows.values()].filter((row) => row.actor.isEqual(actor)) }, insert: (row: Saved) => rows.set(row.id, row) },
  } };
  const call = <T = GuideMaterialSelection>(action: string, input: Record<string, unknown> = {}) => JSON.parse(guideMaterialsResponse(ctx as unknown as Ctx, JSON.stringify({ action, ...input }))) as T;
  const content = { id, expectedRevision: 0, subjectId: '1', guideType: 'quarter', title: 'Guía privada', topicsText: '', sources: [{ kind: 'note', refId: '1', topics: [], includeUnplaced: true }], chosenFileIds: [] };
  return { ctx, rows, notes, call, content };
}
describe('selección de materiales del servidor', () => {
  it('persiste solo para dueño, exige revisión y devuelve null para UUID nuevo', () => {
    const s = setup(); expect(s.call('getSelection', { id })).toBeNull(); const saved = s.call('saveSelection', { input: s.content }); expect(saved).toMatchObject({ revision: 1, sources: [{ kind: 'note', refId: '1' }] });
    expect(s.call('getSelection', { id })).toEqual(saved); expect(() => s.call('saveSelection', { input: s.content })).toThrow('conflict:');
    s.ctx.sender = bob; expect(s.call('listSelections')).toEqual([]); expect(() => s.call('getSelection', { id })).toThrow('unavailable:'); expect(() => s.call('saveSelection', { input: { ...s.content, id: '10000000-0000-4000-8000-000000000002' } })).toThrow('Fuente no disponible');
  });
  it('recupera una referencia retirada como pendiente y permite quitarla sin revelar texto', () => {
    const s = setup(); s.call('saveSelection', { input: s.content }); s.notes.get('1')!.withdrawn = true; const reopened = s.call('getSelection', { id });
    expect(reopened.sources).toHaveLength(1); expect(reopened.unavailableSourceKeys).toEqual(['note:1']); expect(reopened.transcriptions).toEqual([]);
    expect(s.call('saveSelection', { input: { ...s.content, expectedRevision: 1, sources: [] } })).toMatchObject({ sources: [], revision: 2 });
  });
  it('no permite mover materiales de otra materia ni agregar archivos ajenos', () => {
    const s = setup(); s.call('saveSelection', { input: s.content });
    expect(() => s.call('saveSelection', { input: { ...s.content, expectedRevision: 1, subjectId: '2' } })).toThrow('materia');
    expect(() => s.call('saveSelection', { input: { ...s.content, expectedRevision: 1, chosenFileIds: ['forged-file'] } })).toThrow('archivo');
  });
});
