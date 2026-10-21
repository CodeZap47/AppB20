export interface MaintenanceConfiguration { uri: string; module: string; token?: string }
/** El programador pide lotes pequeños; solo SpacetimeDB decide qué venció y puede borrarse. */
export async function runRetentionMaintenance(configuration: MaintenanceConfiguration, fetchFn: typeof fetch = fetch): Promise<{ processed: number; remaining: number; enabled: boolean }> {
  if (!configuration.token) return { processed: 0, remaining: 0, enabled: false };
  const uri = new URL(configuration.uri.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'));
  if (!['https:', 'http:'].includes(uri.protocol) || uri.username || uri.password || !configuration.module) throw new Error('Mantenimiento no configurado.');
  let processed = 0; let remaining = 0;
  for (let batch = 0; batch < 5; batch++) {
    const response = await fetchFn(new URL(`/v1/database/${encodeURIComponent(configuration.module)}/call/purge_due`, uri.origin), {
      method: 'POST', headers: { Authorization: `Bearer ${configuration.token}`, 'Content-Type': 'application/json' },
      body: '[20]', redirect: 'manual', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('No se pudo confirmar el mantenimiento.'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('Respuesta de mantenimiento vacía.');
    const decoder = new TextDecoder(); let text = ''; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 2048) throw new Error('Respuesta de mantenimiento inválida.'); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    catch (error) { await reader.cancel(); throw error; }
    let value: unknown = JSON.parse(text); if (typeof value === 'string') value = JSON.parse(value);
    if (!value || typeof value !== 'object' || !('processed' in value) || !('remaining' in value)
      || !Number.isSafeInteger(value.processed) || !Number.isSafeInteger(value.remaining)
      || typeof value.processed !== 'number' || value.processed < 0 || value.processed > 20 || typeof value.remaining !== 'number' || value.remaining < 0) throw new Error('Respuesta de mantenimiento inválida.');
    processed += value.processed; remaining = value.remaining;
    if (!remaining || !value.processed) break;
  }
  return { enabled: true, processed, remaining };
}
