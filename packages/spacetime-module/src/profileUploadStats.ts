import { isActive, type Ctx, type ViewDb } from './moduleContext';

/** Publica solo totales; nunca identifica adjuntos ni sus destinos privados. */
export function readMemberUploadStats(db: ViewDb, viewer: Ctx['sender']) {
  if (!isActive(db, viewer)) return [];
  const totals = new Map([...db.member.iter()].filter((member) => member.status === 'active').map((member) => [
    member.identity.toHexString(), { memberId: member.identity, bytes: 0n, fileCount: 0n },
  ]));
  const add = (memberId: Ctx['sender'], size: bigint) => {
    const total = totals.get(memberId.toHexString());
    if (total) { total.bytes += size; total.fileCount += 1n; }
  };
  const resources = new Set<string>();
  for (const file of db.resourceFile.iter()) {
    // También registra las bajas para no resucitar su representación heredada.
    resources.add(file.id);
    if (file.removedAt === undefined) add(file.uploadedBy, file.size);
  }
  for (const file of db.workFile.iter()) {
    if (!resources.has(`legacy:${file.id}`)) add(file.uploadedBy, file.size);
  }
  // Los stickers históricos no conservan uploadedBy y no se atribuyen a un dueño supuesto.
  return [...totals.values()];
}
