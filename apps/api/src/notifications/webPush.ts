import { validatePushEndpoint } from '@b20/core';

const encoder = new TextEncoder();
export function decodePushBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid push key.');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
export function encodePushBase64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const concat = (...values: Uint8Array[]): Uint8Array<ArrayBuffer> => { const result = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0)); let offset = 0; for (const value of values) { result.set(value, offset); offset += value.length; } return result; };
const hkdf = async (key: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', key, 'HKDF', false, ['deriveBits']), length));

/** RFC 8291 section 3: exported for the published interoperability test vector. */
export async function deriveWebPushKeys(shared: Uint8Array<ArrayBuffer>, auth: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, userPublic: Uint8Array<ArrayBuffer>, serverPublic: Uint8Array<ArrayBuffer>) {
  const input = await hkdf(shared, auth, concat(encoder.encode('WebPush: info\0'), userPublic, serverPublic), 256);
  return { cek: await hkdf(input, salt, concat(encoder.encode('Content-Encoding: aes128gcm\0')), 128), nonce: await hkdf(input, salt, concat(encoder.encode('Content-Encoding: nonce\0')), 96) };
}
export class InvalidPushSubscription extends Error {}
export async function encryptWebPush(payload: string, p256dh: string, authKey: string): Promise<Uint8Array<ArrayBuffer>> {
  const plaintext = encoder.encode(payload);
  if (plaintext.length > 3000) throw new Error('Push payload too large.');
  let userPublic: Uint8Array<ArrayBuffer>; let auth: Uint8Array<ArrayBuffer>; let receiver: CryptoKey;
  try {
    userPublic = decodePushBase64(p256dh); auth = decodePushBase64(authKey);
    if (userPublic.length !== 65 || userPublic[0] !== 4 || auth.length !== 16) throw new Error('Invalid key length.');
    receiver = await crypto.subtle.importKey('raw', userPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  } catch { throw new InvalidPushSubscription('Invalid subscription keys.'); }
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  if (!('privateKey' in ephemeral)) throw new Error('ECDH key pair unavailable.');
  const exported = await crypto.subtle.exportKey('raw', ephemeral.publicKey);
  if (!(exported instanceof ArrayBuffer)) throw new Error('ECDH public key unavailable.');
  const serverPublic = new Uint8Array(exported);
  const algorithm = { name: 'ECDH', public: receiver };
  const shared = new Uint8Array(await crypto.subtle.deriveBits(algorithm, ephemeral.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16)); const keys = await deriveWebPushKeys(shared, auth, salt, userPublic, serverPublic);
  const aes = await crypto.subtle.importKey('raw', keys.cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: keys.nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21); header.set(salt); new DataView(header.buffer).setUint32(16, 4096); header[20] = serverPublic.length;
  return concat(header, serverPublic, ciphertext);
}
export interface VapidConfiguration { publicKey: string; privateKey: string; subject: string }
export async function prepareVapid(config: VapidConfiguration) {
  const publicBytes = decodePushBase64(config.publicKey); const privateBytes = decodePushBase64(config.privateKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32 || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(config.subject)) throw new Error('VAPID configuration is invalid.');
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: encodePushBase64(publicBytes.slice(1, 33)), y: encodePushBase64(publicBytes.slice(33)), d: config.privateKey, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { key, publicKey: config.publicKey, subject: config.subject };
}
export async function vapidAuthorization(endpoint: string, vapid: Awaited<ReturnType<typeof prepareVapid>>, at = Date.now()) {
  const url = validatePushEndpoint(endpoint);
  const header = encodePushBase64(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = encodePushBase64(encoder.encode(JSON.stringify({ aud: url.origin, exp: Math.floor(at / 1000) + 12 * 60 * 60, sub: vapid.subject })));
  const message = `${header}.${body}`; const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.key, encoder.encode(message)));
  return `vapid t=${message}.${encodePushBase64(signature)}, k=${vapid.publicKey}`;
}
export async function sendWebPush(input: { endpoint: string; p256dh: string; auth: string; payload: string; topic: string }, vapid: Awaited<ReturnType<typeof prepareVapid>>, fetchFn: typeof fetch = fetch) {
  const endpoint = validatePushEndpoint(input.endpoint);
  const encrypted = await encryptWebPush(input.payload, input.p256dh, input.auth);
  const topic = encodePushBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input.topic)))).slice(0, 32);
  const response = await fetchFn(endpoint.href, { method: 'POST', headers: { Authorization: await vapidAuthorization(endpoint.href, vapid), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Topic: topic, Urgency: 'normal' }, body: encrypted, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  await response.body?.cancel();
  const retryHeader = response.headers.get('Retry-After');
  const retryDelay = retryHeader ? /^\d+$/.test(retryHeader) ? Number(retryHeader) : (Date.parse(retryHeader) - Date.now()) / 1000 : 0;
  const retryAfterSeconds = Number.isFinite(retryDelay) ? Math.min(28_800, Math.max(0, Math.ceil(retryDelay))) : 0;
  return { outcome: response.ok ? 'sent' : response.status === 404 || response.status === 410 ? 'invalid' : response.status === 408 || response.status === 429 || response.status >= 500 ? 'retry' : 'failed', retryAfterSeconds } as const;
}
