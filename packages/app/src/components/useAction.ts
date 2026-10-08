import { useState } from 'react';

/** Ejecuta una acción y guarda el mensaje de error para mostrarlo junto al formulario. */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const run = <T,>(fn: () => T): T | undefined => {
    try {
      const result = fn();
      setError(null);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo salió mal.');
      return undefined;
    }
  };
  return { error, run };
}
