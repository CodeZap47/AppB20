import { useEffect, useMemo, type ReactNode } from 'react';
import { config } from '../config';
import { DataProvider } from '../data/DataContext';
import { createSpacetimeDataSource } from '../data/spacetime';

/** The authenticated session and the real group cache have the same lifetime. */
export function SpacetimeProvider({ token, children }: { token: string; children: ReactNode }) {
  const source = useMemo(() => createSpacetimeDataSource({
    token, uri: config.spacetimeUri, database: config.spacetimeDb,
  }), [token]);
  useEffect(() => {
    source.connect();
    return () => source.disconnect();
  }, [source]);
  return <DataProvider source={source}>{children}</DataProvider>;
}
