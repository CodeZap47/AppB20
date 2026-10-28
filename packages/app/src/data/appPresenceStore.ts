import type { DbConnection } from '../module_bindings';

export const APP_PRESENCE_RENEW_MS = 5000;
export interface AppPresenceEnvironment {
  isForeground(): boolean;
  subscribe(listener: () => void): () => void;
}
interface NativeApp {
  getState(): Promise<{ isActive: boolean }>;
  addListener(event: 'appStateChange', listener: (state: { isActive: boolean }) => void): Promise<{ remove(): Promise<void> }>;
}
type Publish = (input: { active: boolean; revision: bigint }) => unknown;

/** Foreground is global to the app, independent of the route currently displayed. */
export function browserAppPresenceEnvironment(android = false, loadNative: () => Promise<NativeApp> = async () => (await import('@capacitor/app')).App): AppPresenceEnvironment {
  let focused = typeof document !== 'undefined' && document.hasFocus();
  let pageVisible = true;
  let nativeActive = !android;
  return {
    isForeground: () => typeof document !== 'undefined' && typeof window !== 'undefined' && pageVisible && nativeActive && (android || focused) && document.visibilityState === 'visible' && navigator.onLine !== false,
    subscribe(listener) {
      if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
      focused = document.hasFocus(); pageVisible = true; nativeActive = !android;
      const focus = () => { focused = true; listener(); };
      const blur = () => { focused = false; listener(); };
      const visibility = () => { focused = document.hasFocus(); listener(); };
      const hide = () => { pageVisible = false; listener(); };
      const show = () => { pageVisible = true; focused = document.hasFocus(); listener(); };
      window.addEventListener('focus', focus); window.addEventListener('blur', blur);
      window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
      window.addEventListener('online', listener); window.addEventListener('offline', listener);
      document.addEventListener('visibilitychange', visibility);
      let disposed = false;
      let nativeRevision = 0;
      let nativeHandle: { remove(): Promise<void> } | undefined;
      if (android) void loadNative().then(async app => {
        const handle = await app.addListener('appStateChange', state => { if (!disposed) { nativeRevision++; nativeActive = state.isActive; listener(); } });
        if (disposed) { await handle.remove(); return; }
        nativeHandle = handle;
        const revision = nativeRevision;
        const state = await app.getState();
        if (!disposed && nativeRevision === revision) { nativeActive = state.isActive; listener(); }
      }).catch(() => { /* Unknown native state stays inactive; browser events alone cannot claim Android foreground. */ });
      return () => {
        disposed = true;
        window.removeEventListener('focus', focus); window.removeEventListener('blur', blur);
        window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show);
        window.removeEventListener('online', listener); window.removeEventListener('offline', listener);
        document.removeEventListener('visibilitychange', visibility);
        void nativeHandle?.remove().catch(() => {});
      };
    },
  };
}

/** A monotonic revision also orders an old in-flight renewal behind a newer departure. */
export class AppPresenceController {
  private publish?: Publish;
  private memberId?: string;
  private revision = 0n;
  private last?: boolean;
  private unsubscribe?: () => void;
  private renewal?: ReturnType<typeof setInterval>;
  constructor(private environment: AppPresenceEnvironment = browserAppPresenceEnvironment()) {}
  connect(publish: Publish, memberId?: string) {
    this.disconnect(); this.publish = publish; this.memberId = memberId;
    this.unsubscribe = this.environment.subscribe(() => this.refresh());
    this.refresh();
  }
  setMember(memberId?: string) {
    if (this.memberId === memberId) return;
    this.memberId = memberId; this.refresh(true);
  }
  refresh(force = false) {
    if (!this.publish) return;
    const active = !!this.memberId && this.environment.isForeground();
    if (active) {
      if (force || this.last !== true) this.send(true);
      this.renewal ??= setInterval(() => this.refresh(true), APP_PRESENCE_RENEW_MS);
    } else {
      clearInterval(this.renewal); this.renewal = undefined;
      if (this.last === true) this.send(false);
    }
  }
  private send(active: boolean) {
    this.last = active;
    try { void Promise.resolve(this.publish?.({ active, revision: ++this.revision })).catch(() => {}); }
    catch { /* The next renewal or connection retries presence; the server lease remains bounded. */ }
  }
  disconnect() {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    clearInterval(this.renewal); this.renewal = undefined;
    if (this.last === true) this.send(false);
    this.publish = undefined; this.memberId = undefined; this.last = undefined;
  }
}

export class SpacetimeAppPresenceStore {
  private controller: AppPresenceController;
  constructor(environment?: AppPresenceEnvironment) { this.controller = new AppPresenceController(environment); }
  connect(connection: Pick<DbConnection, 'reducers'>, memberId?: string) {
    const reducers = connection.reducers as { setAppPresence?: (input: { active: boolean; revision: bigint }) => Promise<void> };
    this.controller.connect(input => reducers.setAppPresence?.(input), memberId);
  }
  setMember(memberId?: string) { this.controller.setMember(memberId); }
  disconnect() { this.controller.disconnect(); }
}
