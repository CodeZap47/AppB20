/** Only encrypted envelopes leave this module. Master keys are Cloudflare secrets. */
export interface AiCiphertext { ciphertext: string; iv: string; masterVersion: string }
export interface AiKeyContext { actor: string; provider: 'gemini'; keyId: string }
export interface AiMasterSecrets { AI_MASTER_KEYS_JSON?: string; AI_MASTER_VERSION?: string }
export class AiCryptoError extends Error {}

function decode(value: string): Uint8Array<ArrayBuffer> {
  try { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
  catch { throw new AiCryptoError('La configuración de cifrado no está disponible.'); }
}
function encode(value: Uint8Array): string { return btoa(String.fromCharCode(...value)); }
function aad(context: AiKeyContext, masterVersion: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]{64}$/.test(context.actor) || context.provider !== 'gemini' || !context.keyId) {
    throw new AiCryptoError('El contexto de la clave no es válido.');
  }
  return new Uint8Array(new TextEncoder().encode(JSON.stringify(['b20-ai-key-v1', context.actor, context.provider, context.keyId, masterVersion])));
}
async function master(secrets: AiMasterSecrets, version: string): Promise<CryptoKey> {
  let keys: unknown;
  try { keys = JSON.parse(secrets.AI_MASTER_KEYS_JSON ?? '{}'); } catch { throw new AiCryptoError('La configuración de cifrado no está disponible.'); }
  if (!keys || typeof keys !== 'object' || !Object.hasOwn(keys, version)) throw new AiCryptoError('La versión de cifrado no está disponible.');
  const value: unknown = (keys as Record<string, unknown>)[version];
  if (typeof value !== 'string') throw new AiCryptoError('La configuración de cifrado no está disponible.');
  const bytes = decode(value);
  if (bytes.byteLength !== 32) throw new AiCryptoError('La configuración de cifrado no está disponible.');
  try { return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); }
  finally { bytes.fill(0); }
}
export async function canEncrypt(secrets: AiMasterSecrets): Promise<boolean> {
  try { if (!secrets.AI_MASTER_VERSION) return false; await master(secrets, secrets.AI_MASTER_VERSION); return true; }
  catch { return false; }
}
export async function encryptAiKey(secrets: AiMasterSecrets, context: AiKeyContext, plaintext: string): Promise<AiCiphertext> {
  const masterVersion = secrets.AI_MASTER_VERSION;
  if (!masterVersion) throw new AiCryptoError('La configuración de cifrado no está disponible.');
  const key = await master(secrets, masterVersion);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clear = new TextEncoder().encode(plaintext);
  try {
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(context, masterVersion), tagLength: 128 }, key, clear);
    return { ciphertext: encode(new Uint8Array(encrypted)), iv: encode(iv), masterVersion };
  } finally { clear.fill(0); }
}
export async function decryptAiKey(secrets: AiMasterSecrets, context: AiKeyContext, envelope: AiCiphertext): Promise<string> {
  const key = await master(secrets, envelope.masterVersion);
  const iv = decode(envelope.iv);
  if (iv.byteLength !== 12) throw new AiCryptoError('No se pudo abrir la clave personal.');
  try {
    const clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv,
      additionalData: aad(context, envelope.masterVersion), tagLength: 128 }, key, decode(envelope.ciphertext)));
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(clear); } finally { clear.fill(0); }
  } catch { throw new AiCryptoError('No se pudo abrir la clave personal.'); }
}
