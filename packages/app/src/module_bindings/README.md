# Bindings de SpacetimeDB

Esta carpeta la genera la CLI de SpacetimeDB a partir de `packages/spacetime-module`:

```bash
npm run spacetime:generate
```

No edites estos archivos a mano. Una vez generados, `src/lib/spacetime.tsx` puede usar
`DbConnection` y `tables` para conectar con `SpacetimeDBProvider` de `spacetimedb/react`.
