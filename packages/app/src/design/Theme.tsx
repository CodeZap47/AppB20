import { useEffect, type ReactNode } from 'react';

/** Aplica la edición visual Campus, la única de la app. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.brand = 'campus';
  }, []);
  return children;
}
