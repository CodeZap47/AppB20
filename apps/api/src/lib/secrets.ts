import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Almacén de claves BYOK. En producción se sustituye por Google Cloud Secret Manager
 * (sección 4 y 5). La interfaz nunca devuelve la clave al cliente.
 */
export interface SecretStore {
  put(userId: string, secret: string): Promise<void>;
  get(userId: string): Promise<string | undefined>;
  has(userId: string): Promise<boolean>;
  delete(userId: string): Promise<void>;
}

/** Implementación de desarrollo: cifra con AES-256-GCM y guarda en memoria. */
export class EncryptedMemoryStore implements SecretStore {
  readonly #key: Buffer;
  readonly #data = new Map<string, string>();

  constructor(base64Key: string) {
    this.#key = Buffer.from(base64Key, 'base64');
    if (this.#key.length !== 32) throw new Error('BYOK_ENCRYPTION_KEY debe tener 32 bytes en base64');
  }

  async put(userId: string, secret: string): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    this.#data.set(userId, payload);
  }

  async get(userId: string): Promise<string | undefined> {
    const payload = this.#data.get(userId);
    if (!payload) return undefined;
    const raw = Buffer.from(payload, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }

  async has(userId: string): Promise<boolean> {
    return this.#data.has(userId);
  }

  async delete(userId: string): Promise<void> {
    this.#data.delete(userId);
  }
}
