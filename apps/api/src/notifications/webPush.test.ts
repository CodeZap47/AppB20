import { webcrypto as crypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { decodePushBase64 as decode, deriveWebPushKeys, encodePushBase64 as encode, encryptWebPush, InvalidPushSubscription, prepareVapid, sendWebPush, vapidAuthorization } from './webPush';
const encoder = new TextEncoder();
async function keys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { pair, raw, p256dh: encode(raw), auth: encode(crypto.getRandomValues(new Uint8Array(16))), vapid: { publicKey: encode(raw), privateKey: privateJwk.d!, subject: 'mailto:admin@example.com' } };
}
describe('Web Push RFC 8291 y VAPID RFC 8292', () => {
  it('coincide con el vector publicado del apéndice A de RFC 8291', async () => {
    const result = await deriveWebPushKeys(decode('kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs'), decode('BTBZMqHH6r4Tts7J_aSIgg'), decode('DGv6ra1nlYgDCS1FRnbzlw'), decode('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'), decode('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'));
    expect(encode(result.cek)).toBe('oIhVW04MRdy2XN9CiKLxTg'); expect(encode(result.nonce)).toBe('4h_95klXJ5E_qnoN');
  });
  it('el receptor descifra el cuerpo y el delimitador usando su clave privada', async () => {
    const receiver = await keys(); const encrypted = await encryptWebPush('aviso privado', receiver.p256dh, receiver.auth);
    const salt = encrypted.slice(0, 16); expect(new DataView(encrypted.buffer).getUint32(16)).toBe(4096); expect(encrypted[20]).toBe(65);
    const serverPublic = encrypted.slice(21, 86); const imported = await crypto.subtle.importKey('raw', serverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: imported }, receiver.pair.privateKey, 256));
    const derived = await deriveWebPushKeys(shared, decode(receiver.auth), salt, receiver.raw, serverPublic);
    const aes = await crypto.subtle.importKey('raw', derived.cek, 'AES-GCM', false, ['decrypt']);
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: derived.nonce }, aes, encrypted.slice(86)));
    expect(plaintext.at(-1)).toBe(2); expect(new TextDecoder().decode(plaintext.slice(0, -1))).toBe('aviso privado');
    expect(new TextDecoder().decode(encrypted)).not.toContain('aviso privado');
  });
  it('firma VAPID verificable para el origen exacto y vencimiento de doce horas', async () => {
    const sender = await keys(); const vapid = await prepareVapid(sender.vapid); const authorization = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/token', vapid, 100_000);
    const jwt = authorization.match(/t=([^,]+)/)![1]!; const [header, claims, signature] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(new TextDecoder().decode(decode(claims)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: 43300, sub: 'mailto:admin@example.com' });
    const publicKey = await crypto.subtle.importKey('raw', sender.raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, decode(signature), encoder.encode(`${header}.${claims}`))).toBe(true);
  });
  it.each([[201, 'sent'], [404, 'invalid'], [410, 'invalid'], [429, 'retry'], [503, 'retry'], [307, 'failed']])('clasifica respuesta %i sin seguir redirecciones', async (status, outcome) => {
    const sender = await keys(); const request = vi.fn(async (_url, init) => { expect(init?.redirect).toBe('manual'); expect(new Headers(init?.headers).get('Content-Encoding')).toBe('aes128gcm'); return new Response(null, { status, headers: { 'Retry-After': '120' } }); }) as unknown as typeof fetch;
    const result = await sendWebPush({ endpoint: 'https://fcm.googleapis.com/fcm/send/token', p256dh: sender.p256dh, auth: sender.auth, payload: '{}', topic: 'notice-1' }, await prepareVapid(sender.vapid), request);
    expect(result).toEqual({ outcome, retryAfterSeconds: 120 });
  });
  it('limita el cuerpo, valida claves y rechaza endpoints internos antes de fetch', async () => {
    const sender = await keys(); await expect(encryptWebPush('a'.repeat(3001), sender.p256dh, sender.auth)).rejects.toThrow('large'); await expect(encryptWebPush('ok', 'B' + 'A'.repeat(86), sender.auth)).rejects.toBeInstanceOf(InvalidPushSubscription);
    const request = vi.fn(); await expect(sendWebPush({ endpoint: 'https://127.0.0.1/private', p256dh: sender.p256dh, auth: sender.auth, payload: '{}', topic: 'a' }, await prepareVapid(sender.vapid), request)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
  });
});
