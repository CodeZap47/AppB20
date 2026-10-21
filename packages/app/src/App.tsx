import { useEffect, useState } from 'react';
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
import { GuideCompendiumPage, GuideFormPage, GuidePage, GuidesPage } from './pages/GuidesPage';
import { WhatsNewPage } from './pages/WhatsNewPage';
import { ContributorPage, LeaderboardPage } from './pages/LeaderboardPage';
import { PollFormPage, PollPage, PollsPage } from './pages/PollsPage';
import { HelpPage, HelpFormPage, HelpPostPage, HelpContactsPage } from './pages/HelpPage';
import { ActivitiesPage, ActivityFormPage, ActivityPage } from './pages/ActivitiesPage';
import { NoteFormPage, NotePage, NotesPage } from './pages/NotesPage';
import { AskQuestionPage, QuestionPage, QuestionsPage } from './pages/QuestionsPage';
import { TeachingFormPage, TeachingPage, TeachingPracticePage } from './pages/TeachingPage';
import { SpacedPage, SpacedCollectionPage, SpacedCollectionFormPage, SpacedCardFormPage, SpacedSessionPage } from './pages/SpacedPage';
import { SpacetimeProvider } from './lib/spacetime';
import { AuthProvider, useSession, useSessionStore } from './auth/AuthContext';
import { SignInPage } from './auth/SignInPage';
import { JoinPage } from './auth/JoinPage';
import { AuthFrame } from './auth/AuthFrame';
import { useDataSource, useSnapshot } from './data/DataContext';
import { SpacetimeDataSource } from './data/spacetime';
import { config } from './config';
import { PlatformContext } from './components/PlatformContext';
import { DataProvider } from './data/DataContext';
import { createDemoState, DemoDataSource } from './data/demo';
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
          { path: 'm/guias', element: <GuidesPage /> },
          { path: 'm/guias/nueva', element: <GuideFormPage /> },
          { path: 'm/guias/compendio', element: <GuideCompendiumPage /> },
          { path: 'm/guias/:guideId', element: <GuidePage /> },
          { path: 'm/guias/:guideId/editar', element: <GuideFormPage /> },
          { path: 'm/aprende-ensenando', element: <TeachingPage /> },
          { path: 'm/aprende-ensenando/nueva', element: <TeachingFormPage /> },
          { path: 'm/aprende-ensenando/:practiceId', element: <TeachingPracticePage /> },
          { path: 'm/repaso', element: <SpacedPage /> },
          { path: 'm/repaso/nueva', element: <SpacedCollectionFormPage /> },
          { path: 'm/repaso/colecciones/:collectionId', element: <SpacedCollectionPage /> },
          { path: 'm/repaso/colecciones/:collectionId/editar', element: <SpacedCollectionFormPage /> },
          { path: 'm/repaso/tarjetas/nueva', element: <SpacedCardFormPage /> },
          { path: 'm/repaso/tarjetas/:cardId/editar', element: <SpacedCardFormPage /> },
          { path: 'm/repaso/sesion', element: <SpacedSessionPage /> },
          { path: 'm/leaderboard', element: <LeaderboardPage /> },
          { path: 'm/leaderboard/:memberId', element: <ContributorPage /> },
          { path: 'm/votaciones', element: <PollsPage /> },
          { path: 'm/votaciones/nueva', element: <PollFormPage /> },
          { path: 'm/votaciones/:pollId', element: <PollPage /> },
          { path: 'm/votaciones/:pollId/editar', element: <PollFormPage /> },
          { path: 'm/ayuda', element: <HelpPage /> },
          { path: 'm/ayuda/nueva', element: <HelpFormPage /> },
          { path: 'm/ayuda/contactos', element: <HelpContactsPage /> },
          { path: 'm/ayuda/:postId', element: <HelpPostPage /> },
          { path: 'm/ayuda/:postId/editar', element: <HelpFormPage /> },
          { path: 'm/:moduleId', element: <ModulePage /> },
          { path: 'ajustes', element: <SettingsPage /> },
          { path: 'instalar', element: <InstallPage /> },
        ],
      },
    ],
  },
]);

/** La autenticación es obligatoria en ambos modos; la URL nunca permite omitirla. */
export function App({ platform }: { platform: Platform }) {
  const clientId = platform === 'android'
    ? config.spacetimeAuthAndroidClientId || config.spacetimeAuthClientId
    : platform.startsWith('extension')
      ? config.spacetimeAuthExtensionClientId || config.spacetimeAuthClientId
      : config.spacetimeAuthClientId;
  return (
    <PlatformContext value={platform}>
      <AuthProvider clientId={clientId} platform={platform}>
        <SignedInGate />
      </AuthProvider>
    </PlatformContext>
  );
}

/** Una sesión real puede usar fixtures privados en memoria o el grupo real según configuración. */
function SignedInGate() {
  const session = useSession();
  if (session?.status !== 'signedIn') return <SignInPage />;
  if (config.dataMode === 'demo') {
    return <DemoApp subject={session.profile.subject} key={session.profile.subject} />;
  }
  return (
    <SpacetimeProvider token={session.token} key={session.token}>
      <MembershipGate />
    </SpacetimeProvider>
  );
}

/**
 * Con sesión: mientras llegan los datos dice que está conectando; sin membresía activa pide
 * unirse. Solo después muestra la app.
 */
function MembershipGate() {
  const { connection, connectionError, me } = useSnapshot();
  const dataSource = useDataSource();
  const sessionStore = useSessionStore();
  if (connection === 'offline') {
    return (
      <AuthFrame title="No pudimos conectar con tu grupo"
        description="Comprueba tu conexión y vuelve a intentarlo.">
        <p className="auth-feedback auth-feedback--error" role="alert">{connectionError ?? 'No se pudo conectar con el grupo.'}</p>
        <button type="button" className="auth-action" onClick={() => {
          if (dataSource instanceof SpacetimeDataSource) dataSource.connect();
        }}>Volver a conectar</button>
        <button type="button" className="auth-action auth-action--secondary" onClick={() => sessionStore?.signOut()}>
          Cerrar sesión
        </button>
      </AuthFrame>
    );
  }
  if (connection === 'connecting') {
    return (
      <AuthFrame title="Conectando con tu grupo" busy>
        <p className="auth-loading" role="status"><span className="auth-spinner" aria-hidden="true" />Conectando con el grupo…</p>
      </AuthFrame>
    );
  }
  if (me?.status !== 'active') return <JoinPage />;
  return <RouterProvider router={router} />;
}

function DemoApp({ subject }: { subject: string }) {
  const [owned, setOwned] = useState<{ subject: string; data: DemoDataSource } | null>(null);
  useEffect(() => {
    // StrictMode ejecuta setup/cleanup/setup: cada setup debe poseer una fuente nueva.
    const data = new DemoDataSource(createDemoState(), 'demo-1');
    setOwned({ subject, data });
    return () => data.dispose();
  }, [subject, createDemoState]);
  if (!owned || owned.subject !== subject) {
    return <AuthFrame title="Todo listo para explorar" busy>
      <p className="auth-loading" role="status"><span className="auth-spinner" aria-hidden="true" />Preparando datos de prueba…</p>
    </AuthFrame>;
  }
  return (
    <DataProvider source={owned.data}>
      <RouterProvider router={router} />
    </DataProvider>
  );
}
