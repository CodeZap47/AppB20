import { Link } from 'react-router';
import { agentName } from '@b20/core';
import { useSnapshot } from '../data/DataContext';
import type { Snapshot } from '../data/types';

/** Nombre del agente de quien consulta; `undefined` sin membresía. */
export function agentNameFor(data: Snapshot) { return data.me ? agentName(data.me, data.members.filter((m) => m.status === 'active')) : undefined; }

export function AgentHelpLink({ assignmentId }: { assignmentId: string }) {
  const bot = agentNameFor(useSnapshot());
  return bot ? <Link to={`/m/agente?${new URLSearchParams({ pestana: 'help', tarea: assignmentId })}`} className="button secondary">Pedir ayuda a {bot}</Link> : null;
}
