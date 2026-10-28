import type { createDemoState } from '../../../packages/app/src/data/demo';

/** Long synthetic history, available only through the design-preview entry. */
export function seedReadingReview(state: ReturnType<typeof createDemoState>) {
  const people = state.members.filter(member => member.status === 'active');
  const end = Date.now() - 60_000;
  state.groupMessages = Array.from({ length: 80 }, (_, index) => ({
    id: `reading-${index + 1}`,
    senderId: people[index % people.length]!.id,
    text: `Mensaje de ejemplo ${String(index + 1).padStart(2, '0')}. Estamos revisando el historial de la conversación para conservar el punto de lectura al mostrar u ocultar el área de escritura.`,
    sentAt: new Date(end - (79 - index) * 60_000),
  }));
}
