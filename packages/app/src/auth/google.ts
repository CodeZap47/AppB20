/**
 * Google Identity Services (GIS) para la web: botón «Iniciar sesión con Google», elección
 * automática de la cuenta (FedCM) y renovación del token sin mostrar nada.
 * https://developers.google.com/identity/gsi/web/reference/js-reference
 */

interface CredentialResponse {
  credential?: string;
}

interface PromptNotification {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
}

interface GoogleIdApi {
  initialize(options: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    auto_select?: boolean;
    use_fedcm_for_prompt?: boolean;
    cancel_on_tap_outside?: boolean;
    itp_support?: boolean;
  }): void;
  prompt(listener?: (notification: PromptNotification) => void): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
let loading: Promise<GoogleIdApi> | undefined;

function loadScript(): Promise<GoogleIdApi> {
  loading ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.google?.accounts?.id
        ? resolve(window.google.accounts.id)
        : reject(new Error('Google no cargó el inicio de sesión.'));
    script.onerror = () => {
      loading = undefined;
      reject(new Error('No se pudo cargar el inicio de sesión de Google. Revisa tu conexión.'));
    };
    document.head.append(script);
  });
  return loading;
}

export interface GoogleSignIn {
  /** Dibuja el botón oficial dentro del elemento. */
  renderButton(parent: HTMLElement): void;
  /** Elige sola la cuenta si ya diste permiso antes; si no puede, llama a `onUnavailable`. */
  promptSilently(onUnavailable: () => void): void;
  disableAutoSelect(): void;
}

/** Inicializa GIS una vez; cada token que entregue Google llega a `onToken`. */
export async function initGoogleSignIn(
  clientId: string,
  onToken: (token: string) => void,
): Promise<GoogleSignIn> {
  const id = await loadScript();
  id.initialize({
    client_id: clientId,
    callback: (response) => {
      if (response.credential) onToken(response.credential);
    },
    auto_select: true,
    use_fedcm_for_prompt: true,
    cancel_on_tap_outside: false,
    itp_support: true,
  });
  return {
    renderButton(parent) {
      id.renderButton(parent, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        locale: 'es-419',
      });
    },
    promptSilently(onUnavailable) {
      id.prompt((n) => {
        if (n.isNotDisplayed?.() || n.isSkippedMoment?.() || n.isDismissedMoment?.())
          onUnavailable();
      });
    },
    disableAutoSelect: () => id.disableAutoSelect(),
  };
}
