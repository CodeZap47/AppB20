import type { FC } from 'react';
import { navigableModules, type ModuleInfo } from '@b20/core';
import {
  Award01, BarChartSquare02, BookOpen01, CalendarHeart01, CheckDone01, Cube01,
  Download01, File02, GraduationHat01, HelpCircle, HomeLine, LifeBuoy01,
  MessageChatCircle, NotificationBox, PresentationChart01, RefreshCw01, Settings01, Stars01, User01, Users01,
} from '@untitledui/icons';
import type { NavItemType } from '@b20-ui/components/application/app-navigation/config';

type NavigationIcon = FC<{ className?: string }>;
export type NavigationItem = NavItemType & { icon: NavigationIcon };

const STUDY_MODULES = ['calendario', 'materias', 'tareas', 'notas', 'preguntas', 'guias', 'retos', 'revision-codigo', 'museo-bugs', 'aprende-ensenando', 'repaso', 'salas', 'exposiciones', 'examenes', 'senales', 'agente'];
const COMMUNITY_MODULES = ['perfiles', 'cumpleanos', 'votaciones', 'ayuda', 'oportunidades', 'leaderboard'];
const MODULE_ICONS: Record<string, NavigationIcon> = {
  calendario: CalendarHeart01,
  materias: BookOpen01,
  inicio: HomeLine,
  mensajes: MessageChatCircle,
  tareas: CheckDone01,
  notas: File02,
  preguntas: HelpCircle,
  guias: BookOpen01,
  retos: CheckDone01,
  'revision-codigo': File02,
  'museo-bugs': HelpCircle,
  'aprende-ensenando': GraduationHat01,
  repaso: RefreshCw01,
  salas: Users01,
  exposiciones: PresentationChart01,
  examenes: CheckDone01,
  agente: Stars01,
  senales: MessageChatCircle,
  perfiles: User01,
  cumpleanos: CalendarHeart01,
  votaciones: BarChartSquare02,
  ayuda: LifeBuoy01,
  oportunidades: Award01,
  leaderboard: Award01,
};

/** The catalog owns availability and labels; this configuration only groups destinations. */
export function buildNavigation(modules: readonly ModuleInfo[] = navigableModules()): {
  items: NavigationItem[];
  footerItems: NavigationItem[];
} {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const links = (ids: string[]) => ids.flatMap((id) => {
    const module = byId.get(id);
    return module ? [{ label: module.title, href: `/m/${module.id}`, icon: MODULE_ICONS[id] }] : [];
  });
  const items: NavigationItem[] = [];
  if (byId.has('inicio')) items.push({ label: 'Inicio', href: '/m/inicio', icon: HomeLine });
  if (byId.has('mensajes')) items.push({ label: byId.get('mensajes')!.title, href: '/m/mensajes', icon: MessageChatCircle });
  const study = links(STUDY_MODULES);
  const community = links(COMMUNITY_MODULES);
  if (study.length) items.push({ label: 'Estudio', icon: BookOpen01, items: study });
  if (byId.has('laboratorio-visual')) items.push({ label: byId.get('laboratorio-visual')!.title, href: '/m/laboratorio-visual', icon: Cube01 });
  if (community.length) items.push({ label: 'Comunidad', icon: Users01, items: community });
  return {
    items,
    footerItems: [
      { label: 'Avisos', href: '/m/avisos', icon: NotificationBox },
      { label: 'Ajustes', href: '/ajustes', icon: Settings01 },
      { label: 'Instalar app', href: '/instalar', icon: Download01 },
    ],
  };
}

/** Canonical leaf for details/forms and legacy aliases, with complete path segments. */
export function resolveActiveUrl(
  pathname: string,
  items: NavItemType[],
  footerItems: NavItemType[] = [],
): string | undefined {
  let path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/modulos') path = '/m/inicio';
  else if (path.startsWith('/perfil/')) path = '/m/perfiles';
  else if (path === '/m/actividades' || path.startsWith('/m/actividades/')) path = '/m/tareas';
  const leaves = [...items, ...footerItems].flatMap<NavItemType>((item) => item.items?.length ? item.items : [item]);
  return leaves
    .filter((item): item is typeof item & { href: string } => Boolean(item.href))
    .sort((left, right) => right.href.length - left.href.length)
    .find((item) => path === item.href || path.startsWith(`${item.href}/`))?.href;
}
