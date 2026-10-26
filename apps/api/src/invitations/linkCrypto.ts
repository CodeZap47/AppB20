/** Invitation secrets have their own key ring; they never share the AI master keys. */
export interface InvitationSecrets { INVITATION_MASTER_KEYS_JSON?: string; INVITATION_MASTER_VERSION?: string }
export interface InvitationEnvelope { ciphertext: string; iv: string; keyVersion: string }
export interface InvitationContext { module: string; id: string }
export class InvitationCryptoError extends Error {}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
function encode(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function decode(value: string): Uint8Array<ArrayBuffer> {
  try { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
  catch { throw new InvitationCryptoError('No se pudo abrir el enlace de invitación.'); }
}
function aad(context: InvitationContext): Uint8Array<ArrayBuffer> {
  if (!context.module || !context.id) throw new InvitationCryptoError('El contexto del enlace no es válido.');
  return new Uint8Array(new TextEncoder().encode(JSON.stringify(['invitation-link', context.module, context.id])));
}
async function master(secrets: InvitationSecrets, version: string): Promise<CryptoKey> {
  let keys: unknown;
  try { keys = JSON.parse(secrets.INVITATION_MASTER_KEYS_JSON ?? '{}'); }
  catch { throw new InvitationCryptoError('El cifrado de invitaciones todavía no está configurado.'); }
  if (!keys || typeof keys !== 'object' || !Object.hasOwn(keys, version)) {
    throw new InvitationCryptoError('La versión de cifrado de invitaciones no está disponible.');
  }
  const value = (keys as Record<string, unknown>)[version];
  if (typeof value !== 'string') throw new InvitationCryptoError('El cifrado de invitaciones todavía no está configurado.');
  const bytes = decode(value);
  try {
    if (bytes.byteLength !== 32) throw new InvitationCryptoError('El cifrado de invitaciones todavía no está configurado.');
    return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally { bytes.fill(0); }
}
export function generateInvitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  try { return encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  finally { bytes.fill(0); }
}
export async function invitationTokenHash(token: string): Promise<string> {
  if (!TOKEN.test(token)) throw new InvitationCryptoError('El enlace de invitación no es válido.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function encryptInvitationToken(secrets: InvitationSecrets, context: InvitationContext, token: string): Promise<InvitationEnvelope> {
  if (!TOKEN.test(token)) throw new InvitationCryptoError('El enlace de invitación no es válido.');
  const keyVersion = secrets.INVITATION_MASTER_VERSION;
  if (!keyVersion || !/^[a-zA-Z0-9_-]{1,40}$/.test(keyVersion)) throw new InvitationCryptoError('El cifrado de invitaciones todavía no está configurado.');
  const key = await master(secrets, keyVersion);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clear = new TextEncoder().encode(token);
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(context), tagLength: 128 }, key, clear);
    return { ciphertext: encode(new Uint8Array(ciphertext)), iv: encode(iv), keyVersion };
  } finally { clear.fill(0); }
}
export async function decryptInvitationToken(secrets: InvitationSecrets, context: InvitationContext, envelope: InvitationEnvelope): Promise<string> {
  const key = await master(secrets, envelope.keyVersion);
  const iv = decode(envelope.iv);
  const ciphertext = decode(envelope.ciphertext);
  if (iv.byteLength !== 12 || ciphertext.byteLength !== 59) throw new InvitationCryptoError('No se pudo abrir el enlace de invitación.');
  try {
    const clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(context), tagLength: 128 }, key, ciphertext));
    try {
      const token = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(clear);
      if (!TOKEN.test(token)) throw new Error();
      return token;
    } finally { clear.fill(0); }
  } catch { throw new InvitationCryptoError('No se pudo abrir el enlace de invitación.'); }
}
