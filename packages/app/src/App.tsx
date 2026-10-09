import { useMemo } from 'react';
import { createHashRouter, RouterProvider } from 'react-router';
import { ErrorPage } from './components/ErrorPage';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { ModulePage } from './pages/ModulePage';
import { SettingsPage } from './pages/SettingsPage';
import { InstallPage } from './pages/InstallPage';
import { DirectThread, GroupThread, MessagesLayout, ThreadPlaceholder } from './pages/MessagesPage';
import { CommandsPage, StickersPage } from './pages/ChatToolsPage';
import {
  AssignmentFormPage,
  AssignmentPage,
  AssignmentsPage,
  SubmitWorkPage,
} from './pages/WorksPage';
import { ProfilePage, ProfilesPage } from './pages/ProfilesPage';
import { BirthdaysPage } from './pages/BirthdaysPage';
import { WhatsNewPage } from './pages/WhatsNewPage';
import { ActivitiesPage, ActivityFormPage, ActivityPage } from './pages/ActivitiesPage';
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
    // Si el propio armazón falla no queda menú: el aviso ocupa toda la pantalla.
    errorElement: <ErrorPage />,
    children: [
      {
        // Un fallo en una pantalla se muestra dentro del armazón, con el menú a la mano.
        errorElement: <ErrorPage />,
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
              { path: 'stickers', element: <StickersPage /> },
              { path: 'comandos', element: <CommandsPage /> },
            ],
          },
          { path: 'm/tareas', element: <AssignmentsPage /> },
          { path: 'm/tareas/nueva', element: <AssignmentFormPage /> },
          { path: 'm/tareas/:assignmentId', element: <AssignmentPage /> },
          { path: 'm/tareas/:assignmentId/editar', element: <AssignmentFormPage /> },
          { path: 'm/tareas/:assignmentId/subir', element: <SubmitWorkPage /> },
          { path: 'm/perfiles', element: <ProfilesPage /> },
          { path: 'perfil/:memberId', element: <ProfilePage /> },
          { path: 'm/cumpleanos', element: <BirthdaysPage /> },
          { path: 'm/actividades', element: <ActivitiesPage /> },
          { path: 'm/actividades/nueva', element: <ActivityFormPage /> },
          { path: 'm/actividades/:activityId', element: <ActivityPage /> },
          { path: 'm/actividades/:activityId/editar', element: <ActivityFormPage /> },
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
    ],
  },
]);

export function App({ platform, source }: { platform: Platform; source?: DataSource }) {
  // Hasta conectar SpacetimeDB, la app usa datos de prueba en memoria. Dependen de
  // `createDemoState` a propósito: en desarrollo, cuando ese módulo se recarga en caliente
  // (porque cambió la forma de los datos), se crean de nuevo. Si no, el estado en memoria
  // conserva la forma anterior y las pantallas que esperan los campos nuevos fallan.
  const data = useMemo(
    () => source ?? new DemoDataSource(createDemoState(), 'demo-1'),
    [source, createDemoState],
  );
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
