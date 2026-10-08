/** Presentación en la que corre la interfaz (sección 5, formas de distribución). */
export type Platform = 'web' | 'extension-panel' | 'extension-tab' | 'android';

export const PLATFORM_LABEL: Record<Platform, string> = {
  web: 'Web / PWA',
  'extension-panel': 'Extensión de Chrome (panel lateral)',
  'extension-tab': 'Extensión de Chrome (vista completa)',
  android: 'App Android',
};
