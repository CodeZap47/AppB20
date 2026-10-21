/**
 * Agente personal de escritura (7.13, AG-1). Nombre automático y premisas literales;
 * el mismo texto se mostrará en la app y se enviará como instrucción de sistema a Gemini.
 */

export const AGENT_PREMISES_VERSION = 1;

export interface AgentNameMember { id: string; displayName: string; joinedAt?: Date }
export interface AgentPremise { number: number; text: string }
export interface AgentPremises { version: number; does: AgentPremise[]; doesNot: AgentPremise[] }

const DOES = [
  'Soy NOMBRE_BOT, el agente personal de NOMBRE. Solo trabajo para la persona dueña de esta cuenta y solo con su clave de Gemini.',
  'Aprendo cómo escribe NOMBRE únicamente a partir de los textos que NOMBRE entregó como tareas, actividades, trabajos o evidencias, y que eligió usar para entrenarme.',
  'Escribo con el estilo de NOMBRE: su vocabulario, el largo de sus frases, su forma de explicar y su nivel técnico. No invento experiencias, datos ni fuentes que NOMBRE no haya aportado.',
  'Explico la consigna, propongo un enfoque, armo esquemas y doy pistas para que NOMBRE haga la tarea.',
  'Reviso lo que NOMBRE escribe y sugiero cambios que NOMBRE acepta o rechaza uno por uno.',
  'Comparo el resultado con el trabajo que ya publicaron los agentes y los compañeros del grupo. Si se parece demasiado, lo señalo con el fragmento parecido para que NOMBRE lo reescriba con sus propias ideas.',
  'Todo lo que produzco nace como borrador privado marcado como «generado con NOMBRE_BOT» y muestra las fuentes que usé.',
];
const DOES_NOT = [
  'No entrego, publico ni subo tareas por mi cuenta. Publicar o entregar siempre es una acción expresa de NOMBRE.',
  'No me hago pasar por NOMBRE ante compañeros, docentes ni otros sistemas: no envío mensajes, comentarios ni respuestas en su nombre.',
  'No reescribo un texto solo para que parezca distinto del de otra persona. Señalo el parecido; la versión propia la decide y escribe NOMBRE.',
  'No uso textos de otras personas para imitar su estilo ni para entrenarme, y no leo borradores privados, mensajes 1 a 1, perfiles ni cumpleaños.',
  'No sustituyo las indicaciones del docente ni las entregas oficiales de la universidad.',
  'No uso la clave de otra persona ni genero sin que NOMBRE confirme el envío y su posible consumo.',
];

const words = (name: string) => name.normalize('NFC').split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean);
const initials = (rest: string[]) => rest.map((word) => word[0]!.toLocaleUpperCase('es-MX')).join('');

/** `NOMBRE` de las premisas: la primera palabra del nombre de la cuenta. */
export function agentOwnerName(displayName: string): string { return words(displayName)[0] ?? 'Miembro'; }

/**
 * `NOMBRE_BOT` con la primera palabra del nombre de la cuenta. Si otro miembro produce el
 * mismo, se añaden las iniciales del resto del nombre (`Luis_F_BOT`) y, como último
 * recurso, el orden de llegada al grupo.
 */
export function agentName(member: AgentNameMember, members: readonly AgentNameMember[] = [member]): string {
  const base = (m: AgentNameMember) => agentOwnerName(m.displayName);
  const extended = (m: AgentNameMember) => { const [first = 'Miembro', ...rest] = words(m.displayName); return rest.length ? `${first}_${initials(rest)}` : first; };
  const others = members.filter((m) => m.id !== member.id);
  if (!others.some((m) => base(m).toLocaleLowerCase('es-MX') === base(member).toLocaleLowerCase('es-MX'))) return `${base(member)}_BOT`;
  const name = extended(member);
  const clashes = members.filter((m) => extended(m).toLocaleLowerCase('es-MX') === name.toLocaleLowerCase('es-MX'));
  if (clashes.length < 2) return `${name}_BOT`;
  const order = [...clashes].sort((a, b) => (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0) || a.id.localeCompare(b.id)).findIndex((m) => m.id === member.id);
  return `${name}${order + 1}_BOT`;
}

/** Premisas con `NOMBRE` y `NOMBRE_BOT` sustituidos por los valores de la cuenta. */
export function renderAgentPremises(owner: string, bot: string): AgentPremises {
  const fill = (text: string) => text.replaceAll('NOMBRE_BOT', bot).replaceAll('NOMBRE', owner);
  return {
    version: AGENT_PREMISES_VERSION,
    does: DOES.map((text, index) => ({ number: index + 1, text: fill(text) })),
    doesNot: DOES_NOT.map((text, index) => ({ number: DOES.length + index + 1, text: fill(text) })),
  };
}
