# Bindings de SpacetimeDB

Esta carpeta la genera la CLI de SpacetimeDB a partir de `packages/spacetime-module`:

```bash
npm run spacetime:generate
```

Los archivos generados están incluidos en el repositorio. No los edites a mano: vuelve a
generarlos cuando cambie el módulo, con una CLI compatible con el SDK (2.11 o posterior).
`src/data/spacetime.ts` usa `DbConnection` para suscribirse exclusivamente a las vistas
públicas y autorizadas; `src/lib/spacetime.tsx` vincula esa conexión a la sesión de Supabase Auth.
