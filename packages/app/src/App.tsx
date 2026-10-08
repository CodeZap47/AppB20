import { useState } from 'react';
import { createHashRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { ModulePage } from './pages/ModulePage';
import { SettingsPage } from './pages/SettingsPage';
import { InstallPage } from './pages/InstallPage';
import { DirectThread, GroupThread, MessagesLayout, ThreadPlaceholder } from './pages/MessagesPage';
import { PublishWorkPage, WorkPage, WorksPage } from './pages/WorksPage';
import { ProfilePage, ProfilesPage } from './pages/ProfilesPage';
import { BirthdaysPage } from './pages/BirthdaysPage';
import { WhatsNewPage } from './pages/WhatsNewPage';
import { ActivitiesPage, ActivityPage } from './pages/ActivitiesPage';
import { NoteFormPage, NotePage, NotesPage } from './pages/NotesPage';
import { AskQuestionPage, QuestionPage, QuestionsPage } from './pages/QuestionsPage';
import { SpacetimeProvider } from './lib/spacetime';
import { PlatformContext } from './components/PlatformContext';
import { DataProvider } from './data/DataContext';
import { createDemoState, DemoDataSource } from './data/demo';
import type { DataSource } from './data/types';
import type { Platform } from './platform';

/**
 * Se usa hash routing porque funciona igual en la web, en las páginas empaquetadas de la
 * extensión (chrome-extension://) y dentro del WebView de Capacitor.
 * Las rutas específicas de cada módulo van antes de la ruta genérica `m/:moduleId`.
 */
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <WhatsNewPage /> },
      { path: 'm/inicio', element: <WhatsNewPage /> },
      { path: 'modulos', element: <HomePage /> },
      {
        path: 'm/mensajes',
        element: <MessagesLayout />,
        // `fill`: la pantalla ocupa todo el alto y se desplaza por dentro (ver Layout).
        handle: { fill: true },
        children: [
          { index: true, element: <GroupThread /> },
          { path: 'directos', element: <ThreadPlaceholder /> },
          { path: 'directos/:conversationId', element: <DirectThread /> },
        ],
      },
      { path: 'm/tareas', element: <WorksPage /> },
      { path: 'm/tareas/nuevo', element: <PublishWorkPage /> },
      { path: 'm/tareas/:workId', element: <WorkPage /> },
      { path: 'm/perfiles', element: <ProfilesPage /> },
      { path: 'perfil/:memberId', element: <ProfilePage /> },
      { path: 'm/cumpleanos', element: <BirthdaysPage /> },
      { path: 'm/actividades', element: <ActivitiesPage /> },
      { path: 'm/actividades/:activityId', element: <ActivityPage /> },
      { path: 'm/notas', element: <NotesPage /> },
      { path: 'm/notas/nueva', element: <NoteFormPage /> },
      { path: 'm/notas/:noteId', element: <NotePage /> },
      { path: 'm/notas/:noteId/editar', element: <NoteFormPage /> },
      { path: 'm/preguntas', element: <QuestionsPage /> },
      { path: 'm/preguntas/nueva', element: <AskQuestionPage /> },
      { path: 'm/preguntas/:questionId', element: <QuestionPage /> },
      { path: 'm/:moduleId', element: <ModulePage /> },
      { path: 'ajustes', element: <SettingsPage /> },
      { path: 'instalar', element: <InstallPage /> },
    ],
  },
]);

export function App({ platform, source }: { platform: Platform; source?: DataSource }) {
  // Hasta conectar SpacetimeDB, la app usa datos de prueba en memoria.
  const [data] = useState(() => source ?? new DemoDataSource(createDemoState(), 'demo-1'));
  return (
    <PlatformContext value={platform}>
      <SpacetimeProvider>
        <DataProvider source={data}>
          <RouterProvider router={router} />
        </DataProvider>
      </SpacetimeProvider>
    </PlatformContext>
  );
}
