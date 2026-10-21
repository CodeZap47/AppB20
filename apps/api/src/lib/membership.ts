import { env } from '../env.ts';

export interface MembershipOptions {
  uri: string;
  module: string;
  fetchFn?: typeof fetch;
}

/** Usa el token de la persona; no necesita ni conserva credenciales del propietario. */
export async function checkActiveMembership(token: string, options?: MembershipOptions): Promise<boolean> {
  const uri = new URL(options?.uri ?? env.spacetimeUri());
  if (uri.protocol === 'wss:') uri.protocol = 'https:';
  if (uri.protocol === 'ws:') uri.protocol = 'http:';
  if (!['http:', 'https:'].includes(uri.protocol) || uri.username || uri.password) {
    throw new Error('SPACETIMEDB_URI inválida');
  }
  const module = options?.module ?? env.spacetimeModule();
  if (!module.trim()) throw new Error('Falta SPACETIMEDB_MODULE');
  const url = new URL(`/v1/database/${encodeURIComponent(module)}/call/assert_active_member`, uri.origin);
  const response = await (options?.fetchFn ?? fetch)(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '[]',
    // Workers supports manual/follow; reject every redirect through the status check below.
    redirect: 'manual',
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 200) return true;
  // SpacetimeDB usa 530 cuando un reducer lanza SenderError (por ejemplo una baja).
  if ([400, 401, 403, 530].includes(response.status)) return false;
  // Un módulo inexistente, error de red o versión incorrecta no equivale a membresía válida.
  throw new Error(`No se pudo comprobar la membresía (${response.status})`);
}
