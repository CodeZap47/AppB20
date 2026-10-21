/** Orígenes de aportes: cálculo interno, sin guardar textos ni firmas en la salida. */
export type OriginContributionKind = 'trabajo' | 'apunte' | 'evidencia' | 'guia' | 'respuesta';
export type ContributionContent = string | readonly ContributionContent[];

export interface ContributionOriginInput {
  kind: OriginContributionKind;
  refId: string;
  memberId: string;
  /** Microsegundos, para conservar la precisión del servidor sin conversiones a Number. */
  createdAt: bigint;
  context: readonly string[];
  content: readonly ContributionContent[];
  /** Identificadores de contenido de archivos, nunca nombre/tamaño como prueba de igualdad. */
  files?: readonly string[];
}

export interface ComputedContributionOrigin {
  kind: OriginContributionKind;
  refId: string;
  memberId: string;
  creditedAt: bigint;
  duplicateOf?: string;
}

function normalized(value: ContributionContent): ContributionContent {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : value.map(normalized);
}
function hasText(value: ContributionContent): boolean {
  return typeof value === 'string' ? Boolean(value) : value.some(hasText);
}
function earlier(a: ContributionOriginInput, b: ContributionOriginInput): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt;
  // Los IDs del servidor son u64; compararlos como Number o texto cambia su orden.
  if (/^\d+$/.test(a.refId) && /^\d+$/.test(b.refId)) return BigInt(a.refId) < BigInt(b.refId);
  return a.refId < b.refId;
}

/**
 * Dos pasadas lineales. El llamador incluye los aportes grupales retirados para que un clon
 * posterior no vuelva a sumar, y filtra la visibilidad solo después de calcular el origen.
 * Los datos personales se excluyen antes de llamar esta función.
 */
export function computeContributionOrigins(rows: readonly ContributionOriginInput[]): ComputedContributionOrigin[] {
  const keyed = rows.map((row) => {
    const content = row.content.map(normalized);
    const files = [...new Set(row.files ?? [])].sort();
    const emptyId = !content.some(hasText) && !files.length ? row.refId : '';
    return { row, key: JSON.stringify([row.kind, row.memberId, row.context, content, files, emptyId]) };
  });
  const first = new Map<string, ContributionOriginInput>();
  for (const { row, key } of keyed) {
    const prior = first.get(key);
    if (!prior || earlier(row, prior)) first.set(key, row);
  }
  return keyed.map(({ row, key }) => {
    const origin = first.get(key)!;
    return { kind: row.kind, refId: row.refId, memberId: row.memberId, creditedAt: origin.createdAt,
      duplicateOf: row.refId !== origin.refId ? origin.refId : undefined };
  });
}
