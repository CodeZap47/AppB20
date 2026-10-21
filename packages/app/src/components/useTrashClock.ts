import { useEffect, useState } from 'react';
import { useDataSource } from '../data/DataContext';

/** El reloj local solo interpola una lectura del servidor; nunca decide permisos. */
export function useTrashClock(enabled: boolean) {
  const source = useDataSource();
  const [clock, setClock] = useState<{ server: number; local: number }>();
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    setClock(undefined); setError('');
    if (typeof source.getTrashClock !== 'function') { setError('Conecta con el servidor para comprobar el plazo.'); return; }
    void source.getTrashClock().then((date) => { if (!disposed) setClock({ server: date.getTime(), local: performance.now() }); }, () => { if (!disposed) setError('No se pudo comprobar el plazo. Vuelve a conectarte.'); });
    const timer = window.setInterval(() => setElapsed(performance.now()), 1000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [source, enabled]);
  return { now: clock ? new Date(clock.server + Math.max(0, (elapsed || performance.now()) - clock.local)) : undefined, error };
}
