import { describe, expect, it } from 'vitest';
import { starterSignalDefinitions, type SignalCommand } from '@b20/core';
import { DemoDataSource, createDemoState } from './demo';
import { buildNews } from '../lib/whatsNew';

function setup() {
  let now = new Date('2026-10-26T12:00:00Z');
  const state = createDemoState(now);
  const owner = new DemoDataSource(state, 'demo-1', () => now);
  const peer = new DemoDataSource(state, 'demo-2', () => now);
  const third = new DemoDataSource(state, 'demo-3', () => now);
  const subjectId = owner.getSnapshot().subjects[0]!.id;
  const act = (command: SignalCommand) => owner.signalAction(command);
  const dictionaryId = act({ action: 'createDictionary', requestId: 'dictionary', subjectId, title: 'Convención del grupo', topic: 'Prueba', definitions: starterSignalDefinitions() })!;
  act({ action: 'publishDictionary', requestId: 'publish', dictionaryId, expectedVersion: 1 });
  const ref = { dictionaryId, dictionaryVersion: 1, medium: 'pen' as const };
  return { state, owner, peer, third, subjectId, ref, dictionaryId, act, advance: (days: number) => { now = new Date(now.getTime() + days * 86_400_000); } };
}

describe('Lenguaje de señales integrado con las sesiones demo', () => {
  it('comparte versiones del diccionario entre cuentas sin compartir mensajes o prácticas', () => {
    const s = setup();
    expect(s.peer.getSnapshot().signals.versions).toHaveLength(1);
    const message = { action: 'saveMessage', requestId: 'message', ...s.ref, reference: '12', answer: 'A', repeat: false } as const;
    expect(s.act(message)).toBe(s.act(message));
    s.act({ action: 'startAttempt', requestId: 'practice', ...s.ref, mode: 'recognize' });
    expect(s.owner.getSnapshot().signals.messages).toHaveLength(1);
    expect(s.owner.getSnapshot().signals.attempts[0]?.expected).toBeUndefined();
    expect(s.peer.getSnapshot().signals.messages).toEqual([]);
    expect(s.peer.getSnapshot().signals.attempts).toEqual([]);
  });

  it('conserva la invitación pendiente sin revelar turnos al tercero', () => {
    const s = setup();
    const sessionId = s.act({ action: 'invitePartner', requestId: 'invite', ...s.ref, guestId: 'demo-2' })!;
    expect(s.peer.getSnapshot().signals.sessions[0]?.status).toBe('pending');
    expect(s.third.getSnapshot().signals.sessions).toEqual([]);
    s.peer.signalAction({ action: 'respondInvitation', requestId: 'accept', sessionId, expectedVersion: 1, accept: true });
    const session = s.owner.getSnapshot().signals.sessions[0]!;
    s.act({ action: 'startSession', requestId: 'start', sessionId, expectedVersion: session.version });
    s.act({ action: 'sendTurn', requestId: 'turn', sessionId, expectedVersion: s.owner.getSnapshot().signals.sessions[0]!.version, reference: '1', answer: 'B', repeat: false });
    const turn = s.peer.getSnapshot().signals.turns[0]!;
    expect(turn.expected).toBeUndefined();
    s.peer.signalAction({ action: 'answerTurn', requestId: 'answer', turnId: turn.id, expectedVersion: turn.version, answer: '1 → B' });
    expect(s.owner.getSnapshot().signals.turns[0]?.correct).toBe(true);
    expect(s.third.getSnapshot().signals.turns).toEqual([]);
  });

  it('conserva las fichas privadas y revalida la fuente cuando se retira', () => {
    const s = setup();
    const noteId = s.owner.saveNote({ subjectId: s.subjectId, topic: 'Prueba', title: 'Fuente personal', body: 'Apunte privado', tags: [], visibility: 'personal', source: 'student' });
    const source = s.owner.getSnapshot().notes.find((note) => note.id === noteId)!;
    s.act({ action: 'saveCard', requestId: 'card', expectedVersion: 0, subjectId: s.subjectId, topic: 'Prueba', reference: 'Concepto', body: 'Resumen privado', conditions: 'Revisar condiciones', support: 'Borrador', source: { kind: 'note', id: source.id, version: source.version, location: 'Introducción' } });
    expect(s.owner.getSnapshot().signals.cards[0]?.sourceAvailable).toBe(true);
    expect(s.peer.getSnapshot().signals.cards).toEqual([]);
    const ownNote = s.state.notes.find((note) => note.id === source.id)!;
    ownNote.withdrawnAt = new Date();
    s.owner.setViewer('demo-1');
    expect(s.owner.getSnapshot().signals.cards[0]?.sourceAvailable).toBe(false);
    expect(s.owner.getSnapshot().signals.cards[0]?.body).toBe('Resumen privado');
  });

  it('no añade prácticas ni fichas al feed y vacía todo al cambiar a una cuenta sin acceso', () => {
    const s = setup();
    const before = buildNews(s.owner.getSnapshot()).map((item) => item.key);
    s.act({ action: 'startAttempt', requestId: 'practice', ...s.ref, mode: 'encode' });
    s.act({ action: 'saveCard', requestId: 'card', expectedVersion: 0, subjectId: s.subjectId, topic: 'Prueba', reference: 'Referencia', body: 'Privado', conditions: '', support: 'Borrador' });
    expect(buildNews(s.owner.getSnapshot()).map((item) => item.key)).toEqual(before);
    s.owner.setViewer('sin-acceso');
    expect(s.owner.getSnapshot().signals.attempts).toEqual([]);
    expect(s.owner.getSnapshot().signals.cards).toEqual([]);
    expect(() => s.act({ action: 'startAttempt', requestId: 'blocked', ...s.ref, mode: 'encode' })).toThrow();
  });
});
