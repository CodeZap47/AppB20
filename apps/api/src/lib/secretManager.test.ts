import { describe, expect, it } from 'vitest';
import { SecretManagerStore } from './secretManager.ts';

/** Secret Manager falso: guarda secretos y versiones como la API REST. */
function fakeSecretManager() {
  const secrets = new Map<string, { versions: { n: number; data: string; state: string }[] }>();
  const calls: string[] = [];
  const json = (status: number, body: unknown = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = decodeURIComponent(url.pathname).replace('/v1/projects/p1/', '');
    calls.push(`${method} ${path}`);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (method === 'POST' && path === 'secrets') {
      const id = url.searchParams.get('secretId')!;
      if (secrets.has(id)) return json(409);
      secrets.set(id, { versions: [] });
      return json(200, { name: `projects/p1/secrets/${id}` });
    }
    let m = path.match(/^secrets\/([^/:]+):addVersion$/);
    if (m && method === 'POST') {
      const s = secrets.get(m[1]!);
      if (!s) return json(404);
      const n = s.versions.length + 1;
      s.versions.push({ n, data: body.payload.data, state: 'ENABLED' });
      return json(200, { name: `projects/123/secrets/${m[1]}/versions/${n}` });
    }
    m = path.match(/^secrets\/([^/]+)\/versions$/);
    if (m && method === 'GET') {
      const s = secrets.get(m[1]!);
      if (!s) return json(404);
      const versions = s.versions
        .filter((v) => v.state !== 'DESTROYED')
        .map((v) => ({ name: `projects/123/secrets/${m![1]}/versions/${v.n}` }));
      return json(200, versions.length ? { versions } : {});
    }
    m = path.match(/^secrets\/([^/]+)\/versions\/(\d+):destroy$/);
    if (m && method === 'POST') {
      const v = secrets.get(m[1]!)?.versions.find((x) => x.n === Number(m![2]));
      if (!v) return json(404);
      v.state = 'DESTROYED';
      return json(200);
    }
    m = path.match(/^secrets\/([^/]+)\/versions\/latest:access$/);
    if (m && method === 'GET') {
      const s = secrets.get(m[1]!);
      const latest = s?.versions.filter((v) => v.state === 'ENABLED').at(-1);
      if (!latest) return json(404);
      return json(200, { payload: { data: latest.data } });
    }
    m = path.match(/^secrets\/([^/]+)$/);
    if (m && method === 'DELETE') return json(secrets.delete(m[1]!) ? 200 : 404);
    return json(500);
  }) as typeof fetch;

  return { secrets, calls, fetchFn };
}

function setup() {
  const fake = fakeSecretManager();
  let now = 0;
  const store = new SecretManagerStore({
    projectId: 'p1',
    getAccessToken: async () => 'tok',
    fetchFn: fake.fetchFn,
    now: () => now,
  });
  return { ...fake, store, advance: (ms: number) => (now += ms) };
}

describe('SecretManagerStore', () => {
  it('guarda, lee y elimina una clave por usuario', async () => {
    const { store, secrets, advance } = setup();
    expect(await store.has('a')).toBe(false);
    await store.put('a', 'clave-de-prueba');
    advance(10 * 60_000); // sin caché: lee de Secret Manager
    expect(await store.get('a')).toBe('clave-de-prueba');
    expect(await store.has('a')).toBe(true);
    expect(await store.get('b')).toBeUndefined();
    await store.delete('a');
    expect(secrets.size).toBe(0);
    expect(await store.has('a')).toBe(false);
  });

  it('al reemplazar la clave destruye la versión anterior', async () => {
    const { store, secrets, advance } = setup();
    await store.put('a', 'vieja');
    await store.put('a', 'nueva');
    const [secret] = [...secrets.values()];
    expect(secret!.versions.map((v) => v.state)).toEqual(['DESTROYED', 'ENABLED']);
    advance(10 * 60_000);
    expect(await store.get('a')).toBe('nueva');
  });

  it('no expone el sub en el nombre del secreto', () => {
    const id = SecretManagerStore.secretId('1234567890');
    expect(id).toMatch(/^byok-[0-9a-f]{40}$/);
    expect(id).not.toContain('1234567890');
  });

  it('recuerda la clave unos minutos para no leerla en cada generación', async () => {
    const { store, calls, advance } = setup();
    await store.put('a', 'clave');
    const before = calls.length;
    await store.get('a');
    await store.get('a');
    expect(calls.length).toBe(before);
    advance(6 * 60_000);
    await store.get('a');
    expect(calls.length).toBe(before + 1);
  });

  it('los errores nunca incluyen la clave', async () => {
    const store = new SecretManagerStore({
      projectId: 'p1',
      getAccessToken: async () => 'tok',
      fetchFn: (async () => new Response('{}', { status: 403 })) as typeof fetch,
    });
    await expect(store.put('a', 'super-secreta')).rejects.toThrow(/403/);
    await expect(store.put('a', 'super-secreta')).rejects.not.toThrow(/super-secreta/);
  });
});
