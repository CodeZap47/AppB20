const pagesProjectHost = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pages\.dev$/;
const publicHost = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const pagesAlias = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const oauthParameters = new Set([
  'code', 'state', 'session_state', 'access_token', 'id_token', 'refresh_token',
  'error', 'error_description', 'error_uri', 'iss',
]);

function parseExactOrigin(value: string | undefined, host: RegExp): URL | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !host.test(url.hostname) || url.port ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined;
    return url;
  } catch { return undefined; }
}

/** Únicamente admite el origen estable de un proyecto Pages, nunca una URL de retorno arbitraria. */
export function parsePagesOrigin(value: string | undefined): URL | undefined {
  return parseExactOrigin(value, pagesProjectHost);
}

/** Origen público de la web: el de Pages o un dominio propio como https://b20.mx. */
export function parseWebOrigin(value: string | undefined): URL | undefined {
  return parseExactOrigin(value, publicHost);
}

export function containsOAuthResponse(url: URL): boolean {
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch { pathname = url.pathname; }
  if (/^\/auth(?:\/|$)/i.test(pathname)) return true;
  const fragment = url.hash.slice(1);
  const fragmentQuery = fragment.includes('?') ? fragment.slice(fragment.indexOf('?') + 1) : fragment;
  return [url.searchParams, new URLSearchParams(fragmentQuery)].some((parameters) =>
    [...parameters.keys()].some((key) => oauthParameters.has(key.toLowerCase())));
}

/**
 * Los aliases de compilaciones, y el subdominio de Pages cuando hay dominio propio, inician el
 * acceso en el dominio estable, donde vive el estado PKCE.
 * No se transfieren respuestas OAuth de otro origen: se reinicia el acceso sin sus datos.
 * Sin `configuredPagesOrigin`, el origen estable es el propio subdominio de Pages.
 */
export function canonicalPagesUrl(
  currentHref: string, configuredOrigin: string | undefined, configuredPagesOrigin?: string,
): string | undefined {
  const canonical = parseWebOrigin(configuredOrigin);
  const pages = configuredPagesOrigin === undefined ? parsePagesOrigin(configuredOrigin) : parsePagesOrigin(configuredPagesOrigin);
  if (!canonical || !pages) return undefined;
  let current: URL;
  try { current = new URL(currentHref); } catch { return undefined; }
  if (current.protocol !== 'https:' || current.port || current.username || current.password ||
      current.origin === canonical.origin) return undefined;
  if (current.hostname !== pages.hostname) {
    if (!current.hostname.endsWith(`.${pages.hostname}`)) return undefined;
    const alias = current.hostname.slice(0, -(pages.hostname.length + 1));
    if (!pagesAlias.test(alias)) return undefined;
  }
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
