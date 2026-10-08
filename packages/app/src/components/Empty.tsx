import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Estado vacío: qué pasa, por qué y, si aplica, qué hacer a continuación. */
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty__icon" aria-hidden="true">
        <Icon name={icon} size={28} />
      </span>
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}
