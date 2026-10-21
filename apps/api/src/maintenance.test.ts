import { describe, expect, it, vi } from 'vitest';
import { runRetentionMaintenance } from './maintenance.ts';
describe('mantenimiento Cloudflare con estado en SpacetimeDB', () => {
  it('no hace solicitudes si el servicio no está configurado', async () => {
    const request = vi.fn();
    expect(await runRetentionMaintenance({ uri: 'https://example.invalid', module: 'b20' }, request)).toEqual({ enabled: false, processed: 0, remaining: 0 });
    expect(request).not.toHaveBeenCalled();
  });
  it('procesa como máximo cinco lotes y deja el resto para el siguiente cron', async () => {
    const request = vi.fn().mockImplementation(async () => Response.json({ processed: 20, remaining: 100 }));
    expect(await runRetentionMaintenance({ uri: 'wss://example.invalid', module: 'b20', token: 'synthetic-service-token' }, request)).toEqual({ enabled: true, processed: 100, remaining: 100 });
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ body: '[20]', redirect: 'manual' });
  });
  it('rechaza una respuesta dudosa sin inventar que se limpiaron datos', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ processed: 21, remaining: -1 }));
    await expect(runRetentionMaintenance({ uri: 'https://example.invalid', module: 'b20', token: 'synthetic-service-token' }, request)).rejects.toThrow('inválida');
  });
});
