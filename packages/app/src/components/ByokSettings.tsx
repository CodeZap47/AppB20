import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AI_CONSENT_VERSION, AI_LIMITS, type AiKeyStatus, type AiStatus } from '@b20/core';
import { useSession } from '../auth/AuthContext';
import { config } from '../config';
import { AiClient } from '../data/aiClient';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { DemoDataSource } from '../data/demo';
import { AiPreparationPanel } from './AiPreparationPanel';
import './ai.css';

type UiAiStatus = AiStatus & { serviceConfigured?: boolean };
const demoStatus = (): UiAiStatus => ({ actor: 'simulado', enabled: false, configured: true, serviceConfigured: true, reason: 'Simulación local: Gemini real está desactivado.',
  model: 'simulado', limits: AI_LIMITS, consentVersion: AI_CONSENT_VERSION, consented: false });

export function ByokSettings() {
  const session = useSession();
  const data = useSnapshot();
  const simulated = useDataSource() instanceof DemoDataSource;
  const token = session?.status === 'signedIn' ? session.token : undefined;
  const account = `${data.me?.id ?? 'sin-miembro'}:${session?.status === 'signedIn' ? session.profile.subject : 'sin-sesion'}`;
  return <ByokAccountSettings key={account} token={token} simulated={simulated} active={data.me?.status === 'active'} />;
}

function ByokAccountSettings({ token, simulated, active }: { token?: string; simulated: boolean; active: boolean }) {
  const tokenRef = useRef(token); tokenRef.current = token;
  const client = useMemo(() => simulated ? undefined : new AiClient({ apiUrl: config.apiUrl, getToken: () => tokenRef.current }), [token, simulated]);
  const [status, setStatus] = useState<UiAiStatus | undefined>(simulated ? demoStatus : undefined);
  const [keyState, setKeyState] = useState<AiKeyStatus>({ configured: false });
  const [apiKey, setApiKey] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!simulated);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef(0);
  const keyInput = useRef<HTMLInputElement>(null);
  useEffect(() => { const field = keyInput.current; return () => { if (field) field.value = ''; }; }, [client]);
  const sessionRevision = useMemo(() => crypto.randomUUID(), [token]);

  useEffect(() => {
    const request = ++operation.current;
    setApiKey(''); setError(''); setNotice(''); setBusy(false);
    if (simulated) return;
    setStatus(undefined); setKeyState({ configured: false }); setConsent(false);
    if (!active || !token || !client) { setLoading(false); return () => client?.cancelPending(); }
    setLoading(true);
    void Promise.all([client.request<UiAiStatus>('/ai/status'), client.request<AiKeyStatus>('/ai/key')]).then(([nextStatus, nextKey]) => {
      if (operation.current !== request) return;
      setStatus(nextStatus); setKeyState(nextKey); setConsent(nextStatus.consented);
    }).catch((failure: unknown) => {
      if (operation.current === request && !(failure instanceof DOMException && failure.name === 'AbortError')) setError(failure instanceof Error ? failure.message : 'No se pudo consultar el servicio de IA.');
    }).finally(() => { if (operation.current === request) setLoading(false); });
    return () => { operation.current++; client.cancelPending(); };
  }, [client, token, simulated, active]);

  const mutate = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    const request = ++operation.current;
    setBusy(true); setError(''); setNotice('');
    try { await action(); if (operation.current === request) setNotice(success); }
    catch (failure) {
      if (operation.current === request && !(failure instanceof DOMException && failure.name === 'AbortError')) setError(failure instanceof Error ? failure.message : 'No se pudo guardar el cambio.');
    } finally { if (operation.current === request) setBusy(false); }
  };
  const saveKey = (event: FormEvent) => {
    event.preventDefault();
    const submitted = apiKey; setApiKey('');
    if (simulated || !client || !status || status.serviceConfigured === false || !status.consented || !submitted.trim()) return;
    void mutate(async () => {
      await client.request('/ai/key', 'PUT', { apiKey: submitted });
      const next = await client.request<AiKeyStatus>('/ai/key'); setKeyState(next);
    }, 'Clave guardada. Su contenido no vuelve a mostrarse. No se hizo una llamada de prueba a Gemini.');
  };
  const deleteKey = () => {
    setApiKey('');
    void mutate(async () => {
      if (!simulated) { await client!.request('/ai/key', 'DELETE'); setKeyState(await client!.request<AiKeyStatus>('/ai/key')); }
      else setKeyState({ configured: false });
    }, 'Clave eliminada. Se invalidaron las operaciones pendientes; una solicitud ya enviada al proveedor puede continuar.');
  };
  const saveConsent = () => void mutate(async () => {
    if (simulated) setStatus((current) => current ? { ...current, consented: consent } : current);
    else {
      await client!.request('/ai/consent', 'PUT', { version: status!.consentVersion, accepted: consent });
      setStatus(await client!.request<UiAiStatus>('/ai/status'));
    }
  }, consent ? 'Consentimiento registrado.' : 'Consentimiento retirado.');

  return <>
    <section className="panel settings" aria-label="Gemini con clave personal">
      <h2>Gemini (BYOK)</h2>
      <p>Cada alumno usa su propia clave. Se guarda cifrada en el servidor y nunca vuelve a mostrarse. Las funciones del grupo siguen disponibles sin configurar IA.</p>
      {loading && <p role="status">Consultando la configuración de IA…</p>}
      {!active && <p className="ai-notice">Necesitas acceso vigente al grupo para administrar IA.</p>}
      {simulated && <p className="ai-notice">Simulación local: no introduzcas claves reales. Los cambios son ficticios y no se guardan ni se envían.</p>}
      {status && <>
        <p className="ai-notice" role="status">{status.enabled ? 'La generación con IA está habilitada para el grupo.' : status.reason || 'La generación con IA todavía no está habilitada para el grupo.'}</p>
        <p>Modelo previsto: <strong>{status.model || 'Pendiente de configurar'}</strong>. Clave propia: <strong>{keyState.configured ? 'Configurada' : 'Sin configurar'}</strong>.</p>
        <p className="field__hint">Hasta {status.limits.maxSources} fuentes y {status.limits.maxCharacters.toLocaleString('es-MX')} caracteres por preparación; {status.limits.maxOutputTokens.toLocaleString('es-MX')} tokens de salida por generación.</p>
        <p className="field__hint">Límites de la app por persona: {status.limits.maxConcurrent} generación simultánea, {status.limits.requestsPerHour} por hora, {status.limits.requestsPerDay} por día y {status.limits.dailyEstimatedTokens.toLocaleString('es-MX')} tokens estimados diarios. Son controles de consumo, no una garantía de cargos del proveedor.</p>
      </>}
      {simulated ? <div className="form__actions"><button type="button" disabled={keyState.configured || !active || busy} onClick={() => { setKeyState({ configured: true }); setNotice('Clave ficticia configurada solo durante esta simulación.'); }}>Usar clave simulada</button>
        {keyState.configured && <button type="button" disabled={busy} onClick={deleteKey}>Eliminar clave simulada</button>}</div> : <form className="form" onSubmit={saveKey} autoComplete="off">
        <label className="field"><span>{keyState.configured ? 'Nueva clave de Gemini' : 'Clave personal de Gemini'}</span><input ref={keyInput} type="password" value={apiKey} autoComplete="new-password" spellCheck={false} autoCapitalize="none" minLength={20} maxLength={256}
          disabled={loading || busy || !status || status.serviceConfigured === false || !active} onChange={(event) => setApiKey(event.target.value)} /></label>
        <p className="field__hint">Registra abajo el consentimiento vigente antes de guardar una clave. Se borra del formulario al enviar, cancelar, cambiar de sesión o salir de esta pantalla. Guardarla no hace una llamada de prueba.</p>
        <div className="form__actions"><button type="submit" disabled={!apiKey.trim() || busy || !status?.consented || status.serviceConfigured === false || !active}>{keyState.configured ? 'Sustituir clave' : 'Guardar clave'}</button>
          <button type="button" className="button--secondary" onClick={() => { setApiKey(''); setNotice('Campo de clave limpiado.'); }}>Cancelar</button>
          {keyState.configured && <button type="button" disabled={busy || !active} onClick={deleteKey}>Eliminar clave</button>}</div>
      </form>}
      {status && <fieldset disabled={busy || loading || !active || status.serviceConfigured === false} className="ai-consent">
        <legend>Consentimiento para usar IA · versión {status.consentVersion}</legend>
        <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />Entiendo que, al confirmar una generación, el texto que revise y mi clave se usarán para solicitar guías o explicaciones a Google Gemini. Revisaré los fragmentos antes de enviarlos.</label>
        <p className="field__hint">Este consentimiento es individual. La administración debe confirmar por separado la elegibilidad del grupo y habilitar el servicio. La generación real comienza desactivada.</p>
        <button type="button" disabled={consent === status.consented} onClick={saveConsent}>{consent ? 'Guardar consentimiento' : 'Retirar consentimiento'}</button>
      </fieldset>}
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
    <AiPreparationPanel key={sessionRevision} client={client} status={status} simulated={simulated} />
  </>;
}
