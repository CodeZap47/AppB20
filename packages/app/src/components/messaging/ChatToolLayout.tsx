import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from '../Icon';

function ToolHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="thread__header">
      <Link
        to="/m/mensajes/directos"
        className="icon-button thread__back"
        aria-label="Ver todas las conversaciones"
      >
        <Icon name="back" />
      </Link>
      <div className="thread__heading">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <Link to="/m/mensajes" className="button secondary thread__action">
        Volver al chat
      </Link>
    </header>
  );
}

export function ToolPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <>
      <ToolHeader title={title} subtitle={subtitle} />
      <div className="chat-tool">{children}</div>
    </>
  );
}
