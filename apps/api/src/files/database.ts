/** Small, authenticated HTTP bridge. No owner token and no arbitrary SQL from clients. */
export type TargetKind = 'assignment' | 'activity' | 'work' | 'evidence';

export interface UploadTarget {
  targetKind: TargetKind;
  targetId: string;
  expectedVersion: number;
  uploadId: string;
}

export interface AuthorizedUpload extends UploadTarget { actor: string }
export interface UploadStatus { fileId: string; storageKey: string }
export interface DownloadAccess {
  storageKey: string;
  name: string;
  size: string;
  contentType: string;
  etag: string;
}
export interface FinalizedUpload extends AuthorizedUpload {
  name: string;
  size: number;
  contentType: string;
  storageKey: string;
  etag: string;
}

export class FileApiError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 503, message: string) {
    super(message);
  }
}

export interface FileDatabase {
  authorize(token: string, target: UploadTarget): Promise<AuthorizedUpload>;
  status(actor: string, uploadId: string): Promise<UploadStatus | null>;
  finalize(upload: FinalizedUpload): Promise<void>;
  download(token: string, fileId: string): Promise<DownloadAccess>;
}

/** u64 values stay decimal strings until encoded as raw JSON numbers; never round via Number. */
type Argument = string | number | { u64: string };
const u64 = (value: string): Argument => ({ u64: value });
function encodeArguments(args: Argument[]): string {
  return `[${args.map((value) => typeof value === 'object' ? value.u64 : JSON.stringify(value)).join(',')}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createFileDatabase(env: FileWorkerEnv, fetchFn: typeof fetch = fetch): FileDatabase {
  const uri = new URL(env.SPACETIMEDB_URI);
  if (uri.protocol === 'wss:') uri.protocol = 'https:';
  if (uri.protocol === 'ws:') uri.protocol = 'http:';
  if (!['http:', 'https:'].includes(uri.protocol) || uri.username || uri.password) {
    throw new FileApiError(503, 'El servicio de archivos todavía no está configurado.');
  }
  async function call(name: string, token: string, args: Argument[], returnsValue: boolean): Promise<unknown> {
    if (!token) throw new FileApiError(503, 'El servicio de archivos todavía no está configurado.');
    let response: Response;
    try {
      response = await fetchFn(new URL(`/v1/database/${encodeURIComponent(env.SPACETIMEDB_MODULE)}/call/${name}`, uri.origin), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: encodeArguments(args),
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new FileApiError(503, 'No pudimos confirmar el archivo. Reintenta sin cambiarlo.');
    }
    if (!response.ok) {
      // SenderError includes permission and stale-version rejections. Do not expose server logs.
      if ([400, 401, 403, 530].includes(response.status)) {
        throw new FileApiError(409, 'Tu acceso o la versión cambió. Actualiza la página antes de volver a subir.');
      }
      throw new FileApiError(503, 'No pudimos confirmar el archivo. Reintenta sin cambiarlo.');
    }
    if (!returnsValue) return undefined;
    try {
      // Procedures return a SATS JSON string whose contents are a deliberately small JSON DTO.
      const data: unknown = await response.json();
      return typeof data === 'string' ? JSON.parse(data) as unknown : data;
    } catch {
      throw new FileApiError(503, 'La versión del servicio de archivos no coincide con la app.');
    }
  }
  return {
    async authorize(token, target) {
      const data = await call('authorize_file_upload', token,
        [target.targetKind, u64(target.targetId), target.expectedVersion, target.uploadId], true);
      if (!isRecord(data) || typeof data.actor !== 'string' || !/^(?:0x)?[0-9a-f]{64}$/i.test(data.actor)) {
        throw new FileApiError(503, 'No pudimos comprobar quién sube el archivo.');
      }
      return { ...target, actor: data.actor.replace(/^0x/, '').toLowerCase() };
    },
    async status(actor, uploadId) {
      const data = await call('get_file_upload_status', env.FILE_SERVICE_TOKEN, [actor, uploadId], true);
      if (data === null) return null;
      if (!isRecord(data) || typeof data.fileId !== 'string' || typeof data.storageKey !== 'string') {
        throw new FileApiError(503, 'No pudimos comprobar si el archivo ya quedó guardado.');
      }
      return { fileId: data.fileId, storageKey: data.storageKey };
    },
    async finalize(upload) {
      await call('finalize_file_upload', env.FILE_SERVICE_TOKEN, [upload.actor, upload.targetKind,
        u64(upload.targetId), upload.expectedVersion, upload.uploadId, upload.name, u64(String(upload.size)),
        upload.contentType, upload.storageKey, upload.etag], false);
    },
    async download(token, fileId) {
      const data = await call('get_file_download_access', token, [fileId], true);
      if (!isRecord(data) || !['storageKey', 'name', 'size', 'contentType', 'etag'].every((key) => typeof data[key] === 'string')) {
        throw new FileApiError(404, 'Este archivo no está disponible.');
      }
      return { storageKey: String(data.storageKey), name: String(data.name), size: String(data.size),
        contentType: String(data.contentType), etag: String(data.etag) };
    },
  };
}
