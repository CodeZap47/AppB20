import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';

describe('criptografía de notificaciones en el runtime Cloudflare', () => {
  it('ejecuta HKDF, ECDH, AES128GCM y VAPID en workerd con el vector RFC', async () => {
    const code = `
      import { deriveWebPushKeys, decodePushBase64 as d, encodePushBase64 as e, encryptWebPush, prepareVapid, vapidAuthorization } from './webPush.ts';
      export default { async fetch() {
        const keys = await deriveWebPushKeys(d('kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs'),d('BTBZMqHH6r4Tts7J_aSIgg'),d('DGv6ra1nlYgDCS1FRnbzlw'),d('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),d('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'));
        const encrypted = await encryptWebPush('aviso', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg');
        const vapid = await prepareVapid({publicKey:'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',privateKey:'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',subject:'mailto:admin@example.com'});
        const authorization = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/token', vapid);
        return Response.json({cek:e(keys.cek),nonce:e(keys.nonce),encryptedLength:encrypted.length,vapid:authorization.startsWith('vapid t=')});
      }};`;
    const bundle = await build({ stdin: { contents: code, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
    const worker = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-10-21', compatibilityFlags: ['nodejs_compat'] }));
    try { const response = await worker.dispatchFetch('https://notifications.example.test'); expect(response.status, await response.clone().text()).toBe(200); expect(await response.json()).toEqual({ cek: 'oIhVW04MRdy2XN9CiKLxTg', nonce: '4h_95klXJ5E_qnoN', encryptedLength: 108, vapid: true }); }
    finally { await worker.dispose(); }
  }, 30000);
});
