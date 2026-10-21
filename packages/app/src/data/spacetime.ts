import { DbConnection } from '../module_bindings';
import type { Actions, Snapshot } from './types';
import { createSpacetimeActions } from './spacetimeActions';
import { emptySnapshot, PUBLIC_VIEWS, readSnapshot } from './spacetimeSnapshot';
import { ResourceTransport } from './resourceTransport';
import { config } from '../config';

export interface ConnectionOptions {
  uri: string;
  database: string;
  token: string;
  /** El adaptador heredado toma el token renovado en cada solicitud. */
  getToken?: () => string | undefined;
  apiUrl?: string;
}

export interface ConnectionCallbacks {
  connected: (connection: DbConnection, identity: string) => void;
  failed: () => void;
}

/** Injectable transport so permission and disconnect behavior can be tested without an account. */
export type ConnectionFactory = (
  options: ConnectionOptions,
  callbacks: ConnectionCallbacks,
) => DbConnection;

const openConnection: ConnectionFactory = (options, callbacks) => DbConnection.builder()
  .withUri(options.uri)
  .withDatabaseName(options.database)
  .withToken(options.token)
  .onConnect((connection, identity) => callbacks.connected(connection, identity.toHexString()))
  .onConnectError(() => callbacks.failed())
  .onDisconnect(() => callbacks.failed())
  .build();

/** A session owns one cache. Disconnecting or signing out always discards that cache. */
export class SpacetimeDataSource {
  readonly label = 'Grupo B20';
  private snapshot: Snapshot = emptySnapshot('connecting');
  private listeners = new Set<() => void>();
  private connection?: DbConnection;
  private identity = '';
  private generation = 0;
  private ready = false;
  private refreshQueued = false;

  constructor(
    private options: ConnectionOptions,
    private factory: ConnectionFactory = openConnection,
  ) {}

  getSnapshot = (): Snapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private emit(snapshot: Snapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  getIdentity = (): string => this.identity;
  getConnection = (): DbConnection => {
    if (!this.ready || !this.connection || this.snapshot.connection !== 'ready') {
      throw new Error('Espera a que se restablezca la conexión con el grupo.');
    }
    return this.connection;
  };

  connect() {
    this.disconnect();
    const generation = this.generation;
    this.emit(emptySnapshot('connecting'));
    if (!this.options.token) {
      this.fail(generation, 'Inicia sesión para conectar con el grupo.');
      return;
    }
    try {
      const connection = this.factory(this.options, {
        connected: (connected, identity) => {
          if (generation !== this.generation) { connected.disconnect(); return; }
          this.connection = connected;
          this.identity = identity;
          const changed = () => this.queueRefresh(generation);
          // Only public, permission-filtered views exist in the generated client.
          for (const table of new Set(Object.values(connected.db))) {
            table.onInsert(changed);
            table.onDelete(changed);
            table.onUpdate(changed);
          }
          connected.subscriptionBuilder()
            .onApplied(() => {
              if (generation !== this.generation) return;
              this.ready = true;
              this.refresh(generation);
            })
            .onError(() => this.fail(generation,
              'No se pudo cargar el grupo. Comprueba la configuración de acceso y vuelve a conectar.'))
            .subscribe(PUBLIC_VIEWS.map((view) => `SELECT * FROM ${view}`));
        },
        failed: () => this.fail(generation,
          'No se pudo conectar con el grupo. Revisa tu conexión y vuelve a intentarlo.'),
      });
      if (generation === this.generation) this.connection = connection;
      else connection.disconnect();
    } catch {
      this.fail(generation, 'No se pudo iniciar la conexión con el grupo.');
    }
  }

  private queueRefresh(generation: number) {
    if (this.refreshQueued || !this.ready || generation !== this.generation) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      this.refresh(generation);
    });
  }

  private refresh(generation: number) {
    if (!this.ready || !this.connection || generation !== this.generation) return;
    try {
      this.emit(readSnapshot(this.connection, this.identity));
    } catch {
      this.fail(generation, 'Los datos del grupo requieren una actualización. Vuelve a conectar.');
    }
  }

  private fail(generation: number, message: string) {
    if (generation !== this.generation) return;
    this.disconnect();
    this.emit(emptySnapshot('offline', message));
  }

  disconnect() {
    ++this.generation;
    this.ready = false;
    this.refreshQueued = false;
    this.identity = '';
    const previous = this.connection;
    this.connection = undefined;
    previous?.disconnect();
    this.emit(emptySnapshot('offline'));
  }
}

export function createSpacetimeDataSource(options: ConnectionOptions, factory?: ConnectionFactory) {
  const source = new SpacetimeDataSource(options, factory);
  const legacyApiUrl = options.apiUrl ?? config.apiUrl;
  const files = new ResourceTransport({ getConnection: source.getConnection, getIdentity: source.getIdentity,
    legacy: legacyApiUrl ? { apiUrl: legacyApiUrl, getToken: options.getToken ?? (() => options.token) } : undefined });
  return Object.assign(source, createSpacetimeActions(source.getConnection, source.getIdentity, files)) as
    SpacetimeDataSource & Actions;
}
