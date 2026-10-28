import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { DataSource, Snapshot } from './types';
import { clearChatDrafts } from '../lib/chatDrafts';
import { clearVisualSceneDrafts } from '../lib/visualSceneDrafts';

const DataContext = createContext<DataSource | null>(null);

export function DataProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  useEffect(() => {
    if (typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function') return;
    let owner = source.getSnapshot().me?.id;
    const unsubscribe = source.subscribe(() => {
      const next = source.getSnapshot().me?.id;
      // An empty snapshot can also mean reconnecting: keep the owner's recovery draft.
      if (owner && next && next !== owner) { clearChatDrafts(); void clearVisualSceneDrafts(); }
      if (next) owner = next;
    });
    return () => { unsubscribe(); clearChatDrafts(); };
  }, [source]);
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
