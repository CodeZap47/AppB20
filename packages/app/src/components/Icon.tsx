import type { ReactNode } from 'react';

const ICONS = {
  back: <path d="M15 5l-7 7 7 7" />,
  chat: <path d="M4 5h16v11H9.5L4 20z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  clip: <path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.8 17.1a1.7 1.7 0 0 1-2.4-2.4L15 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  down: <path d="M12 5v14M5 12l7 7 7-7" />,
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13 7l4 4" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </>
  ),
  folder: <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18.5" cy="12" r="1.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  reply: <path d="M10 6L4 12l6 6M4.5 12H14a6 6 0 0 1 6 6v1" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  slash: <path d="M15 4L9 20" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14a4 4 0 0 0 7 0M9.5 9.5v.5M14.5 9.5v.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20.5 20.5L16 16" />
    </>
  ),
  send: <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />,
  trash: (
    <>
      <path d="M4 7h16M10 7V4h4v3" />
      <path d="M6.5 7l1 13h9l1-13" />
    </>
  ),
  upload: <path d="M12 16V4M6.5 9.5L12 4l5.5 5.5M4 20h16" />,
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <circle cx="17.5" cy="9.5" r="2.5" />
      <path d="M17.5 14.5a4.5 4.5 0 0 1 4 4.5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

/** Iconos de línea propios; son decorativos, el texto accesible va en el control que los usa. */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
