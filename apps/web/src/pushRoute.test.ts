import { describe, expect, it } from 'vitest';
import { pushDestination } from './pushRoute';
const app = 'https://app-b20.pages.dev/sw.js';
describe('destinos de Web Push', () => {
  it('solo abre rutas de módulos del mismo origen', () => {
    expect(pushDestination('/m/avisos', app)).toBe('https://app-b20.pages.dev/#/m/avisos');
    expect(pushDestination('./#/m/mensajes/directos/123', app)).toBe('https://app-b20.pages.dev/#/m/mensajes/directos/123');
  });
  it('descarta URLs externas, javascript, rutas codificadas y destinos de autenticación', () => {
    for (const destination of ['https://example.com/#/m/avisos', '//example.com/#/m/avisos', 'javascript:alert(1)', './#/m/%2f%2fexample.com', './#/auth', '']) {
      expect(pushDestination(destination, app)).toBe('https://app-b20.pages.dev/#/m/avisos');
    }
  });
});
