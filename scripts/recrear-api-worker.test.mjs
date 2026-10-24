import assert from 'node:assert/strict';
import { test } from 'node:test';
import { masterKeysJson, replaceVapidPublicKey, vapidPair } from './recrear-api-worker.mjs';

test('la clave maestra tiene 32 bytes en base64 bajo la versión indicada', () => {
  const keys = JSON.parse(masterKeysJson('v2'));
  assert.deepEqual(Object.keys(keys), ['v2']);
  assert.equal(Buffer.from(keys.v2, 'base64').length, 32);
  assert.notEqual(masterKeysJson('v2'), masterKeysJson('v2'));
});

test('el par VAPID usa el formato que espera el Worker', () => {
  const { publicKey, privateKey } = vapidPair();
  const point = Buffer.from(publicKey, 'base64url');
  assert.equal(point.length, 65);
  assert.equal(point[0], 4);
  assert.equal(Buffer.from(privateKey, 'base64url').length, 32);
  assert.doesNotMatch(publicKey + privateKey, /[=+/]/);
});

test('sustituye la clave pública en jsonc y en .env sin tocar lo demás', () => {
  const jsonc = '{\n  "VAPID_PUBLIC_KEY": "viejaA1",\n  "VITE_VAPID_PUBLIC_KEY": "viejaB2",\n  "OTRA": "x"\n}';
  const env = 'VITE_DATA_MODE=spacetime\nVITE_VAPID_PUBLIC_KEY=vieja\n';
  assert.equal(replaceVapidPublicKey(jsonc, 'nueva_-9'), '{\n  "VAPID_PUBLIC_KEY": "nueva_-9",\n  "VITE_VAPID_PUBLIC_KEY": "nueva_-9",\n  "OTRA": "x"\n}');
  assert.equal(replaceVapidPublicKey(env, 'nueva'), 'VITE_DATA_MODE=spacetime\nVITE_VAPID_PUBLIC_KEY=nueva\n');
});
