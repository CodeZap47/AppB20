import { t, table } from 'spacetimedb/server';
import type { Ctx, ViewDb } from './moduleContext';

/** Marcadores editoriales independientes del contador técnico y del esquema histórico. */
export const noteEdition = table({ name: 'note_edition' }, {
  key: t.string().primaryKey(), noteId: t.u64().index('btree'), version: t.u32(), isFinal: t.bool(),
});

/** Los cambios de archivos y los clientes anteriores heredan el último marcador. */
export function noteIsFinal(db: ViewDb, noteId: bigint, version: number): boolean {
  let latest = 0;
  let isFinal = false;
  for (const marker of db.noteEdition.noteId.filter(noteId)) {
    if (marker.version <= version && marker.version > latest) {
      latest = marker.version;
      isFinal = marker.isFinal;
    }
  }
  return isFinal;
}

export function markNoteEdition(ctx: Ctx, noteId: bigint, version: number, isFinal: boolean) {
  const row = { key: `${noteId}:${version}`, noteId, version, isFinal };
  if (ctx.db.noteEdition.key.find(row.key)) ctx.db.noteEdition.key.update(row);
  else ctx.db.noteEdition.insert(row);
}
