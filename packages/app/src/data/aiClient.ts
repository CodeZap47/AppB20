/** No key, token, prepared material or response is persisted in browser storage. */
export interface AiClientOptions {
  apiUrl: string;
  getToken(): string | undefined;
  fetch?: typeof fetch;
}
export class AiClientError extends Error {
  constructor(readonly code: string, message: string, readonly recoverable = true) { super(message); this.name = 'AiClientError'; }
}
const MESSAGES: Record<string, string> = {
  invalid: 'Revisa la selección y los datos antes de continuar.',
  unavailable: 'El servicio de IA o una fuente no está disponible. Revisa su configuración y tus permisos.',
  conflict: 'El material cambió. Prepara la selección nuevamente.',
  expired: 'La preparación venció. Prepara el material nuevamente.',
  quota: 'Se alcanzó un límite de la app. Reduce la selección o espera antes de continuar.',
  consent: 'Revisa y acepta el consentimiento vigente para continuar.',
  unauthorized: 'Tu sesión venció. Inicia sesión de nuevo.',
  forbidden: 'Ya no tienes acceso a este material.',
  source_unavailable: 'Una fuente cambió o ya no está disponible. Prepara el material nuevamente.',
  source_changed: 'Una fuente cambió. Revisa la selección y prepara el material nuevamente.',
  preparation_expired: 'La vista previa venció. Prepara el material nuevamente.',
  invalid_request: 'Revisa la selección y los datos antes de continuar.',
  invalid_key: 'La clave no tiene el formato esperado. Revisa el valor e inténtalo de nuevo.',
  service_unavailable: 'El servicio de IA todavía no está configurado. Puedes consultar el resto de la app.',
  disabled: 'La generación con IA todavía no está habilitada para el grupo.',
  limit_exceeded: 'Se alcanzó un límite. Reduce la selección o consulta los límites del servicio.',
  consent_required: 'Revisa y acepta el consentimiento vigente para continuar.',
  unknown_confirmation_required: 'Hay otro envío de IA con resultado incierto. Consulta su estado y confirma expresamente el posible consumo adicional antes de continuar.',
};

export class AiClient {
  private readonly controllers = new Set<AbortController>();
  private disposed = false;
  constructor(private readonly options: AiClientOptions) {}

  /** Called on account/token change and unmount so late responses cannot reach another session. */
  cancelPending(): void { for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
  dispose(): void { this.disposed = true; this.cancelPending(); }

  async request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const token = this.options.getToken();
    if (this.disposed || !token) throw new AiClientError('unauthorized', MESSAGES.unauthorized!);
    if (!this.options.apiUrl) throw new AiClientError('service_unavailable', MESSAGES.service_unavailable!);
    const controller = new AbortController();
    this.controllers.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const response = await (this.options.fetch ?? fetch)(`${this.options.apiUrl.replace(/\/$/, '')}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
      });
      this.assertSession(token, controller.signal);
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { code?: string; error?: { code?: string; recoverable?: boolean } } | null;
        this.assertSession(token, controller.signal);
        const code = data?.error?.code ?? data?.code ?? (response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : 'request_failed');
        // Server/proxy details are deliberately not echoed: they may contain submitted secrets.
        throw new AiClientError(code, MESSAGES[code] ?? 'No se pudo completar la operación de IA. Revisa la selección e inténtalo de nuevo.', data?.error?.recoverable !== false);
      }
      const result = response.status === 204 ? undefined as T : await response.json() as T;
      this.assertSession(token, controller.signal);
      return result;
    } catch (error) {
      if (controller.signal.aborted || this.disposed || this.options.getToken() !== token) throw new DOMException('La operación se canceló.', 'AbortError');
      if (error instanceof AiClientError) throw error;
      throw new AiClientError('network', 'No se pudo contactar al servicio de IA. Comprueba la conexión.');
    } finally {
      signal?.removeEventListener('abort', abort);
      this.controllers.delete(controller);
    }
  }

  private assertSession(token: string, signal: AbortSignal) {
    if (signal.aborted || this.disposed || this.options.getToken() !== token) throw new DOMException('La sesión cambió.', 'AbortError');
  }
}
