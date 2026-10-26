import { describe, expect, it, vi } from 'vitest';
import { createResendEmailSend, ResendEmailError } from './resend';

const message = { to: 'alumno@example.com', from: 'B20 <invitaciones@b20.mx>', subject: 'Te invitaron a B20', html: '<p>Hola</p>', text: 'Hola' };

describe('adaptador Resend', () => {
  it('envía HTML y texto con autenticación, clave idempotente y tiempo límite', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'mail-1' }));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    expect(await createResendEmailSend('re_secret', request)(message, 'b20-invitation/hash')).toEqual({ id: 'mail-1' });
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer re_secret');
    expect(new Headers(init!.headers).get('Idempotency-Key')).toBe('b20-invitation/hash');
    expect(JSON.parse(String(init!.body))).toEqual({ ...message, to: [message.to] });
    expect(timeout).toHaveBeenCalledWith(10_000);
    timeout.mockRestore();
  });

  it.each([
    [403, 'validation_error', 'failed'], [401, 'restricted_api_key', 'failed'],
    [429, 'daily_quota_exceeded', 'failed'], [429, 'monthly_quota_exceeded', 'failed'],
    [409, 'invalid_idempotent_request', 'failed'], [422, 'invalid_parameter', 'failed'],
    [429, 'rate_limit_exceeded', 'retry'], [409, 'concurrent_idempotent_requests', 'retry'],
    [409, 'resource_locked', 'retry'], [500, 'application_error', 'retry'], [503, 'service_unavailable', 'retry'],
  ])('clasifica %s %s como %s', async (status, code, outcome) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: code, message: 'alumno@example.com re_secret' }, { status: Number(status), headers: { 'retry-after': '61' } }));
    await expect(createResendEmailSend('re_secret', request)(message, 'key')).rejects.toMatchObject({ code, outcome, retryAfterSeconds: 61, message: code });
  });

  it('no expone mensajes, nombres arbitrarios ni errores de red del proveedor', async () => {
    for (const response of [Response.json({ name: 'alumno@example.com re_secret', message: 'private' }, { status: 403 }), new Response('private', { status: 502 })]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(createResendEmailSend('re_secret', request)(message, 'key')).rejects.toMatchObject({ message: `http_${response.status}` });
    }
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('alumno@example.com re_secret'));
    await expect(createResendEmailSend('re_secret', request)(message, 'key')).rejects.toMatchObject({ code: 'network_error', outcome: 'retry', message: 'network_error' });
  });

  it.each([{}, { id: '' }, { id: 'private@example.com' }, { id: 5 }, { id: 'a'.repeat(129) }])('rechaza una respuesta de éxito inválida %j', async (response) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    await expect(createResendEmailSend('re_secret', request)(message, 'key')).rejects.toMatchObject({ code: 'invalid_response', outcome: 'retry' });
  });

  it('acota las respuestas y cancela el flujo demasiado grande', async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('a'.repeat(16_385))); }, cancel: cancelled });
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(createResendEmailSend('re_secret', request)(message, 'key')).rejects.toMatchObject({ code: 'invalid_response' });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('ignora Retry-After inválido y acota el válido', async () => {
    for (const [header, expected] of [['private', undefined], ['-1', undefined], ['999999', 86_400]] as const) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: 'rate_limit_exceeded' }, { status: 429, headers: { 'retry-after': header } }));
      try { await createResendEmailSend('re_secret', request)(message, 'key'); expect.fail('Expected provider error'); }
      catch (error) { expect(error).toBeInstanceOf(ResendEmailError); expect((error as ResendEmailError).retryAfterSeconds).toBe(expected); }
    }
  });
});
