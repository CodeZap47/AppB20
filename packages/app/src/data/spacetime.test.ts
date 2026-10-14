import { Identity, Timestamp } from 'spacetimedb';
import { describe, expect, it } from 'vitest';
import { SpacetimeDataSource, VIEWS, type SpacetimeConnection } from './spacetime';

const ME = Identity.fromString('aa'.repeat(32));
const OTHER = Identity.fromString('bb'.repeat(32));
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

type Row = Record<string, any>;

/**
 * Conexión falsa: cada vista es una lista de filas y cada reducer una función que las cambia,
 * como haría el servidor antes de mandar la actualización.
 */
function fakeConnection(reducers: Record<string, (args: Row, db: FakeDb) => void> = {}) {
  const db: FakeDb = {};
  const listeners: Record<string, { insert: Function[]; del: Function[] }> = {};
  const camel = (n: string) => n.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  let applied: ((ctx: unknown) => void) | undefined;
  const calls: { name: string; args: Row }[] = [];

  for (const name of VIEWS) {
    const key = camel(name);
    db[key] = [];
    listeners[key] = { insert: [], del: [] };
  }
  const insert = (view: string, row: Row) => {
    const key = camel(view);
    db[key]!.push(row);
    for (const cb of listeners[key]!.insert) cb({}, row);
  };

  const conn: SpacetimeConnection = {
    db: Object.fromEntries(
      Object.keys(db).map((key) => [
        key,
        {
          iter: () => db[key]!,
          onInsert: (cb: Function) => listeners[key]!.insert.push(cb),
          onDelete: (cb: Function) => listeners[key]!.del.push(cb),
        },
      ]),
    ) as SpacetimeConnection['db'],
    reducers: new Proxy(
      {},
      {
        get: (_, name: string) => async (args: Row) => {
          calls.push({ name, args });
          const impl = reducers[name];
          if (!impl) throw new Error(`reducer ${name} sin implementar en la prueba`);
          impl(args, { ...db, insert } as never);
        },
      },
    ),
    subscriptionBuilder: () => ({
      onApplied: (cb) => {
        applied = cb;
        return { onError: () => ({ subscribe: () => undefined }) };
      },
    }),
    disconnect: () => undefined,
  };
  return { conn, db, insert, calls, apply: () => applied?.({}) };
}

type FakeDb = Record<string, Row[]> & { insert?: (view: string, row: Row) => void };

const member = (identity: Identity, name: string, isCreator = false) => ({
  identity,
  displayName: name,
  photoUrl: undefined,
  status: 'active',
  isCreator,
  joinedAt: ts('2026-10-01T10:00:00Z'),
});

describe('SpacetimeDataSource', () => {
  it('está conectando hasta que llega la suscripción', () => {
    const { conn, apply } = fakeConnection();
    const source = new SpacetimeDataSource(conn);
    expect(source.getSnapshot().connection).toBe('connecting');
    apply();
    expect(source.getSnapshot().connection).toBe('ready');
  });

  it('convierte identidades, u64 y fechas al formato de la interfaz', () => {
    const { conn, insert, apply } = fakeConnection();
    insert('my_member', member(ME, 'Ana', true));
    insert('members', member(ME, 'Ana', true));
    insert('members', member(OTHER, 'Beto'));
    insert('subjects', {
      id: 7n,
      code: '',
      name: 'Optativa',
      period: 3,
      createdBy: ME,
      createdAt: ts('2026-10-02T00:00:00Z'),
    });
    insert('group_messages', {
      id: 12n,
      sender: OTHER,
      text: 'hola',
      sentAt: ts('2026-10-03T12:00:00Z'),
      replyToId: 11n,
      editedAt: undefined,
      deletedAt: undefined,
      deletedBy: undefined,
    });
    insert('work_authors', { id: 1n, workId: 5n, author: ME });
    insert('work_authors', { id: 2n, workId: 5n, author: OTHER });
    insert('works', {
      id: 5n,
      assignmentId: 3n,
      title: '',
      description: 'd',
      version: 1,
      createdBy: ME,
      createdAt: ts('2026-10-04T00:00:00Z'),
      updatedAt: ts('2026-10-04T00:00:00Z'),
    });
    const source = new SpacetimeDataSource(conn);
    apply();
    const snap = source.getSnapshot();
    expect(snap.me).toMatchObject({ id: ME.toHexString(), displayName: 'Ana', isCreator: true });
    expect(snap.members.map((m) => m.displayName)).toEqual(['Ana', 'Beto']);
    expect(snap.subjects[0]).toEqual({ id: '7', name: 'Optativa', code: undefined, period: 3 });
    expect(snap.groupMessages[0]).toMatchObject({
      id: '12',
      senderId: OTHER.toHexString(),
      replyToId: '11',
      sentAt: new Date('2026-10-03T12:00:00Z'),
    });
    expect(snap.works[0]!.authorIds).toEqual([ME.toHexString(), OTHER.toHexString()]);
  });

  it('devuelve el id que asignó el servidor a lo que creaste', async () => {
    const { conn, insert, apply, calls } = fakeConnection({
      sendGroupMessage: (args, db) =>
        db.insert!('group_messages', {
          id: 40n,
          sender: ME,
          text: args.text,
          sentAt: ts('2026-10-05T00:00:00Z'),
        }),
    });
    insert('my_member', member(ME, 'Ana'));
    insert('group_messages', {
      id: 39n,
      sender: OTHER,
      text: 'antes',
      sentAt: ts('2026-10-04T00:00:00Z'),
    });
    const source = new SpacetimeDataSource(conn);
    apply();
    await expect(source.sendGroupMessage('nuevo', '39')).resolves.toBe('40');
    expect(calls[0]).toEqual({ name: 'sendGroupMessage', args: { text: 'nuevo', replyToId: 39n } });
  });

  it('espera la fila si llega después de que termina el reducer', async () => {
    let later: (() => void) | undefined;
    const { conn, insert, apply } = fakeConnection({
      askQuestion: (args, db) => {
        later = () =>
          db.insert!('questions', {
            id: 2n,
            subjectId: 1n,
            topic: '',
            title: args.title,
            body: '',
            author: ME,
            status: 'open',
            createdAt: ts('2026-10-05T00:00:00Z'),
          });
      },
    });
    insert('my_member', member(ME, 'Ana'));
    const source = new SpacetimeDataSource(conn);
    apply();
    const pending = source.askQuestion({ subjectId: '1', topic: '', title: '¿?', body: '' });
    await Promise.resolve();
    await Promise.resolve();
    later!();
    await expect(pending).resolves.toBe('2');
  });

  it('el error del módulo llega tal cual a la pantalla', async () => {
    const { conn, insert, apply } = fakeConnection({
      joinGroup: () => {
        throw new Error('Tu correo no está en la lista autorizada del grupo.');
      },
    });
    insert('members', member(OTHER, 'Beto'));
    const source = new SpacetimeDataSource(conn);
    apply();
    await expect(source.joinGroup('Ana')).rejects.toThrow('lista autorizada');
  });

  it('convierte los argumentos a los tipos del módulo', async () => {
    const { conn, insert, apply, calls } = fakeConnection({
      inviteMember: () => {},
      removeMember: () => {},
      saveCalendar: () => {},
    });
    insert('my_member', member(ME, 'Ana', true));
    const source = new SpacetimeDataSource(conn);
    apply();
    await source.inviteMember('x@ejemplo.mx', true);
    await source.removeMember(OTHER.toHexString());
    await source.saveCalendar(2, [
      { startDate: '2026-01-05', endDate: '2026-02-01' },
      { startDate: '', endDate: '' },
    ]);
    expect(calls[0]!.args).toEqual({ email: 'x@ejemplo.mx', isCreator: true });
    expect((calls[1]!.args.identity as Identity).toHexString()).toBe(OTHER.toHexString());
    expect(calls[2]!.args).toEqual({
      period: 2,
      startDates: ['2026-01-05', ''],
      endDates: ['2026-02-01', ''],
    });
  });

  it('avisa una sola vez por lote de filas', async () => {
    const { conn, insert, apply } = fakeConnection();
    const source = new SpacetimeDataSource(conn);
    apply();
    let count = 0;
    source.subscribe(() => count++);
    await Promise.resolve();
    count = 0;
    insert('members', member(ME, 'Ana'));
    insert('members', member(OTHER, 'Beto'));
    await Promise.resolve();
    expect(count).toBe(1);
    expect(source.getSnapshot().members).toHaveLength(2);
  });
});
