import { SenderError } from 'spacetimedb/server';
import { cleanChatCommand } from '../../core/src/chatCommands';
import { memberIdentityFor } from './authIdentity';
import { activeMember, isActive, log, type Ctx, type ViewDb } from './moduleContext';

export function commandReadable(db: ViewDb, sender: Ctx['sender'], commandId: bigint) {
  if (!isActive(db, sender)) return false;
  const row = db.chatCommand.id.find(commandId);
  return !!row && (row.owner.isEqual(sender) ||
    (isActive(db, row.owner) && !!db.chatCommandDetail.commandId.find(commandId)?.shared));
}

export function saveChatCommand(ctx: Ctx, input: {
  id?: bigint; name: string; description: string; text: string;
  visibility?: string; actionKind?: string; resourceKind?: string; expectedVersion?: number;
}) {
  activeMember(ctx);
  const actor = memberIdentityFor(ctx);
  const existing = input.id === undefined ? undefined : ctx.db.chatCommand.id.find(input.id);
  if (input.id !== undefined && (!existing || !existing.owner.isEqual(actor))) {
    throw new SenderError('Solo el autor puede editar este comando. Puedes crear una copia personal.');
  }
  const detail = existing ? ctx.db.chatCommandDetail.commandId.find(existing.id) : undefined;
  if (input.expectedVersion !== undefined && input.expectedVersion !== (detail?.version ?? 1)) {
    throw new SenderError('El comando cambió. Actualiza la lista antes de guardar.');
  }
  let fields: ReturnType<typeof cleanChatCommand>;
  try {
    fields = cleanChatCommand({ ...input,
      visibility: input.visibility ?? (detail?.shared ? 'classroom' : 'personal'),
      actionKind: input.actionKind ?? detail?.actionKind ?? 'text',
      resourceKind: input.resourceKind ?? detail?.resourceKind });
  } catch (error) { throw new SenderError(error instanceof Error ? error.message : 'Comando no válido.'); }
  const all = [...ctx.db.chatCommand.iter()];
  if (all.some(row => row.id !== input.id && row.owner.isEqual(actor) && row.name === fields.name)) {
    throw new SenderError(`Ya tienes un comando «/${fields.name}».`);
  }
  if (fields.visibility === 'classroom' && all.some(row => row.id !== input.id && row.name === fields.name &&
    ctx.db.chatCommandDetail.commandId.find(row.id)?.shared)) {
    throw new SenderError(`Ya existe un comando del salón «/${fields.name}». Elige otro nombre.`);
  }
  const stored = { name: fields.name, description: fields.description, text: fields.text };
  const row = existing ? { ...existing, ...stored } : ctx.db.chatCommand.insert({ id: 0n, owner: actor, ...stored, createdAt: ctx.timestamp });
  if (existing) ctx.db.chatCommand.id.update(row);
  const metadata = { commandId: row.id, shared: fields.visibility === 'classroom', actionKind: fields.actionKind,
    resourceKind: fields.resourceKind, version: existing ? (detail?.version ?? 1) + 1 : 1, updatedAt: ctx.timestamp };
  if (detail) ctx.db.chatCommandDetail.commandId.update(metadata); else ctx.db.chatCommandDetail.insert(metadata);
}

export function removeChatCommand(ctx: Ctx, input: { commandId: bigint }) {
  const member = activeMember(ctx);
  const row = ctx.db.chatCommand.id.find(input.commandId);
  const detail = ctx.db.chatCommandDetail.commandId.find(input.commandId);
  const own = row?.owner.isEqual(memberIdentityFor(ctx));
  if (!row || (!own && !(member.isCreator && detail?.shared))) throw new SenderError('El comando no existe o no puedes retirarlo.');
  if (!own && detail) {
    ctx.db.chatCommandDetail.commandId.update({ ...detail, shared: false, version: detail.version + 1, updatedAt: ctx.timestamp });
    log(ctx, 'moderate', 'chat_command', row.id);
    return;
  }
  ctx.db.chatCommand.id.delete(row.id);
  ctx.db.chatCommandDetail.commandId.delete(row.id);
}
