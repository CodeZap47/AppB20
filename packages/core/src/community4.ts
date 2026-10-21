export const OPPORTUNITY_KINDS = ['contest', 'course', 'scholarship', 'event', 'internship', 'other'] as const;
export const OPPORTUNITY_MODALITIES = ['online', 'in_person', 'hybrid'] as const;
export interface MuseumFields {
  intention: string; symptom: string; cause: string; correction: string; learning: string;
  minimalCode: string; evidence: string; language: string; topic: string; bugType: string;
  noteIds: string[]; questionIds: string[];
}
export interface OpportunityFields {
  kind: string; title: string; topic: string; modality: string; sourceUrl: string; organizer: string;
  requirements: string; deadline?: string; costKnown: boolean; cost: string; roomId?: string;
}
function text(value: string, field: string, max: number, required = true) {
  if (typeof value !== 'string') throw new Error(`${field} no es válido.`);
  const result = value.trim();
  if ((required && !result) || result.length > max) throw new Error(`${field}: ${required ? 'obligatorio, ' : ''}máximo ${max} caracteres.`);
  return result;
}
function links(input: string[]) {
  if (!Array.isArray(input) || input.length > 20 || input.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id) || (/^[0-9]+$/.test(id) && BigInt(id) > 18446744073709551615n))) throw new Error('Referencias no válidas (máximo 20).');
  return [...new Set(input)];
}
export function cleanMuseum(input: MuseumFields): MuseumFields {
  return { intention: text(input.intention, 'La intención', 2000), symptom: text(input.symptom, 'El síntoma', 4000),
    cause: text(input.cause, 'La causa o hipótesis', 4000), correction: text(input.correction, 'La corrección', 4000, false),
    learning: text(input.learning, 'El aprendizaje', 2000), minimalCode: text(input.minimalCode, 'El código mínimo', 12000, false),
    evidence: text(input.evidence, 'La evidencia', 4000, false), language: text(input.language, 'El lenguaje', 80),
    topic: text(input.topic, 'El tema', 200), bugType: text(input.bugType, 'El tipo de error', 100),
    noteIds: links(input.noteIds), questionIds: links(input.questionIds) };
}
export function cleanOpportunity(input: OpportunityFields): OpportunityFields {
  if (!OPPORTUNITY_KINDS.includes(input.kind as typeof OPPORTUNITY_KINDS[number])) throw new Error('El tipo de oportunidad no es válido.');
  if (!OPPORTUNITY_MODALITIES.includes(input.modality as typeof OPPORTUNITY_MODALITIES[number])) throw new Error('La modalidad no es válida.');
  const sourceUrl = text(input.sourceUrl, 'La fuente HTTPS', 2048);
  // Compatible con el runtime WASM, sin dependencia de URL ni de servicios externos.
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?(?:[/?#][^\s<>"\\]*)?$/i.test(sourceUrl) || /[\u0000-\u0020\u007f]/.test(sourceUrl)) throw new Error('La fuente debe ser HTTPS sin credenciales.');
  if (input.deadline !== undefined && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input.deadline) || !Number.isFinite(Date.parse(input.deadline)) || new Date(input.deadline).toISOString() !== input.deadline.replace(/Z$/, input.deadline.includes('.') ? 'Z' : '.000Z'))) throw new Error('La fecha límite no es válida.');
  if (input.roomId !== undefined) links([input.roomId]);
  if (typeof input.costKnown !== 'boolean') throw new Error('Indica si conoces el costo.');
  return { kind: input.kind, modality: input.modality, title: text(input.title, 'El título', 200), topic: text(input.topic, 'El tema', 200), sourceUrl,
    organizer: text(input.organizer, 'El organizador', 200), requirements: text(input.requirements, 'Los requisitos', 4000),
    deadline: input.deadline, costKnown: input.costKnown, cost: input.costKnown ? text(input.cost, 'El costo (incluye moneda o gratis)', 300) : '', roomId: input.roomId };
}
export function opportunityExpired(row: Pick<OpportunityFields, 'deadline'>, now: Date) { return row.deadline !== undefined && Date.parse(row.deadline) <= now.getTime(); }
