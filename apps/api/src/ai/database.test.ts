import { describe, expect, it } from 'vitest';
import { AiApiError, createAiDatabase, type AiWorkerEnv } from './database.ts';

const env = { SPACETIMEDB_URI: 'wss://db.example.test', SPACETIMEDB_MODULE: 'module/encoded', AI_SERVICE_TOKEN: 'ai-service-only' } as AiWorkerEnv;
describe('Puente IA de procedimientos autorizados', () => {
  it('usa token de alumno o servicio exclusivo y conserva los u64 como cadenas', async () => {
    const requests: { url: string; headers: Headers; body: string }[] = [];
    const db = createAiDatabase(env, (async (url, init) => {
      requests.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body) });
      return Response.json(JSON.stringify({ configured: true }));
    }) as typeof fetch);
    await db.user('student-only', 'ai_prepare', { subjectId: '18446744073709551615' });
    await db.service('ai_claim_generation', { actor: 'a'.repeat(64), id: 'example' });
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer student-only');
    expect(requests[1]!.headers.get('authorization')).toBe('Bearer ai-service-only');
    expect(JSON.parse(JSON.parse(requests[0]!.body)[0]).subjectId).toBe('18446744073709551615');
    expect(requests[0]!.url).toContain('module%2Fencoded/call/ai_prepare');
    expect(() => db.service('ai_key_status', {})).toThrow(AiApiError);
    expect(() => db.user('student', 'ai_commit_key', {})).toThrow(AiApiError);
  });
  it('rechaza configuración incompleta y respuestas inválidas sin exponer logs', async () => {
    expect(() => createAiDatabase({ ...env, SPACETIMEDB_URI: 'https://secret:pw@db.example.test' })).toThrow(AiApiError);
    const db = createAiDatabase(env, (async () => new Response('not-json SECRET')) as typeof fetch);
    await expect(db.user('student', 'ai_status', {})).rejects.toMatchObject({ status: 503, code: 'protocol' });
    const denied = createAiDatabase(env, (async () => new Response('unauthorized:PRIVATE_RAW_LOG', { status: 530 })) as typeof fetch);
    await expect(denied.user('student', 'ai_status', {})).rejects.toMatchObject({ status: 403, code: 'unauthorized' });
    await expect(denied.user('student', 'ai_status', {})).rejects.not.toThrow('PRIVATE_RAW_LOG');
  });
  it('cancela lecturas que superan el máximo en lugar de cargar respuestas ilimitadas', async () => {
    let cancelled = false;
    const oversized = () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel() { cancelled = true; } }), { status: 530 });
    const db = createAiDatabase(env, (async () => oversized()) as typeof fetch);
    await expect(db.user('student', 'ai_status', {})).rejects.toMatchObject({ status: 503, code: 'protocol' });
    expect(cancelled).toBe(true);
  });
});

it('admite una guía Unicode editada con historial de pasos sin ampliar el límite de EX-1', async () => {
  const value = { result: '界'.repeat(450_000) };
  const db = createAiDatabase(env, (async () => Response.json(JSON.stringify(value))) as typeof fetch);
  expect(await db.user('student', 'guide_ai', { action: 'getDraft' })).toEqual(value);
  await expect(db.user('student', 'ai_get_generation', {})).rejects.toMatchObject({ code: 'protocol' });
});
