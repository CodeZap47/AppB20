import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { DataSource, Snapshot } from './types';

const DataContext = createContext<DataSource | null>(null);

export function DataProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  return <DataContext value={source}>{children}</DataContext>;
}

export function useDataSource(): DataSource {
  const source = useContext(DataContext);
  if (!source) throw new Error('Falta DataProvider');
  return source;
}

export function useSnapshot(): Snapshot {
  const source = useDataSource();
  return useSyncExternalStore(
    (listener) => source.subscribe(listener),
    () => source.getSnapshot(),
  );
}
