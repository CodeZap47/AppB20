import { DemoDataSource, type createDemoState } from '../../../packages/app/src/data/demo';

/** Only the design-preview entry creates these synthetic foreground sessions. */
export function seedPresenceReview(state: ReturnType<typeof createDemoState>, viewer: DemoDataSource): () => void {
  const people = state.members.filter(member => member.status === 'active' && member.id !== viewer.getSnapshot().me?.id).slice(0, 2);
  const sessions = people.map(member => new DemoDataSource(state, member.id));
  viewer.appPresence.setForeground(true);
  sessions.forEach(session => session.appPresence.setForeground(true));
  return () => sessions.forEach(session => session.dispose());
}
