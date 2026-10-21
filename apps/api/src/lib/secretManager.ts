/** Adaptador histórico sin registrar: el despliegue actual solo admite SpacetimeDB y Cloudflare. */
import { createHash } from 'node:crypto';
import type { SecretStore } from './secrets.ts';

const API = 'https://secretmanager.googleapis.com/v1';
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
/** Las claves leídas se recuerdan un rato para no pagar una lectura por cada generación. */
const CACHE_MS = 5 * 60_000;
/** Los tokens de acceso se renuevan un minuto antes de vencer. */
const TOKEN_MARGIN_MS = 60_000;

/** Entrega un token de acceso OAuth para la API de Secret Manager. */
export type AccessTokenProvider = () => Promise<string>;

/**
 * Token de la cuenta de servicio desde el servidor de metadatos de Google Cloud (Cloud Run,
 * GCE). En local no existe: ahí se usa `EncryptedMemoryStore`.
 */
export function metadataTokenProvider(fetchFn: typeof fetch = fetch): AccessTokenProvider {
  let cached: { token: string; expiresAt: number } | undefined;
  return async () => {
    if (cached && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()) return cached.token;
    const res = await fetchFn(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!res.ok)
      throw new Error(`No se pudo obtener el token de la cuenta de servicio (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cached.token;
  };
}

export interface SecretManagerStoreOptions {
  projectId: string;
  getAccessToken: AccessTokenProvider;
  fetchFn?: typeof fetch;
  now?: () => number;
}

/**
 * Claves BYOK en Google Cloud Secret Manager, un secreto por usuario (`byok-<hash del sub>`).
 * Usa la API REST para no cargar el cliente gRPC. La cuenta de servicio solo necesita permisos
 * sobre secretos que empiecen con `byok-` (ver `docs/despliegue.md`).
 */
export class SecretManagerStore implements SecretStore {
  readonly #projectId: string;
  readonly #getAccessToken: AccessTokenProvider;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #cache = new Map<string, { value: string; expiresAt: number }>();

  constructor(options: SecretManagerStoreOptions) {
    this.#projectId = options.projectId;
    this.#getAccessToken = options.getAccessToken;
    this.#fetch = options.fetchFn ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  /** Nombre del secreto. Se usa un hash para no exponer el `sub` en los nombres del proyecto. */
  static secretId(userId: string): string {
    return `byok-${createHash('sha256').update(userId).digest('hex').slice(0, 40)}`;
  }

  async put(userId: string, secret: string): Promise<void> {
    const id = SecretManagerStore.secretId(userId);
    const created = await this.#call('POST', `secrets?secretId=${id}`, {
      replication: { automatic: {} },
      labels: { app: 'b20' },
    });
    if (!created.ok && created.status !== 409) await this.#fail(created, 'crear el secreto');

    const added = await this.#call('POST', `secrets/${id}:addVersion`, {
      payload: { data: Buffer.from(secret, 'utf8').toString('base64') },
    });
    if (!added.ok) await this.#fail(added, 'guardar la clave');
    const { name: current } = (await added.json()) as { name: string };

    // Solo se conserva la versión nueva: una clave reemplazada no debe poder leerse.
    const listed = await this.#call(
      'GET',
      `secrets/${id}/versions?filter=${encodeURIComponent('state:ENABLED OR state:DISABLED')}`,
    );
    if (!listed.ok) await this.#fail(listed, 'listar versiones');
    const { versions = [] } = (await listed.json()) as { versions?: { name: string }[] };
    for (const version of versions) {
      if (version.name === current) continue;
      const destroyed = await this.#call('POST', `${this.#relative(version.name)}:destroy`, {});
      if (!destroyed.ok) await this.#fail(destroyed, 'destruir la versión anterior');
    }
    this.#cache.set(userId, { value: secret, expiresAt: this.#now() + CACHE_MS });
  }

  async get(userId: string): Promise<string | undefined> {
    const hit = this.#cache.get(userId);
    if (hit && hit.expiresAt > this.#now()) return hit.value;
    const res = await this.#call(
      'GET',
      `secrets/${SecretManagerStore.secretId(userId)}/versions/latest:access`,
    );
    if (res.status === 404 || res.status === 400 || res.status === 412) {
      this.#cache.delete(userId);
      return undefined;
    }
    if (!res.ok) await this.#fail(res, 'leer la clave');
    const body = (await res.json()) as { payload?: { data?: string } };
    const value = Buffer.from(body.payload?.data ?? '', 'base64').toString('utf8');
    if (!value) return undefined;
    this.#cache.set(userId, { value, expiresAt: this.#now() + CACHE_MS });
    return value;
  }

  async has(userId: string): Promise<boolean> {
    return (await this.get(userId)) !== undefined;
  }

  async delete(userId: string): Promise<void> {
    this.#cache.delete(userId);
    const res = await this.#call('DELETE', `secrets/${SecretManagerStore.secretId(userId)}`);
    if (!res.ok && res.status !== 404) await this.#fail(res, 'borrar la clave');
  }

  #relative(name: string): string {
    // `projects/123/secrets/x/versions/2` → `secrets/x/versions/2`
    return name.slice(name.indexOf('secrets/'));
  }

  async #call(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await this.#getAccessToken();
    return this.#fetch(`${API}/projects/${this.#projectId}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** Nunca incluye la clave: solo la operación y el código de estado. */
  async #fail(res: Response, action: string): Promise<never> {
    throw new Error(`Secret Manager no pudo ${action} (${res.status})`);
  }
}
