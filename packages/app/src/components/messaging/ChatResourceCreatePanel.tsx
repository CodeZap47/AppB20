import { lazy, Suspense, useState } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { ChatResourceKind } from '@b20/core';
import { useSnapshot } from '../../data/DataContext';
import { Icon } from '../Icon';
import { ChatButton } from './Messaging';
import type { ResourceFormContext } from './resourceFormContext';
import './commands.css';

const AssignmentForm = lazy(() => import('../../pages/WorksPage').then(m => ({ default: m.AssignmentForm })));
const WorkForm = lazy(() => import('../../pages/WorksPage').then(m => ({ default: m.SubmitWorkForAssignment })));
const ActivityForm = lazy(() => import('../../pages/ActivitiesPage').then(m => ({ default: m.ActivityForm })));
const NoteForm = lazy(() => import('../../pages/NotesPage').then(m => ({ default: m.NoteForm })));
const QuestionForm = lazy(() => import('../../pages/QuestionsPage').then(m => ({ default: m.AskQuestionPage })));

export const RESOURCE_LABELS: Record<ChatResourceKind, string> = {
  tarea: 'Tarea', trabajo: 'Trabajo', clase: 'Actividad de clase', nota: 'Nota', pregunta: 'Pregunta',
};

/** Module forms keep their normal page behavior; here their result returns to the draft. */
export function ChatResourceCreatePanel({ kind, initialTitle, onCreated, onClose }: {
  kind: ChatResourceKind; initialTitle?: string;
  onCreated: (id: string, shareable: boolean) => void; onClose: () => void;
}) {
  const { assignments } = useSnapshot();
  const [assignmentId, setAssignmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const form: ResourceFormContext = { initialTitle, onSaved: onCreated, onCancel: onClose, onBusyChange: setBusy };
  return <ModalOverlay isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={open => { if (!open && !busy) onClose(); }} className="chat-resource-overlay">
    <Modal className="chat-resource-modal">
      <Dialog className="chat-resource-dialog" aria-label={`Crear ${RESOURCE_LABELS[kind].toLowerCase()} en el chat`}>
        <header className="chat-resource-dialog__header">
          <div><Heading slot="title">Crear {RESOURCE_LABELS[kind].toLowerCase()}</Heading><p>Al guardar vuelves a tu borrador. Tú decides cuándo enviarlo.</p></div>
          <ChatButton type="button" variant="tertiary" aria-label="Cerrar creación y volver al chat" disabled={busy} onClick={onClose}><Icon name="close" /></ChatButton>
        </header>
        <div className="chat-resource-dialog__content">
          {kind === 'nota' && <p className="chat-command-notice">Comprueba la visibilidad: solo una nota del grupo se añadirá al borrador como referencia.</p>}
          {kind === 'trabajo' && <label className="field chat-resource-assignment"><span className="field__label">¿A qué tarea pertenece?</span>
            <select aria-label="Tarea del trabajo" value={assignmentId} disabled={busy} onChange={e => setAssignmentId(e.target.value)}>
              <option value="">Elige una tarea</option>{assignments.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select><span className="field__hint">El estado borrador o final del trabajo sigue siendo visible para el grupo.</span>
          </label>}
          <Suspense fallback={<p role="status">Cargando formulario…</p>}>
            {kind === 'tarea' && <AssignmentForm {...form} />}
            {kind === 'trabajo' && assignmentId && <WorkForm key={assignmentId} assignmentId={assignmentId} {...form} />}
            {kind === 'clase' && <ActivityForm {...form} />}
            {kind === 'nota' && <NoteForm {...form} />}
            {kind === 'pregunta' && <QuestionForm {...form} />}
          </Suspense>
        </div>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
