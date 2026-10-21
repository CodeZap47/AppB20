export interface NotificationDatabaseConfiguration { uri: string; module: string; serviceToken: string }
export type NotificationCall = <T>(name: string, input: Record<string, unknown>) => Promise<T>;
export function createNotificationCall(configuration: NotificationDatabaseConfiguration, fetchFn: typeof fetch = fetch): NotificationCall {
  const uri = new URL(configuration.uri.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'));
  if (!['https:', 'http:'].includes(uri.protocol) || uri.username || uri.password || !configuration.serviceToken || !configuration.module) throw new Error('Notification database is not configured.');
  return async <T>(name: string, input: Record<string, unknown>): Promise<T> => {
    const response = await fetchFn(new URL(`/v1/database/${encodeURIComponent(configuration.module)}/call/${name}`, uri.origin), { method: 'POST', headers: { Authorization: `Bearer ${configuration.serviceToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify([JSON.stringify(input)]), redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Notification state could not be confirmed.'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('Empty notification response.');
    const chunks: Uint8Array[] = []; let length = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 128 * 1024) throw new Error('Notification response too large.'); chunks.push(part.value); } }
    catch (error) { await reader.cancel(); throw error; }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return (typeof value === 'string' ? JSON.parse(value) : value) as T;
  };
}
