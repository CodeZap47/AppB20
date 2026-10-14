import { useState } from 'react';

/**
 * Ejecuta una acción y guarda el mensaje de error para mostrarlo junto al formulario. Espera
 * la respuesta: en la demo es inmediata y en SpacetimeDB llega del servidor.
 */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = async <T,>(fn: () => T | Promise<T>): Promise<T | undefined> => {
    setPending(true);
    try {
      const result = await fn();
      setError(null);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo salió mal.');
      return undefined;
    } finally {
      setPending(false);
    }
  };
  return { error, pending, run };
}

/**
 * Para acciones sin formulario donde mostrar el error (marcar como visto, reaccionar): no deja
 * una promesa rechazada sin atender y avisa en la consola.
 */
export function fire(result: unknown): void {
  if (result instanceof Promise) {
    result.catch((e: unknown) => console.error(e instanceof Error ? e.message : e));
  }
}
