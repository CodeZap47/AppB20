/** Los rechazos de dominio viajan como datos para conservar el mensaje del servidor. */
export function helpResponse(value: string): unknown {
  const response: unknown = JSON.parse(value);
  if (!response || typeof response !== 'object' || !('ok' in response)) throw new Error('No se pudo confirmar la operación de Ayuda.');
  if (response.ok === false) throw new Error('message' in response && typeof response.message === 'string' ? response.message.slice(0, 500) : 'No se pudo guardar el cambio.');
  if (response.ok !== true || !('data' in response)) throw new Error('No se pudo confirmar la operación de Ayuda.');
  return response.data;
}
