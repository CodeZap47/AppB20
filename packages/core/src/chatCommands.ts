import { commandNameError, normalizeCommandName } from './messages';

export const CHAT_RESOURCE_KINDS = ['tarea', 'trabajo', 'clase', 'nota', 'pregunta'] as const;
export type ChatResourceKind = (typeof CHAT_RESOURCE_KINDS)[number];
export type ChatCommandVisibility = 'personal' | 'classroom';
export type ChatCommandActionKind = 'text' | 'create';

/** Shared by the demo, server and editor; command actions always open a form. */
export function cleanChatCommand(input: {
  name: string; description: string; text: string;
  visibility?: string; actionKind?: string; resourceKind?: string;
}) {
  const name = normalizeCommandName(input.name);
  const problem = commandNameError(name);
  if (problem) throw new Error(problem);
  const visibility = input.visibility ?? 'personal';
  if (visibility !== 'personal' && visibility !== 'classroom') throw new Error('El alcance del comando no es válido.');
  const actionKind = input.actionKind ?? 'text';
  if (actionKind !== 'text' && actionKind !== 'create') throw new Error('El tipo de comando no es válido.');
  const text = actionKind === 'text' ? input.text.trim() : '';
  if (actionKind === 'text' && !text) throw new Error('Escribe el texto del comando.');
  if (text.length > 2000) throw new Error('El texto del comando admite hasta 2000 caracteres.');
  const resourceKind = actionKind === 'create' ? input.resourceKind : undefined;
  if (actionKind === 'create' && !CHAT_RESOURCE_KINDS.includes(resourceKind as ChatResourceKind)) {
    throw new Error('Elige qué recurso crea el comando.');
  }
  return { name, description: input.description.trim().slice(0, 80), text,
    visibility: visibility as ChatCommandVisibility, actionKind: actionKind as ChatCommandActionKind,
    resourceKind: resourceKind as ChatResourceKind | undefined };
}
