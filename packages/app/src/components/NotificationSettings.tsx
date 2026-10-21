import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_KINDS, NOTIFICATION_TITLES } from '@b20/core';
import type { NotificationPreferencesInput } from '../data/notificationTypes';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';
import { usePlatform } from './PlatformContext';
import { webPushSupport } from '../lib/notifications';
import { browserPushInstallationId, disableBrowserPush, enableBrowserPush } from '../lib/browserPush';
import { config } from '../config';

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const TIME_ZONES: string[] = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } })();
const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
export function NotificationSettings() {
  const data = useSnapshot(); const source = useDataSource(); const platform = usePlatform();
  const simulated = source instanceof DemoDataSource;
  const saved = (): NotificationPreferencesInput => ({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...data.notificationPreferences, expectedVersion: data.notificationPreferences?.version ?? 0 });
  const [form, setForm] = useState(saved);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!dirty) setForm(saved());
  }, [data.notificationPreferences?.version, dirty]);
  function change(patch: Partial<NotificationPreferencesInput>) { setDirty(true); setForm((current) => ({ ...current, ...patch })); }
  async function run(task: () => unknown | Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try { await task(); setNotice(success); } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar. Inténtalo de nuevo.'); }
    finally { setBusy(false); }
  }
  const support = platform === 'web' ? webPushSupport() : undefined;
  const ownBrowserId = data.me && browserPushInstallationId(data.me.id);
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <section className="panel settings" aria-labelledby="notifications-settings-title"><h2 id="notifications-settings-title">Avisos y recordatorios</h2>
    <p className="muted">La <Link to="/m/avisos">bandeja de avisos</Link> está disponible sin activar notificaciones del dispositivo. Los mensajes privados usan texto genérico.</p>
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form className="form" onSubmit={(event) => { event.preventDefault(); void run(async () => { await source.saveNotificationPreferences(form); setDirty(false); }, 'Preferencias guardadas.'); }}>
      <fieldset className="form settings-group" disabled={busy}><legend className="field__label">Horario</legend>
        <label className="field"><span className="field__label">Zona horaria</span>
          <span className="row"><input list="notification-time-zones" value={form.timeZone} onChange={(event) => change({ timeZone: event.target.value })} placeholder="America/Tijuana" required />
            {deviceZone && deviceZone !== form.timeZone && <button type="button" className="link-button" onClick={() => change({ timeZone: deviceZone })}>Usar la de este dispositivo ({deviceZone})</button>}</span>
          <span className="field__hint">Las horas de recordatorio y descanso se interpretan en esta zona, incluidos los cambios de horario.</span></label>
        <datalist id="notification-time-zones">{TIME_ZONES.map((zone) => <option key={zone} value={zone} />)}</datalist>
        <div className="settings-times">
          <label className="field"><span className="field__label">Hora de recordatorios</span><input type="time" value={clock(form.reminderMinute)} onChange={(event) => change({ reminderMinute: minute(event.target.value) })} required /></label>
          <label className="field"><span className="field__label">Inicio del descanso</span><input type="time" value={clock(form.quietStartMinute)} onChange={(event) => change({ quietStartMinute: minute(event.target.value) })} required /></label>
          <label className="field"><span className="field__label">Fin del descanso</span><input type="time" value={clock(form.quietEndMinute)} onChange={(event) => change({ quietEndMinute: minute(event.target.value) })} required /></label>
        </div>
        <p className="field__hint">Durante el descanso los avisos quedan en tu bandeja y se pospone el envío al dispositivo. Dos horas iguales desactivan el descanso.</p>
      </fieldset>
      <fieldset className="form settings-group" disabled={busy}><legend className="field__label">Qué avisos recibir</legend>
        <div className="settings-checks">{NOTIFICATION_KINDS.map((kind) => <label key={kind} className="check"><input type="checkbox" checked={form.enabledKinds.includes(kind)} onChange={(event) => change({ enabledKinds: event.target.checked ? [...form.enabledKinds, kind] : form.enabledKinds.filter((value) => value !== kind) })} />{NOTIFICATION_TITLES[kind]}</label>)}</div>
        <label className="check"><input type="checkbox" checked={form.pushEnabled} onChange={(event) => change({ pushEnabled: event.target.checked })} />Enviar también a mis dispositivos registrados</label>
      </fieldset>
      <div className="form__actions">
        {dirty && <span className="muted form__note">Cambios sin guardar.</span>}
        {dirty && <button type="button" className="secondary" disabled={busy} onClick={() => { setDirty(false); setForm(saved()); }}>Recargar preferencias guardadas</button>}
        <button type="submit" disabled={busy}>Guardar preferencias</button>
      </div>
    </form>
    <h3>Este dispositivo</h3>
    {simulated ? <p className="muted">En la simulación se comprueba la bandeja; no se registran ni envían notificaciones externas.</p>
      : platform !== 'web' ? <p className="muted">Usa la bandeja dentro de la aplicación. Puedes activar Web Push desde la web/PWA en un navegador compatible.</p>
      : support?.kind === 'needs-install' ? <p>{support.reason} <Link to="/instalar">Ver instalación</Link></p>
      : support?.kind === 'unsupported' ? <p>{support.reason}</p>
      : !config.vapidPublicKey ? <p className="muted">El envío a dispositivos aún no está configurado. Tu bandeja sigue disponible.</p>
      : <div className="row"><button type="button" disabled={busy || !data.me || !data.notificationPreferences?.pushEnabled} onClick={() => { if (data.me) void run(() => enableBrowserPush(data.me!.id, config.vapidPublicKey, (input) => source.registerPushInstallation(input)), 'Dispositivo registrado.'); }}>Activar en este dispositivo</button>
          <button type="button" className="secondary" disabled={busy || !ownBrowserId || !data.me} onClick={() => { if (data.me) void run(() => disableBrowserPush(data.me!.id, (id) => source.removePushInstallation(id)), 'Dispositivo desactivado.'); }}>Desactivar en este dispositivo</button></div>}
    {!simulated && !data.notificationPreferences?.pushEnabled && <p className="field__hint">Guarda la opción de enviar a dispositivos antes de activar este navegador.</p>}
    {data.pushInstallations.length > 0 && <ul className="plain-list">{data.pushInstallations.map((installation) => <li key={installation.id} className="row row--between"><span className="settings-person"><span className="settings-person__name">{installation.label}</span><span className={installation.enabled ? 'badge badge--group' : 'badge'}>{installation.enabled ? 'Activo' : 'Desactivado'}</span></span>
      <button type="button" className="link-button" disabled={busy} aria-label={`Retirar ${installation.label}`} onClick={() => void run(() => source.removePushInstallation(installation.id), 'Instalación retirada.')}>Retirar</button></li>)}</ul>}
    <div className="form__actions"><button type="button" className="secondary" disabled={busy} onClick={() => void run(() => source.requestNotificationTest(), 'Prueba solicitada. Consulta tu bandeja de avisos.')}>Probar mis avisos</button></div>
  </section>;
}
