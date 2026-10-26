import { useEffect, useState } from 'react';
import { createHashRouter, RouterProvider, type RouteObject } from 'react-router';
import { displayNameError } from '@b20/core';
import { ErrorPage } from './components/ErrorPage';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { ModulePage } from './pages/ModulePage';
import { SettingsPage } from './pages/SettingsPage';
import { InstallPage } from './pages/InstallPage';
import { DirectThread, GroupThread, ChannelThread, MessagesLayout, ThreadPlaceholder } from './pages/MessagesPage';
import { RetiredContentPage } from './pages/RetiredContentPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ChallengesPage, ChallengeCreatePage, ChallengeDetailPage, CodeReviewsPage, CodeReviewCreatePage, CodeReviewDetailPage } from './pages/PracticePage';
import { MuseumPage } from './pages/MuseumPage';
import { OpportunitiesPage } from './pages/OpportunitiesPage';
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
import { RoomFormPage, RoomPage, RoomsPage } from './pages/RoomsPage';
import { AgentPage } from './pages/AgentPage';
import { SpacedPage, SpacedCollectionPage, SpacedCollectionFormPage, SpacedCardFormPage, SpacedSessionPage } from './pages/SpacedPage';
import { PresentationsPage, PresentationFormPage, PresentationPracticePage, PresentationAttemptPage } from './pages/PresentationsPage';
import { ExamsPage, ExamCreatePage } from './pages/ExamsPage';
import { ExamPage, ExamAttemptPage } from './pages/ExamDetailPage';
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
import { ThemeProvider } from './design/Theme';
import { AssignmentCalendarPage, SubjectsPage } from './pages/AcademicHubPages';
import { useSupabaseAuth } from './auth/SupabaseAuthProvider';
import { CreatePasswordPage, PasskeySuggestionPage } from './auth/SupabaseSignInForm';
import { capturePendingInvitation, clearPendingInvitation, preparePendingInvitation } from './auth/pendingInvitation';
import { captureInviteLink } from './auth/inviteLink';

captureInviteLink();
capturePendingInvitation();

function InvitationAlreadyJoined() {
  useEffect(() => { clearPendingInvitation(); }, []);
  return <section className="panel"><h1>Ya eres integrante del grupo</h1><p>Este enlace no cambia tu acceso actual.</p><a href="#/modulos">Entrar al grupo</a></section>;
}

/**
 * Se usa hash routing porque funciona igual en la web, en las páginas empaquetadas de la
 * extensión (chrome-extension://) y dentro del WebView de Capacitor.
 * Las rutas específicas de cada módulo van antes de la ruta genérica `m/:moduleId`.
 */
export const routes: RouteObject[] = [
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
          { path: 'invitacion', element: <InvitationAlreadyJoined /> },
          { path: 'm/inicio', element: <WhatsNewPage /> },
          { path: 'modulos', element: <HomePage /> },
          { path: 'm/calendario', element: <AssignmentCalendarPage /> },
          { path: 'm/materias', element: <SubjectsPage /> },
          { path: 'm/materias/:subjectId', element: <SubjectsPage /> },
          {
            path: 'm/mensajes',
            element: <MessagesLayout />,
            // `fill`: la pantalla ocupa todo el alto y se desplaza por dentro (ver Layout).
            handle: { fill: true },
            children: [
              { index: true, element: <GroupThread /> },
              { path: 'directos', element: <ThreadPlaceholder /> },
              { path: 'directos/:conversationId', element: <DirectThread /> },
              { path: 'canales/:channelId', element: <ChannelThread /> },
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
          { path: 'm/retirados', element: <RetiredContentPage /> },
          { path: 'm/avisos', element: <NotificationsPage /> },
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
          { path: 'm/salas', element: <RoomsPage /> },
          { path: 'm/salas/nueva', element: <RoomFormPage /> },
          { path: 'm/salas/:roomId', element: <RoomPage /> },
          { path: 'm/salas/:roomId/editar', element: <RoomFormPage /> },
          { path: 'm/agente', element: <AgentPage /> },
          { path: 'm/repaso', element: <SpacedPage /> },
          { path: 'm/repaso/nueva', element: <SpacedCollectionFormPage /> },
          { path: 'm/repaso/colecciones/:collectionId', element: <SpacedCollectionPage /> },
          { path: 'm/repaso/colecciones/:collectionId/editar', element: <SpacedCollectionFormPage /> },
          { path: 'm/repaso/tarjetas/nueva', element: <SpacedCardFormPage /> },
          { path: 'm/repaso/tarjetas/:cardId/editar', element: <SpacedCardFormPage /> },
          { path: 'm/repaso/sesion', element: <SpacedSessionPage /> },
          { path: 'm/exposiciones', element: <PresentationsPage /> },
          { path: 'm/exposiciones/nueva', element: <PresentationFormPage /> },
          { path: 'm/exposiciones/:practiceId', element: <PresentationPracticePage /> },
          { path: 'm/exposiciones/:practiceId/editar', element: <PresentationFormPage /> },
          { path: 'm/exposiciones/:practiceId/intentos/:attemptId', element: <PresentationAttemptPage /> },
          { path: 'm/examenes', element: <ExamsPage /> },
          { path: 'm/examenes/nuevo', element: <ExamCreatePage /> },
          { path: 'm/examenes/intentos/:attemptId', element: <ExamAttemptPage /> },
          { path: 'm/examenes/:examId/regenerar', element: <ExamCreatePage /> },
          { path: 'm/examenes/:examId', element: <ExamPage /> },
          { path: 'm/leaderboard', element: <LeaderboardPage /> },
          { path: 'm/leaderboard/:memberId', element: <ContributorPage /> },
          { path: 'm/votaciones', element: <PollsPage /> },
          { path: 'm/votaciones/nueva', element: <PollFormPage /> },
          { path: 'm/votaciones/:pollId', element: <PollPage /> },
          { path: 'm/votaciones/:pollId/editar', element: <PollFormPage /> },
          { path: 'm/ayuda', element: <HelpPage /> },
          { path: 'm/retos', element: <ChallengesPage /> },
          { path: 'm/retos/nuevo', element: <ChallengeCreatePage /> },
          { path: 'm/retos/:challengeId', element: <ChallengeDetailPage /> },
          { path: 'm/revision-codigo', element: <CodeReviewsPage /> },
          { path: 'm/revision-codigo/nueva', element: <CodeReviewCreatePage /> },
          { path: 'm/revision-codigo/:reviewId', element: <CodeReviewDetailPage /> },
          { path: 'm/museo-bugs', element: <MuseumPage /> },
          { path: 'm/oportunidades', element: <OpportunitiesPage /> },
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
];

const router = createHashRouter(routes);

/** La autenticación es obligatoria en ambos modos; la URL nunca permite omitirla. */
export function App({ platform }: { platform: Platform }) {
  const [invitationReady, setInvitationReady] = useState(false);
  useEffect(() => { let alive = true; void preparePendingInvitation().finally(() => { if (alive) setInvitationReady(true); }); return () => { alive = false; }; }, []);
  if (!invitationReady) return <AuthFrame title="Preparando el acceso" busy><p role="status">Preparando el acceso…</p></AuthFrame>;
  return (
    <ThemeProvider><PlatformContext value={platform}>
      <AuthProvider platform={platform}>
        <SignedInGate />
      </AuthProvider>
    </PlatformContext></ThemeProvider>
  );
}

/** Una sesión real puede usar fixtures privados en memoria o el grupo real según configuración. */
function SignedInGate() {
  const session = useSession();
  const supabase = useSupabaseAuth();
  if (supabase?.pending === 'password') return <CreatePasswordPage />;
  if (supabase?.pending === 'passkey') return <PasskeySuggestionPage />;
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
 * Con sesión: espera los datos y exige membresía activa y nombre válido antes de abrir la app.
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
  if (me?.status !== 'active' || displayNameError(me.displayName)) return <JoinPage />;
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
