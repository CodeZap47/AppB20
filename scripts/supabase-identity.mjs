#!/usr/bin/env node
// Calcula la identidad de SpacetimeDB que tendrá una cuenta de Supabase y prepara el comando
// link_auth_identity. No llama a Maincloud: el propietario revisa y ejecuta el comando.
import { blake3 } from '@noble/hashes/blake3.js';
import { pathToFileURL } from 'node:url';

export const SUPABASE_ISSUER = 'https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1';
const DATABASE = 'app-b20-34245';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDENTITY = /^(?:0x)?c200[0-9a-f]{60}$/;

/**
 * Misma derivación que `Identity::from_claims` de SpacetimeDB: blake3 de `iss|sub`, prefijo
 * 0xc200 y suma de comprobación. Se verificó contra la identidad de la CLI el 22 de octubre de 2026.
 */
export function identityFromClaims(issuer, subject) {
  const id = blake3(new TextEncoder().encode(`${issuer}|${subject}`)).slice(0, 26);
  const checksumInput = new Uint8Array(28);
  checksumInput.set([0xc2, 0x00]);
  checksumInput.set(id, 2);
  const identity = new Uint8Array(32);
  identity.set([0xc2, 0x00]);
  identity.set(blake3(checksumInput).slice(0, 4), 2);
  identity.set(id, 6);
  return `0x${Buffer.from(identity).toString('hex')}`;
}

export function linkCommand(sessionIdentity, memberIdentity) {
  return `spacetime call -s maincloud ${DATABASE} link_auth_identity '"${sessionIdentity}"' '"${memberIdentity}"'`;
}

function main(args) {
  const [uid, flag, member] = args.map((value) => value.trim().toLowerCase());
  if (!uid || !UUID.test(uid) || (flag && flag !== '--member')) {
    console.error('Uso: npm run spacetime:supabase-identity -- <user-uid-de-supabase> [--member <identidad-del-miembro>]');
    process.exit(1);
  }
  const session = identityFromClaims(SUPABASE_ISSUER, uid);
  console.log(`Identidad de sesión con Supabase: ${session}`);
  if (!member) {
    console.log('\nMiembros actuales, para elegir a quién corresponde:');
    console.log(`  spacetime sql -s maincloud ${DATABASE} "SELECT identity, display_name FROM member WHERE status = 'active'"`);
    return;
  }
  if (!IDENTITY.test(member)) {
    console.error('La identidad del miembro debe ser el hex de 64 caracteres que empieza con c200.');
    process.exit(1);
  }
  console.log('\nRevisa la correspondencia y ejecuta:');
  console.log(`  ${linkCommand(session, member.startsWith('0x') ? member : `0x${member}`)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
