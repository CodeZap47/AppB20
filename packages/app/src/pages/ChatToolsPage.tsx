import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { CHAT_RESOURCE_KINDS, commandNameError, normalizeCommandName, type ChatResourceKind } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { ChatCommand, SaveChatCommandInput } from '../data/types';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { ToolPage } from '../components/messaging/ChatToolLayout';
import { ChatButton } from '../components/messaging/Messaging';
import { RESOURCE_LABELS } from '../components/messaging/ChatResourceCreatePanel';
import { commandConversation } from '../lib/commandNavigation';
import { memberName } from '../lib/format';
import { useAction } from '../components/useAction';
import '../components/messaging/commands.css';
export { StickersPage } from './StickerToolsPage';

const EMPTY = { name: '', description: '', text: '', visibility: 'personal' as const,
  actionKind: 'text' as const, resourceKind: 'tarea' as ChatResourceKind };
type CommandForm = Omit<SaveChatCommandInput, 'id' | 'expectedVersion'> & { visibility: 'personal' | 'classroom'; actionKind: 'text' | 'create'; resourceKind: ChatResourceKind };
const BUILT_INS = [
  ...CHAT_RESOURCE_KINDS.map(kind => ({ name: kind, title: RESOURCE_LABELS[kind], detail: 'Busca una referencia o crea un recurso desde el chat.' })),
  { name: 'sticker', title: 'Stickers', detail: 'Abre el selector para enviar un sticker.' },
  { name: 'codigo', title: 'Código', detail: 'Inserta un bloque de código editable.' },
];

/** Personal templates and shared shortcuts use the same live command catalogue. */
export function CommandsPage() {
  const source = useDataSource();
  const navigate = useNavigate();
  const { me, members, chatCommands } = useSnapshot();
  const { error, pending, run } = useAction();
  const [editing, setEditing] = useState<ChatCommand | null>(null);
  const [form, setForm] = useState<CommandForm>(EMPTY);
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState<ChatCommand | null>(null);
  const working = useRef(false);
  const editorRef = useRef<HTMLElement>(null);
  const name = normalizeCommandName(form.name);
  const taken = chatCommands.filter(c => c.id !== editing?.id && (c.ownerId === me?.id ||
    (form.visibility === 'classroom' && c.visibility === 'classroom'))).map(c => c.name);
  const nameProblem = form.name ? commandNameError(name, taken) : undefined;
  const sorted = [...chatCommands].sort((a, b) => a.name.localeCompare(b.name));
  const reset = () => { setEditing(null); setForm(EMPTY); };
  const focusEditor = () => requestAnimationFrame(() => {
    editorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    editorRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  });
  const startEdit = (command: ChatCommand) => {
    setEditing(command); setNotice('');
    setForm({ name: command.name, description: command.description, text: command.text,
      visibility: command.visibility ?? 'personal', actionKind: command.actionKind ?? 'text', resourceKind: command.resourceKind ?? 'tarea' });
    focusEditor();
  };
  const copy = (command: ChatCommand) => {
    const ownNames = new Set(chatCommands.filter(c => c.ownerId === me?.id).map(c => c.name));
    let copyName = command.name;
    let suffix = 1;
    while (ownNames.has(copyName)) copyName = `${command.name.slice(0, 17)}-copia${suffix++ === 1 ? '' : suffix - 1}`;
    setEditing(null); setForm({ name: copyName, description: command.description, text: command.text,
      visibility: 'personal', actionKind: command.actionKind ?? 'text', resourceKind: command.resourceKind ?? 'tarea' });
    setNotice('Copia personal preparada. Revisa el nombre y guarda tu comando.'); focusEditor();
  };
  const tryCommand = (command: { name: string; id?: string }) => {
    if (!me) return;
    void navigate(commandConversation(me.id), { state: { messageCommand: command.name, commandId: command.id } });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (working.current || nameProblem) return;
    working.current = true;
    try {
      const result = await run(() => source.saveChatCommand({ id: editing?.id, ...form, name,
        resourceKind: form.actionKind === 'create' ? form.resourceKind : undefined, expectedVersion: editing?.version }));
      if (result) { setNotice(`/${name} guardado. Ya está disponible ${form.visibility === 'classroom' ? 'para el salón' : 'en tus chats'}.`); reset(); }
    } finally { working.current = false; }
  };
  const remove = async () => {
    if (!removing || working.current) return;
    working.current = true;
    try {
      const id = removing.id;
      if (await run(async () => { await source.removeChatCommand(id); return true; })) {
        setRemoving(null); setNotice('Comando retirado. Los mensajes que ya se enviaron se conservan.');
        if (editing?.id === id) reset();
      }
    } finally { working.current = false; }
  };

  return <ToolPage title="Comandos" subtitle="Cita recursos, crea desde el chat y guarda tus propios atajos">
    <div className="chat-commands">
      <section className="chat-command-section" aria-labelledby="builtin-commands-title">
        <header><p className="label">Explora los atajos</p><h3 id="builtin-commands-title">Comandos de la app</h3><p className="muted">Escribe / en una conversación. Puedes elegir un recurso existente o crear uno sin salir del chat.</p></header>
        <div className="chat-command-catalogue">{BUILT_INS.map(c => <article key={c.name} className="chat-command-card">
          <div><code>/{c.name}</code><h4>{c.title}</h4><p>{c.detail}</p></div>
          <ChatButton type="button" variant="secondary" onClick={() => tryCommand(c)}>Probar en el chat</ChatButton>
        </article>)}</div>
      </section>

      <section className="chat-command-section chat-command-editor" ref={editorRef} aria-labelledby="command-editor-title">
        <header><p className="label">Tu propio atajo</p><h3 id="command-editor-title">{editing ? `Editar /${editing.name}` : 'Crear un comando'}</h3><p className="muted">Inserta una plantilla o abre el formulario de un recurso. El mensaje siempre queda listo para revisar antes de enviar.</p></header>
        <form className="form" onSubmit={submit} aria-busy={pending}>
          <fieldset disabled={pending} className="chat-command-fields">
            <div className="form__grid">
              <label className="field"><span className="field__label">Nombre</span><span className="command-input"><span aria-hidden="true">/</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="saludo" maxLength={25} required aria-invalid={Boolean(nameProblem)} /></span><span className={nameProblem ? 'field__hint error' : 'field__hint'}>{nameProblem ?? 'De 1 a 24 letras, números o guiones.'}</span></label>
              <label className="field"><span className="field__label">Descripción <span className="field__optional">opcional</span></span><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Para qué sirve" maxLength={80} /></label>
            </div>
            <div className="form__grid">
              <label className="field"><span className="field__label">Quién puede usarlo</span><select value={form.visibility} onChange={e => setForm({ ...form, visibility: e.target.value as CommandForm['visibility'] })}><option value="personal">Solo yo</option><option value="classroom">Todo el salón</option></select><span className="field__hint">Solo el autor puede editarlo. Un administrador puede retirar un comando compartido.</span></label>
              <label className="field"><span className="field__label">Qué hace</span><select value={form.actionKind} onChange={e => setForm({ ...form, actionKind: e.target.value as CommandForm['actionKind'] })}><option value="text">Insertar texto</option><option value="create">Crear un recurso</option></select></label>
            </div>
            {form.actionKind === 'text' ? <label className="field"><span className="field__label">Texto que inserta</span><textarea value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} rows={4} maxLength={2000} required /><span className="field__hint">Admite enlaces y bloques de código. Puedes editarlo antes de enviar.</span></label> : <label className="field"><span className="field__label">Recurso que crea</span><select value={form.resourceKind} onChange={e => setForm({ ...form, resourceKind: e.target.value as ChatResourceKind })}>{CHAT_RESOURCE_KINDS.map(kind => <option key={kind} value={kind}>{RESOURCE_LABELS[kind]}</option>)}</select><span className="field__hint">Abre un formulario dentro del chat; no publica ni envía nada por sí solo.</span></label>}
            <div className="chat-command-preview"><span className="label">Vista previa</span><strong>/{name || 'nombre'}</strong>{form.actionKind === 'text' ? <pre>{form.text || 'El texto de tu plantilla aparecerá aquí.'}</pre> : <p>Abre el formulario para crear {RESOURCE_LABELS[form.resourceKind].toLowerCase()} y vuelve al borrador.</p>}</div>
          </fieldset>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="form__actions">{editing && <ChatButton type="button" variant="secondary" onClick={reset} disabled={pending}>Cancelar edición</ChatButton>}<ChatButton type="submit" loading={pending} disabled={!form.name || (form.actionKind === 'text' && !form.text.trim()) || Boolean(nameProblem)}>{editing ? 'Guardar cambios' : 'Crear comando'}</ChatButton></div>
        </form>
      </section>
      {notice && <p className="chat-command-notice" role="status">{notice}</p>}
      <section className="chat-command-section" aria-labelledby="saved-commands-title"><header><p className="label">Listos para usar</p><h3 id="saved-commands-title">Tus comandos y los del salón</h3></header>
        {sorted.length === 0 ? <Empty icon="slash" title="Crea tu primer comando">Guarda un saludo, un enlace o un atajo para crear recursos.</Empty> : <ul className="chat-command-list">{sorted.map(c => <li key={c.id} className="chat-command-card"><div><code>/{c.name}</code><span className="chat-command-badge">{c.visibility === 'classroom' ? 'Del salón' : 'Personal'}</span><p>{c.description || (c.actionKind === 'create' ? `Crear ${RESOURCE_LABELS[c.resourceKind ?? 'tarea'].toLowerCase()}` : c.text)}</p><small>{memberName(members, c.ownerId)} · {c.actionKind === 'create' ? 'Abre un formulario' : 'Plantilla de texto'}</small></div><div className="chat-command-actions">
          <ChatButton type="button" variant="secondary" onClick={() => tryCommand(c)}>Usar</ChatButton><ChatButton type="button" variant="tertiary" onClick={() => copy(c)}>Copiar</ChatButton>
          {c.ownerId === me?.id && <ChatButton type="button" variant="tertiary" onClick={() => startEdit(c)} aria-label={`Editar /${c.name}`}><Icon name="edit" size={16} /></ChatButton>}
          {(c.ownerId === me?.id || (me?.isCreator && c.visibility === 'classroom')) && <ChatButton type="button" variant="tertiary" onClick={() => setRemoving(c)} aria-label={`Retirar /${c.name}`}><Icon name="trash" size={16} /></ChatButton>}
        </div></li>)}</ul>}
      </section>
    </div>
    <ModalOverlay isOpen={Boolean(removing)} isDismissable={!pending} onOpenChange={open => { if (!open) setRemoving(null); }} className="b20-messaging messaging-confirm-overlay"><Modal className="messaging-confirm"><Dialog className="messaging-confirm__dialog"><Heading slot="title">Retirar /{removing?.name}</Heading><p>{removing?.visibility === 'classroom' ? 'Dejará de estar disponible para el salón.' : 'Se eliminará de tus comandos.'} Los mensajes enviados se conservan.</p>{error && <p className="error" role="alert">{error}</p>}<div className="messaging-confirm__actions"><ChatButton variant="secondary" onClick={() => setRemoving(null)} disabled={pending}>Cancelar</ChatButton><ChatButton variant="danger" loading={pending} onClick={() => void remove()}>Retirar comando</ChatButton></div></Dialog></Modal></ModalOverlay>
  </ToolPage>;
}
