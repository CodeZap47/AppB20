import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SUPABASE_ISSUER, identityFromClaims, linkCommand } from './supabase-identity.mjs';

const uid = '6f1c2b8e-3d4a-4c5b-9e7f-0a1b2c3d4e5f';

test('la identidad tiene el formato de SpacetimeDB y es determinista', () => {
  const identity = identityFromClaims(SUPABASE_ISSUER, uid);
  assert.match(identity, /^0xc200[0-9a-f]{60}$/);
  assert.equal(identityFromClaims(SUPABASE_ISSUER, uid), identity);
});

test('cambiar emisor o sujeto produce otra identidad', () => {
  const identity = identityFromClaims(SUPABASE_ISSUER, uid);
  assert.notEqual(identityFromClaims('https://zyxwvutsrqponmlkjihg.supabase.co/auth/v1', uid), identity);
  assert.notEqual(identityFromClaims(SUPABASE_ISSUER, uid.replace(/f$/, 'e')), identity);
});

test('el comando pasa ambas identidades como cadenas JSON', () => {
  assert.equal(
    linkCommand('0xc200aa', '0xc200bb'),
    `spacetime call -s maincloud app-b20-34245 link_auth_identity '"0xc200aa"' '"0xc200bb"'`,
  );
});
