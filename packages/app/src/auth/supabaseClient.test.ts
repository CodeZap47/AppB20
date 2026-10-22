// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { supabaseStorage, validateSupabaseConfig } from './supabaseClient';
import { setRememberSession } from './persistence';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
describe('credenciales públicas de Supabase', () => {
  it('solo admite el origen HTTPS y una clave publishable', () => {
    expect(validateSupabaseConfig('https://example.supabase.co', 'sb_publishable_public')).toBe('https://example.supabase.co');
    for (const url of ['http://example.supabase.co', 'https://user:secret@example.supabase.co', 'https://example.supabase.co/path'])
      expect(() => validateSupabaseConfig(url, 'sb_publishable_public')).toThrow();
    for (const key of ['sb_secret_private', 'service_role', ''])
      expect(() => validateSupabaseConfig('https://example.supabase.co', key)).toThrow();
  });
});
describe('persistencia de sesión Supabase', () => {
  it('respeta recordar sesión y borra copias antiguas al cambiar de cuenta', async () => {
    const storage = supabaseStorage('web');
    await storage.setItem('session', 'first');
    expect(localStorage.getItem('session')).toBe('first');
    setRememberSession(false);
    await storage.setItem('session', 'second');
    expect(localStorage.getItem('session')).toBeNull();
    expect(sessionStorage.getItem('session')).toBe('second');
    expect(await storage.getItem('session')).toBe('second');
    await storage.removeItem('session');
    expect(await storage.getItem('session')).toBeNull();
  });
});
