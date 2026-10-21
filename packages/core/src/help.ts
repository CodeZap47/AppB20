/** Intercambio de ayuda voluntario: el nivel describe el contenido, nunca a la persona. */
export const HELP_KIND_LABEL = { offer: 'Puedo ayudarte', request: 'Necesito ayuda' } as const;
export const HELP_LEVEL_LABEL = { initial: 'Inicial', basics: 'Con bases', advanced: 'Profundización' } as const;
export const HELP_MODALITY_LABEL = {
  messages: 'Mensajes', video: 'Videollamada externa', in_person: 'Presencial', flexible: 'Flexible',
} as const;
export const HELP_POST_STATUS_LABEL = { open: 'Abierta', closed: 'Cerrada', withdrawn: 'Retirada' } as const;
export const HELP_CONTACT_STATUS_LABEL = {
  pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada', cancelled: 'Cancelada', closed: 'Cerrada',
} as const;
export const HELP_LIMITS = { title: 200, topic: 120, description: 4000, availability: 500, message: 1000, reason: 500 } as const;

export type HelpKind = keyof typeof HELP_KIND_LABEL;
export type HelpLevel = keyof typeof HELP_LEVEL_LABEL;
export type HelpModality = keyof typeof HELP_MODALITY_LABEL;
export type HelpPostStatus = keyof typeof HELP_POST_STATUS_LABEL;
export type HelpContactStatus = keyof typeof HELP_CONTACT_STATUS_LABEL;

export interface HelpPostFields {
  kind: HelpKind;
  subjectId: string;
  title: string;
  topic: string;
  description: string;
  level: HelpLevel;
  modality: HelpModality;
  availability: string;
}

export function helpText(value: string, field: string, max: number, optional = false): string {
  const clean = value.trim();
  if (!optional && !clean) throw new Error(`${field} no puede estar vacío.`);
  if (clean.length > max) throw new Error(`${field} excede ${max} caracteres.`);
  return clean;
}

export function cleanHelpPost(input: HelpPostFields): HelpPostFields {
  if (!Object.hasOwn(HELP_KIND_LABEL, input.kind)) throw new Error('Elige si ofreces o necesitas ayuda.');
  if (!Object.hasOwn(HELP_LEVEL_LABEL, input.level)) throw new Error('Elige el nivel del contenido.');
  if (!Object.hasOwn(HELP_MODALITY_LABEL, input.modality)) throw new Error('Elige una modalidad de ayuda.');
  return {
    kind: input.kind, subjectId: input.subjectId,
    title: helpText(input.title, 'El título', HELP_LIMITS.title),
    topic: helpText(input.topic, 'El tema', HELP_LIMITS.topic),
    description: helpText(input.description, 'La descripción', HELP_LIMITS.description),
    level: input.level, modality: input.modality,
    availability: helpText(input.availability, 'La disponibilidad', HELP_LIMITS.availability, true),
  };
}
