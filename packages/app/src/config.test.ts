import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_API_URL', '');
  vi.stubEnv('VITE_AI_API_URL', '');
  vi.stubEnv('VITE_INVITATION_API_URL', '');
});
afterEach(() => vi.unstubAllEnvs());

it('usa el Worker dedicado para enlaces sin activar las descargas heredadas de R2', async () => {
  vi.stubEnv('VITE_AI_API_URL', 'https://app-b20-ai.example');
  const { config } = await import('./config');
  expect(config.invitationApiUrl).toBe('https://app-b20-ai.example');
  expect(config.apiUrl).toBe('');
});

it('permite separar el servicio de enlaces de IA y de los archivos heredados', async () => {
  vi.stubEnv('VITE_INVITATION_API_URL', 'https://invitation.example');
  vi.stubEnv('VITE_AI_API_URL', 'https://ai.example');
  vi.stubEnv('VITE_API_URL', 'https://files.example');
  const { config } = await import('./config');
  expect(config.invitationApiUrl).toBe('https://invitation.example');
  expect(config.aiApiUrl).toBe('https://ai.example');
  expect(config.apiUrl).toBe('https://files.example');
});

it('conserva compatibilidad con instalaciones que tienen un único Worker', async () => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  const { config } = await import('./config');
  expect(config.invitationApiUrl).toBe('https://api.example');
});

it('no inventa una dirección local en un build de producción sin servicio', async () => {
  const { config } = await import('./config');
  expect(config.invitationApiUrl).toBe('');
});
