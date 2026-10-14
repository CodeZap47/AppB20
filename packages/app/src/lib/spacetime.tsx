import { useEffect, useState } from 'react';
import { config } from '../config';
import { SpacetimeDataSource, type SpacetimeConnection } from '../data/spacetime';

/**
 * Conexión con SpacetimeDB. Usa `DbConnection` de los bindings generados con
 * `npm run spacetime:generate`; se cargan con `import.meta.glob` para que la app compile
 * aunque todavía no existan (entonces avisa en vez de conectar).
 */
const bindings = import.meta.glob('../module_bindings/index.ts');

interface ConnectionBuilder {
  withUri(uri: string): ConnectionBuilder;
  withDatabaseName(name: string): ConnectionBuilder;
  withToken(token: string): ConnectionBuilder;
  onConnect(cb: () => void): ConnectionBuilder;
  onConnectError(cb: (ctx: unknown, error: Error) => void): ConnectionBuilder;
  onDisconnect(cb: (ctx: unknown, error?: Error) => void): ConnectionBuilder;
  build(): SpacetimeConnection;
}

/** Espera entre reintentos de conexión; crece hasta 30 s. */
const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export type SpacetimeState =
  | { status: 'connecting' }
  | { status: 'connected'; source: SpacetimeDataSource }
  | { status: 'error'; message: string };

/**
 * Conecta con el token de la sesión y reconecta solo si se cae, con el token vigente en ese
 * momento (`getToken`), porque el de Google cambia cada hora.
 */
export function useSpacetimeSource(getToken: () => string | undefined): SpacetimeState {
  const [state, setState] = useState<SpacetimeState>({ status: 'connecting' });

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: SpacetimeDataSource | undefined;

    const load = bindings['../module_bindings/index.ts'];
    if (!load) {
      setState({
        status: 'error',
        message: 'Faltan los bindings de SpacetimeDB (npm run spacetime:generate).',
      });
      return;
    }

    let generation = 0;
    const retry = (from: number) => {
      // Solo reintenta la conexión vigente; las anteriores ya se reemplazaron.
      if (stopped || from !== generation) return;
      generation++;
      current?.setConnection('offline');
      const wait = RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)];
      timer = setTimeout(connect, wait);
    };

    const connect = async () => {
      const token = getToken();
      if (stopped || !token) return;
      const mod = (await load()) as { DbConnection: { builder(): ConnectionBuilder } };
      if (stopped) return;
      const mine = generation;
      const conn = mod.DbConnection.builder()
        .withUri(config.spacetimeUri)
        .withDatabaseName(config.spacetimeDb)
        .withToken(token)
        .onConnect(() => {
          attempt = 0;
        })
        .onConnectError((_ctx, error) => {
          console.error('SpacetimeDB:', error.message);
          retry(mine);
        })
        .onDisconnect(() => retry(mine))
        .build();
      const source = new SpacetimeDataSource(conn);
      current?.disconnect();
      current = source;
      setState({ status: 'connected', source });
    };

    void connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      current?.disconnect();
    };
  }, [getToken]);

  return state;
}
