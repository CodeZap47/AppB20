import { describe, expect, it, vi } from 'vitest';
import { createFeedInteractionActions } from './feedInteractionActions';

const target = { kind: 'note', id: '42' } as const;
const thread = { target, comments: [], canComment: true, maxLength: 4000 };
describe('adaptador de conversaciones y enlaces', () => {
  it('envía comandos al procedimiento sin crear publicaciones ni reducers', async () => {
    const feedThread = vi.fn().mockResolvedValue(JSON.stringify(thread)); const connection = () => ({ procedures: { feedThread } });
    const source = createFeedInteractionActions(connection);
    expect(await source.readFeedThread(target)).toEqual(thread);
    await source.addFeedThreadComment(target, 'Una duda', 'retry-id'); await source.deleteFeedThreadComment(target, '8');
    expect(feedThread.mock.calls.map(([input]) => JSON.parse(input.payload))).toEqual([{ action: 'read', target }, { action: 'comment', target, text: 'Una duda', requestId: 'retry-id' }, { action: 'delete', target, commentId: '8' }]);
  });
  it('usa el token actual y las rutas autenticadas sin ponerlo en el enlace ni query', async () => {
    let token = 'first'; const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 's', url: 'https://api.b20.mx/s/opaque', preview: { title: 'Nota', description: 'Extracto', kindLabel: 'Nota de clase', path: '/m/notas/42' } }), {status: 201})).mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(new Response('{"ok":true}'));
    const source = createFeedInteractionActions(() => ({ procedures: {} }), { apiUrl: 'https://api.b20.mx/', getToken: () => token, fetch: fetcher });
    await source.createFeedShare(target); token = 'second'; await source.listFeedShares(target); await source.revokeFeedShare('s');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://api.b20.mx/shares', 'https://api.b20.mx/shares?kind=note&id=42', 'https://api.b20.mx/shares/s']);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer first' }, body: JSON.stringify({ target }) });
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer second' } });
  });
  it('bloquea sesiones sin token, respuestas inválidas y fallos ambiguos de creación', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network'));
    const source = createFeedInteractionActions(() => ({ procedures: {} }), { apiUrl: 'https://api.b20.mx', getToken: () => 'token', fetch: fetcher });
    await expect(source.createFeedShare(target)).rejects.toThrow('Revisa los enlaces existentes');
    const noSession = createFeedInteractionActions(() => ({ procedures: {} }), { apiUrl: 'https://api.b20.mx', getToken: () => undefined, fetch: fetcher });
    await expect(noSession.createFeedShare(target)).rejects.toThrow('Inicia sesión');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(createFeedInteractionActions(() => ({ procedures: {} })).readFeedThread(target)).rejects.toThrow('disponible');
    await expect(createFeedInteractionActions(() => ({ procedures: { feedThread: async () => '{}' } })).readFeedThread(target)).rejects.toThrow('incompleta');
  });
  it.each([
    { ...thread, target: {kind: 'note', id: '99'} }, { ...thread, maxLength: -1 },
    { ...thread, comments: [{id: '1', authorId: 'a', text: 'x', createdAt: 'invalid', canDelete: true}] },
    { ...thread, comments: [{id: '1', authorId: 'a', text: 'x', createdAt: '2026-10-26T00:00:00Z', canDelete: 'yes'}] },
  ])('rechaza contratos de conversación inválidos %#', async (invalid) => {
    const source = createFeedInteractionActions(() => ({ procedures: { feedThread: async () => JSON.stringify(invalid) } }));
    await expect(source.readFeedThread(target)).rejects.toThrow('incompleta');
  });
  it('acota y limpia la preview recibida sin cambiar el token público', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 's', url: 'https://api.b20.mx/s/opaque', preview: { title: 'Título', description: '```private()``` https://example.invalid ' + 'a'.repeat(250), kindLabel: 'Nota', path: '/m/notas/42' } })));
    const source = createFeedInteractionActions(() => ({procedures: {}}), {apiUrl: 'https://api.b20.mx', getToken: () => 'token', fetch: fetcher});
    const result = await source.createFeedShare(target); expect(result.url).toBe('https://api.b20.mx/s/opaque'); expect(result.preview.description).toBe('a'.repeat(160));
  });
});
