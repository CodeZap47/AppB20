import type { ReactNode } from 'react';

/**
 * Conexión con SpacetimeDB.
 *
 * Pendiente de la Etapa 0: generar los bindings (`npm run spacetime:generate`) y envolver la app
 * con `SpacetimeDBProvider` de `spacetimedb/react`, usando `DbConnection.builder()` con
 * `config.spacetimeUri`, `config.spacetimeDb` y el token OIDC de Google de la sesión.
 * Las lecturas deben suscribirse a las vistas (`members`, `group_messages`,
 * `my_direct_messages`, etc.), no a las tablas, que son privadas.
 */
export function SpacetimeProvider({ children }: { children: ReactNode }) {
  return children;
}
