/**
 * Límite de tamaño para cualquier archivo que se suba a la app: adjuntos de trabajos y, más
 * adelante, de mensajes, evidencias y fotos. La interfaz lo usa para avisar antes de subir;
 * el servidor (módulo SpacetimeDB y almacenamiento) lo vuelve a validar.
 */
export const MAX_FILE_MB = 50;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

/** Tamaño legible: «512 B», «820 KB», «12.4 MB», «1.2 GB». */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${Number(mb.toFixed(1))} MB`;
  return `${Number((mb / 1024).toFixed(1))} GB`;
}

/** Motivo por el que un archivo no puede subirse, o `undefined` si su tamaño es válido. */
export function fileSizeError(name: string, bytes: number): string | undefined {
  if (!Number.isFinite(bytes) || bytes <= 0) return `«${name}» está vacío.`;
  if (bytes <= MAX_FILE_BYTES) return undefined;
  // Un archivo apenas por encima del límite se redondearía a «50 MB»; se dice «más de».
  const shown = formatBytes(bytes);
  const weight = shown === formatBytes(MAX_FILE_BYTES) ? `más de ${shown}` : shown;
  return `«${name}» pesa ${weight} y el límite es de ${MAX_FILE_MB} MB por archivo.`;
}
