const pagesProjectHost = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pages\.dev$/;
const pagesAlias = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const oauthParameters = new Set([
  'code', 'state', 'session_state', 'access_token', 'id_token', 'refresh_token',
  'error', 'error_description', 'error_uri', 'iss',
]);

/** Únicamente admite el origen estable de un proyecto Pages, nunca una URL de retorno arbitraria. */
export function parsePagesOrigin(value: string | undefined): URL | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !pagesProjectHost.test(url.hostname) || url.port ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined;
    return url;
  } catch { return undefined; }
}

function containsOAuthResponse(url: URL): boolean {
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch { pathname = url.pathname; }
  if (/^\/auth(?:\/|$)/i.test(pathname)) return true;
  const fragment = url.hash.slice(1);
  const fragmentQuery = fragment.includes('?') ? fragment.slice(fragment.indexOf('?') + 1) : fragment;
  return [url.searchParams, new URLSearchParams(fragmentQuery)].some((parameters) =>
    [...parameters.keys()].some((key) => oauthParameters.has(key.toLowerCase())));
}

/**
 * Los aliases de compilaciones inician el acceso en el dominio estable, donde vive el estado PKCE.
 * No se transfieren respuestas OAuth de otro origen: se reinicia el acceso sin sus datos.
 */
export function canonicalPagesUrl(currentHref: string, configuredOrigin: string | undefined): string | undefined {
  const canonical = parsePagesOrigin(configuredOrigin);
  if (!canonical) return undefined;
  let current: URL;
  try { current = new URL(currentHref); } catch { return undefined; }
  if (current.protocol !== 'https:' || current.port || current.username || current.password ||
      current.origin === canonical.origin || !current.hostname.endsWith(`.${canonical.hostname}`)) return undefined;
  const alias = current.hostname.slice(0, -(canonical.hostname.length + 1));
  if (!pagesAlias.test(alias)) return undefined;
  if (containsOAuthResponse(current)) {
    canonical.searchParams.set('auth_restart', '1');
    return canonical.href;
  }
  // Asignar cada componente evita que una ruta como //otro-host cambie el destino.
  canonical.pathname = current.pathname;
  canonical.search = current.search;
  canonical.hash = current.hash;
  return canonical.href;
}
