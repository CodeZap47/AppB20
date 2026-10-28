import { DemoDataSource, type createDemoState } from '../../../packages/app/src/data/demo';
import { formatChatPostReference } from '../../../packages/core/src/chatPosts';

/** Author, reader, delivered recipient and offline recipients use only synthetic demo sessions. */
export function seedMessageInfoReview(state: ReturnType<typeof createDemoState>, viewer: DemoDataSource): () => void {
  const people = state.members.filter(member => member.status === 'active' && member.id !== viewer.getSnapshot().me?.id);
  const id = viewer.sendGroupMessage('Les comparto el material para la próxima clase. Podemos revisarlo antes de comenzar.');
  const reader = people[0] && new DemoDataSource(state, people[0].id);
  const delivered = people[1] && new DemoDataSource(state, people[1].id);
  reader?.getSnapshot(); delivered?.getSnapshot();
  reader?.messageReceipts.markSeen('group', 'general', [id]);
  const material = state.assignments[0];
  if (material) viewer.sendGroupMessage(`Aquí está la tarea que comentamos. ${formatChatPostReference({ kind: 'assignment', id: material.id })}`);
  return () => { reader?.dispose(); delivered?.dispose(); };
}

/** Design-preview only: four synthetic sessions exercise the real demo live-draft store. */
export function seedMessagesReview(state: ReturnType<typeof createDemoState>, viewer: DemoDataSource): () => void {
  const me = viewer.getSnapshot().me?.id;
  const people = state.members.filter(member => member.status === 'active' && member.id !== me).slice(0, 4);
  const sessions = people.map(member => new DemoDataSource(state, member.id));
  const texts = [
    'Estoy revisando el ejemplo de tablas de verdad. Podemos comparar los resultados después de clase.',
    '¿Les parece si organizamos los materiales por tema? Ya encontré una explicación que nos puede servir.',
    'Voy a subir mi propuesta del proyecto. Incluye los casos de prueba y unas notas sobre las decisiones que tomamos.',
    'También estoy preparando una pregunta para el grupo. Quiero comprobar qué sucede cuando la lista está vacía.',
  ];
  const channel = viewer.getSnapshot().chatChannels.find(row => !row.archivedAt);
  let progress = 0;
  const publish = () => {
    sessions.forEach((session, index) => {
      const text = texts[index]!;
      const preview = text.slice(0, Math.min(text.length, 64 + progress % 110));
      session.liveDrafts.publish('group', 'general', preview);
      if (channel) session.liveDrafts.publish('channel', channel.id, preview);
    });
    progress += 12;
  };
  publish();
  const timer = setInterval(publish, 1200);
  return () => { clearInterval(timer); sessions.forEach(session => session.dispose()); };
}
