import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Platform } from '../platform';
import { config } from '../config';
import { getChromeAuth } from './platformAuth';
import { rememberSession } from './persistence';

export function validateSupabaseConfig(url: string, key: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/')
    throw new Error('Configura el origen HTTPS del proyecto Supabase.');
  // Una clave secret/service_role jamás puede entrar al bundle del cliente.
  if (!key.startsWith('sb_publishable_')) throw new Error('Configura una clave pública sb_publishable_ de Supabase.');
  return parsed.origin;
}

/** Un único sobre administrado por el SDK; no duplicamos access/refresh tokens. */
export function supabaseStorage(platform: Platform) {
  const chrome = platform.startsWith('extension') ? getChromeAuth() : undefined;
  return {
    async getItem(key: string): Promise<string | null> {
      if (chrome) {
        const value = (await chrome.storage.local?.get(key))?.[key] ?? (await chrome.storage.session.get(key))[key];
        return typeof value === 'string' ? value : null;
      }
      return localStorage.getItem(key) ?? sessionStorage.getItem(key);
    },
    async setItem(key: string, value: string): Promise<void> {
      if (chrome) {
        await chrome.storage.local?.remove(key);
        await chrome.storage.session.remove(key);
        await (rememberSession() && chrome.storage.local ? chrome.storage.local : chrome.storage.session).set({ [key]: value });
      } else {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
        (rememberSession() ? localStorage : sessionStorage).setItem(key, value);
      }
    },
    async removeItem(key: string): Promise<void> {
      if (chrome) {
        await chrome.storage.local?.remove(key);
        await chrome.storage.session.remove(key);
      } else {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      }
    },
  };
}

let cached: { key: string; client: SupabaseClient } | undefined;
export function createB20Supabase(platform: Platform) {
  const url = validateSupabaseConfig(config.supabaseUrl, config.supabasePublishableKey);
  const key = `${url}:${config.supabasePublishableKey}:${platform}:${config.supabasePasskeysEnabled}`;
  if (cached?.key === key) return cached.client;
  const client = createClient(url, config.supabasePublishableKey, {
    auth: {
      flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
      storageKey: `b20.supabase.${new URL(url).hostname}`, storage: supabaseStorage(platform),
      ...(config.supabasePasskeysEnabled ? { experimental: { passkey: true } } : {}),
    },
  });
  cached = { key, client };
  return client;
}

export function supabaseRedirect(platform: Platform): string {
  if (platform === 'android') return 'mx.b20.app://auth/callback';
  if (platform.startsWith('extension')) {
    const chrome = getChromeAuth();
    if (!chrome) throw new Error('Abre B20 desde la extensión instalada.');
    return chrome.identity.getRedirectURL('auth/callback');
  }
  return `${window.location.origin}/auth/callback`;
}
