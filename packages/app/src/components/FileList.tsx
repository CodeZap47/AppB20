import type { ReactNode } from 'react';
import { formatBytes } from '@b20/core';
import { Icon } from './Icon';

export interface FileItem {
  key: string;
  name: string;
  size: number;
  /** Con enlace, el nombre descarga el archivo. */
  url?: string;
  /** Texto secundario junto al tamaño: quién lo subió y cuándo. */
  detail?: ReactNode;
}

export function FileList({
  items,
  onRemove,
}: {
  items: FileItem[];
  /** Si se pasa, cada archivo lleva un botón para quitarlo. */
  onRemove?: (key: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="files">
      {items.map((item) => (
        <li key={item.key} className="file">
          <span className="file__icon" aria-hidden="true">
            <Icon name="file" />
          </span>
          <span className="file__main">
            {item.url ? (
              <a className="file__name" href={item.url} download={item.name}>
                {item.name}
              </a>
            ) : (
              <span className="file__name">{item.name}</span>
            )}
            <span className="file__meta">
              {formatBytes(item.size)}
              {item.detail && <> · {item.detail}</>}
            </span>
          </span>
          {onRemove && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Quitar ${item.name}`}
              title="Quitar"
              onClick={() => onRemove(item.key)}
            >
              <Icon name="trash" size={18} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
