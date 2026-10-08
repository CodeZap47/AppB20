import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { EncryptedMemoryStore } from './lib/secrets.ts';

describe('api', () => {
  const app = createApp(new EncryptedMemoryStore(randomBytes(32).toString('base64')));

  it('responde /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });

  it('exige sesión para Gemini', async () => {
    const res = await app.request('/ai/key');
    expect(res.status).toBe(401);
  });
});
