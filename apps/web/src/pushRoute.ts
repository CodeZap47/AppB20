/** Un aviso solo puede abrir rutas del módulo dentro del mismo origen de la aplicación. */
export function pushDestination(value: unknown, appUrl: string): string {
  const base = new URL(appUrl);
  const fallback = new URL('./#/m/avisos', base);
  if (typeof value !== 'string' || value.length > 400 || /[\u0000-\u0020\u007f]/.test(value)) return fallback.href;
  const route = value.startsWith('/m/') ? `./#${value}` : value;
  let url: URL;
  try { url = new URL(route, base); } catch { return fallback.href; }
  if (url.origin !== base.origin || !/^#\/m\/[a-zA-Z0-9_/?=&%-]*$/.test(url.hash) || /%2f|%5c/i.test(url.hash)) return fallback.href;
  return url.href;
}
