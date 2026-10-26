import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import { routes } from '../../../packages/app/src/App';
import { DataProvider } from '../../../packages/app/src/data/DataContext';
import { createDemoState, DemoDataSource } from '../../../packages/app/src/data/demo';
import { ThemeProvider } from '../../../packages/app/src/design/Theme';
import { PlatformContext } from '../../../packages/app/src/components/PlatformContext';
import { replayWelcomeTour } from '../../../packages/app/src/components/WelcomeTour';
import { dayKey } from '../../../packages/app/src/lib/dueCalendar';
import { seedFeedReview } from './feedReviewFixtures';
import '@b20/app/styles.css';

/** Separate comparison entry: synthetic data only, excluded from normal production builds. */
if (!import.meta.env.DEV && import.meta.env.MODE !== 'design-preview')
  throw new Error('Esta entrada solo sirve para comparar diseños con datos ficticios.');
const state = createDemoState();
const names = [
  'Kevin Alcaraz',
  'Luis Flores Bojorquez',
  'Gamaliel Seefoo',
  'Christian',
  'Ana · ejemplo',
  'Sofía · ejemplo',
  'Diego · ejemplo',
  'Alex · ejemplo',
];
state.members.forEach((member, index) => {
  member.displayName = names[index]!;
  member.isCreator = index < 4;
});
const today = new Date();
const inDays = (days: number) =>
  dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
const titles = [
  'Tablas de verdad y equivalencias',
  'Diseño de un algoritmo',
  'Lógica aplicada: exposición en equipo',
];
state.assignments.forEach((assignment, index) => {
  assignment.title = titles[index] ?? assignment.title;
  assignment.dueDate = inDays(index * 3);
  assignment.instructions =
    'Analiza el problema, explica tu razonamiento y comparte una solución con el grupo. Consulta los apuntes vinculados como referencia. Material de ejemplo para esta vista de diseño.';
});
const exampleAssignment = state.assignments[0]!;
state.assignments.push(
  ...[2, 7, 11].map((days, index) => ({
    ...exampleAssignment,
    id: `preview-${index}`,
    title: ['Conjuntos y operaciones', 'De la idea al pseudocódigo', 'Práctica de proposiciones'][
      index
    ]!,
    dueDate: inDays(days),
    version: 1,
  })),
);
const exampleNote = state.notes.find((note) => note.visibility === 'group');
if (exampleNote) {
  exampleNote.authorId = 'demo-1';
  exampleNote.title = 'Cómo construir una tabla de verdad';
  exampleNote.subjectId = exampleAssignment.subjectId;
  exampleNote.assignmentIds = [exampleAssignment.id];
}
if (new URLSearchParams(window.location.search).get('feed-review') === '1') seedFeedReview(state);
const source = new DemoDataSource(state, 'demo-1');
source.saveMemberProfile({
  preferredName: 'Kevin',
  bio: 'Construyendo cosas y aprendiendo en el camino. Me interesa el diseño de interfaces, el desarrollo web y las buenas ideas que se comparten.',
  interests: ['Diseño', 'Desarrollo web'],
  learningGoals: 'Crear herramientas que nos ayuden a aprender mejor.',
  skills: ['TypeScript', 'Interfaces'],
  helpTopics: ['Lógica'],
  portfolioLinks: [],
  subjectIds: state.subjects
    .filter((subject) => subject.period === 1)
    .slice(0, 2)
    .map((subject) => subject.id),
  expectedVersion: 0,
});
const router = createHashRouter(routes);

function PreviewTools() {
  return (
    <details className="design-preview-tools">
      <summary>Vista de diseño · datos ficticios</summary>
      <div>
        <nav aria-label="Comparar pantallas">
          <a href="./">Login</a>
          <a href="#/m/calendario">Calendario</a>
          <a href={`#/m/materias/${exampleAssignment.subjectId}`}>Materias</a>
          <a href="#/perfil/demo-1">Perfil</a>
          <a href="#/m/mensajes">Mensajes</a>
          <button onClick={replayWelcomeTour}>Tutorial</button>
        </nav>
        <small>Los nombres ilustran el distintivo solicitado. No son cuentas conectadas.</small>
      </div>
    </details>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <PlatformContext value="web">
      <DataProvider source={source}>
        <RouterProvider router={router} />
        <PreviewTools />
      </DataProvider>
    </PlatformContext>
  </ThemeProvider>,
);
